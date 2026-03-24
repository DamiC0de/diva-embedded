#!/usr/bin/env python3
"""
processing_feedback.py — Feedback progressif audio pendant le traitement.

Story 27.5: Genere et joue un son ambiant evolutif quand le traitement
depasse un seuil configurable (defaut 2s). Le son est genere programmatiquement
(sinusoide 200-400Hz avec modulation d'amplitude) et joue via aplay.

Le module est un singleton: une seule instance de playback a la fois.
"""

import asyncio
import collections
import io
import struct
import subprocess
import time
from datetime import datetime
from typing import Optional

import numpy as np


# === CONSTANTS ===
SAMPLE_RATE = 16000
CHANNELS = 1
BITS_PER_SAMPLE = 16
BYTES_PER_SAMPLE = BITS_PER_SAMPLE // 8


class ProcessingFeedback:
    """Genere et joue un son de feedback progressif pendant le traitement.

    Le son est une sinusoide a frequence croissante (200-400Hz) avec
    modulation d'amplitude douce, genere au __init__() et stocke en memoire.

    Usage:
        fb = ProcessingFeedback(alsa_device="plughw:5")
        await fb.start(volume=0.2)   # lance le playback apres le delay
        await fb.stop()               # fade-out et arret
    """

    def __init__(self, alsa_device: str = "plughw:5", duration_s: float = 15.0):
        self.alsa_device = alsa_device
        self.duration_s = duration_s

        # Generate the WAV buffer at init time
        self._pcm_samples = self._generate_pcm_samples()
        self._wav_bytes = self._generate_wav_bytes(self._pcm_samples)

        # Phase 3 loop segment (seconds 10-15) for continuous looping
        phase3_start = int(10.0 * SAMPLE_RATE)
        phase3_end = int(15.0 * SAMPLE_RATE)
        self._phase3_pcm = self._pcm_samples[phase3_start:phase3_end]
        self._phase3_wav_bytes = self._generate_wav_bytes(self._phase3_pcm)

        # Playback state
        self._aplay_proc: Optional[subprocess.Popen] = None
        self._playback_task: Optional[asyncio.Task] = None
        self._timer_task: Optional[asyncio.Task] = None
        self._is_playing = False
        self._is_timer_active = False
        self._start_time: Optional[float] = None
        self._feedback_started_time: Optional[float] = None
        self._correlation_id: Optional[str] = None

        # Metrics (Task 6)
        self.metrics = {
            "trigger_count": 0,
            "cancelled_count": 0,
            "total_duration_ms": 0.0,
            "total_delay_ms": 0.0,
        }
        self.events: collections.deque = collections.deque(maxlen=200)

    def _generate_pcm_samples(self) -> np.ndarray:
        """Generate 15 seconds of PCM samples: sinusoid 200-400Hz with amplitude modulation.

        Three phases:
          - Phase 1 (0-5s): 200-250Hz
          - Phase 2 (5-10s): 250-350Hz
          - Phase 3 (10-15s): 350-400Hz plateau

        Amplitude modulation: slow sinusoidal envelope at 0.5Hz for a "breathing" effect.
        """
        total_samples = int(self.duration_s * SAMPLE_RATE)
        t = np.arange(total_samples) / SAMPLE_RATE

        # Frequency sweep: piecewise linear
        freq = np.zeros(total_samples, dtype=np.float64)

        # Phase 1: 0-5s -> 200-250Hz
        p1_end = int(5.0 * SAMPLE_RATE)
        freq[:p1_end] = np.linspace(200, 250, p1_end)

        # Phase 2: 5-10s -> 250-350Hz
        p2_start = p1_end
        p2_end = int(10.0 * SAMPLE_RATE)
        freq[p2_start:p2_end] = np.linspace(250, 350, p2_end - p2_start)

        # Phase 3: 10-15s -> 350-400Hz
        p3_start = p2_end
        freq[p3_start:] = np.linspace(350, 400, total_samples - p3_start)

        # Generate sinusoid with instantaneous frequency (phase accumulation)
        phase = np.cumsum(2 * np.pi * freq / SAMPLE_RATE)
        signal = np.sin(phase)

        # Amplitude modulation: slow envelope at 0.5Hz
        amp_mod = 0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)

        # Combine and scale to int16 range (moderate volume)
        signal = signal * amp_mod * 0.7  # 0.7 = base amplitude (not too loud)

        # Ensure zero-crossing at loop point (phase 3 end) for seamless looping
        # Apply short fade at very end (last 100 samples) to match start of phase 3
        fade_len = min(100, total_samples - p3_start)
        if fade_len > 0:
            fade_out = np.linspace(1.0, 0.0, fade_len)
            signal[-fade_len:] *= fade_out

        # Convert to int16
        samples_int16 = (signal * 32767).clip(-32768, 32767).astype(np.int16)
        return samples_int16

    @staticmethod
    def _generate_wav_bytes(pcm_samples: np.ndarray) -> bytes:
        """Convert PCM int16 samples to WAV bytes (header + data)."""
        pcm_data = pcm_samples.tobytes()
        data_size = len(pcm_data)
        byte_rate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
        block_align = CHANNELS * BYTES_PER_SAMPLE

        buf = io.BytesIO()
        # RIFF header
        buf.write(b"RIFF")
        buf.write(struct.pack("<I", 36 + data_size))
        buf.write(b"WAVE")
        # fmt sub-chunk
        buf.write(b"fmt ")
        buf.write(struct.pack("<I", 16))           # sub-chunk size
        buf.write(struct.pack("<H", 1))            # PCM format
        buf.write(struct.pack("<H", CHANNELS))
        buf.write(struct.pack("<I", SAMPLE_RATE))
        buf.write(struct.pack("<I", byte_rate))
        buf.write(struct.pack("<H", block_align))
        buf.write(struct.pack("<H", BITS_PER_SAMPLE))
        # data sub-chunk
        buf.write(b"data")
        buf.write(struct.pack("<I", data_size))
        buf.write(pcm_data)

        return buf.getvalue()

    def _generate_fadeout(self, duration_ms: int = 300) -> bytes:
        """Generate a fade-out WAV: ramp from current level to silence.

        Returns WAV bytes of the fade-out segment.
        """
        num_samples = int(duration_ms * SAMPLE_RATE / 1000)
        t = np.arange(num_samples) / SAMPLE_RATE

        # Use the frequency at end of phase 3 (400Hz) for the fade-out tone
        freq = 400.0
        signal = np.sin(2 * np.pi * freq * t)

        # Amplitude modulation (same as main signal)
        amp_mod = 0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)
        signal = signal * amp_mod * 0.7

        # Apply linear descending ramp
        ramp = np.linspace(1.0, 0.0, num_samples)
        signal = signal * ramp

        samples_int16 = (signal * 32767).clip(-32768, 32767).astype(np.int16)
        return self._generate_wav_bytes(samples_int16)

    @staticmethod
    def _apply_volume(wav_bytes: bytes, volume: float) -> bytes:
        """Apply volume scaling to WAV bytes (header preserved)."""
        if volume >= 1.0 or len(wav_bytes) <= 44:
            return wav_bytes

        header = wav_bytes[:44]
        pcm_data = wav_bytes[44:]
        samples = np.frombuffer(pcm_data, dtype=np.int16)
        scaled = (samples.astype(np.float32) * volume).clip(-32768, 32767).astype(np.int16)
        return header + scaled.tobytes()

    @staticmethod
    def is_night_mode() -> bool:
        """Check if current time is in night mode (22h-6h)."""
        hour = datetime.now().hour
        return hour >= 22 or hour < 6

    def _effective_volume(self, base_volume: float) -> float:
        """Calculate effective volume considering night mode."""
        if self.is_night_mode():
            return base_volume / 2.0
        return base_volume

    async def start_with_delay(
        self,
        delay_ms: int,
        volume: float,
        correlation_id: str = "",
        audio_playing_flag: Optional[callable] = None,
    ) -> dict:
        """Start the feedback with a delay timer.

        Args:
            delay_ms: Delay in ms before starting playback.
            volume: Base volume (0.1-0.5).
            correlation_id: For logging.
            audio_playing_flag: Callable returning True if a filler is playing.

        Returns:
            dict with status info.
        """
        # Singleton: stop any existing playback
        if self._is_playing or self._is_timer_active:
            await self.stop()

        self._correlation_id = correlation_id
        self._start_time = time.time()
        self._is_timer_active = True

        # Check if filler is playing
        if audio_playing_flag and audio_playing_flag():
            self._is_timer_active = False
            self._log_event("skipped", reason="filler_playing")
            return {"skipped": True, "reason": "filler_playing"}

        # Create delayed start task
        self._timer_task = asyncio.create_task(
            self._delayed_start(delay_ms, volume, audio_playing_flag)
        )

        return {"started": True, "delay_ms": delay_ms}

    async def _delayed_start(
        self,
        delay_ms: int,
        volume: float,
        audio_playing_flag: Optional[callable] = None,
    ):
        """Wait for delay then start playback."""
        try:
            await asyncio.sleep(delay_ms / 1000.0)
        except asyncio.CancelledError:
            self._is_timer_active = False
            return

        # Re-check filler flag after delay
        if audio_playing_flag and audio_playing_flag():
            self._is_timer_active = False
            self._log_event("skipped", reason="filler_playing_after_delay")
            return

        self._is_timer_active = False
        await self._start_playback(volume)

    async def _start_playback(self, volume: float):
        """Start the actual audio playback via aplay."""
        effective_vol = self._effective_volume(volume)
        self._feedback_started_time = time.time()
        self._is_playing = True

        self.metrics["trigger_count"] += 1

        delay_ms = 0.0
        if self._start_time:
            delay_ms = (self._feedback_started_time - self._start_time) * 1000

        self._log_event(
            "started",
            delay_before_feedback_ms=delay_ms,
            volume=effective_vol,
            night_mode=self.is_night_mode(),
        )

        # Check high trigger rate warning
        self._check_high_trigger_rate()

        # Launch aplay in background
        self._playback_task = asyncio.create_task(
            self._playback_loop(effective_vol)
        )

    async def _playback_loop(self, volume: float):
        """Feed WAV data to aplay in a loop."""
        try:
            self._aplay_proc = subprocess.Popen(
                ["aplay", "-D", self.alsa_device, "-t", "wav", "-q"],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            # Send the initial 15-second WAV
            wav_data = self._apply_volume(self._wav_bytes, volume)
            # Write WAV header first, then PCM data
            self._aplay_proc.stdin.write(wav_data)

            # Loop phase 3 if still playing
            while self._is_playing and self._aplay_proc and self._aplay_proc.poll() is None:
                phase3_data = self._apply_volume(self._phase3_wav_bytes, volume)
                # Only send PCM data (skip WAV header) for continuous feed
                try:
                    self._aplay_proc.stdin.write(phase3_data[44:])
                except (BrokenPipeError, OSError):
                    break

                # Small sleep to prevent tight loop
                await asyncio.sleep(0.1)

        except (BrokenPipeError, OSError, asyncio.CancelledError):
            pass
        except Exception as e:
            print(f"[PROCESSING_FEEDBACK] Playback error: {e}", flush=True)
        finally:
            self._is_playing = False

    async def stop(self, fadeout_ms: int = 300) -> dict:
        """Stop the feedback with a fade-out.

        Returns:
            dict with status info.
        """
        result = {}

        # Case 1: Timer still pending (response came before delay expired)
        if self._is_timer_active and self._timer_task:
            self._timer_task.cancel()
            try:
                await self._timer_task
            except asyncio.CancelledError:
                pass
            self._is_timer_active = False
            self._timer_task = None
            self.metrics["cancelled_count"] += 1
            self._log_event("cancelled", interrupted_by="tts_ready")
            return {"started": False, "cancelled": True}

        # Case 2: Playback is active
        if self._is_playing and self._aplay_proc:
            duration_ms = 0.0
            if self._feedback_started_time:
                duration_ms = (time.time() - self._feedback_started_time) * 1000

            # Send fade-out
            try:
                fadeout_data = self._generate_fadeout(fadeout_ms)
                effective_vol = self._effective_volume(0.2)  # Use default volume for fadeout
                fadeout_data = self._apply_volume(fadeout_data, effective_vol)
                if self._aplay_proc.stdin:
                    self._aplay_proc.stdin.write(fadeout_data[44:])  # PCM only
                    self._aplay_proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass

            # Wait for fade-out to finish (max fadeout_ms + small overhead)
            self._is_playing = False
            try:
                if self._aplay_proc:
                    self._aplay_proc.wait(timeout=(fadeout_ms / 1000.0) + 0.2)
            except subprocess.TimeoutExpired:
                if self._aplay_proc:
                    self._aplay_proc.kill()
            except Exception:
                pass

            # Cancel playback task
            if self._playback_task:
                self._playback_task.cancel()
                try:
                    await self._playback_task
                except asyncio.CancelledError:
                    pass
                self._playback_task = None

            self.metrics["total_duration_ms"] += duration_ms
            if self._start_time and self._feedback_started_time:
                self.metrics["total_delay_ms"] += (
                    self._feedback_started_time - self._start_time
                ) * 1000

            self._log_event(
                "stopped",
                duration_ms=duration_ms,
                interrupted_by="tts_ready",
                fadeout=True,
            )

            self._aplay_proc = None
            self._feedback_started_time = None
            self._start_time = None
            self._correlation_id = None

            result = {
                "started": True,
                "stopped": True,
                "duration_ms": round(duration_ms, 1),
                "fadeout": True,
            }
            return result

        # Case 3: Nothing active
        self._start_time = None
        self._correlation_id = None
        return {"started": False, "cancelled": False, "noop": True}

    def force_stop(self):
        """Synchronous force stop (for use in tuning updates)."""
        self._is_playing = False
        self._is_timer_active = False

        if self._timer_task:
            self._timer_task.cancel()
            self._timer_task = None

        if self._aplay_proc:
            try:
                if self._aplay_proc.stdin:
                    self._aplay_proc.stdin.close()
                self._aplay_proc.kill()
            except Exception:
                pass
            self._aplay_proc = None

        if self._playback_task:
            self._playback_task.cancel()
            self._playback_task = None

    def _log_event(self, action: str, **kwargs):
        """Log a structured JSON event."""
        import json as _json

        event = {
            "event": "processing_feedback",
            "action": action,
            "correlation_id": self._correlation_id or "",
            **kwargs,
        }
        self.events.append(event)
        print(f"[PROCESSING_FEEDBACK] {_json.dumps(event)}", flush=True)

    def _check_high_trigger_rate(self):
        """Warn if feedback triggers >70% of the last 50 events."""
        recent = list(self.events)[-50:]
        if len(recent) < 10:
            return
        started_count = sum(1 for e in recent if e.get("action") == "started")
        ratio = started_count / len(recent)
        if ratio > 0.70:
            print(
                f"[PROCESSING_FEEDBACK] WARNING: feedback triggered {ratio:.0%} of last "
                f"{len(recent)} events — possible systemic latency issue",
                flush=True,
            )

    def get_metrics(self) -> dict:
        """Return metrics for the /metrics/processing endpoint."""
        count = self.metrics["trigger_count"]
        cancelled = self.metrics["cancelled_count"]
        avg_duration = (
            self.metrics["total_duration_ms"] / count if count > 0 else 0.0
        )
        avg_delay = (
            self.metrics["total_delay_ms"] / count if count > 0 else 0.0
        )

        return {
            "trigger_count": count,
            "cancelled_count": cancelled,
            "avg_duration_ms": round(avg_duration, 1),
            "avg_delay_ms": round(avg_delay, 1),
            "recent_events_count": len(self.events),
            "is_playing": self._is_playing,
            "is_timer_active": self._is_timer_active,
        }
