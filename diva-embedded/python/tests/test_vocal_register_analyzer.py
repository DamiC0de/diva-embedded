"""
test_vocal_register_analyzer.py — Tests unitaires pour la Story 28.1.

Couvre : detection chuchotement, voix pressee, voix posee, audio vide/court,
seuils configurables, fallback.

Story 28.1 — FR208
"""

import sys
import os

import numpy as np

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from vocal_register_analyzer import VocalRegisterAnalyzer, RegisterType, VocalRegister


SAMPLE_RATE = 16000


def _generate_audio(amplitude: float, duration_s: float = 1.0,
                     freq_hz: float = 200.0) -> bytes:
    """Genere de l'audio synthetique PCM 16-bit mono."""
    n_samples = int(SAMPLE_RATE * duration_s)
    t = np.arange(n_samples, dtype=np.float64) / SAMPLE_RATE
    signal = (amplitude * np.sin(2 * np.pi * freq_hz * t)).astype(np.int16)
    return signal.tobytes()


def _generate_quiet_audio(duration_s: float = 2.0) -> bytes:
    """Genere un audio tres calme (chuchotement simule)."""
    # Amplitude tres basse → RMS bas en dB
    return _generate_audio(amplitude=50, duration_s=duration_s, freq_hz=200.0)


def _generate_loud_audio(duration_s: float = 2.0) -> bytes:
    """Genere un audio fort (voix normale/forte)."""
    return _generate_audio(amplitude=8000, duration_s=duration_s, freq_hz=200.0)


def _generate_speech_like_audio(amplitude: float, syllable_count: int,
                                 duration_s: float = 2.0) -> bytes:
    """Genere un audio avec des segments de parole simules.

    Cree des 'syllabes' (bursts de signal) entrecoupees de silences
    pour simuler un debit vocal. L'alternance silence/signal produit
    des transitions que l'analyseur interprete comme des syllabes.
    """
    n_samples = int(SAMPLE_RATE * duration_s)
    signal = np.zeros(n_samples, dtype=np.float64)

    if syllable_count <= 0:
        return signal.astype(np.int16).tobytes()

    # Syllable duration: ~60ms of tone
    syllable_duration_s = 0.06
    syllable_samples = int(SAMPLE_RATE * syllable_duration_s)

    # Gap between syllables must be large enough to create a clear silence→speech transition
    # This is what the analyzer counts as "speech onsets" in 20ms windows
    gap_duration_s = 0.04  # 40ms of silence between syllables
    gap_samples = int(SAMPLE_RATE * gap_duration_s)

    # Total per unit = syllable + gap
    unit_samples = syllable_samples + gap_samples

    # Calculate starting offset to center the burst pattern
    total_burst_samples = syllable_count * unit_samples
    start_offset = max(0, (n_samples - total_burst_samples) // 2)

    pos = start_offset
    for i in range(syllable_count):
        if pos + syllable_samples > n_samples:
            break
        # Syllable (tone burst)
        t = np.arange(syllable_samples, dtype=np.float64) / SAMPLE_RATE
        signal[pos:pos + syllable_samples] = amplitude * np.sin(2 * np.pi * 300.0 * t)
        pos += syllable_samples
        # Silence gap
        pos += gap_samples

    return signal.astype(np.int16).tobytes()


# =====================================================================
# Test: Audio basse amplitude → registre "whisper"
# =====================================================================

def test_whisper_detection():
    """Audio synthetique basse amplitude → registre 'whisper'."""
    analyzer = VocalRegisterAnalyzer()
    audio = _generate_quiet_audio(duration_s=2.0)
    result = analyzer.analyze(audio, SAMPLE_RATE)

    assert isinstance(result, VocalRegister)
    assert result.register == RegisterType.WHISPER, \
        f"Expected 'whisper', got '{result.register}' (RMS={result.rms_db}dB)"
    assert result.rms_db < -35.0, f"RMS should be < -35 dB, got {result.rms_db}"
    assert result.confidence > 0.5


# =====================================================================
# Test: Audio forte amplitude, segments rapides → registre "pressed"
# =====================================================================

def test_pressed_detection():
    """Audio synthetique haute amplitude, segments courts et rapides → 'pressed'."""
    analyzer = VocalRegisterAnalyzer()
    # Beaucoup de syllabes en peu de temps → debit eleve
    audio = _generate_speech_like_audio(
        amplitude=8000, syllable_count=20, duration_s=2.0
    )
    result = analyzer.analyze(audio, SAMPLE_RATE)

    assert isinstance(result, VocalRegister)
    assert result.register == RegisterType.PRESSED, \
        f"Expected 'pressed', got '{result.register}' (rate={result.estimated_speech_rate}syl/s)"
    assert result.estimated_speech_rate > 5.0
    assert result.confidence > 0.5


# =====================================================================
# Test: Audio amplitude moyenne, rythme normal → registre "calm"
# =====================================================================

def test_calm_detection():
    """Audio synthetique amplitude moyenne, rythme normal → 'calm'."""
    analyzer = VocalRegisterAnalyzer()
    # Quelques syllabes, rythme modere
    audio = _generate_speech_like_audio(
        amplitude=5000, syllable_count=6, duration_s=2.0
    )
    result = analyzer.analyze(audio, SAMPLE_RATE)

    assert isinstance(result, VocalRegister)
    assert result.register == RegisterType.CALM, \
        f"Expected 'calm', got '{result.register}' (rate={result.estimated_speech_rate}, rms={result.rms_db})"


# =====================================================================
# Test: Audio vide ou trop court → registre "calm" par defaut (fallback)
# =====================================================================

def test_empty_audio_fallback():
    """Audio vide → registre 'calm' par defaut."""
    analyzer = VocalRegisterAnalyzer()
    result = analyzer.analyze(b"", SAMPLE_RATE)

    assert result.register == RegisterType.CALM
    assert result.confidence == 0.0


def test_short_audio_fallback():
    """Audio trop court (< 100ms) → registre 'calm' par defaut."""
    analyzer = VocalRegisterAnalyzer()
    # 50ms d'audio = 800 samples * 2 bytes = 1600 bytes
    short_audio = _generate_audio(amplitude=5000, duration_s=0.05)
    result = analyzer.analyze(short_audio, SAMPLE_RATE)

    assert result.register == RegisterType.CALM
    assert result.confidence == 0.0


# =====================================================================
# Test: Seuils configurables depuis tuning
# =====================================================================

def test_configurable_thresholds():
    """Verification des seuils configurables depuis tuning."""
    # Changer le seuil RMS pour que l'audio calme soit detecte comme whisper
    tuning = {"register_whisper_rms_db": -10.0}  # Seuil tres haut
    analyzer = VocalRegisterAnalyzer(tuning=tuning)

    audio = _generate_speech_like_audio(amplitude=3000, syllable_count=5, duration_s=2.0)
    result = analyzer.analyze(audio, SAMPLE_RATE)

    # Avec un seuil RMS eleve, meme un audio modere est detecte comme whisper
    assert result.register == RegisterType.WHISPER, \
        f"Expected 'whisper' with high threshold, got '{result.register}' (RMS={result.rms_db}dB)"


def test_configurable_pressed_threshold():
    """Verification du seuil de debit presse configurable."""
    # Seuil presse tres bas → facile a declencer
    tuning = {"register_pressed_rate_threshold": 1.0}
    analyzer = VocalRegisterAnalyzer(tuning=tuning)

    # 10 syllabes en 2s = environ 7.5 syl/s estime
    audio = _generate_speech_like_audio(amplitude=8000, syllable_count=10, duration_s=2.0)
    result = analyzer.analyze(audio, SAMPLE_RATE)

    assert result.register == RegisterType.PRESSED, \
        f"Expected 'pressed' with low threshold, got '{result.register}' (rate={result.estimated_speech_rate})"


# =====================================================================
# Test: Resultat contient des metriques valides
# =====================================================================

def test_result_metrics():
    """Les metriques brutes sont presentes et valides."""
    analyzer = VocalRegisterAnalyzer()
    audio = _generate_loud_audio(duration_s=2.0)
    result = analyzer.analyze(audio, SAMPLE_RATE)

    assert isinstance(result.rms_db, float)
    assert isinstance(result.estimated_speech_rate, float)
    assert isinstance(result.confidence, float)
    assert 0.0 <= result.confidence <= 1.0
    assert result.rms_db > -96.0  # Not silent


# =====================================================================
# Run tests
# =====================================================================

if __name__ == "__main__":
    test_whisper_detection()
    print("PASS test_whisper_detection")

    test_pressed_detection()
    print("PASS test_pressed_detection")

    test_calm_detection()
    print("PASS test_calm_detection")

    test_empty_audio_fallback()
    print("PASS test_empty_audio_fallback")

    test_short_audio_fallback()
    print("PASS test_short_audio_fallback")

    test_configurable_thresholds()
    print("PASS test_configurable_thresholds")

    test_configurable_pressed_threshold()
    print("PASS test_configurable_pressed_threshold")

    test_result_metrics()
    print("PASS test_result_metrics")

    print("\nAll tests passed!")
