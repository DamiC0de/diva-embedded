"""
test_processing_feedback.py — Tests unitaires pour la Story 27.5.

Couvre : generation du son, fade-out, volume scaling, mode nuit,
singleton, endpoints, metriques, configuration dynamique.

Story 27.5 — FR205
"""

import sys
import os
import asyncio
import struct
import io
import time
from unittest.mock import patch, MagicMock, AsyncMock

import numpy as np

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from processing_feedback import ProcessingFeedback, SAMPLE_RATE, BITS_PER_SAMPLE


# =====================================================================
# Helper: parse WAV header
# =====================================================================

def parse_wav_header(wav_bytes: bytes) -> dict:
    """Parse a WAV file header and return metadata."""
    assert wav_bytes[:4] == b"RIFF"
    assert wav_bytes[8:12] == b"WAVE"
    assert wav_bytes[12:16] == b"fmt "

    fmt_size = struct.unpack_from("<I", wav_bytes, 16)[0]
    audio_format = struct.unpack_from("<H", wav_bytes, 20)[0]
    channels = struct.unpack_from("<H", wav_bytes, 22)[0]
    sample_rate = struct.unpack_from("<I", wav_bytes, 24)[0]
    byte_rate = struct.unpack_from("<I", wav_bytes, 28)[0]
    block_align = struct.unpack_from("<H", wav_bytes, 32)[0]
    bits_per_sample = struct.unpack_from("<H", wav_bytes, 34)[0]

    assert wav_bytes[36:40] == b"data"
    data_size = struct.unpack_from("<I", wav_bytes, 40)[0]

    return {
        "audio_format": audio_format,
        "channels": channels,
        "sample_rate": sample_rate,
        "byte_rate": byte_rate,
        "block_align": block_align,
        "bits_per_sample": bits_per_sample,
        "data_size": data_size,
        "num_samples": data_size // (bits_per_sample // 8) // channels,
    }


# =====================================================================
# Task 7.1: Tests unitaires — generation du son
# =====================================================================

def test_wav_duration_15_seconds():
    """Le buffer WAV genere fait exactement 15 secondes (240000 samples a 16kHz)."""
    fb = ProcessingFeedback()
    header = parse_wav_header(fb._wav_bytes)
    assert header["num_samples"] == 15 * SAMPLE_RATE  # 240000


def test_wav_format_pcm_16bit_16khz_mono():
    """Le format est PCM 16-bit 16kHz mono."""
    fb = ProcessingFeedback()
    header = parse_wav_header(fb._wav_bytes)
    assert header["audio_format"] == 1  # PCM
    assert header["bits_per_sample"] == 16
    assert header["sample_rate"] == 16000
    assert header["channels"] == 1


def test_pcm_samples_count():
    """Les samples PCM int16 font bien 240000."""
    fb = ProcessingFeedback()
    assert len(fb._pcm_samples) == 15 * SAMPLE_RATE


def test_frequencies_phase1_200_250hz():
    """Phase 1 (0-5s) : frequences dans la plage 200-250Hz."""
    fb = ProcessingFeedback()
    # Extract phase 1 samples (0-5s)
    p1_samples = fb._pcm_samples[:5 * SAMPLE_RATE].astype(np.float64)

    # FFT analysis
    fft = np.abs(np.fft.rfft(p1_samples))
    freqs = np.fft.rfftfreq(len(p1_samples), 1.0 / SAMPLE_RATE)

    # Find dominant frequency
    dominant_idx = np.argmax(fft[1:]) + 1  # Skip DC
    dominant_freq = freqs[dominant_idx]

    # Should be between 200 and 260Hz (allow some margin for modulation)
    assert 190 <= dominant_freq <= 260, f"Phase 1 dominant freq: {dominant_freq}Hz"


def test_frequencies_phase2_250_350hz():
    """Phase 2 (5-10s) : frequences dans la plage 250-350Hz."""
    fb = ProcessingFeedback()
    p2_start = 5 * SAMPLE_RATE
    p2_end = 10 * SAMPLE_RATE
    p2_samples = fb._pcm_samples[p2_start:p2_end].astype(np.float64)

    fft = np.abs(np.fft.rfft(p2_samples))
    freqs = np.fft.rfftfreq(len(p2_samples), 1.0 / SAMPLE_RATE)

    dominant_idx = np.argmax(fft[1:]) + 1
    dominant_freq = freqs[dominant_idx]

    assert 240 <= dominant_freq <= 360, f"Phase 2 dominant freq: {dominant_freq}Hz"


def test_frequencies_phase3_350_400hz():
    """Phase 3 (10-15s) : frequences dans la plage 350-400Hz."""
    fb = ProcessingFeedback()
    p3_start = 10 * SAMPLE_RATE
    p3_samples = fb._pcm_samples[p3_start:].astype(np.float64)

    fft = np.abs(np.fft.rfft(p3_samples))
    freqs = np.fft.rfftfreq(len(p3_samples), 1.0 / SAMPLE_RATE)

    dominant_idx = np.argmax(fft[1:]) + 1
    dominant_freq = freqs[dominant_idx]

    assert 340 <= dominant_freq <= 410, f"Phase 3 dominant freq: {dominant_freq}Hz"


def test_frequencies_in_200_400hz_range():
    """Toutes les frequences dominantes sont dans la plage 200-400Hz."""
    fb = ProcessingFeedback()
    # Check each 1-second segment
    for sec in range(15):
        start = sec * SAMPLE_RATE
        end = start + SAMPLE_RATE
        segment = fb._pcm_samples[start:end].astype(np.float64)

        fft = np.abs(np.fft.rfft(segment))
        freqs = np.fft.rfftfreq(len(segment), 1.0 / SAMPLE_RATE)

        dominant_idx = np.argmax(fft[1:]) + 1
        dominant_freq = freqs[dominant_idx]

        assert 190 <= dominant_freq <= 410, (
            f"Second {sec}: dominant freq {dominant_freq}Hz out of range"
        )


# =====================================================================
# Task 7.1: Tests unitaires — fade-out
# =====================================================================

def test_fadeout_duration_300ms():
    """Le fade-out de 300ms fait 4800 samples."""
    fb = ProcessingFeedback()
    fadeout_wav = fb._generate_fadeout(300)
    header = parse_wav_header(fadeout_wav)
    expected_samples = int(300 * SAMPLE_RATE / 1000)  # 4800
    assert header["num_samples"] == expected_samples


def test_fadeout_last_sample_near_zero():
    """Le dernier sample du fade-out est proche de zero."""
    fb = ProcessingFeedback()
    fadeout_wav = fb._generate_fadeout(300)
    pcm_data = fadeout_wav[44:]
    samples = np.frombuffer(pcm_data, dtype=np.int16)

    # Last few samples should be very close to zero
    last_samples = np.abs(samples[-10:])
    assert np.max(last_samples) < 100, f"Last samples not near zero: max={np.max(last_samples)}"


def test_fadeout_ramp_descending():
    """La rampe du fade-out est descendante (l'energie diminue)."""
    fb = ProcessingFeedback()
    fadeout_wav = fb._generate_fadeout(300)
    pcm_data = fadeout_wav[44:]
    samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float64)

    # Compare RMS energy of first half vs second half
    half = len(samples) // 2
    rms_first = np.sqrt(np.mean(samples[:half] ** 2))
    rms_second = np.sqrt(np.mean(samples[half:] ** 2))

    assert rms_first > rms_second, (
        f"Fade-out not descending: first_half_rms={rms_first:.1f}, second_half_rms={rms_second:.1f}"
    )


def test_fadeout_configurable_duration():
    """Le fade-out accepte une duree configurable."""
    fb = ProcessingFeedback()

    fadeout_150 = fb._generate_fadeout(150)
    header_150 = parse_wav_header(fadeout_150)
    assert header_150["num_samples"] == int(150 * SAMPLE_RATE / 1000)

    fadeout_500 = fb._generate_fadeout(500)
    header_500 = parse_wav_header(fadeout_500)
    assert header_500["num_samples"] == int(500 * SAMPLE_RATE / 1000)


# =====================================================================
# Task 7.2: Tests unitaires — volume scaling
# =====================================================================

def test_volume_scaling_reduces_amplitude():
    """Le volume scaling reduit l'amplitude des samples."""
    fb = ProcessingFeedback()
    original = fb._wav_bytes
    scaled = fb._apply_volume(original, 0.5)

    orig_pcm = np.frombuffer(original[44:], dtype=np.int16)
    scaled_pcm = np.frombuffer(scaled[44:], dtype=np.int16)

    orig_rms = np.sqrt(np.mean(orig_pcm.astype(np.float64) ** 2))
    scaled_rms = np.sqrt(np.mean(scaled_pcm.astype(np.float64) ** 2))

    # Scaled should be approximately half the original
    ratio = scaled_rms / orig_rms
    assert 0.4 <= ratio <= 0.6, f"Volume ratio: {ratio:.3f} (expected ~0.5)"


def test_volume_scaling_1_0_no_change():
    """Volume 1.0 ne change rien."""
    fb = ProcessingFeedback()
    original = fb._wav_bytes
    scaled = fb._apply_volume(original, 1.0)
    assert original == scaled


def test_volume_scaling_range():
    """Le scaling fonctionne pour differentes valeurs 0.1-0.5."""
    fb = ProcessingFeedback()
    for vol in [0.1, 0.2, 0.3, 0.4, 0.5]:
        scaled = fb._apply_volume(fb._wav_bytes, vol)
        assert len(scaled) == len(fb._wav_bytes), f"Size mismatch for volume {vol}"
        # Header should be preserved
        assert scaled[:44] == fb._wav_bytes[:44] or vol >= 1.0


# =====================================================================
# Task 7.3: Tests unitaires — mode nuit
# =====================================================================

def test_night_mode_23h():
    """23h00 -> mode nuit actif."""
    fb = ProcessingFeedback()
    from datetime import datetime
    with patch("processing_feedback.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 20, 23, 0, 0)
        assert fb.is_night_mode() is True


def test_night_mode_05h():
    """05h00 -> mode nuit actif."""
    fb = ProcessingFeedback()
    from datetime import datetime
    with patch("processing_feedback.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 20, 5, 0, 0)
        assert fb.is_night_mode() is True


def test_night_mode_07h():
    """07h00 -> mode nuit inactif."""
    fb = ProcessingFeedback()
    from datetime import datetime
    with patch("processing_feedback.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 20, 7, 0, 0)
        assert fb.is_night_mode() is False


def test_night_mode_volume_halved():
    """En mode nuit, le volume effectif est divise par 2."""
    fb = ProcessingFeedback()
    from datetime import datetime
    with patch("processing_feedback.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 20, 23, 0, 0)
        vol = fb._effective_volume(0.2)
        assert vol == 0.1


def test_day_mode_volume_normal():
    """En journee, le volume effectif est normal."""
    fb = ProcessingFeedback()
    from datetime import datetime
    with patch("processing_feedback.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2026, 3, 20, 14, 0, 0)
        vol = fb._effective_volume(0.2)
        assert vol == 0.2


# =====================================================================
# Task 7.2: Tests unitaires — playback (mocked aplay)
# =====================================================================

def test_start_creates_timer():
    """start_with_delay cree un timer asyncio."""
    fb = ProcessingFeedback()

    async def _test():
        result = await fb.start_with_delay(delay_ms=2000, volume=0.2, correlation_id="test-1")
        assert result["started"] is True
        assert result["delay_ms"] == 2000
        assert fb._is_timer_active is True
        # Cleanup
        fb.force_stop()

    asyncio.get_event_loop().run_until_complete(_test())


def test_stop_before_playback_cancels():
    """stop() avant le debut du playback (timer non expire) -> annulation propre."""
    fb = ProcessingFeedback()

    async def _test():
        await fb.start_with_delay(delay_ms=5000, volume=0.2, correlation_id="test-2")
        assert fb._is_timer_active is True

        # Stop immediately (before 5s delay)
        result = await fb.stop()
        assert result.get("started") is False
        assert result.get("cancelled") is True
        assert fb._is_timer_active is False

    asyncio.get_event_loop().run_until_complete(_test())


def test_stop_cancels_increments_metrics():
    """L'annulation incremente le compteur cancelled_count."""
    fb = ProcessingFeedback()

    async def _test():
        await fb.start_with_delay(delay_ms=5000, volume=0.2)
        await fb.stop()
        assert fb.metrics["cancelled_count"] == 1

        await fb.start_with_delay(delay_ms=5000, volume=0.2)
        await fb.stop()
        assert fb.metrics["cancelled_count"] == 2

    asyncio.get_event_loop().run_until_complete(_test())


def test_filler_playing_skips():
    """Si un filler est en cours, start_with_delay retourne skipped."""
    fb = ProcessingFeedback()

    async def _test():
        result = await fb.start_with_delay(
            delay_ms=2000,
            volume=0.2,
            audio_playing_flag=lambda: True,  # filler playing
        )
        assert result.get("skipped") is True
        assert result.get("reason") == "filler_playing"

    asyncio.get_event_loop().run_until_complete(_test())


def test_stop_when_nothing_active():
    """stop() quand rien n'est actif -> noop."""
    fb = ProcessingFeedback()

    async def _test():
        result = await fb.stop()
        assert result.get("noop") is True

    asyncio.get_event_loop().run_until_complete(_test())


def test_force_stop_cleans_up():
    """force_stop() nettoie tous les etats."""
    fb = ProcessingFeedback()

    async def _test():
        await fb.start_with_delay(delay_ms=5000, volume=0.2)
        fb.force_stop()
        assert fb._is_playing is False
        assert fb._is_timer_active is False
        assert fb._timer_task is None

    asyncio.get_event_loop().run_until_complete(_test())


# =====================================================================
# Task 7.4: Tests unitaires — metriques
# =====================================================================

def test_metrics_initial_state():
    """Les metriques sont initialisees a zero."""
    fb = ProcessingFeedback()
    metrics = fb.get_metrics()
    assert metrics["trigger_count"] == 0
    assert metrics["cancelled_count"] == 0
    assert metrics["avg_duration_ms"] == 0.0
    assert metrics["avg_delay_ms"] == 0.0
    assert metrics["is_playing"] is False
    assert metrics["is_timer_active"] is False


def test_metrics_after_cancel():
    """Les metriques refletent une annulation."""
    fb = ProcessingFeedback()

    async def _test():
        await fb.start_with_delay(delay_ms=5000, volume=0.2, correlation_id="met-1")
        await fb.stop()
        metrics = fb.get_metrics()
        assert metrics["cancelled_count"] == 1
        assert metrics["trigger_count"] == 0  # Never actually triggered

    asyncio.get_event_loop().run_until_complete(_test())


def test_events_deque_bounded():
    """La deque d'evenements est bornee a 200."""
    fb = ProcessingFeedback()
    for i in range(250):
        fb._log_event("test", index=i)
    assert len(fb.events) == 200


# =====================================================================
# Task 7.5: Tests unitaires — phase 3 loop segment
# =====================================================================

def test_phase3_loop_segment_exists():
    """Le segment de boucle phase 3 est genere."""
    fb = ProcessingFeedback()
    assert fb._phase3_pcm is not None
    assert len(fb._phase3_pcm) == 5 * SAMPLE_RATE  # 5 seconds


def test_phase3_wav_bytes_valid():
    """Les bytes WAV du segment phase 3 sont valides."""
    fb = ProcessingFeedback()
    header = parse_wav_header(fb._phase3_wav_bytes)
    assert header["audio_format"] == 1
    assert header["sample_rate"] == 16000
    assert header["channels"] == 1


# =====================================================================
# Task 7.6: Tests de configuration
# =====================================================================

def test_custom_duration():
    """ProcessingFeedback accepte une duree personnalisee."""
    fb = ProcessingFeedback(duration_s=10.0)
    assert len(fb._pcm_samples) == 10 * SAMPLE_RATE


def test_high_trigger_rate_warning():
    """Warning si feedback declenche > 70% du temps."""
    fb = ProcessingFeedback()
    # Simulate 50 "started" events
    for _ in range(50):
        fb._log_event("started")

    # Should print a warning (we just verify no exception)
    fb._check_high_trigger_rate()


def test_log_event_stored():
    """Les evenements sont stockes dans la deque."""
    fb = ProcessingFeedback()
    fb._correlation_id = "test-log"
    fb._log_event("test_action", key1="value1")
    assert len(fb.events) == 1
    event = fb.events[0]
    assert event["action"] == "test_action"
    assert event["key1"] == "value1"
    assert event["correlation_id"] == "test-log"


# =====================================================================
# Run all tests
# =====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
