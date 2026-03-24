#!/usr/bin/env python3
"""
Paroli TTS HTTP Server — Fork Mode with NPU support
Story 11.2 / FR77

Forks paroli-cli (or piper as fallback) per request.
Paroli uses the RKNN-converted decoder on NPU Core 0 for ~4x speedup,
while the encoder runs on CPU (dynamic graph, incompatible with RKNN).

Falls back to piper CLI if paroli is not available or if synthesis fails.

Port: 8880 (replaces the old piper-tts service)
API: POST /v1/audio/speech  { input, voice, response_format, speed }
     GET  /health            { status, engine, mode }
"""

import subprocess
import tempfile
import threading
import struct
import os
import sys
import json
import io
import uuid
import wave
import time
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("TTS_PORT", "8880"))
PAROLI_CLI = os.environ.get("PAROLI_CLI", "/opt/paroli/build/paroli-cli")
PIPER_CLI = os.environ.get("PIPER_CLI", "/opt/piper/piper/piper")
ENCODER_ONNX = "/opt/models/piper-streaming/encoder.onnx"
DECODER_ONNX = "/opt/models/piper-streaming/decoder.onnx"
DECODER_RKNN = "/opt/models/piper-streaming/decoder.rknn"
CONFIG_JSON = "/opt/models/piper-streaming/config.json"
PIPER_MODEL = "/opt/piper/voices/fr_FR-siwis-medium.onnx"
ESPEAK_DATA = "/opt/piper/piper/espeak-ng-data"
SAMPLE_RATE = 22050
# === TTS Cache ===
import hashlib as _hashlib
_tts_cache = {}
_TTS_CACHE_MAX = 200

def _cache_key(text, speed):
    return _hashlib.md5(f"{text}:{speed:.2f}".encode()).hexdigest()

  # Piper default
SYNTHESIS_TIMEOUT = 30  # seconds — strict timeout per synthesis

# Story 11.3 — NPU Core allocation for TTS decoder
# Core 0 (mask 0x1) is reserved for TTS via centralized npu-allocation.json
# Read from env var NPU_CORE_MASK (set by systemd) or default to 0x1
NPU_CORE_TTS = int(os.environ.get("NPU_CORE_TTS", "0"))
NPU_CORE_MASK = int(os.environ.get("NPU_CORE_MASK", "0x1"), 16)

# Load NPU allocation config if available
NPU_CONFIG_PATHS = [
    "/opt/diva-embedded/config/npu-allocation.json",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "npu-allocation.json"),
]

def _load_npu_core_mask() -> int:
    """Load TTS core mask from npu-allocation.json, env var, or default."""
    # Environment variable has highest priority
    env_mask = os.environ.get("NPU_CORE_MASK")
    if env_mask:
        return int(env_mask, 16) if env_mask.startswith("0x") else int(env_mask)

    # Try config file
    for config_path in NPU_CONFIG_PATHS:
        if os.path.exists(config_path):
            try:
                with open(config_path) as f:
                    config = json.load(f)
                mask_str = config.get("cores", {}).get("tts", {}).get("mask", "0x1")
                return int(mask_str, 16)
            except Exception:
                pass

    return 0x1  # Default: Core 0

NPU_CORE_MASK = _load_npu_core_mask()

USE_PAROLI = os.path.exists(PAROLI_CLI) and os.path.exists(ENCODER_ONNX)
USE_RKNN = USE_PAROLI and os.path.exists(DECODER_RKNN)


# =============================================================================
# Structured JSON Logging — aligned with Story 11.1 patterns
# =============================================================================

def log_json(level: str, message: str, **kwargs):
    """Emit a structured JSON log line compatible with diva-server logging."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "service": "tts",
        "msg": message,
    }
    entry.update(kwargs)
    print(json.dumps(entry, ensure_ascii=False), flush=True)


def _engine_name() -> str:
    """Return current engine name for logging and /health."""
    if USE_RKNN:
        return "paroli-npu"
    elif USE_PAROLI:
        return "paroli-cpu"
    return "piper"


# Story 11.3 / AC6 — Log core assignment at startup
log_json("info", "TTS server starting", engine=_engine_name(),
         paroli_cli=os.path.exists(PAROLI_CLI),
         encoder_onnx=os.path.exists(ENCODER_ONNX),
         decoder_rknn=os.path.exists(DECODER_RKNN),
         npuCoreMask=hex(NPU_CORE_MASK),
         npuCore=NPU_CORE_TTS)
log_json("info", "[NPU] Core 0 assigned to tts",
         service="tts", coreId=NPU_CORE_TTS,
         coreMask=hex(NPU_CORE_MASK), model="decoder.rknn")


# =============================================================================
# Paroli Daemon Process (kept for future use — daemon mode)
# =============================================================================

class ParoliDaemon:
    """Keeps paroli-cli running with model loaded in memory."""

    def __init__(self):
        self.process = None
        self.lock = threading.Lock()
        self._start()

    def _start(self):
        decoder = DECODER_RKNN if USE_RKNN else DECODER_ONNX
        cmd = [
            PAROLI_CLI,
            "--encoder", ENCODER_ONNX,
            "--decoder", decoder,
            "--config", CONFIG_JSON,
            "--espeak_data", ESPEAK_DATA,
            "--output_raw",
            "--json-input",
        ]
        # Story 11.3 / AC1 — Explicit NPU Core 0 allocation for daemon mode
        if USE_RKNN:
            cmd.extend(["--core_mask", str(NPU_CORE_MASK)])
        log_json("info", "Starting daemon", cmd=" ".join(cmd))
        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Wait for model to load (read stderr until "Initialized piper")
        def wait_ready():
            for line in self.process.stderr:
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    log_json("debug", "paroli stderr", output=text)
                if "Initialized piper" in text:
                    log_json("info", "Daemon ready (model loaded)")
                    break

        t = threading.Thread(target=wait_ready, daemon=True)
        t.start()
        t.join(timeout=30)  # Wait up to 30s for model load
        if self.process.poll() is not None:
            raise RuntimeError("Paroli daemon crashed during startup")

    def synthesize(self, text: str, length_scale: float = 1.0) -> bytes:
        """Send text to daemon and read raw PCM output."""
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                log_json("warn", "Daemon died, restarting")
                self._start()

            # Send JSON input line
            json_input = json.dumps({
                "text": text,
                "length_scale": length_scale,
                "noise_scale": 0.667,
                "noise_w": 0.8,
            }) + "\n"

            try:
                self.process.stdin.write(json_input.encode("utf-8"))
                self.process.stdin.flush()
            except BrokenPipeError:
                log_json("warn", "Daemon pipe broken, restarting")
                self._start()
                self.process.stdin.write(json_input.encode("utf-8"))
                self.process.stdin.flush()

            # Read raw PCM until silence marker
            pcm_chunks = []
            start = time.time()
            while time.time() - start < SYNTHESIS_TIMEOUT:
                data = self.process.stdout.read(4096)
                if not data:
                    break
                pcm_chunks.append(data)
                if len(data) < 4096:
                    break

            pcm_data = b"".join(pcm_chunks)
            if not pcm_data:
                raise RuntimeError("No audio data from daemon")

            return self._pcm_to_wav(pcm_data)

    def _pcm_to_wav(self, pcm_data: bytes) -> bytes:
        """Convert raw int16 PCM to WAV."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm_data)
        return buf.getvalue()

    def shutdown(self):
        if self.process:
            self.process.stdin.close()
            self.process.terminate()
            self.process.wait(timeout=5)


# =============================================================================
# Fallback: Fork-based synthesis (primary mode)
# =============================================================================

def _synthesize_with_paroli(text: str, speed: float, tmp_path: str) -> bytes:
    """Try to synthesize with paroli-cli. Raises on failure."""
    decoder = DECODER_RKNN if USE_RKNN else DECODER_ONNX
    cmd = [
        PAROLI_CLI,
        "--encoder", ENCODER_ONNX,
        "--decoder", decoder,
        "--config", CONFIG_JSON,
        "--espeak_data", ESPEAK_DATA,
        "--output_file", tmp_path,
    ]
    # Story 11.3 / AC1 — Pass core_mask to RKNN decoder for explicit Core 0 allocation
    if USE_RKNN:
        cmd.extend(["--core_mask", str(NPU_CORE_MASK)])
    if speed != 1.0:
        cmd.extend(["--length_scale", str(1.0 / speed)])

    proc = subprocess.run(
        cmd,
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=SYNTHESIS_TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"paroli-cli exit {proc.returncode}: {proc.stderr.decode()[:200]}")

    with open(tmp_path, "rb") as f:
        return f.read()


def _synthesize_with_piper(text: str, speed: float, tmp_path: str) -> bytes:
    """Synthesize with piper CLI (CPU fallback)."""
    cmd = [
        PIPER_CLI,
        "--model", PIPER_MODEL,
        "--output_file", tmp_path,
    ]
    if speed != 1.0:
        cmd.extend(["--length_scale", str(1.0 / speed)])

    proc = subprocess.run(
        cmd,
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=SYNTHESIS_TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"piper exit {proc.returncode}: {proc.stderr.decode()[:200]}")

    with open(tmp_path, "rb") as f:
        return f.read()


def synthesize_fork(text: str, speed: float = 1.0, correlation_id: str = "") -> tuple:
    """
    Fork-based synthesis with automatic fallback.

    Returns (wav_bytes, engine_used) where engine_used is one of:
    'paroli-npu', 'paroli-cpu', 'piper'.

    Fallback chain:
      1. Paroli + RKNN decoder (NPU)  — if available
      2. Paroli + ONNX decoder (CPU)  — if RKNN fails but Paroli exists
      3. Piper CLI (CPU)              — ultimate fallback
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # --- Try Paroli first ---
        if USE_PAROLI:
            try:
                wav_data = _synthesize_with_paroli(text, speed, tmp_path)
                engine = "paroli-npu" if USE_RKNN else "paroli-cpu"
                return wav_data, engine
            except Exception as e:
                # Story 11.3 / AC5 — Fallback with NPU core context
                log_json("warn", "Paroli synthesis failed, falling back to Piper",
                         core=NPU_CORE_TTS, service="tts",
                         reason=str(e)[:200], fallbackUsed="piper-cpu",
                         correlationId=correlation_id)

        # --- Fallback to Piper ---
        if os.path.exists(PIPER_CLI):
            wav_data = _synthesize_with_piper(text, speed, tmp_path)
            return wav_data, "piper"

        raise RuntimeError("No TTS engine available (paroli and piper both missing)")

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# =============================================================================
# HTTP Server
# =============================================================================

# Fork mode — daemon mode has blocking stdout issue with paroli's json-input protocol
daemon = None
log_json("info", "Using fork mode (paroli-cli per request)")


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/v1/audio/speech":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            correlation_id = self.headers.get("X-Correlation-Id", str(uuid.uuid4())[:8])

            try:
                data = json.loads(body)
                text = data.get("input", "")
                speed = data.get("speed", 1.0)

                if not text.strip():
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Empty text")
                    return

                t0 = time.time()

                # TTS Cache check
                _ck = _cache_key(text, speed)
                if _ck in _tts_cache:
                    wav_data = _tts_cache[_ck]
                    engine = "cache"
                    elapsed_ms = 0
                    log_json("info", "TTS cache hit", textLength=len(text), correlationId=correlation_id)
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/wav")
                    self.send_header("Content-Length", str(len(wav_data)))
                    self.send_header("X-TTS-Engine", "cache")
                    self.send_header("X-TTS-Duration-Ms", "0")
                    self.end_headers()
                    self.wfile.write(wav_data)
                    return

                # Try daemon first, fall back to fork
                if daemon:
                    try:
                        wav_data = daemon.synthesize(text, 1.0 / speed if speed != 0 else 1.0)
                        engine = _engine_name()
                    except Exception as e:
                        log_json("warn", "Daemon synthesis failed, using fork",
                                 reason=str(e)[:200], correlationId=correlation_id)
                        wav_data, engine = synthesize_fork(text, speed, correlation_id)
                else:
                    wav_data, engine = synthesize_fork(text, speed, correlation_id)

                elapsed_ms = round((time.time() - t0) * 1000)

                # AC8 — Structured log with metrics
                log_json("info", "Synthesis complete",
                         engine=engine,
                         durationMs=elapsed_ms,
                         textLength=len(text),
                         audioBytes=len(wav_data),
                         correlationId=correlation_id)

                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav_data)))
                self.send_header("X-TTS-Engine", engine)
                self.send_header("X-TTS-Duration-Ms", str(elapsed_ms))
                self.end_headers()
                self.wfile.write(wav_data)

                # Store in cache
                if len(_tts_cache) >= _TTS_CACHE_MAX:
                    _tts_cache.pop(next(iter(_tts_cache)), None)
                _tts_cache[_cache_key(text, speed)] = wav_data

            except Exception as e:
                elapsed_ms = round((time.time() - t0) * 1000) if 't0' in dir() else 0
                log_json("error", "Synthesis failed",
                         error=str(e)[:300],
                         textLength=len(text) if 'text' in dir() else 0,
                         durationMs=elapsed_ms,
                         correlationId=correlation_id)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            engine = _engine_name()
            mode = "daemon" if daemon else "fork"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "engine": engine,
                "mode": mode,
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default access logs



# === Pre-warm TTS cache at startup ===
def pre_warm_cache():
    """Pre-synthesize common phrases so first response is instant."""
    phrases = [
        "Salut Georges !", "Bonsoir ! Quoi de neuf ?",
        "Ça va bien, merci !", "Nickel!", "Tout roule !",
        "De rien !", "Pas de quoi !", "À ton service !",
        "Content que ça te plaise !", "OK!",
        "C'est noté.", "C'est fait !",
        "Bonne nuit ! Dors bien.", "À bientôt !",
        "Bonjour Georges ! Comment ça va ?", "Bonne journée !",
    ]
    import threading
    def _warm():
        for text in phrases:
            try:
                key = _cache_key(text, 1.0)
                if key not in _tts_cache:
                    if daemon:
                        wav = daemon.synthesize(text, 1.0)
                    else:
                        wav, _ = synthesize_fork(text, 1.0)
                    _tts_cache[key] = wav
            except: pass
        log_json("info", "TTS cache pre-warmed", count=len(_tts_cache))
    threading.Thread(target=_warm, daemon=True).start()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), TTSHandler)
    log_json("info", "Server listening", port=PORT,
             engine=_engine_name(), mode="daemon" if daemon else "fork")
    pre_warm_cache()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log_json("info", "Shutting down")
        if daemon:
            daemon.shutdown()
        server.server_close()
