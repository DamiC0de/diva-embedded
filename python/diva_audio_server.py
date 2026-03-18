#!/usr/bin/env python3
"""
diva-audio-server.py — Serveur HTTP pour les services audio de Diva.

Remplace wakeword_server.py TCP par un serveur FastAPI stateless.
Node.js orchestre, Python exécute.

Usage :
    uvicorn diva_audio_server:app --host 0.0.0.0 --port 9010
    # ou
    python diva_audio_server.py
"""

import asyncio
import base64
import io
import os
import subprocess
import tempfile
import time
import wave
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# === CONFIGURATION ===
ALSA_CARD = os.environ.get("ALSA_CARD", "5")
ALSA_DEVICE = f"plughw:{ALSA_CARD}"
SAMPLE_RATE = 16000
CHANNELS = 1

# Wake word
WAKEWORD_MODEL_PATH = "/opt/diva-embedded/assets/diva_fr.onnx"
WAKEWORD_THRESHOLD = 0.7

# VAD
SILENCE_TIMEOUT_S = 0.8
MIN_SPEECH_MS = 300


# === GLOBALS (initialisés au démarrage) ===
oww_model = None
vad_model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Charger les modèles au démarrage."""
    global oww_model, vad_model

    print("[INIT] Chargement openWakeWord...")
    from openwakeword.model import Model
    oww_model = Model(
        wakeword_model_paths=[WAKEWORD_MODEL_PATH],
    )
    print(f"[INIT] Wake word modèle chargé: {WAKEWORD_MODEL_PATH}")

    print("[INIT] Chargement Silero VAD...")
    import torch
    vad_model, _ = torch.hub.load(
        "snakers4/silero-vad", "silero_vad",
        force_reload=False, onnx=True
    )
    print("[INIT] Silero VAD chargé")

    print("[INIT] ✅ Serveur audio Diva prêt sur port 9010")
    yield
    print("[SHUTDOWN] Arrêt du serveur audio")


app = FastAPI(title="Diva Audio Server", lifespan=lifespan)


# =====================================================================
# MODELS (Pydantic)
# =====================================================================

class PlayRequest(BaseModel):
    path: str

class PlayBytesRequest(BaseModel):
    wav_base64: str

class RecordRequest(BaseModel):
    max_duration_s: float = 10.0
    silence_timeout_s: float = SILENCE_TIMEOUT_S
    min_speech_ms: float = MIN_SPEECH_MS

class WakewordRequest(BaseModel):
    timeout_s: float = 0


# Global mute flag
is_muted = False

# =====================================================================
# ENDPOINT : /health
# =====================================================================

@app.get("/health")
async def health():
    """Status du serveur."""
    return {
        "status": "ok",
        "wakeword_loaded": oww_model is not None,
        "vad_loaded": vad_model is not None,
        "alsa_device": ALSA_DEVICE,
    }


# =====================================================================
# ENDPOINT : /wakeword/wait
# =====================================================================

@app.get("/wakeword/test")
async def wakeword_test():
    """Test endpoint - retourne immédiatement."""
    return {"test": True, "model_loaded": oww_model is not None, "threshold": WAKEWORD_THRESHOLD}


@app.post("/wakeword/wait")
async def wakeword_wait(req: WakewordRequest):
    """Bloque jusqu'à ce que le wake word soit détecté."""
    if oww_model is None:
        raise HTTPException(500, "Wake word model not loaded")

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _wakeword_listen, req.timeout_s)

    if result is None:
        raise HTTPException(408, "Timeout waiting for wake word")

    return {
        "detected": True,
        "score": result["score"],
        "timestamp": time.time(),
    }


def _wakeword_listen(timeout_s: float) -> dict | None:
    """Écoute le micro en continu et retourne quand le wake word est détecté."""
    # Reset le modèle et drain le buffer audio
    oww_model.reset()
    time.sleep(0.5)  # Laisser le buffer se vider après playback
    proc = subprocess.Popen(
        [
            "arecord", "-D", ALSA_DEVICE,
            "-f", "S16_LE", "-r", str(SAMPLE_RATE),
            "-c", str(CHANNELS), "-t", "raw",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    CHUNK_SAMPLES = 1280  # 80ms à 16kHz
    CHUNK_BYTES = CHUNK_SAMPLES * 2

    # Drain: lire et jeter 20 frames (~1.6s) pour vider l'écho résiduel
    for _ in range(20):
        proc.stdout.read(CHUNK_BYTES)
    oww_model.reset()  # Reset après drain

    start_time = time.time()

    try:
        while True:
            if timeout_s > 0 and (time.time() - start_time) > timeout_s:
                return None

            raw = proc.stdout.read(CHUNK_BYTES)
            if len(raw) < CHUNK_BYTES:
                continue

            # Skip si muted
            if is_muted:
                oww_model.reset()
                time.sleep(0.1)
                continue

            audio = np.frombuffer(raw, dtype=np.int16)
            prediction = oww_model.predict(audio)

            for model_name, score in prediction.items():
                if score > 0.5: print(f"[WW] Score: {score:.3f}", flush=True)
                if score >= WAKEWORD_THRESHOLD:
                    oww_model.reset()
                    return {"score": float(score), "model": model_name}

    finally:
        proc.terminate()
        proc.wait()


# =====================================================================
# ENDPOINT : /audio/record
# =====================================================================

@app.post("/audio/record")
async def audio_record(req: RecordRequest):
    """Enregistre l'audio du micro avec détection VAD."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _record_with_vad,
        req.max_duration_s, req.silence_timeout_s, req.min_speech_ms
    )

    if result is None:
        return {"has_speech": False, "reason": "no_speech_detected"}

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(result["audio_bytes"])
    wav_buffer.seek(0)

    return {
        "has_speech": True,
        "wav_base64": base64.b64encode(wav_buffer.read()).decode("ascii"),
        "duration_ms": result["duration_ms"],
    }


def _record_with_vad(
    max_duration_s: float,
    silence_timeout_s: float,
    min_speech_ms: float,
) -> dict | None:
    """Enregistre avec VAD Silero."""
    subprocess.run(["pkill", "-9", "arecord"], capture_output=True)
    time.sleep(0.2)
    import torch

    proc = subprocess.Popen(
        [
            "arecord", "-D", ALSA_DEVICE,
            "-f", "S16_LE", "-r", str(SAMPLE_RATE),
            "-c", str(CHANNELS), "-t", "raw",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    CHUNK_MS = 32
    CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_MS / 1000)
    CHUNK_BYTES = CHUNK_SAMPLES * 2

    all_audio = bytearray()
    speech_started = False
    last_speech_time = time.time()
    start_time = time.time()

    try:
        while True:
            elapsed = time.time() - start_time

            if elapsed > max_duration_s:
                break

            raw = proc.stdout.read(CHUNK_BYTES)
            if len(raw) < CHUNK_BYTES:
                continue

            audio_int16 = np.frombuffer(raw, dtype=np.int16)
            audio_float = audio_int16.astype(np.float32) / 32768.0
            audio_tensor = torch.from_numpy(audio_float)

            # VAD check
            speech_prob = vad_model(audio_tensor, SAMPLE_RATE).item()

            if speech_prob > 0.5:
                speech_started = True
                last_speech_time = time.time()
                all_audio.extend(raw)
            elif speech_started:
                all_audio.extend(raw)
                if time.time() - last_speech_time > silence_timeout_s:
                    break
            else:
                # Pas encore de parole
                if elapsed > 5.0:
                    return None

    finally:
        proc.terminate()
        proc.wait()

    if not all_audio:
        return None

    duration_ms = len(all_audio) / 2 / SAMPLE_RATE * 1000

    if duration_ms < min_speech_ms:
        return None

    return {
        "audio_bytes": bytes(all_audio),
        "duration_ms": int(duration_ms),
    }


# =====================================================================
# ENDPOINT : /audio/play
# =====================================================================

@app.post("/audio/play")
async def audio_play(req: PlayRequest):
    """Joue un fichier WAV via aplay."""
    if not os.path.exists(req.path):
        raise HTTPException(404, f"File not found: {req.path}")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _play_wav_safe, req.path)

    return {"played": True, "path": req.path}


@app.post("/audio/play-bytes")
async def audio_play_bytes(req: PlayBytesRequest):
    """Joue des bytes WAV (base64) via aplay."""
    wav_bytes = base64.b64decode(req.wav_base64)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _play_wav_bytes_safe, wav_bytes)

    return {"played": True, "size": len(wav_bytes)}


def _play_wav_safe(wav_path: str):
    """Jouer un WAV avec mute micro."""
    _mute_mic()
    try:
        subprocess.run(
            ["aplay", "-D", ALSA_DEVICE, wav_path],
            capture_output=True, timeout=30
        )
        time.sleep(0.3)  # Laisser l'écho se dissiper avant unmute
    finally:
        _unmute_mic()


def _play_wav_bytes_safe(wav_bytes: bytes):
    """Jouer des bytes WAV avec mute micro."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
        tmp.write(wav_bytes)
        tmp.flush()
        _play_wav_safe(tmp.name)


# =====================================================================
# ENDPOINT : /mic/mute et /mic/unmute
# =====================================================================

@app.post("/mic/mute")
async def mic_mute():
    """Couper le micro."""
    _mute_mic()
    return {"muted": True}


@app.post("/mic/unmute")
async def mic_unmute():
    """Rouvrir le micro."""
    _unmute_mic()
    return {"muted": False}


def _mute_mic():
    global is_muted
    is_muted = True


def _unmute_mic():
    global is_muted
    is_muted = False
    time.sleep(0.1)  # Wait for audio buffer to clear


# =====================================================================
# MAIN
# =====================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9010, log_level="info")
