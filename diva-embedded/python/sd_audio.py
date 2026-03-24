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
import collections

DEVICE_INDEX = None
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
BLOCK_SIZE = 1280  # 80ms at 16kHz

# Detect ReSpeaker device
for i, d in enumerate(sd.query_devices()):
    if "ReSpeaker" in d["name"]:
        DEVICE_INDEX = i
        break

if DEVICE_INDEX is None:
    print("[SD_AUDIO] WARNING: ReSpeaker not found, using default")


# =============================================================
# Global Input Stream — continuous microphone capture
# =============================================================

class ContinuousInputStream:
    """Persistent input stream that feeds a ring buffer.
    All recording functions read from this buffer instead of spawning arecord."""
    
    def __init__(self, device=DEVICE_INDEX, sr=SAMPLE_RATE, channels=CHANNELS, 
                 buffer_seconds=10):
        self.device = device
        self.sr = sr
        self.channels = channels
        self.buffer_size = sr * 2 * buffer_seconds  # bytes
        self.ring_buffer = collections.deque(maxlen=self.buffer_size)
        self._stream = None
        self._chunk_queue = collections.deque(maxlen=500)  # ~40s of 80ms chunks
        self._chunk_event = threading.Event()
        self._running = False
        self._muted = False
        self._lock = threading.Lock()
    
    def start(self):
        if self._running:
            return
        self._running = True
        self._stream = sd.InputStream(
            device=self.device,
            samplerate=self.sr,
            channels=self.channels,
            dtype=DTYPE,
            blocksize=BLOCK_SIZE,
            callback=self._audio_callback,
        )
        self._stream.start()
        print(f"[SD_AUDIO] Input stream started (device={self.device}, sr={self.sr})")
    
    def stop(self):
        self._running = False
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except:
                pass
            self._stream = None
    
    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            pass  # Ignore xrun warnings
        raw = indata.tobytes()
        if not self._muted:
            self._chunk_queue.append(raw)
            self._chunk_event.set()
    
    def read_chunk(self, timeout=5.0):
        """Read one chunk (BLOCK_SIZE samples) from the stream.
        Returns bytes or None on timeout."""
        self._chunk_event.clear()
        if self._chunk_queue:
            return self._chunk_queue.popleft()
        if self._chunk_event.wait(timeout=timeout):
            if self._chunk_queue:
                return self._chunk_queue.popleft()
        return None
    
    def read_bytes(self, num_bytes, timeout=5.0):
        """Read exactly num_bytes from the stream."""
        buf = bytearray()
        deadline = time.time() + timeout
        while len(buf) < num_bytes and time.time() < deadline:
            chunk = self.read_chunk(timeout=max(0.01, deadline - time.time()))
            if chunk:
                buf.extend(chunk)
        return bytes(buf[:num_bytes])
    
    def drain(self):
        """Clear all buffered audio."""
        self._chunk_queue.clear()
        self._chunk_event.clear()
    
    def mute(self):
        self._muted = True
        self.drain()
    
    def unmute(self):
        self._muted = False
    
    @property
    def is_muted(self):
        return self._muted
    
    @property
    def is_running(self):
        return self._running


# Global instance
_input_stream = ContinuousInputStream()


def get_input_stream():
    return _input_stream


def start_input():
    _input_stream.start()


def stop_input():
    _input_stream.stop()


# =============================================================
# Playback — via sounddevice (full-duplex with input)
# =============================================================

def play_wav_bytes(wav_bytes: bytes) -> float:
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
    
    if sw == 2:
        audio = np.frombuffer(frames, dtype=np.int16)
    elif sw == 1:
        audio = np.frombuffer(frames, dtype=np.uint8).astype(np.int16) * 256
    else:
        return 0.0
    
    if ch == 2:
        audio = audio[::2]
    
    if sr != SAMPLE_RATE:
        ratio = SAMPLE_RATE / sr
        indices = np.arange(0, len(audio), 1/ratio).astype(int)
        indices = indices[indices < len(audio)]
        audio = audio[indices]
    
    duration = len(audio) / SAMPLE_RATE
    
    try:
        sd.play(audio, samplerate=SAMPLE_RATE, device=DEVICE_INDEX, blocking=True)
    except Exception as e:
        print(f"[SD_AUDIO] Play error: {e}")
    
    return duration


def play_wav_file(wav_path: str) -> float:
    with open(wav_path, "rb") as f:
        return play_wav_bytes(f.read())


def is_playing() -> bool:
    return sd.get_stream() is not None and sd.get_stream().active


print(f"[SD_AUDIO] Initialized: device={DEVICE_INDEX} sr={SAMPLE_RATE}")
