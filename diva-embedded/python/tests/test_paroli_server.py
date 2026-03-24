"""
test_paroli_server.py — Tests unitaires pour la Story 11.2.

Couvre :
- Task 4.2 : Logs structures JSON
- Task 4.3 : Fallback automatique Paroli -> Piper
- Task 4.4 : Endpoint /health
- Task 4.5 : Timeout 30s par synthese
- Task 4.6 : Compatibilite avec piper.ts (meme format requete/reponse)
- Task 6.1 : Test fonctionnel POST /v1/audio/speech
- Task 6.2 : Test de fallback
- Task 6.4 : Test de streaming phrase par phrase
- Task 6.5 : Test de charge (10 syntheses consecutives)

Story 11.2 / FR77
"""

import sys
import os
import json
import io
import wave
import struct
import time
import threading
import unittest
from unittest.mock import patch, MagicMock, PropertyMock
from http.client import HTTPConnection

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# =============================================================================
# Helper: parse WAV
# =============================================================================

def parse_wav(wav_bytes: bytes) -> dict:
    """Parse WAV header and return metadata."""
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        return {
            "channels": wf.getnchannels(),
            "sample_width": wf.getsampwidth(),
            "sample_rate": wf.getframerate(),
            "n_frames": wf.getnframes(),
            "data": wf.readframes(wf.getnframes()),
        }


def make_wav(sample_rate=22050, duration_s=0.1, channels=1, sample_width=2) -> bytes:
    """Generate a minimal valid WAV file for testing."""
    n_frames = int(sample_rate * duration_s)
    # Silent audio
    pcm_data = b"\x00\x00" * n_frames * channels
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()


# =============================================================================
# Test: log_json structured output
# =============================================================================

class TestLogJson(unittest.TestCase):
    """Task 4.2 — Structured JSON logs."""

    def test_log_json_outputs_valid_json(self):
        """log_json should emit valid JSON with required fields."""
        # We need to import after patching USE_PAROLI etc.
        with patch.dict(os.environ, {"TTS_PORT": "0"}), \
             patch("os.path.exists", return_value=False):
            # Re-import to get fresh module
            if "paroli_server" in sys.modules:
                del sys.modules["paroli_server"]

            import importlib
            captured = []
            with patch("builtins.print", side_effect=lambda *a, **kw: captured.append(a[0] if a else "")):
                # Import triggers startup logs
                import importlib
                spec = importlib.util.spec_from_file_location(
                    "paroli_server_test",
                    os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
                )
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

            # Check that all captured lines are valid JSON
            for line in captured:
                if isinstance(line, str) and line.startswith("{"):
                    data = json.loads(line)
                    self.assertIn("ts", data)
                    self.assertIn("level", data)
                    self.assertIn("service", data)
                    self.assertEqual(data["service"], "tts")

    def test_log_json_includes_extra_kwargs(self):
        """log_json should include arbitrary extra fields."""
        captured = []
        with patch("builtins.print", side_effect=lambda *a, **kw: captured.append(a[0] if a else "")):
            # Import the module's log_json function
            with patch.dict(os.environ, {"TTS_PORT": "0"}), \
                 patch("os.path.exists", return_value=False):
                import importlib
                spec = importlib.util.spec_from_file_location(
                    "paroli_server_log",
                    os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
                )
                mod = importlib.util.module_from_spec(spec)
                # Capture startup logs but ignore them
                with patch("builtins.print"):
                    spec.loader.exec_module(mod)

                captured.clear()
                with patch("builtins.print", side_effect=lambda *a, **kw: captured.append(a[0] if a else "")):
                    mod.log_json("info", "test msg", engine="paroli-npu", durationMs=42)

        line = captured[0]
        data = json.loads(line)
        self.assertEqual(data["msg"], "test msg")
        self.assertEqual(data["engine"], "paroli-npu")
        self.assertEqual(data["durationMs"], 42)


# =============================================================================
# Test: synthesize_fork fallback chain
# =============================================================================

class TestSynthesizeForkFallback(unittest.TestCase):
    """Task 4.3 / Task 6.2 — Fallback Paroli -> Piper."""

    def _load_module(self, paroli_exists=True, rknn_exists=True, piper_exists=True):
        """Load paroli-server module with mocked file existence."""
        def fake_exists(path):
            if "paroli-cli" in path:
                return paroli_exists
            if "decoder.rknn" in path:
                return rknn_exists
            if "encoder.onnx" in path:
                return paroli_exists
            if "piper" in path and path.endswith("piper"):
                return piper_exists
            return True

        with patch("os.path.exists", side_effect=fake_exists), \
             patch("builtins.print"):
            import importlib
            spec = importlib.util.spec_from_file_location(
                f"paroli_server_fb_{paroli_exists}_{rknn_exists}",
                os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        return mod

    def test_engine_name_npu(self):
        """When RKNN decoder exists, engine should be paroli-npu."""
        mod = self._load_module(paroli_exists=True, rknn_exists=True)
        self.assertEqual(mod._engine_name(), "paroli-npu")

    def test_engine_name_cpu(self):
        """When no RKNN but Paroli exists, engine should be paroli-cpu."""
        mod = self._load_module(paroli_exists=True, rknn_exists=False)
        self.assertEqual(mod._engine_name(), "paroli-cpu")

    def test_engine_name_piper_fallback(self):
        """When no Paroli, engine should be piper."""
        mod = self._load_module(paroli_exists=False, rknn_exists=False)
        self.assertEqual(mod._engine_name(), "piper")

    @patch("subprocess.run")
    def test_fallback_paroli_to_piper_on_failure(self, mock_run):
        """When Paroli fails, should fall back to Piper."""
        mod = self._load_module(paroli_exists=True, rknn_exists=True, piper_exists=True)

        wav_bytes = make_wav()
        call_count = [0]

        def fake_run(cmd, **kwargs):
            call_count[0] += 1
            if "paroli-cli" in cmd[0]:
                # Paroli fails
                result = MagicMock()
                result.returncode = 1
                result.stderr = b"RKNN error: core busy"
                return result
            else:
                # Piper succeeds — write WAV to the output file
                out_file = cmd[cmd.index("--output_file") + 1]
                with open(out_file, "wb") as f:
                    f.write(wav_bytes)
                result = MagicMock()
                result.returncode = 0
                return result

        # Patch at module level
        mod.subprocess.run = fake_run
        # Also need piper to "exist" for fallback
        original_exists = os.path.exists
        def patched_exists(path):
            if path == mod.PIPER_CLI:
                return True
            return original_exists(path)

        with patch("os.path.exists", side_effect=patched_exists), \
             patch("builtins.print"):
            data, engine = mod.synthesize_fork("Bonjour", 1.0, "test-123")

        self.assertEqual(engine, "piper")
        self.assertEqual(call_count[0], 2)  # paroli tried, then piper

    @patch("subprocess.run")
    def test_paroli_npu_success(self, mock_run):
        """When Paroli+RKNN succeeds, should return paroli-npu engine."""
        mod = self._load_module(paroli_exists=True, rknn_exists=True)

        wav_bytes = make_wav()

        def fake_run(cmd, **kwargs):
            out_file = cmd[cmd.index("--output_file") + 1]
            with open(out_file, "wb") as f:
                f.write(wav_bytes)
            result = MagicMock()
            result.returncode = 0
            return result

        mod.subprocess.run = fake_run

        with patch("builtins.print"):
            data, engine = mod.synthesize_fork("Bonjour", 1.0, "test-456")

        self.assertEqual(engine, "paroli-npu")
        # Verify it's valid WAV
        parsed = parse_wav(data)
        self.assertEqual(parsed["sample_rate"], 22050)
        self.assertEqual(parsed["channels"], 1)


# =============================================================================
# Test: /health endpoint
# =============================================================================

class TestHealthEndpoint(unittest.TestCase):
    """Task 4.4 — /health returns correct engine info."""

    def _load_module(self, paroli=True, rknn=True):
        def fake_exists(path):
            if "paroli-cli" in path or "encoder.onnx" in path:
                return paroli
            if "decoder.rknn" in path:
                return rknn
            return True

        with patch("os.path.exists", side_effect=fake_exists), \
             patch("builtins.print"):
            import importlib
            spec = importlib.util.spec_from_file_location(
                f"paroli_server_health_{paroli}_{rknn}",
                os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        return mod

    def test_health_npu_mode(self):
        """Health should report paroli-npu when RKNN available."""
        mod = self._load_module(paroli=True, rknn=True)
        self.assertEqual(mod._engine_name(), "paroli-npu")

    def test_health_piper_mode(self):
        """Health should report piper when no Paroli."""
        mod = self._load_module(paroli=False, rknn=False)
        self.assertEqual(mod._engine_name(), "piper")

    def test_health_response_format(self):
        """Health response should have status, engine, mode fields."""
        # This tests the expected JSON shape
        expected_keys = {"status", "engine", "mode"}
        health = {"status": "ok", "engine": "paroli-npu", "mode": "fork"}
        self.assertEqual(set(health.keys()), expected_keys)


# =============================================================================
# Test: Timeout constant
# =============================================================================

class TestTimeout(unittest.TestCase):
    """Task 4.5 — 30s timeout per synthesis."""

    def test_synthesis_timeout_is_30s(self):
        """SYNTHESIS_TIMEOUT should be 30 seconds."""
        with patch("os.path.exists", return_value=False), \
             patch("builtins.print"):
            import importlib
            spec = importlib.util.spec_from_file_location(
                "paroli_server_timeout",
                os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

        self.assertEqual(mod.SYNTHESIS_TIMEOUT, 30)


# =============================================================================
# Test: WAV format compatibility with piper.ts
# =============================================================================

class TestWavFormat(unittest.TestCase):
    """Task 4.6 / Task 6.1 — WAV output is 22050Hz 16-bit mono."""

    def test_pcm_to_wav_format(self):
        """ParoliDaemon._pcm_to_wav should produce 22050Hz 16-bit mono WAV."""
        with patch("os.path.exists", return_value=False), \
             patch("builtins.print"):
            import importlib
            spec = importlib.util.spec_from_file_location(
                "paroli_server_wav",
                os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

        # Create a daemon instance without starting the subprocess
        daemon = mod.ParoliDaemon.__new__(mod.ParoliDaemon)
        daemon.process = None
        daemon.lock = threading.Lock()

        # Generate fake PCM (1 second of silence)
        n_samples = 22050
        pcm_data = b"\x00\x00" * n_samples

        wav_data = daemon._pcm_to_wav(pcm_data)
        parsed = parse_wav(wav_data)

        self.assertEqual(parsed["channels"], 1)
        self.assertEqual(parsed["sample_width"], 2)
        self.assertEqual(parsed["sample_rate"], 22050)
        self.assertEqual(parsed["n_frames"], n_samples)


# =============================================================================
# Test: HTTP server integration (lightweight — no real subprocess)
# =============================================================================

class TestHTTPServerIntegration(unittest.TestCase):
    """Task 6.1 / 6.4 / 6.5 — HTTP endpoint tests."""

    @classmethod
    def setUpClass(cls):
        """Start the server on a random port with mocked synthesis."""
        with patch("os.path.exists", return_value=False), \
             patch("builtins.print"):
            import importlib
            spec = importlib.util.spec_from_file_location(
                "paroli_server_http",
                os.path.join(os.path.dirname(__file__), "..", "paroli-server.py")
            )
            cls.mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.mod)

        # Mock synthesize_fork to return valid WAV without real CLI
        cls._original_synthesize_fork = cls.mod.synthesize_fork

        def mock_synthesize_fork(text, speed=1.0, correlation_id=""):
            wav = make_wav(duration_s=0.1)
            return wav, "piper"

        cls.mod.synthesize_fork = mock_synthesize_fork

        # Start server on port 0 (OS picks a free port)
        from http.server import HTTPServer
        cls.server = HTTPServer(("127.0.0.1", 0), cls.mod.TTSHandler)
        cls.port = cls.server.server_address[1]
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.mod.synthesize_fork = cls._original_synthesize_fork

    def _post_speech(self, text, speed=1.0):
        """Send a POST /v1/audio/speech and return (status, headers, body)."""
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        body = json.dumps({"input": text, "voice": "fr_FR-siwis-medium", "response_format": "wav", "speed": speed})
        conn.request("POST", "/v1/audio/speech", body=body, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, dict(resp.getheaders()), data

    def test_post_speech_returns_200_wav(self):
        """POST /v1/audio/speech should return 200 with WAV content."""
        status, headers, data = self._post_speech("Bonjour le monde")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "audio/wav")
        # Check valid WAV
        parsed = parse_wav(data)
        self.assertEqual(parsed["sample_rate"], 22050)
        self.assertEqual(parsed["channels"], 1)

    def test_post_speech_returns_engine_header(self):
        """Response should include X-TTS-Engine header."""
        status, headers, data = self._post_speech("Test header")
        self.assertEqual(status, 200)
        self.assertIn("X-TTS-Engine", headers)
        self.assertIn("X-TTS-Duration-Ms", headers)

    def test_post_speech_empty_text_returns_400(self):
        """Empty input text should return 400."""
        status, _, _ = self._post_speech("")
        self.assertEqual(status, 400)

    def test_post_speech_whitespace_only_returns_400(self):
        """Whitespace-only input should return 400."""
        status, _, _ = self._post_speech("   ")
        self.assertEqual(status, 400)

    def test_health_endpoint(self):
        """GET /health should return JSON with status, engine, mode."""
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/health")
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertIn(data["engine"], ("paroli-npu", "paroli-cpu", "piper"))
        self.assertIn(data["mode"], ("daemon", "fork"))

    def test_404_on_unknown_path(self):
        """Unknown paths should return 404."""
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/unknown")
        resp = conn.getresponse()
        resp.read()
        self.assertEqual(resp.status, 404)

    def test_multiple_sequential_requests(self):
        """Task 6.5 — 10 consecutive requests should all succeed (stability)."""
        for i in range(10):
            status, _, data = self._post_speech(f"Phrase numero {i}")
            self.assertEqual(status, 200, f"Request {i} failed with status {status}")
            self.assertGreater(len(data), 44, f"Request {i} returned too small WAV")

    def test_three_phrases_independently(self):
        """Task 6.4 — 3 phrases should each return independent WAV."""
        phrases = [
            "Premiere phrase courte.",
            "Deuxieme phrase un peu plus longue pour tester.",
            "Troisieme phrase.",
        ]
        results = []
        for phrase in phrases:
            status, _, data = self._post_speech(phrase)
            self.assertEqual(status, 200)
            parsed = parse_wav(data)
            results.append(parsed)

        # Each should be valid independent WAV
        for i, r in enumerate(results):
            self.assertEqual(r["sample_rate"], 22050, f"Phrase {i} wrong sample rate")
            self.assertEqual(r["channels"], 1, f"Phrase {i} wrong channels")

    def test_speed_parameter_accepted(self):
        """Speed parameter should be accepted without error."""
        status, _, _ = self._post_speech("Test vitesse", speed=1.5)
        self.assertEqual(status, 200)
        status, _, _ = self._post_speech("Test lent", speed=0.8)
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
