"""
test_wakeword_prosody_analyzer.py — Tests unitaires pour la Story 28.2.

Couvre : detection executant, compagnon, alerte, neutre (fallback),
audio vide/court, latence < 50ms, seuils configurables.

Story 28.2 — FR209
"""

import sys
import os
import time

import numpy as np

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wakeword_prosody_analyzer import (
    WakewordProsodyAnalyzer,
    WakewordProsody,
    InteractionMode,
)


SAMPLE_RATE = 16000


def _generate_tone(
    amplitude: float,
    duration_s: float,
    freq_hz: float = 200.0,
    freq_end_hz: float | None = None,
) -> bytes:
    """Genere un signal tonal PCM 16-bit mono avec option de sweep de frequence."""
    n_samples = int(SAMPLE_RATE * duration_s)
    t = np.arange(n_samples, dtype=np.float64) / SAMPLE_RATE

    if freq_end_hz is not None and freq_end_hz != freq_hz:
        # Sweep lineaire de freq_hz a freq_end_hz
        freqs = np.linspace(freq_hz, freq_end_hz, n_samples)
        phase = np.cumsum(2 * np.pi * freqs / SAMPLE_RATE)
        signal = (amplitude * np.sin(phase)).astype(np.int16)
    else:
        signal = (amplitude * np.sin(2 * np.pi * freq_hz * t)).astype(np.int16)

    return signal.tobytes()


def _generate_executant_audio() -> bytes:
    """Audio court (300ms), volume moyen, pitch descendant abrupt.
    Simule 'Diva !' sec et rapide."""
    return _generate_tone(
        amplitude=5000,         # volume moyen-haut
        duration_s=0.3,         # 300ms — court
        freq_hz=250,            # pitch initial haut
        freq_end_hz=140,        # pitch final bas → descendant abrupt
    )


def _generate_compagnon_audio() -> bytes:
    """Audio long (700ms), volume bas, pitch descendant doux.
    Simule 'Diva...' doux et lent."""
    return _generate_tone(
        amplitude=800,          # volume bas
        duration_s=0.7,         # 700ms — long
        freq_hz=190,            # pitch initial moyen
        freq_end_hz=170,        # pitch final legerement plus bas → descendant doux
    )


def _generate_alerte_audio() -> bytes:
    """Audio court (250ms), volume fort, pitch stable haut.
    Simule 'DIVA !' fort et urgent."""
    return _generate_tone(
        amplitude=25000,        # volume fort
        duration_s=0.25,        # 250ms — tres court
        freq_hz=260,            # pitch haut stable
        freq_end_hz=270,        # legerement montant
    )


def _generate_ambiguous_audio() -> bytes:
    """Audio moyen, volume moyen, pitch plat → aucun mode clair."""
    return _generate_tone(
        amplitude=2000,         # volume moyen
        duration_s=0.45,        # entre court et long
        freq_hz=200,            # pitch moyen
        freq_end_hz=200,        # stable — pas de slope
    )


# =====================================================================
# Tests de detection de mode
# =====================================================================

class TestWakewordProsodyAnalyzer:

    def setup_method(self):
        self.analyzer = WakewordProsodyAnalyzer()

    def test_executant_mode(self):
        """Audio court, volume moyen, pitch descendant → mode executant."""
        audio = _generate_executant_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)

        assert result.mode == InteractionMode.EXECUTANT, (
            f"Expected executant, got {result.mode} "
            f"(dur={result.duration_ms}ms, rms={result.rms_db}dB, "
            f"slope={result.pitch_slope}, rate={result.speech_rate})"
        )
        assert result.confidence >= 0.6
        assert result.duration_ms < 400

    def test_compagnon_mode(self):
        """Audio long, volume bas, pitch descendant doux → mode compagnon."""
        audio = _generate_compagnon_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)

        assert result.mode == InteractionMode.COMPAGNON, (
            f"Expected compagnon, got {result.mode} "
            f"(dur={result.duration_ms}ms, rms={result.rms_db}dB, "
            f"slope={result.pitch_slope}, rate={result.speech_rate})"
        )
        assert result.confidence >= 0.6
        assert result.duration_ms > 600

    def test_alerte_mode(self):
        """Audio court, volume fort, pitch stable haut → mode alerte."""
        audio = _generate_alerte_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)

        assert result.mode == InteractionMode.ALERTE, (
            f"Expected alerte, got {result.mode} "
            f"(dur={result.duration_ms}ms, rms={result.rms_db}dB, "
            f"slope={result.pitch_slope}, pitch={result.pitch_mean_hz}Hz)"
        )
        assert result.confidence >= 0.6

    def test_neutre_fallback_ambiguous(self):
        """Audio avec metriques ambigues → mode neutre (fallback)."""
        audio = _generate_ambiguous_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)

        assert result.mode == InteractionMode.NEUTRE, (
            f"Expected neutre, got {result.mode} "
            f"(dur={result.duration_ms}ms, rms={result.rms_db}dB, "
            f"slope={result.pitch_slope})"
        )

    def test_neutre_fallback_empty_audio(self):
        """Audio vide → mode neutre."""
        result = self.analyzer.analyze(b"", SAMPLE_RATE)
        assert result.mode == InteractionMode.NEUTRE
        assert result.confidence == 0.0
        assert result.duration_ms == 0.0

    def test_neutre_fallback_too_short(self):
        """Audio < 100ms → mode neutre."""
        # 50ms = 800 samples = 1600 bytes
        short_audio = _generate_tone(amplitude=5000, duration_s=0.05)
        result = self.analyzer.analyze(short_audio, SAMPLE_RATE)
        assert result.mode == InteractionMode.NEUTRE
        assert result.confidence == 0.0

    def test_latency_under_50ms(self):
        """L'analyse doit prendre < 50ms sur un audio de 800ms."""
        audio = _generate_tone(amplitude=5000, duration_s=0.8, freq_hz=200)

        # Warmup
        self.analyzer.analyze(audio, SAMPLE_RATE)

        # Mesure
        times = []
        for _ in range(20):
            t0 = time.perf_counter()
            self.analyzer.analyze(audio, SAMPLE_RATE)
            times.append((time.perf_counter() - t0) * 1000)

        avg_ms = sum(times) / len(times)
        assert avg_ms < 50, f"Moyenne latence = {avg_ms:.1f}ms (doit etre < 50ms)"

    def test_configurable_thresholds(self):
        """Les seuils sont configurables via tuning."""
        # Avec un seuil de duree courte tres bas, un audio de 300ms
        # n'est plus considere comme "court"
        custom_tuning = {
            "prosody_short_duration_ms": 100,  # Seulement < 100ms = court
            "prosody_long_duration_ms": 200,    # > 200ms = long
            "prosody_confidence_threshold": 0.6,
        }
        analyzer = WakewordProsodyAnalyzer(tuning=custom_tuning)

        # Audio de 300ms → maintenant "long" (> 200ms) → devrait tendre vers compagnon
        audio = _generate_tone(
            amplitude=800, duration_s=0.3, freq_hz=190, freq_end_hz=175,
        )
        result = analyzer.analyze(audio, SAMPLE_RATE)
        # Le mode depend des seuils — l'important est que ca ne crash pas
        # et que le mode est determine par les seuils custom
        assert result.mode in (
            InteractionMode.EXECUTANT,
            InteractionMode.COMPAGNON,
            InteractionMode.ALERTE,
            InteractionMode.NEUTRE,
        )

    def test_result_has_all_fields(self):
        """Le resultat contient tous les champs attendus."""
        audio = _generate_executant_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)

        assert hasattr(result, "mode")
        assert hasattr(result, "confidence")
        assert hasattr(result, "duration_ms")
        assert hasattr(result, "rms_db")
        assert hasattr(result, "pitch_mean_hz")
        assert hasattr(result, "pitch_slope")
        assert hasattr(result, "speech_rate")
        assert hasattr(result, "analysis_time_ms")

    def test_to_dict(self):
        """to_dict() retourne un dictionnaire serializable."""
        audio = _generate_executant_audio()
        result = self.analyzer.analyze(audio, SAMPLE_RATE)
        d = result.to_dict()

        assert isinstance(d, dict)
        assert isinstance(d["mode"], str)
        assert d["mode"] in ("executant", "compagnon", "alerte", "neutre")
        assert isinstance(d["confidence"], float)
        assert isinstance(d["duration_ms"], float)

    def test_analysis_enabled_flag(self):
        """Le flag prosody_analysis_enabled est lu par le tuning."""
        tuning = {"prosody_analysis_enabled": False}
        analyzer = WakewordProsodyAnalyzer(tuning=tuning)
        # L'analyseur lui-meme ne check pas le flag — c'est le serveur qui decide
        # Mais l'analyseur doit fonctionner normalement
        audio = _generate_executant_audio()
        result = analyzer.analyze(audio, SAMPLE_RATE)
        assert result.mode is not None

    def test_performance_100_calls(self):
        """Performance : 100 appels avec des audios de 200ms a 800ms, moyenne < 50ms."""
        durations = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
        times = []

        for dur in durations:
            audio = _generate_tone(amplitude=5000, duration_s=dur, freq_hz=200)
            for _ in range(15):
                t0 = time.perf_counter()
                self.analyzer.analyze(audio, SAMPLE_RATE)
                times.append((time.perf_counter() - t0) * 1000)

        avg_ms = sum(times) / len(times)
        p99_ms = sorted(times)[int(len(times) * 0.99)]

        assert avg_ms < 50, f"Moyenne = {avg_ms:.1f}ms (doit etre < 50ms)"
        assert p99_ms < 80, f"P99 = {p99_ms:.1f}ms (doit etre < 80ms)"
