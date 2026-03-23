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
import collections
import io
import json as _json
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
from typing import Optional

from circular_buffer import CircularAudioBuffer
from wakeword_variants import detect_prefix, adjust_score, PrefixResult, DEFAULT_VARIANTS
from wakeword_tiering import determine_tier, WakewordTier, TieringResult
from wakeword_threshold import DynamicThreshold, SpeakerCache, detect_fuzzy_match
from processing_feedback import ProcessingFeedback
from prosody_analyzer import ProsodyAnalyzer, ProsodyResult
from vocal_register_analyzer import VocalRegisterAnalyzer, VocalRegister
from wakeword_prosody_analyzer import WakewordProsodyAnalyzer, WakewordProsody, InteractionMode

# === CONFIGURATION ===
ALSA_CARD = os.environ.get("ALSA_CARD", "5")
ALSA_DEVICE = f"plughw:{ALSA_CARD}"
SAMPLE_RATE = 16000
CHANNELS = 1

# Wake word
WAKEWORD_MODEL_PATH = "/opt/diva-embedded/assets/diva_fr.onnx"

# --- Tunable config (loaded from JSON, modifiable via API) ---
_TUNING_PATH = "/opt/diva-embedded/data/tuning.json"
_DEFAULT_TUNING = {
    "wakeword_threshold": 0.7,
    "wakeword_drain_frames": 20,
    "vad_silence_timeout_s": 0.8,
    "vad_min_speech_ms": 300,
    "vad_speech_prob_threshold": 0.5,
    "wakeword_log_threshold": 0.5,
    "record_max_wait_s": 5.0,
    "post_play_delay_s": 0.3,
    "post_wakeword_delay_s": 0.5,
    "circular_buffer_duration_s": 3.0,
    "post_wakeword_capture_s": 2.0,
    "pre_audio_min_speech_ms": 200,
    "wakeword_variants": ["Hey Diva", "Oh Diva", "Dis Diva", "Diva ?", "Eh Diva"],
    "wakeword_prefix_boost": 0.15,
    "wakeword_no_prefix_penalty": 0.10,
    "wakeword_prefix_window_ms": 500,
    "wakeword_tier_high": 0.90,
    "wakeword_tier_medium": 0.60,
    "wakeword_medium_listen_s": 3.0,
    "wakeword_chime_enabled": True,
    "wakeword_attention_enabled": True,
    "wakeword_deactivation_sound_enabled": False,
    "wakeword_false_positive_cooldown_s": 2.0,
    "wakeword_chime_latency_target_ms": 100,
    "wakeword_threshold_adult": 0.90,
    "wakeword_threshold_child": 0.70,
    # Story 27.5: Processing feedback
    "processing_feedback_enabled": True,
    "processing_feedback_delay_ms": 2000,
    "processing_feedback_volume": 0.2,
    "processing_feedback_max_duration_s": 15,
    "processing_feedback_fadeout_ms": 300,
    # Story 27.6: Prosody endpoint detection
    "prosody_endpoint_enabled": True,
    "prosody_early_cutoff_s": 0.4,
    "prosody_hesitation_timeout_s": 1.5,
    "prosody_f0_weight": 0.35,
    "prosody_energy_weight": 0.25,
    "prosody_lengthening_weight": 0.20,
    "prosody_hesitation_weight": 0.20,
    "prosody_score_high_threshold": 0.8,
    "prosody_score_low_threshold": 0.3,
    # Story 28.1: Vocal register analysis
    "register_whisper_rms_db": -35.0,
    "register_pressed_rate_threshold": 5.5,
    "register_calm_rate_max": 4.5,
    "register_analysis_enabled": True,
    # Story 28.2: Wakeword prosody analysis
    "prosody_short_duration_ms": 350,
    "prosody_long_duration_ms": 600,
    "prosody_alert_rms_db": -15.0,
    "prosody_confidence_threshold": 0.6,
    "prosody_analysis_enabled": True,
    "prosody_wakeword_buffer_ms": 800,
}

def _load_tuning():
    try:
        with open(_TUNING_PATH) as f:
            saved = _json.load(f)
            merged = {**_DEFAULT_TUNING, **saved}
            return merged
    except Exception:
        return dict(_DEFAULT_TUNING)

def _save_tuning(cfg):
    with open(_TUNING_PATH, "w") as f:
        _json.dump(cfg, f, indent=2)

tuning = _load_tuning()
_save_tuning(tuning)  # ensure file exists with all keys

# Legacy aliases for backward compat
WAKEWORD_THRESHOLD = tuning["wakeword_threshold"]
SILENCE_TIMEOUT_S = tuning["vad_silence_timeout_s"]
MIN_SPEECH_MS = tuning["vad_min_speech_ms"]

# Story 2.6: Dynamic threshold based on speaker persona
dynamic_threshold = DynamicThreshold(
    adult_threshold=tuning.get("wakeword_threshold_adult", 0.90),
    child_threshold=tuning.get("wakeword_threshold_child", 0.70),
)
speaker_cache = SpeakerCache(ttl_s=30.0, api_url="http://localhost:3002")


# === GLOBALS (initialisés au démarrage) ===
oww_model = None
vad_model = None

# Preloaded feedback sounds (loaded in lifespan)
_preloaded_sounds: dict[str, bytes] = {}

# Story 27.5: Processing feedback instance (initialized in lifespan)
_processing_feedback: Optional[ProcessingFeedback] = None
# Story 27.6: Prosody analyzer instance (initialized in lifespan)
_prosody_analyzer: Optional[ProsodyAnalyzer] = None
# Story 28.1: Vocal register analyzer instance (initialized in lifespan)
_vocal_register_analyzer: Optional[VocalRegisterAnalyzer] = None
# Story 28.2: Wakeword prosody analyzer instance (initialized in lifespan)
_wakeword_prosody_analyzer: Optional[WakewordProsodyAnalyzer] = None
# Flag shared with filler system to check if audio is playing
_filler_audio_playing: bool = False

ASSETS_DIR = "/opt/diva-embedded/assets"

# --- Story 27.4: False positive cooldown ---
_last_silent_dismiss_time: float = 0.0

# --- Story 29.1: VAD activity tracking for proactive scheduler ---
_last_vad_ts: float = 0.0  # timestamp of last VAD speech detection
_active_speakers_estimate: int = 0  # estimated number of distinct speakers (0, 1, 2+)

# --- Story 27.4: Wakeword metrics ---
_wakeword_events: collections.deque = collections.deque(maxlen=1000)
_wakeword_metrics = {
    "total_detections": 0,
    "false_positives": 0,
    "true_positives": 0,
    "silent_dismissals": 0,
    "low_tier_ignores": 0,
}


def _record_wakeword_event(event_type: str) -> None:
    """Record a wakeword event for metrics tracking.

    Args:
        event_type: "true_positive", "false_positive", or "low_tier_ignore"
    """
    now = time.time()

    # Prune events older than 24h
    cutoff = now - 86400
    while _wakeword_events and _wakeword_events[0]["timestamp"] < cutoff:
        _wakeword_events.popleft()

    _wakeword_events.append({"timestamp": now, "type": event_type})
    _wakeword_metrics["total_detections"] += 1

    if event_type == "true_positive":
        _wakeword_metrics["true_positives"] += 1
    elif event_type == "false_positive":
        _wakeword_metrics["false_positives"] += 1
        _wakeword_metrics["silent_dismissals"] += 1
    elif event_type == "low_tier_ignore":
        _wakeword_metrics["low_tier_ignores"] += 1


def _get_fp_ratio_24h() -> float:
    """Calculate false positive ratio over 24h sliding window."""
    now = time.time()
    cutoff = now - 86400
    tp = sum(1 for e in _wakeword_events if e["timestamp"] >= cutoff and e["type"] == "true_positive")
    fp = sum(1 for e in _wakeword_events if e["timestamp"] >= cutoff and e["type"] == "false_positive")
    total = tp + fp
    if total == 0:
        return 0.0
    return fp / total


def play_feedback(sound_name: str, volume: float = 1.0) -> float:
    """Joue un son precharge en arriere-plan via aplay (non-bloquant, sub-100ms).

    Args:
        sound_name: "chime", "attention" ou "deactivate"
        volume: multiplicateur de volume entre 0.0 et 1.0 (defaut 1.0)

    Returns:
        latency_ms: delai entre appel et debut du playback (ms)
    """
    t_start = time.perf_counter()

    wav_bytes = _preloaded_sounds.get(sound_name)
    if not wav_bytes:
        print(f"[FEEDBACK] Sound '{sound_name}' not preloaded, skipping")
        return 0.0

    # Apply volume scaling if needed
    if volume < 1.0 and len(wav_bytes) > 44:
        # WAV header is 44 bytes, PCM data follows
        header = wav_bytes[:44]
        pcm_data = wav_bytes[44:]
        samples = np.frombuffer(pcm_data, dtype=np.int16)
        scaled = (samples.astype(np.float32) * volume).clip(-32768, 32767).astype(np.int16)
        wav_bytes = header + scaled.tobytes()

    try:
        # Non-blocking: Popen + stdin pipe to avoid disk I/O
        proc = subprocess.Popen(
            ["aplay", "-D", ALSA_DEVICE, "-q"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.stdin.write(wav_bytes)
        proc.stdin.close()
        # Don't wait — non-blocking for sub-100ms latency
    except Exception as e:
        print(f"[FEEDBACK] Error playing {sound_name}: {e}")

    latency_ms = (time.perf_counter() - t_start) * 1000
    target_ms = tuning.get("wakeword_chime_latency_target_ms", 100)
    if latency_ms > target_ms:
        print(f"[FEEDBACK] WARNING: {sound_name} latency {latency_ms:.1f}ms > target {target_ms}ms", flush=True)
    else:
        print(f"[FEEDBACK] {sound_name} latency: {latency_ms:.1f}ms", flush=True)

    return latency_ms


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

    # Story 27.3 + 27.4: Preload feedback sounds into memory for sub-100ms playback
    for sound_name in ("chime", "attention", "deactivate"):
        sound_path = os.path.join(ASSETS_DIR, f"{sound_name}.wav")
        try:
            with open(sound_path, "rb") as sf:
                _preloaded_sounds[sound_name] = sf.read()
            print(f"[INIT] Preloaded {sound_name}.wav ({len(_preloaded_sounds[sound_name])} bytes)")
        except FileNotFoundError:
            print(f"[INIT] WARNING: {sound_path} not found — feedback sound disabled")

    # Story 27.5: Initialize processing feedback with generated audio
    global _processing_feedback
    _processing_feedback = ProcessingFeedback(
        alsa_device=ALSA_DEVICE,
        duration_s=tuning.get("processing_feedback_max_duration_s", 15),
    )
    print(f"[INIT] Processing feedback generated ({len(_processing_feedback._wav_bytes)} bytes)")

    # Story 27.6: Initialize prosody analyzer
    global _prosody_analyzer
    _prosody_analyzer = ProsodyAnalyzer(sample_rate=SAMPLE_RATE, frame_size=512)
    print("[INIT] Prosody analyzer initialized")

    # Story 28.1: Initialize vocal register analyzer
    global _vocal_register_analyzer
    _vocal_register_analyzer = VocalRegisterAnalyzer(tuning=tuning)
    print("[INIT] Vocal register analyzer initialized")

    # Story 28.2: Initialize wakeword prosody analyzer
    global _wakeword_prosody_analyzer
    _wakeword_prosody_analyzer = WakewordProsodyAnalyzer(tuning=tuning)
    print("[INIT] Wakeword prosody analyzer initialized")

    # Story 27.4: Start daily metrics logger
    async def _daily_metrics_logger():
        while True:
            await asyncio.sleep(86400)  # 24h
            ratio = _get_fp_ratio_24h()
            log_entry = {
                "event": "wakeword_daily_metrics",
                "total_detections": _wakeword_metrics["total_detections"],
                "true_positives": _wakeword_metrics["true_positives"],
                "false_positives": _wakeword_metrics["false_positives"],
                "silent_dismissals": _wakeword_metrics["silent_dismissals"],
                "low_tier_ignores": _wakeword_metrics["low_tier_ignores"],
                "fp_ratio_24h": round(ratio, 4),
            }
            print(f"[METRICS] {_json.dumps(log_entry)}", flush=True)
            if ratio > 0.10:
                print("[METRICS] CRITICAL: FP ratio > 10% — review wake-word model or tiering thresholds", flush=True)
            elif ratio > 0.05:
                print("[METRICS] WARNING: FP ratio > 5% — consider adjusting thresholds", flush=True)

    _metrics_task = asyncio.create_task(_daily_metrics_logger())

    print("[INIT] Serveur audio Diva pret sur port 9010")
    yield
    _metrics_task.cancel()
    print("[SHUTDOWN] Arret du serveur audio")


app = FastAPI(title="Diva Audio Server", lifespan=lifespan)


# =====================================================================
# MODELS (Pydantic)
# =====================================================================

class PlayRequest(BaseModel):
    path: str

class PlayBytesRequest(BaseModel):
    wav_base64: str
    volume_percent: int = 100  # Story 28.1: Optional volume attenuation (0-100)

class RecordRequest(BaseModel):
    max_duration_s: float = 10.0
    silence_timeout_s: float = SILENCE_TIMEOUT_S
    min_speech_ms: float = MIN_SPEECH_MS

class WakewordRequest(BaseModel):
    timeout_s: float = 0
    capture_post_audio_s: Optional[float] = None  # None = use tuning default


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
    """Bloque jusqu'à ce que le wake word soit détecté.

    Retourne pre_audio_base64 (buffer circulaire avant le wake-word)
    et post_audio_base64 (audio capture apres le wake-word) si disponibles.
    """
    if oww_model is None:
        raise HTTPException(500, "Wake word model not loaded")

    capture_post_s = req.capture_post_audio_s if req.capture_post_audio_s is not None else tuning["post_wakeword_capture_s"]

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _wakeword_listen, req.timeout_s, capture_post_s)

    if result is None:
        raise HTTPException(408, "Timeout waiting for wake word")

    # Story 27.3: Determine action based on tier
    action = result.get("action", "process")
    tier = result.get("tier", "HIGH")
    detected = action == "process"

    response = {
        "detected": detected,
        "score": result["score"],
        "timestamp": time.time(),
        # Story 27.3: Tiering fields
        "tier": tier,
        "action": action,
        "score_raw": result["score"],
        "feedback_played": result.get("feedback_played", False),
        # Story 27.4: Latency and false positive fields
        "latency_feedback_ms": result.get("latency_feedback_ms", 0.0),
        "false_positive": result.get("false_positive", False),
        # Story 2.6: Persona context
        "persona_type": result.get("persona_type", "unknown"),
        "threshold_applied": result.get("threshold_applied", tuning.get("wakeword_threshold", 0.85)),
        "fuzzy_boost": result.get("fuzzy_boost", 0.0),
    }

    # Story 27.4: Dismiss reason (if applicable)
    if result.get("dismiss_reason") is not None:
        response["dismiss_reason"] = result["dismiss_reason"]

    # Story 27.2: Variant detection and adjusted score
    if result.get("score_adjusted") is not None:
        response["score_adjusted"] = result["score_adjusted"]
    if result.get("variant_detected") is not None:
        response["variant_detected"] = result["variant_detected"]

    # Story 27.3: Medium tier fields
    if result.get("medium_tier_speech_detected") is not None:
        response["medium_tier_speech_detected"] = result["medium_tier_speech_detected"]
    if result.get("medium_tier_listen_duration_s") is not None:
        response["medium_tier_listen_duration_s"] = result["medium_tier_listen_duration_s"]

    if result.get("pre_audio"):
        response["pre_audio_base64"] = base64.b64encode(result["pre_audio"]).decode("ascii")

    if result.get("post_audio"):
        response["post_audio_base64"] = base64.b64encode(result["post_audio"]).decode("ascii")

    # Story 28.2: Wakeword prosody analysis
    if (
        detected
        and tuning.get("prosody_analysis_enabled", True)
        and _wakeword_prosody_analyzer is not None
        and result.get("pre_audio")
    ):
        try:
            # Extract the last N ms of pre_audio as the wakeword audio
            ww_buffer_ms = tuning.get("prosody_wakeword_buffer_ms", 800)
            ww_buffer_bytes = int(SAMPLE_RATE * (ww_buffer_ms / 1000.0) * 2)  # 16-bit = 2 bytes/sample
            pre_audio_raw = result["pre_audio"]
            ww_audio = pre_audio_raw[-ww_buffer_bytes:] if len(pre_audio_raw) > ww_buffer_bytes else pre_audio_raw

            # Update tuning in analyzer
            _wakeword_prosody_analyzer._tuning = tuning
            prosody_result = _wakeword_prosody_analyzer.analyze(ww_audio, SAMPLE_RATE)

            response["wakeword_prosody"] = prosody_result.to_dict()
            print(f"[WW_PROSODY] mode={prosody_result.mode.value} conf={prosody_result.confidence:.2f} "
                  f"dur={prosody_result.duration_ms:.0f}ms rms={prosody_result.rms_db:.1f}dB "
                  f"pitch={prosody_result.pitch_mean_hz:.0f}Hz slope={prosody_result.pitch_slope:.1f} "
                  f"rate={prosody_result.speech_rate:.1f} analysis={prosody_result.analysis_time_ms:.1f}ms",
                  flush=True)
        except Exception as e:
            print(f"[WW_PROSODY] Error: {e}", flush=True)
            # Graceful fallback — don't block the response

    return response


# Story 28.2: Debug endpoint for wakeword prosody analysis
class WakewordProsodyRequest(BaseModel):
    wav_base64: str


@app.post("/wakeword/analyze-prosody")
async def wakeword_analyze_prosody(req: WakewordProsodyRequest):
    """Analyse prosodique d'un audio WAV base64 (debug/test).

    Story 28.2 — FR209
    """
    if _wakeword_prosody_analyzer is None:
        raise HTTPException(500, "Wakeword prosody analyzer not initialized")

    try:
        wav_data = base64.b64decode(req.wav_base64)

        # Extraire le PCM depuis le WAV
        buf = io.BytesIO(wav_data)
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            pcm_bytes = wf.readframes(wf.getnframes())

        _wakeword_prosody_analyzer._tuning = tuning
        result = _wakeword_prosody_analyzer.analyze(pcm_bytes, sr)
        return result.to_dict()
    except Exception as e:
        raise HTTPException(400, f"Analysis failed: {e}")


def _wakeword_listen(timeout_s: float, capture_post_s: float = 2.0) -> dict | None:
    """Écoute le micro en continu et retourne quand le wake word est détecté.

    Maintient un buffer circulaire de pre-audio et capture le post-audio
    apres la detection du wake-word.
    """
    # Reset le modèle et drain le buffer audio
    oww_model.reset()
    # Reap any zombie arecord processes before spawning new one
    import os
    try:
        while True:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
    except ChildProcessError:
        pass
    time.sleep(tuning["post_wakeword_delay_s"])  # Laisser le buffer se vider après playback
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

    # Initialiser le buffer circulaire
    circ_buf = CircularAudioBuffer(
        duration_s=tuning["circular_buffer_duration_s"],
        sample_rate=SAMPLE_RATE,
        sample_width=2,
        channels=CHANNELS,
    )

    # Drain: lire et jeter N frames pour vider l'écho résiduel
    for _ in range(tuning["wakeword_drain_frames"]):
        proc.stdout.read(CHUNK_BYTES)
    oww_model.reset()  # Reset après drain

    start_time = time.time()
    cooldown_s = 3.0  # Ignore detections for 3s after drain (anti-echo)

    try:
        while True:
            if timeout_s > 0 and (time.time() - start_time) > timeout_s:
                return None

            raw = proc.stdout.read(CHUNK_BYTES)
            if len(raw) < CHUNK_BYTES:
                continue

            # Alimenter le buffer circulaire AVANT le traitement openWakeWord
            circ_buf.write(raw)

            # Skip si muted
            if is_muted:
                oww_model.reset()
                circ_buf.clear()
                time.sleep(0.1)
                continue

            audio = np.frombuffer(raw, dtype=np.int16)
            prediction = oww_model.predict(audio)

            # Ignore detections during cooldown period (echo protection)
            elapsed = time.time() - start_time
            if elapsed < cooldown_s:
                continue

            for model_name, score in prediction.items():
                if score > tuning["wakeword_log_threshold"]: print(f"[WW] Score: {score:.3f}", flush=True)

                # Story 2.6: Resolve dynamic threshold based on speaker persona
                speaker_info = speaker_cache.get_all()
                persona_type = speaker_info.get("persona_type")
                current_threshold = dynamic_threshold.get_threshold(persona_type)

                # Story 2.6 AC5: Flexible detection window for partial scores
                # "Di!" + silence + phrase within 2s = probable intent
                PARTIAL_SCORE_MIN = 0.4
                if PARTIAL_SCORE_MIN <= score < current_threshold and vad_model is not None:
                    import torch as _torch_flex
                    # Listen for 2s of speech following the partial detection
                    flex_start = time.time()
                    flex_timeout = 2.0
                    speech_found_flex = False
                    while (time.time() - flex_start) < flex_timeout:
                        flex_raw = proc.stdout.read(CHUNK_BYTES)
                        if len(flex_raw) < CHUNK_BYTES:
                            continue
                        circ_buf.write(flex_raw)
                        # VAD check
                        flex_int16 = np.frombuffer(flex_raw, dtype=np.int16)
                        flex_float = flex_int16.astype(np.float32) / 32768.0
                        flex_tensor = _torch_flex.from_numpy(flex_float[:512].copy()) if len(flex_float) >= 512 else None
                        if flex_tensor is not None:
                            prob = vad_model(flex_tensor, SAMPLE_RATE).item()
                            if prob > tuning["vad_speech_prob_threshold"]:
                                speech_found_flex = True
                                break
                    if speech_found_flex:
                        # Treat as a valid wake word — boost score above threshold
                        score = current_threshold  # Promote to threshold level
                        print(f"[WW] Flexible detection: partial score {score:.3f} + speech detected within 2s, treating as wake word", flush=True)
                    else:
                        continue  # Not a valid detection

                if score >= current_threshold:
                    oww_model.reset()

                    # Sauvegarder le pre-audio du buffer circulaire
                    pre_audio = circ_buf.read_all()
                    print(f"[WW] Detected! Pre-audio buffer: {len(pre_audio)} bytes", flush=True)

                    # Story 27.2: Detecter le prefixe interpellatif dans le pre-audio
                    prefix_result = detect_prefix(
                        pre_audio_bytes=pre_audio,
                        sample_rate=SAMPLE_RATE,
                        prefix_window_ms=tuning["wakeword_prefix_window_ms"],
                        vad_model=vad_model,
                        variants=tuning["wakeword_variants"],
                        prefix_boost=tuning["wakeword_prefix_boost"],
                    )

                    # Ajuster le score en fonction du prefixe
                    score_adjusted = adjust_score(
                        raw_score=float(score),
                        prefix_result=prefix_result,
                        no_prefix_penalty=tuning["wakeword_no_prefix_penalty"],
                    )

                    # Story 2.6: Apply fuzzy matching boost for pronunciation variants
                    fuzzy_boost_applied = 0.0
                    score_before_fuzzy = score_adjusted
                    score_adjusted = detect_fuzzy_match(
                        audio_chunk=pre_audio[-SAMPLE_RATE:] if pre_audio else b"",
                        score=score_adjusted,
                        sample_rate=SAMPLE_RATE,
                    )
                    fuzzy_boost_applied = round(score_adjusted - score_before_fuzzy, 4)

                    # Story 2.6: Log structure JSON avec contexte speaker (AC #8)
                    import json as _log_json
                    persona_label = persona_type if persona_type else "unknown"
                    log_entry = {
                        "event": "wakeword_detected",
                        "variant_detected": prefix_result.prefix_detected,
                        "score_raw": round(float(score), 4),
                        "score_adjusted": round(score_adjusted, 4),
                        "threshold_applied": round(current_threshold, 4),
                        "persona_type": persona_label,
                        "speaker_id": speaker_info.get("speaker_id"),
                        "decision": "accept",
                        "fuzzy_boost": fuzzy_boost_applied,
                        "prefix_detected": prefix_result.prefix_detected or "none",
                        "is_interpellative": prefix_result.is_interpellative,
                        "has_continuous_speech": prefix_result.has_continuous_speech,
                        "energy_db": round(prefix_result.energy_db, 1),
                    }
                    print(f"[WW] {_log_json.dumps(log_entry)}", flush=True)

                    # Si le score ajuste tombe sous le seuil apres penalite, ignorer
                    if score_adjusted < current_threshold:
                        # Story 2.6: Log rejection with persona context
                        reject_log = {
                            "event": "wakeword_rejected",
                            "score_raw": round(float(score), 4),
                            "score_adjusted": round(score_adjusted, 4),
                            "threshold_applied": round(current_threshold, 4),
                            "persona_type": persona_label,
                            "speaker_id": speaker_info.get("speaker_id"),
                            "decision": "reject",
                            "fuzzy_boost": fuzzy_boost_applied,
                        }
                        log_level = "[WW] [DEBUG]" if persona_label in ("child", "ado", "unknown") else "[WW]"
                        print(f"{log_level} {_json.dumps(reject_log)}", flush=True)
                        continue

                    # Story 27.4: Check false-positive cooldown BEFORE processing
                    global _last_silent_dismiss_time
                    fp_cooldown_s = tuning.get("wakeword_false_positive_cooldown_s", 2.0)
                    time_since_dismiss = time.time() - _last_silent_dismiss_time
                    if _last_silent_dismiss_time > 0 and time_since_dismiss < fp_cooldown_s:
                        cooldown_log = {
                            "event": "wakeword_cooldown_active",
                            "score_raw": round(float(score), 4),
                            "score_adjusted": round(score_adjusted, 4),
                            "time_since_dismiss_s": round(time_since_dismiss, 2),
                            "cooldown_s": fp_cooldown_s,
                            "action": "ignore",
                            "dismiss_reason": "cooldown_active",
                        }
                        print(f"[WW] {_json.dumps(cooldown_log)}", flush=True)
                        continue  # Skip — cooldown still active

                    # Story 27.3 + 2.6: Determine tier with persona-adapted thresholds
                    persona_tiering = dynamic_threshold.get_tiering_thresholds(persona_type)
                    tiering = determine_tier(
                        score=score_adjusted,
                        tier_high=persona_tiering["tier_high"],
                        tier_medium=persona_tiering["tier_medium"],
                    )

                    # Story 27.3 + 27.4: Structured log (AC #9)
                    tier_log = {
                        "event": "wakeword_tiering",
                        "score_raw": round(float(score), 4),
                        "score_adjusted": round(score_adjusted, 4),
                        "tier": tiering.tier.value,
                        "action": tiering.action,
                    }

                    # === LOW tier: ignore completely (AC #3) ===
                    if tiering.tier == WakewordTier.LOW:
                        tier_log["action_taken"] = "ignore"
                        tier_log["false_positive"] = False
                        tier_log["chime_played"] = False
                        print(f"[WW] [DEBUG] {_json.dumps(tier_log)}", flush=True)
                        _record_wakeword_event("low_tier_ignore")
                        continue  # Stay in listen loop — no sound, no state change

                    # === HIGH tier: immediate processing (AC #1, #6) ===
                    if tiering.tier == WakewordTier.HIGH:
                        feedback_played = False
                        latency_feedback_ms = 0.0
                        if tuning.get("wakeword_chime_enabled", True):
                            latency_feedback_ms = play_feedback("chime")
                            feedback_played = True

                        tier_log["action_taken"] = "process"
                        tier_log["false_positive"] = False
                        tier_log["chime_played"] = feedback_played
                        tier_log["latency_feedback_ms"] = round(latency_feedback_ms, 1)
                        print(f"[WW] {_json.dumps(tier_log)}", flush=True)
                        _record_wakeword_event("true_positive")

                        # Capture post-audio
                        post_audio = _capture_post_audio(proc, capture_post_s, CHUNK_BYTES)

                        return {
                            "score": float(score),
                            "score_adjusted": score_adjusted,
                            "model": model_name,
                            "pre_audio": pre_audio if pre_audio else None,
                            "post_audio": post_audio if post_audio else None,
                            "variant_detected": prefix_result.prefix_detected,
                            "tier": "HIGH",
                            "action": "process",
                            "feedback_played": feedback_played,
                            "latency_feedback_ms": latency_feedback_ms,
                            "false_positive": False,
                            "persona_type": persona_label,
                            "threshold_applied": current_threshold,
                            "fuzzy_boost": fuzzy_boost_applied,
                        }

                    # === MEDIUM tier: attention bip + listen for speech (AC #2, #7, #8) ===
                    if tiering.tier == WakewordTier.MEDIUM:
                        feedback_played = False
                        latency_feedback_ms = 0.0
                        if tuning.get("wakeword_attention_enabled", True):
                            latency_feedback_ms = play_feedback("attention")
                            feedback_played = True

                        # Check pre-audio for speech (AC #10: pre-audio as positive signal)
                        pre_audio_has_speech = _check_pre_audio_speech(
                            pre_audio, tuning.get("pre_audio_min_speech_ms", 200)
                        )

                        if pre_audio_has_speech:
                            # Pre-audio contains speech => treat as confirmed (like HIGH)
                            # Play chime for confirmed detection
                            if tuning.get("wakeword_chime_enabled", True):
                                latency_feedback_ms = play_feedback("chime")
                                feedback_played = True

                            tier_log["action_taken"] = "process"
                            tier_log["pre_audio_speech"] = True
                            tier_log["false_positive"] = False
                            tier_log["chime_played"] = True
                            tier_log["latency_feedback_ms"] = round(latency_feedback_ms, 1)
                            print(f"[WW] {_json.dumps(tier_log)}", flush=True)
                            _record_wakeword_event("true_positive")

                            post_audio = _capture_post_audio(proc, capture_post_s, CHUNK_BYTES)

                            return {
                                "score": float(score),
                                "score_adjusted": score_adjusted,
                                "model": model_name,
                                "pre_audio": pre_audio if pre_audio else None,
                                "post_audio": post_audio if post_audio else None,
                                "variant_detected": prefix_result.prefix_detected,
                                "tier": "MEDIUM",
                                "action": "process",
                                "medium_tier_speech_detected": True,
                                "medium_tier_listen_duration_s": 0.0,
                                "feedback_played": feedback_played,
                                "latency_feedback_ms": latency_feedback_ms,
                                "false_positive": False,
                                "persona_type": persona_label,
                                "threshold_applied": current_threshold,
                                "fuzzy_boost": fuzzy_boost_applied,
                            }

                        # Listen for speech during medium_listen_s (AC #2)
                        listen_s = tuning.get("wakeword_medium_listen_s", 3.0)
                        speech_found, listen_duration, extra_audio = _medium_tier_listen(
                            proc, listen_s, CHUNK_BYTES
                        )

                        tier_log["medium_speech_detected"] = speech_found
                        tier_log["medium_listen_duration_s"] = round(listen_duration, 2)

                        if speech_found:
                            # Speech confirmed — play chime
                            if tuning.get("wakeword_chime_enabled", True):
                                latency_feedback_ms = play_feedback("chime")
                                feedback_played = True

                            tier_log["action_taken"] = "process"
                            tier_log["false_positive"] = False
                            tier_log["chime_played"] = True
                            tier_log["latency_feedback_ms"] = round(latency_feedback_ms, 1)
                            print(f"[WW] {_json.dumps(tier_log)}", flush=True)
                            _record_wakeword_event("true_positive")

                            # Combine post_audio: extra_audio from medium listen IS the post audio
                            return {
                                "score": float(score),
                                "score_adjusted": score_adjusted,
                                "model": model_name,
                                "pre_audio": pre_audio if pre_audio else None,
                                "post_audio": extra_audio if extra_audio else None,
                                "variant_detected": prefix_result.prefix_detected,
                                "tier": "MEDIUM",
                                "action": "process",
                                "medium_tier_speech_detected": True,
                                "medium_tier_listen_duration_s": listen_duration,
                                "feedback_played": feedback_played,
                                "latency_feedback_ms": latency_feedback_ms,
                                "false_positive": False,
                                "persona_type": persona_label,
                                "threshold_applied": current_threshold,
                                "fuzzy_boost": fuzzy_boost_applied,
                            }
                        else:
                            # Story 27.4: Silent dismiss — no audible response
                            _last_silent_dismiss_time = time.time()

                            # Optional micro-deactivation sound
                            if tuning.get("wakeword_deactivation_sound_enabled", False):
                                play_feedback("deactivate", volume=0.3)

                            tier_log["action_taken"] = "silent_dismiss"
                            tier_log["false_positive"] = True
                            tier_log["chime_played"] = False
                            tier_log["dismiss_reason"] = "no_speech_detected"
                            print(f"[WW] {_json.dumps(tier_log)}", flush=True)
                            _record_wakeword_event("false_positive")

                            return {
                                "score": float(score),
                                "score_adjusted": score_adjusted,
                                "model": model_name,
                                "pre_audio": pre_audio if pre_audio else None,
                                "post_audio": None,
                                "variant_detected": prefix_result.prefix_detected,
                                "tier": "MEDIUM",
                                "action": "silent_dismiss",
                                "medium_tier_speech_detected": False,
                                "medium_tier_listen_duration_s": listen_duration,
                                "feedback_played": False,
                                "latency_feedback_ms": 0.0,
                                "false_positive": True,
                                "dismiss_reason": "no_speech_detected",
                                "persona_type": persona_label,
                                "threshold_applied": current_threshold,
                                "fuzzy_boost": fuzzy_boost_applied,
                            }

    finally:
        proc.terminate()
        proc.wait()


def _capture_post_audio(proc, capture_s: float, chunk_bytes: int) -> bytes | None:
    """Capture l'audio post-wake-word pendant capture_s secondes ou jusqu'au silence VAD.

    Reutilise le meme processus arecord pour eviter de perdre de l'audio.
    """
    if capture_s <= 0:
        return None

    import torch

    post_audio = bytearray()
    start = time.time()
    CHUNK_MS = 32
    VAD_CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_MS / 1000)
    VAD_CHUNK_BYTES = VAD_CHUNK_SAMPLES * 2

    speech_detected = False
    last_speech_time = time.time()
    silence_timeout = tuning["vad_silence_timeout_s"]

    try:
        while (time.time() - start) < capture_s:
            raw = proc.stdout.read(chunk_bytes)
            if len(raw) < chunk_bytes:
                continue
            post_audio.extend(raw)

            # VAD check on sub-chunks for silence detection
            if vad_model is not None:
                offset = 0
                while offset + VAD_CHUNK_BYTES <= len(raw):
                    vad_chunk = raw[offset:offset + VAD_CHUNK_BYTES]
                    audio_int16 = np.frombuffer(vad_chunk, dtype=np.int16)
                    audio_float = audio_int16.astype(np.float32) / 32768.0
                    audio_tensor = torch.from_numpy(audio_float)
                    speech_prob = vad_model(audio_tensor, SAMPLE_RATE).item()

                    if speech_prob > tuning["vad_speech_prob_threshold"]:
                        speech_detected = True
                        last_speech_time = time.time()
                        # Story 29.1: Track last VAD activity
                        global _last_vad_ts
                        _last_vad_ts = time.time()
                    offset += VAD_CHUNK_BYTES

                # Si on a detecte de la parole et qu'il y a du silence depuis longtemps, arreter
                if speech_detected and (time.time() - last_speech_time) > silence_timeout:
                    print(f"[WW] Post-audio: silence detected, stopping capture", flush=True)
                    break
    except Exception as e:
        print(f"[WW] Post-audio capture error: {e}", flush=True)

    result = bytes(post_audio)
    print(f"[WW] Post-audio captured: {len(result)} bytes", flush=True)
    return result if result else None


def _medium_tier_listen(proc, listen_s: float, chunk_bytes: int) -> tuple:
    """Ecoute supplementaire pour le palier MOYEN via Silero VAD.

    Reutilise le processus arecord deja ouvert (pas de kill/restart).

    Returns:
        (speech_found: bool, listen_duration: float, audio_bytes: bytes | None)
    """
    import torch

    audio_buf = bytearray()
    start = time.time()
    CHUNK_MS = 32
    VAD_CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_MS / 1000)
    VAD_CHUNK_BYTES = VAD_CHUNK_SAMPLES * 2

    speech_detected = False

    try:
        while (time.time() - start) < listen_s:
            raw = proc.stdout.read(chunk_bytes)
            if len(raw) < chunk_bytes:
                continue
            audio_buf.extend(raw)

            # VAD check on sub-chunks
            if vad_model is not None:
                offset = 0
                while offset + VAD_CHUNK_BYTES <= len(raw):
                    vad_chunk = raw[offset:offset + VAD_CHUNK_BYTES]
                    audio_int16 = np.frombuffer(vad_chunk, dtype=np.int16)
                    audio_float = audio_int16.astype(np.float32) / 32768.0
                    audio_tensor = torch.from_numpy(audio_float)
                    speech_prob = vad_model(audio_tensor, SAMPLE_RATE).item()

                    if speech_prob > tuning["vad_speech_prob_threshold"]:
                        speech_detected = True
                        # Speech detected — stop listening early
                        # Continue capturing a bit more for the actual command
                        remaining_audio = _capture_post_audio(proc, tuning["post_wakeword_capture_s"], chunk_bytes)
                        if remaining_audio:
                            audio_buf.extend(remaining_audio)
                        listen_duration = time.time() - start
                        result_audio = bytes(audio_buf)
                        return (True, listen_duration, result_audio if result_audio else None)

                    offset += VAD_CHUNK_BYTES
    except Exception as e:
        print(f"[WW] Medium tier listen error: {e}", flush=True)

    listen_duration = time.time() - start
    result_audio = bytes(audio_buf) if audio_buf else None
    return (speech_detected, listen_duration, result_audio)


def _check_pre_audio_speech(pre_audio: bytes, min_speech_ms: float = 200) -> bool:
    """Verifie si le pre-audio contient de la parole via Silero VAD.

    Analyse les 2 dernieres secondes du buffer (avant le wake-word)
    pour determiner si l'utilisateur a deja parle.

    Args:
        pre_audio: PCM 16-bit LE mono
        min_speech_ms: duree minimale de parole pour considerer comme positif

    Returns:
        True si parole detectee dans le pre-audio
    """
    if not pre_audio or len(pre_audio) < 3200:  # Min 100ms
        return False

    if vad_model is None:
        return False

    try:
        import torch

        # Analyser les 2 dernieres secondes (avant le wake-word ~500ms)
        wakeword_bytes = int(0.5 * SAMPLE_RATE * 2)  # ~500ms for "Diva"
        analysis_end = max(0, len(pre_audio) - wakeword_bytes)
        analysis_start = max(0, analysis_end - int(2.0 * SAMPLE_RATE * 2))

        if analysis_end <= analysis_start:
            return False

        audio_segment = pre_audio[analysis_start:analysis_end]
        audio_int16 = np.frombuffer(audio_segment, dtype=np.int16)
        audio_float = audio_int16.astype(np.float32) / 32768.0

        chunk_samples = 512  # 32ms at 16kHz
        speech_chunks = 0
        total_chunks = 0

        for i in range(0, len(audio_float) - chunk_samples + 1, chunk_samples):
            chunk = audio_float[i:i + chunk_samples]
            tensor = torch.from_numpy(chunk.copy())
            prob = vad_model(tensor, SAMPLE_RATE).item()
            if prob > tuning["vad_speech_prob_threshold"]:
                speech_chunks += 1
            total_chunks += 1

        if total_chunks == 0:
            return False

        # Calculate speech duration
        speech_duration_ms = speech_chunks * 32  # 32ms per chunk
        return speech_duration_ms >= min_speech_ms

    except Exception as e:
        print(f"[WW] Pre-audio speech check error: {e}", flush=True)
        return False


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

    response = {
        "has_speech": True,
        "wav_base64": base64.b64encode(wav_buffer.read()).decode("ascii"),
        "duration_ms": result["duration_ms"],
        # Story 27.6: Prosody fields
        "prosody_end_score": result.get("prosody_end_score"),
        "prosody_effective_timeout_s": result.get("prosody_effective_timeout_s"),
        "prosody_time_saved_ms": result.get("prosody_time_saved_ms"),
        "prosody_hesitation_detected": result.get("prosody_hesitation_detected"),
    }

    # Story 28.1: Vocal register analysis on captured audio
    if tuning.get("register_analysis_enabled", True) and _vocal_register_analyzer is not None:
        try:
            # Update analyzer tuning in case it changed
            _vocal_register_analyzer._tuning = tuning
            vr = _vocal_register_analyzer.analyze(result["audio_bytes"], SAMPLE_RATE)
            response["vocal_register"] = {
                "register": vr.register.value,
                "rms_db": vr.rms_db,
                "estimated_speech_rate": vr.estimated_speech_rate,
                "confidence": vr.confidence,
            }
            print(f"[REGISTER] Detected: {vr.register.value} (RMS={vr.rms_db}dB, rate={vr.estimated_speech_rate}syl/s, conf={vr.confidence})", flush=True)
        except Exception as e:
            print(f"[REGISTER] Analysis error (non-blocking): {e}", flush=True)

    return response


# =====================================================================
# ENDPOINT : /audio/analyze-register (Story 28.1 / Task 2.1)
# =====================================================================

class AnalyzeRegisterRequest(BaseModel):
    wav_base64: str

@app.post("/audio/analyze-register")
async def audio_analyze_register(req: AnalyzeRegisterRequest):
    """Analyse le registre vocal d'un audio WAV en base64."""
    if _vocal_register_analyzer is None:
        raise HTTPException(503, "Vocal register analyzer not initialized")

    try:
        wav_bytes = base64.b64decode(req.wav_base64)
        # Extract raw PCM from WAV
        wav_io = io.BytesIO(wav_bytes)
        with wave.open(wav_io, "rb") as wf:
            sr = wf.getframerate()
            pcm_bytes = wf.readframes(wf.getnframes())

        _vocal_register_analyzer._tuning = tuning
        vr = _vocal_register_analyzer.analyze(pcm_bytes, sr)
        return {
            "vocal_register": {
                "register": vr.register.value,
                "rms_db": vr.rms_db,
                "estimated_speech_rate": vr.estimated_speech_rate,
                "confidence": vr.confidence,
            }
        }
    except Exception as e:
        raise HTTPException(500, f"Register analysis failed: {e}")


def _record_with_vad(
    max_duration_s: float,
    silence_timeout_s: float,
    min_speech_ms: float,
) -> dict | None:
    """Enregistre avec VAD Silero + analyse prosodique (Story 27.6)."""
    subprocess.run(["pkill", "-9", "arecord"], capture_output=True)
    # Reap zombie arecord processes left by pkill
    import os
    try:
        while True:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
    except ChildProcessError:
        pass
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

    # Story 27.6: Reset prosody analyzer for this recording
    prosody_enabled = tuning.get("prosody_endpoint_enabled", True) and _prosody_analyzer is not None
    if prosody_enabled:
        try:
            _prosody_analyzer.reset()
        except Exception as e:
            print(f"[PROSODY] Reset error: {e}", flush=True)
            prosody_enabled = False

    # Story 27.6: Track last prosody result for response enrichment
    last_prosody_result: Optional[ProsodyResult] = None
    effective_timeout_s = silence_timeout_s

    # Drain first 3 frames (~96ms) to clear playback echo from mic buffer
    for _ in range(3):
        proc.stdout.read(CHUNK_BYTES)

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

            # VAD check (unchanged — Silero VAD)
            speech_prob = vad_model(audio_tensor, SAMPLE_RATE).item()

            if speech_prob > tuning["vad_speech_prob_threshold"]:
                speech_started = True
                last_speech_time = time.time()
                all_audio.extend(raw)

                # Story 29.1: Track last VAD activity for /audio/vad-status
                global _last_vad_ts, _active_speakers_estimate
                _last_vad_ts = time.time()
                _active_speakers_estimate = 1  # At least 1 speaker detected

                # Story 27.6: Feed prosody analyzer during speech
                if prosody_enabled:
                    try:
                        last_prosody_result = _prosody_analyzer.compute_end_score_weighted(
                            audio_int16, is_speech=True, config=tuning
                        )
                    except Exception as e:
                        print(f"[PROSODY] Error during speech: {e}", flush=True)

            elif speech_started:
                all_audio.extend(raw)

                # Story 27.6: Compute prosody score during silence after speech
                if prosody_enabled:
                    try:
                        last_prosody_result = _prosody_analyzer.compute_end_score_weighted(
                            audio_int16, is_speech=False, config=tuning
                        )
                        effective_timeout_s = _prosody_analyzer.get_effective_timeout(
                            last_prosody_result.end_score, tuning
                        )
                    except Exception as e:
                        print(f"[PROSODY] Error during silence: {e}", flush=True)
                        effective_timeout_s = silence_timeout_s
                else:
                    effective_timeout_s = silence_timeout_s

                if time.time() - last_speech_time > effective_timeout_s:
                    break
            else:
                # Pas encore de parole
                if elapsed > tuning["record_max_wait_s"]:
                    return None

    finally:
        proc.terminate()
        proc.wait()

    if not all_audio:
        return None

    duration_ms = len(all_audio) / 2 / SAMPLE_RATE * 1000

    if duration_ms < min_speech_ms:
        return None

    # Story 27.6: Log prosody endpoint event and enrich response
    prosody_end_score = None
    prosody_effective_timeout_s = None
    prosody_time_saved_ms = None
    prosody_hesitation_detected = None

    if prosody_enabled and last_prosody_result is not None:
        try:
            time_saved_ms = max(0.0, (silence_timeout_s - effective_timeout_s) * 1000)
            prosody_end_score = round(last_prosody_result.end_score, 3)
            prosody_effective_timeout_s = round(effective_timeout_s, 3)
            prosody_time_saved_ms = round(time_saved_ms, 1)
            prosody_hesitation_detected = last_prosody_result.hesitation_detected

            # Record event for metrics
            _prosody_analyzer.record_event(
                result=last_prosody_result,
                effective_timeout_s=effective_timeout_s,
                standard_timeout_s=silence_timeout_s,
            )

            # Structured JSON log
            log_entry = {
                "event": "prosody_endpoint",
                "end_score": prosody_end_score,
                "f0_slope": round(last_prosody_result.f0_slope, 3),
                "energy_ratio": round(last_prosody_result.energy_ratio, 3),
                "lengthening_ratio": round(last_prosody_result.lengthening_ratio, 3),
                "hesitation_detected": prosody_hesitation_detected,
                "effective_timeout_s": prosody_effective_timeout_s,
                "standard_timeout_s": round(silence_timeout_s, 3),
                "time_saved_ms": prosody_time_saved_ms,
            }
            print(f"[PROSODY] {_json.dumps(log_entry)}", flush=True)
        except Exception as e:
            print(f"[PROSODY] Logging error: {e}", flush=True)

    return {
        "audio_bytes": bytes(all_audio),
        "duration_ms": int(duration_ms),
        "prosody_end_score": prosody_end_score,
        "prosody_effective_timeout_s": prosody_effective_timeout_s,
        "prosody_time_saved_ms": prosody_time_saved_ms,
        "prosody_hesitation_detected": prosody_hesitation_detected,
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
    """Joue des bytes WAV (base64) via aplay. Story 28.1: optional volume attenuation."""
    wav_bytes = base64.b64decode(req.wav_base64)

    # Story 28.1 / Task 4.3: Attenuate WAV samples if volume_percent < 100
    if req.volume_percent < 100:
        wav_bytes = _attenuate_wav(wav_bytes, req.volume_percent)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _play_wav_bytes_safe, wav_bytes)

    return {"played": True, "size": len(wav_bytes), "volume_percent": req.volume_percent}


def _attenuate_wav(wav_bytes: bytes, volume_percent: int) -> bytes:
    """Story 28.1: Attenuate WAV samples by a percentage (0-100).
    Multiplies PCM 16-bit samples by volume_percent/100, preserving WAV header."""
    try:
        wav_in = io.BytesIO(wav_bytes)
        wav_out = io.BytesIO()
        with wave.open(wav_in, "rb") as wf:
            params = wf.getparams()
            pcm_data = wf.readframes(wf.getnframes())

        samples = np.frombuffer(pcm_data, dtype=np.int16).copy()
        factor = max(0, min(100, volume_percent)) / 100.0
        samples = (samples.astype(np.float32) * factor).clip(-32768, 32767).astype(np.int16)

        with wave.open(wav_out, "wb") as wf:
            wf.setparams(params)
            wf.writeframes(samples.tobytes())
        return wav_out.getvalue()
    except Exception as e:
        print(f"[VOLUME] Attenuation error (playing original): {e}", flush=True)
        return wav_bytes


def _play_wav_safe(wav_path: str):
    """Jouer un WAV — kill arecord first car ALSA est half-duplex."""
    _mute_mic()
    # Kill arecord to free ALSA device (half-duplex — can't record and play simultaneously)
    subprocess.run(["pkill", "-9", "arecord"], capture_output=True)
    # Reap zombies
    try:
        while True:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                break
    except ChildProcessError:
        pass
    time.sleep(0.05)  # Brief pause for ALSA to release
    try:
        subprocess.run(
            ["aplay", "-D", ALSA_DEVICE, wav_path],
            capture_output=True, timeout=30
        )
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
# ENDPOINT : /tuning (GET = read, POST = update)
# =====================================================================

@app.get("/tuning")
async def get_tuning():
    """Return current tuning parameters."""
    return tuning

@app.post("/tuning")
async def update_tuning(new_values: dict):
    """Update tuning parameters. Only known keys are accepted."""
    updated = []
    for key, value in new_values.items():
        if key in tuning:
            tuning[key] = value
            updated.append(key)
    if updated:
        # Update legacy aliases
        global WAKEWORD_THRESHOLD, SILENCE_TIMEOUT_S, MIN_SPEECH_MS
        WAKEWORD_THRESHOLD = tuning["wakeword_threshold"]
        SILENCE_TIMEOUT_S = tuning["vad_silence_timeout_s"]
        MIN_SPEECH_MS = tuning["vad_min_speech_ms"]
        # Story 2.6: Update dynamic threshold when tuning changes
        dynamic_threshold.update(
            adult_threshold=tuning.get("wakeword_threshold_adult", 0.90),
            child_threshold=tuning.get("wakeword_threshold_child", 0.70),
        )
        # Story 27.5: If processing_feedback_enabled toggled to false, stop immediately
        if "processing_feedback_enabled" in updated and not tuning["processing_feedback_enabled"]:
            if _processing_feedback:
                _processing_feedback.force_stop()
                print("[TUNING] Processing feedback disabled — stopped immediately")
        _save_tuning(tuning)
        print(f"[TUNING] Updated: {updated}")
    return {"updated": updated, "tuning": tuning}


# =====================================================================
# ENDPOINT : /metrics/wakeword (Story 27.4)
# =====================================================================

@app.get("/metrics/wakeword")
async def get_wakeword_metrics():
    """Return wakeword detection metrics with 24h sliding window ratio."""
    ratio_24h = _get_fp_ratio_24h()
    now = time.time()

    # Count events in 24h window by type
    cutoff = now - 86400
    window_tp = sum(1 for e in _wakeword_events if e["timestamp"] >= cutoff and e["type"] == "true_positive")
    window_fp = sum(1 for e in _wakeword_events if e["timestamp"] >= cutoff and e["type"] == "false_positive")
    window_low = sum(1 for e in _wakeword_events if e["timestamp"] >= cutoff and e["type"] == "low_tier_ignore")

    return {
        "total_detections": _wakeword_metrics["total_detections"],
        "true_positives": _wakeword_metrics["true_positives"],
        "false_positives": _wakeword_metrics["false_positives"],
        "silent_dismissals": _wakeword_metrics["silent_dismissals"],
        "low_tier_ignores": _wakeword_metrics["low_tier_ignores"],
        "fp_ratio_24h": round(ratio_24h, 4),
        "window_24h": {
            "true_positives": window_tp,
            "false_positives": window_fp,
            "low_tier_ignores": window_low,
        },
        "last_event_timestamp": _wakeword_events[-1]["timestamp"] if _wakeword_events else None,
        "events_in_window": len(_wakeword_events),
    }


# =====================================================================
# ENDPOINT : /metrics/prosody (Story 27.6)
# =====================================================================

@app.get("/metrics/prosody")
async def get_prosody_metrics():
    """Return prosody endpoint detection metrics."""
    if _prosody_analyzer is None:
        return {"error": "Prosody analyzer not initialized"}
    return _prosody_analyzer.get_metrics()


# =====================================================================
# ENDPOINT : /processing/start-feedback et /processing/stop-feedback (Story 27.5)
# =====================================================================

class StartFeedbackRequest(BaseModel):
    correlation_id: str = ""


@app.post("/processing/start-feedback")
async def start_processing_feedback(req: StartFeedbackRequest):
    """Start the processing feedback timer.

    Called by Node.js when LLM/API processing begins. The actual audio
    starts after processing_feedback_delay_ms (default 2s).
    """
    if not tuning.get("processing_feedback_enabled", True):
        return {"skipped": True, "reason": "disabled"}

    if _processing_feedback is None:
        raise HTTPException(500, "Processing feedback not initialized")

    def _filler_check():
        return _filler_audio_playing

    result = await _processing_feedback.start_with_delay(
        delay_ms=tuning.get("processing_feedback_delay_ms", 2000),
        volume=tuning.get("processing_feedback_volume", 0.2),
        correlation_id=req.correlation_id,
        audio_playing_flag=_filler_check,
    )
    return result


@app.post("/processing/stop-feedback")
async def stop_processing_feedback():
    """Stop the processing feedback with fade-out.

    Called by Node.js just before playing the first TTS chunk.
    Cancels the timer if feedback hasn't started yet, or triggers fade-out.
    """
    if _processing_feedback is None:
        return {"started": False, "cancelled": False, "noop": True}

    fadeout_ms = tuning.get("processing_feedback_fadeout_ms", 300)
    result = await _processing_feedback.stop(fadeout_ms=fadeout_ms)
    return result


@app.post("/processing/set-filler-playing")
async def set_filler_playing(body: dict):
    """Set the filler_audio_playing flag (called by Node.js)."""
    global _filler_audio_playing
    _filler_audio_playing = body.get("playing", False)
    return {"filler_audio_playing": _filler_audio_playing}


# =====================================================================
# ENDPOINT : /metrics/processing (Story 27.5)
# =====================================================================

@app.get("/metrics/processing")
async def get_processing_metrics():
    """Return processing feedback metrics."""
    if _processing_feedback is None:
        return {"error": "Processing feedback not initialized"}
    return _processing_feedback.get_metrics()


# =====================================================================
# ENDPOINT : /audio/vad-status (Story 29.1 / Task 4.1)
# =====================================================================

@app.get("/audio/vad-status")
async def get_vad_status():
    """Return VAD activity status for proactive scheduler timing.

    Returns:
        last_vad_activity_ts: ISO 8601 timestamp of last VAD speech detection
        seconds_since_last_activity: seconds since last speech detected
        active_speakers_estimate: estimated distinct speakers (0, 1, or 2+)
    """
    from datetime import datetime, timezone

    now = time.time()
    if _last_vad_ts > 0:
        last_ts_iso = datetime.fromtimestamp(_last_vad_ts, tz=timezone.utc).isoformat()
        seconds_since = now - _last_vad_ts
    else:
        last_ts_iso = None
        seconds_since = 9999  # No activity ever detected — consider as available

    return {
        "last_vad_activity_ts": last_ts_iso,
        "seconds_since_last_activity": round(seconds_since, 1),
        "active_speakers_estimate": _active_speakers_estimate,
    }


# =====================================================================
# MAIN
# =====================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9010, log_level="info")
