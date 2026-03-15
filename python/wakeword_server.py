#!/usr/bin/env python3
"""
Diva PROTO — Wake word + voice capture + playback.
Python handles ALL audio. Node.js handles APIs only.
Communication: TCP JSON lines on port 9001.

Flow:
1. Open mic, run OpenWakeWord continuously
2. Wake word detected → stop wake word, capture voice until silence
3. Send audio as base64 WAV to Node via TCP
4. Receive play command from Node (WAV path)
5. Play WAV via aplay
6. Resume wake word listening
"""

import json
import socket
import sys
import os
import time
import subprocess
import struct
import base64
import wave
import tempfile
import urllib.request

import numpy as np

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HOST = "127.0.0.1"
PORT = 9001
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80ms at 16kHz
BYTES_PER_CHUNK = CHUNK_SAMPLES * 2  # 16-bit
THRESHOLD = 0.5
SILENCE_TIMEOUT_S = 2.5
MAX_RECORD_S = 30
ENERGY_THRESHOLD = 500  # RMS threshold for VAD

MODEL_NAME = "hey_jarvis_v0.1"
MODEL_FILE = f"{MODEL_NAME}.onnx"
MODEL_URL = f"https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/{MODEL_FILE}"


# ---------------------------------------------------------------------------
# Auto-detect ReSpeaker card number
# ---------------------------------------------------------------------------
def detect_respeaker_card() -> str:
    """Auto-detect ReSpeaker Lite USB card number via arecord -l."""
    try:
        result = subprocess.run(
            ["arecord", "-l"], capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if "ReSpeaker" in line or "respeaker" in line.lower():
                # Line format: "card X: ..."
                parts = line.split(":")
                if parts:
                    card_str = parts[0].strip().split()[-1]
                    if card_str.isdigit():
                        device = f"plughw:{card_str}"
                        print(f"[Wake] Auto-detected ReSpeaker on {device}", flush=True)
                        return device
    except Exception as e:
        print(f"[Wake] arecord -l failed: {e}", flush=True)

    # Fallback to env or default
    fallback = os.environ.get("AUDIO_INPUT_DEVICE", "plughw:5")
    print(f"[Wake] ReSpeaker not found, using fallback: {fallback}", flush=True)
    return fallback


# ---------------------------------------------------------------------------
# Download wake word model if missing
# ---------------------------------------------------------------------------
def ensure_model() -> str:
    """Find or download hey_jarvis model. Returns path to model file."""
    # First check in openwakeword package directory
    try:
        import openwakeword
        pkg_dir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
        pkg_model = os.path.join(pkg_dir, MODEL_FILE)
        if os.path.exists(pkg_model) and os.path.getsize(pkg_model) > 100000:
            print(f"[Wake] Model found in package: {pkg_model}", flush=True)
            return pkg_model
    except Exception:
        pass

    # Fallback: download to project models dir
    model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, MODEL_FILE)

    if os.path.exists(model_path) and os.path.getsize(model_path) > 100000:
        print(f"[Wake] Model found: {model_path}", flush=True)
        return model_path

    print(f"[Wake] Downloading model from {MODEL_URL}...", flush=True)
    try:
        urllib.request.urlretrieve(MODEL_URL, model_path)
        print(f"[Wake] Model downloaded: {model_path}", flush=True)
    except Exception as e:
        print(f"[Wake] ERROR downloading model: {e}", flush=True)
        sys.exit(1)

    return model_path


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------
def open_mic(device: str) -> subprocess.Popen:
    """Open microphone via arecord, returns Popen with stdout as raw PCM."""
    proc = subprocess.Popen(
        ["arecord", "-D", device, "-f", "S16_LE", "-r", str(SAMPLE_RATE),
         "-c", "1", "-t", "raw", "-q"],
        stdout=subprocess.PIPE
    )
    print(f"[Wake] Mic opened on {device} (pid={proc.pid})", flush=True)
    return proc


def close_mic(proc: subprocess.Popen | None):
    """Safely close microphone process."""
    if proc is None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    print("[Wake] Mic closed", flush=True)


def compute_rms(raw: bytes) -> float:
    """Compute RMS energy of 16-bit PCM audio."""
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples ** 2)))


def pcm_to_wav_bytes(pcm: bytes) -> bytes:
    """Convert raw PCM to WAV format in memory."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        with wave.open(tmp.name, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm)
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)


def play_wav(path: str, device: str):
    """Play a WAV file via aplay."""
    print(f"[Wake] Playing {path}...", flush=True)
    try:
        subprocess.run(
            ["aplay", "-D", device, path],
            timeout=60, capture_output=True
        )
        print("[Wake] Playback done", flush=True)
    except subprocess.TimeoutExpired:
        print("[Wake] Playback timed out", flush=True)
    except Exception as e:
        print(f"[Wake] Playback error: {e}", flush=True)


# ---------------------------------------------------------------------------
# TCP communication
# ---------------------------------------------------------------------------
def send_json(sock: socket.socket, data: dict):
    """Send a JSON line over TCP."""
    msg = json.dumps(data) + "\n"
    sock.sendall(msg.encode())


def recv_json(sock: socket.socket, timeout: float = 30.0) -> dict | None:
    """Receive a JSON line from TCP with timeout."""
    sock.settimeout(timeout)
    buf = b""
    try:
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                return None
            buf += chunk
            if b"\n" in buf:
                line, _ = buf.split(b"\n", 1)
                return json.loads(line.decode())
    except socket.timeout:
        print("[Wake] TCP recv timeout", flush=True)
        return None
    except Exception as e:
        print(f"[Wake] TCP recv error: {e}", flush=True)
        return None


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    # Step 1: Detect hardware
    device = detect_respeaker_card()

    # Step 2: Ensure model is downloaded
    model_path = ensure_model()

    # Step 3: Load OpenWakeWord model
    print("[Wake] Loading wake word model...", flush=True)
    try:
        from openwakeword.model import Model
    except ImportError:
        print("[Wake] ERROR: openwakeword not installed. Run: pip3 install openwakeword", flush=True)
        sys.exit(1)

    # Ensure embedding/melspectrogram ONNX models are available
    try:
        import openwakeword
        pkg_dir = os.path.dirname(openwakeword.__file__)
        res_dir = os.path.join(pkg_dir, "resources", "models")
        os.makedirs(res_dir, exist_ok=True)
        # Download onnx feature models and copy over tflite names (openwakeword defaults to tflite)
        for feat in ["melspectrogram", "embedding_model"]:
            onnx_path = os.path.join(res_dir, f"{feat}.onnx")
            tflite_path = os.path.join(res_dir, f"{feat}.tflite")
            # Download onnx if missing
            if not os.path.exists(onnx_path) or os.path.getsize(onnx_path) < 10000:
                url = f"https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/{feat}.onnx"
                print(f"[Wake] Downloading {feat}.onnx...", flush=True)
                urllib.request.urlretrieve(url, onnx_path)
            # Copy onnx over tflite so the default loader finds it
            import shutil
            shutil.copy2(onnx_path, tflite_path)
    except Exception as e:
        print(f"[Wake] Warning: could not ensure feature models: {e}", flush=True)

    model = Model(wakeword_model_paths=[model_path])
    loaded = list(model.models.keys()) if hasattr(model, 'models') else list(model.prediction_buffer.keys())
    print(f"[Wake] Models loaded: {loaded}", flush=True)
    if not loaded:
        print("[Wake] FATAL: No models loaded! Exiting.", flush=True)
        sys.exit(1)

    # Step 4: Connect to Node.js TCP server
    print(f"[Wake] Connecting to Node.js on {HOST}:{PORT}...", flush=True)
    max_retries = 30
    conn = None
    for attempt in range(max_retries):
        try:
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.connect((HOST, PORT))
            print(f"[Wake] Connected to Node.js", flush=True)
            break
        except ConnectionRefusedError:
            conn.close()
            conn = None
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                print(f"[Wake] Could not connect to Node.js after {max_retries} attempts", flush=True)
                sys.exit(1)

    # Step 5: Main loop
    mic_proc = None
    try:
        while True:
            # --- Wake word detection phase ---
            print("\n[Wake] Listening for wake word...", flush=True)
            mic_proc = open_mic(device)

            detected = False
            while not detected:
                raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                if not raw or len(raw) < BYTES_PER_CHUNK:
                    time.sleep(0.01)
                    continue

                audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                model.predict(audio)

                for model_name, scores in model.prediction_buffer.items():
                    if len(scores) > 0 and scores[-1] > THRESHOLD:
                        print(f"[Wake] *** WAKE WORD DETECTED *** (score={scores[-1]:.3f})", flush=True)
                        model.reset()
                        detected = True
                        break

            # --- Voice capture phase ---
            # Keep using the same mic process (already open)
            print("[Wake] Recording voice...", flush=True)
            chunks = []
            last_voice_time = time.time()
            start_time = time.time()

            while True:
                raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                if not raw or len(raw) < BYTES_PER_CHUNK:
                    time.sleep(0.01)
                    continue

                chunks.append(raw)
                rms = compute_rms(raw)

                if rms > ENERGY_THRESHOLD:
                    last_voice_time = time.time()

                now = time.time()
                elapsed = now - start_time
                silence_duration = now - last_voice_time

                if silence_duration > SILENCE_TIMEOUT_S:
                    print(f"[Wake] Silence detected after {elapsed:.1f}s", flush=True)
                    break
                if elapsed > MAX_RECORD_S:
                    print(f"[Wake] Max recording time reached ({MAX_RECORD_S}s)", flush=True)
                    break

            # Close mic before sending/playing
            close_mic(mic_proc)
            mic_proc = None

            # Check if we got enough audio
            pcm_data = b"".join(chunks)
            duration_s = len(pcm_data) / (SAMPLE_RATE * 2)
            print(f"[Wake] Captured {duration_s:.1f}s of audio ({len(pcm_data)} bytes)", flush=True)

            if duration_s < 0.3:
                print("[Wake] Audio too short, ignoring", flush=True)
                continue

            # Convert to WAV and send to Node.js
            wav_data = pcm_to_wav_bytes(pcm_data)
            b64_audio = base64.b64encode(wav_data).decode("ascii")

            print("[Wake] Sending audio to Node.js...", flush=True)
            send_json(conn, {
                "type": "audio",
                "data": b64_audio
            })

            # Wait for response from Node.js
            print("[Wake] Waiting for response...", flush=True)
            response = recv_json(conn, timeout=60)

            if response and response.get("type") == "play":
                wav_path = response.get("path", "")
                if wav_path and os.path.exists(wav_path):
                    play_wav(wav_path, device)
                else:
                    print(f"[Wake] WAV file not found: {wav_path}", flush=True)
            elif response and response.get("type") == "error":
                print(f"[Wake] Node.js error: {response.get('message', 'unknown')}", flush=True)
            else:
                print(f"[Wake] Unexpected response: {response}", flush=True)

    except KeyboardInterrupt:
        print("\n[Wake] Interrupted by user", flush=True)
    except BrokenPipeError:
        print("[Wake] Node.js disconnected", flush=True)
    except Exception as e:
        print(f"[Wake] Fatal error: {e}", flush=True)
    finally:
        close_mic(mic_proc)
        if conn:
            conn.close()
        print("[Wake] Server stopped", flush=True)


if __name__ == "__main__":
    main()
