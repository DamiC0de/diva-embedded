"""
sounddevice Audio Manager — Full-duplex ALSA replacement
Replaces arecord/aplay subprocesses with sounddevice streams.
Eliminates ALSA half-duplex conflicts and subprocess overhead.
"""
import sounddevice as sd
import numpy as np
import wave
import io
import threading
import time

DEVICE_INDEX = None  # Auto-detect ReSpeaker
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
BLOCK_SIZE = 1280  # 80ms at 16kHz (same as wake word chunk)

# Detect ReSpeaker device at import
for i, d in enumerate(sd.query_devices()):
    if "ReSpeaker" in d["name"]:
        DEVICE_INDEX = i
        break

if DEVICE_INDEX is None:
    print("[SD_AUDIO] WARNING: ReSpeaker not found, using default")

# Global input buffer for wake word / recording
_input_buffer = bytearray()
_input_lock = threading.Lock()
_input_callback = None  # Optional callback for real-time processing
_is_recording = False

# Output state
_is_playing = False
_play_done = threading.Event()

def get_device():
    return DEVICE_INDEX

def play_wav_bytes(wav_bytes: bytes) -> float:
    """Play WAV bytes via sounddevice. Returns duration in seconds."""
    global _is_playing
    
    # Parse WAV
    buf = io.BytesIO(wav_bytes)
    try:
        with wave.open(buf, "rb") as wf:
            sr = wf.getframerate()
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            frames = wf.readframes(wf.getnframes())
    except Exception as e:
        print(f"[SD_AUDIO] WAV parse error: {e}")
        return 0.0
    
    # Convert to numpy array
    if sw == 2:
        audio = np.frombuffer(frames, dtype=np.int16)
    elif sw == 1:
        audio = np.frombuffer(frames, dtype=np.uint8).astype(np.int16) * 256
    else:
        print(f"[SD_AUDIO] Unsupported sample width: {sw}")
        return 0.0
    
    if ch == 2:
        audio = audio[::2]  # Take left channel only
    
    # Resample if needed
    if sr != SAMPLE_RATE:
        # Simple linear interpolation resample
        ratio = SAMPLE_RATE / sr
        indices = np.arange(0, len(audio), 1/ratio).astype(int)
        indices = indices[indices < len(audio)]
        audio = audio[indices]
    
    duration = len(audio) / SAMPLE_RATE
    
    _is_playing = True
    _play_done.clear()
    
    try:
        sd.play(audio, samplerate=SAMPLE_RATE, device=DEVICE_INDEX, blocking=True)
    except Exception as e:
        print(f"[SD_AUDIO] Play error: {e}")
    finally:
        _is_playing = False
        _play_done.set()
    
    return duration

def play_wav_file(wav_path: str) -> float:
    """Play a WAV file via sounddevice."""
    with open(wav_path, "rb") as f:
        return play_wav_bytes(f.read())

def is_playing() -> bool:
    return _is_playing

def record_chunk(duration_s: float) -> bytes:
    """Record a chunk of audio. Returns raw PCM int16 bytes."""
    frames = int(SAMPLE_RATE * duration_s)
    audio = sd.rec(frames, samplerate=SAMPLE_RATE, channels=1, dtype=DTYPE, device=DEVICE_INDEX, blocking=True)
    return audio.tobytes()

def start_input_stream(callback=None):
    """Start continuous input stream for wake word detection."""
    global _input_callback, _is_recording
    _input_callback = callback
    _is_recording = True

def stop_input_stream():
    global _is_recording
    _is_recording = False

print(f"[SD_AUDIO] Initialized: device={DEVICE_INDEX} sr={SAMPLE_RATE} dtype={DTYPE}")
