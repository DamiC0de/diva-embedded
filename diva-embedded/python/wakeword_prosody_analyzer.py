"""
wakeword_prosody_analyzer.py — Analyse prosodique du wake-word pour pre-configurer le mode.

Analyse la prosodie du mot "Diva" (duree, volume, pitch, debit) pour determiner
le mode d'interaction initial : executant, compagnon, alerte, neutre.

Story 28.2 — FR209
"""

import time
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional

import numpy as np


class InteractionMode(str, Enum):
    EXECUTANT = "executant"
    COMPAGNON = "compagnon"
    ALERTE = "alerte"
    NEUTRE = "neutre"


@dataclass
class WakewordProsody:
    mode: InteractionMode
    confidence: float
    duration_ms: float
    rms_db: float
    pitch_mean_hz: float
    pitch_slope: float  # positif = montant, negatif = descendant
    speech_rate: float
    analysis_time_ms: float = 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["mode"] = self.mode.value
        return d


# Default thresholds — overridden by tuning config
_DEFAULT_SHORT_DURATION_MS = 350
_DEFAULT_LONG_DURATION_MS = 600
_DEFAULT_ALERT_RMS_DB = -15.0
_DEFAULT_CONFIDENCE_THRESHOLD = 0.6
_DEFAULT_ANALYSIS_ENABLED = True


class WakewordProsodyAnalyzer:
    """Analyse la prosodie du wake-word pour pre-configurer le mode d'interaction."""

    def __init__(self, tuning: Optional[dict] = None):
        self._tuning = tuning or {}

    def _get(self, key: str, default):
        return self._tuning.get(key, default)

    def analyze(self, audio_bytes: bytes, sample_rate: int = 16000) -> WakewordProsody:
        """
        Analyse la prosodie d'un buffer audio PCM 16-bit mono (le wake-word).

        Args:
            audio_bytes: PCM S16_LE mono
            sample_rate: Frequence d'echantillonnage (defaut 16000)

        Returns:
            WakewordProsody avec le mode detecte et les metriques brutes
        """
        t_start = time.perf_counter()

        # Fallback pour audio vide ou trop court (< 100ms)
        min_samples = int(sample_rate * 0.1)  # 100ms
        if not audio_bytes or len(audio_bytes) < min_samples * 2:
            elapsed = (time.perf_counter() - t_start) * 1000
            return WakewordProsody(
                mode=InteractionMode.NEUTRE,
                confidence=0.0,
                duration_ms=0.0,
                rms_db=-96.0,
                pitch_mean_hz=0.0,
                pitch_slope=0.0,
                speech_rate=0.0,
                analysis_time_ms=elapsed,
            )

        # Convertir en numpy
        samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float64)

        # === Duree ===
        duration_ms = (len(samples) / sample_rate) * 1000.0

        # === RMS en dB ===
        rms = np.sqrt(np.mean(samples ** 2))
        rms_db = 20.0 * np.log10(max(rms, 1e-10) / 32768.0)

        # === Estimation du pitch par autocorrelation ===
        pitch_mean_hz, pitch_slope = self._estimate_pitch(samples, sample_rate)

        # === Estimation du debit (speech rate) ===
        speech_rate = self._estimate_speech_rate(samples, sample_rate)

        # === Calcul des scores pour chaque mode ===
        short_ms = float(self._get("prosody_short_duration_ms", _DEFAULT_SHORT_DURATION_MS))
        long_ms = float(self._get("prosody_long_duration_ms", _DEFAULT_LONG_DURATION_MS))
        alert_rms_db = float(self._get("prosody_alert_rms_db", _DEFAULT_ALERT_RMS_DB))
        conf_threshold = float(self._get("prosody_confidence_threshold", _DEFAULT_CONFIDENCE_THRESHOLD))

        scores = {
            InteractionMode.EXECUTANT: self._score_executant(
                duration_ms, rms_db, pitch_slope, speech_rate, short_ms
            ),
            InteractionMode.COMPAGNON: self._score_compagnon(
                duration_ms, rms_db, pitch_slope, speech_rate, long_ms
            ),
            InteractionMode.ALERTE: self._score_alerte(
                duration_ms, rms_db, pitch_mean_hz, pitch_slope, alert_rms_db, short_ms
            ),
        }

        # Choisir le mode avec le score le plus eleve
        best_mode = max(scores, key=lambda m: scores[m])
        best_score = scores[best_mode]

        # Si le meilleur score est sous le seuil de confiance → neutre
        if best_score < conf_threshold:
            best_mode = InteractionMode.NEUTRE
            best_score = 1.0 - max(scores.values())  # confiance inverse

        elapsed = (time.perf_counter() - t_start) * 1000

        return WakewordProsody(
            mode=best_mode,
            confidence=round(min(1.0, best_score), 3),
            duration_ms=round(duration_ms, 1),
            rms_db=round(rms_db, 1),
            pitch_mean_hz=round(pitch_mean_hz, 1),
            pitch_slope=round(pitch_slope, 2),
            speech_rate=round(speech_rate, 2),
            analysis_time_ms=round(elapsed, 2),
        )

    def _estimate_pitch(self, samples: np.ndarray, sample_rate: int) -> tuple:
        """
        Estime le pitch moyen et la pente (slope) par autocorrelation.

        Returns:
            (pitch_mean_hz, pitch_slope) — pitch_slope negatif = descendant
        """
        # Centre le signal
        signal = samples - np.mean(samples)

        # Pitch sur 2 segments pour calculer la pente
        n = len(signal)
        mid = n // 2
        segments = [signal[:mid], signal[mid:]]

        pitches = []
        for seg in segments:
            p = self._autocorrelation_pitch(seg, sample_rate)
            if p > 0:
                pitches.append(p)

        if len(pitches) == 0:
            return (0.0, 0.0)

        pitch_mean = np.mean(pitches)

        if len(pitches) >= 2:
            pitch_slope = pitches[-1] - pitches[0]  # positif = montant
        else:
            pitch_slope = 0.0

        return (float(pitch_mean), float(pitch_slope))

    def _autocorrelation_pitch(self, segment: np.ndarray, sample_rate: int) -> float:
        """Estime la frequence fondamentale d'un segment par autocorrelation."""
        if len(segment) < 64:
            return 0.0

        # Limiter la taille pour la performance
        max_len = min(len(segment), 4096)
        seg = segment[:max_len]

        # Autocorrelation
        corr = np.correlate(seg, seg, mode='full')
        corr = corr[len(corr) // 2:]  # partie positive

        # Normaliser
        if corr[0] > 0:
            corr = corr / corr[0]

        # Trouver le premier pic apres le premier zero-crossing
        # Plage de pitch humain: 80-400 Hz → periodes de 40-200 samples a 16kHz
        min_lag = max(1, int(sample_rate / 400))  # ~40 a 16kHz
        max_lag = min(len(corr) - 1, int(sample_rate / 80))   # ~200 a 16kHz

        if min_lag >= max_lag or max_lag >= len(corr):
            return 0.0

        # Chercher le pic dans la plage
        search_region = corr[min_lag:max_lag + 1]
        if len(search_region) == 0:
            return 0.0

        peak_idx = np.argmax(search_region) + min_lag

        # Verifier que c'est un vrai pic (correlation > 0.2)
        if corr[peak_idx] < 0.2:
            return 0.0

        pitch_hz = sample_rate / peak_idx
        return float(pitch_hz)

    def _estimate_speech_rate(self, samples: np.ndarray, sample_rate: int) -> float:
        """
        Estime le debit de parole en comptant les transitions d'energie.
        Retourne un indicateur de vitesse (nombre de transitions normalise).
        """
        # Fenetre d'analyse : 20ms
        frame_len = int(sample_rate * 0.02)
        if len(samples) < frame_len * 2:
            return 0.0

        n_frames = len(samples) // frame_len
        energies = np.zeros(n_frames)

        for i in range(n_frames):
            frame = samples[i * frame_len : (i + 1) * frame_len]
            energies[i] = np.sqrt(np.mean(frame ** 2))

        # Seuil d'energie pour distinguer parole/silence
        threshold = np.mean(energies) * 0.3
        is_speech = energies > threshold

        # Compter les transitions speech -> silence et silence -> speech
        transitions = np.sum(np.abs(np.diff(is_speech.astype(int))))

        # Normaliser par la duree en secondes
        duration_s = len(samples) / sample_rate
        if duration_s <= 0:
            return 0.0

        return float(transitions / duration_s)

    def _score_executant(self, duration_ms, rms_db, pitch_slope, speech_rate, short_ms):
        """Mode executant : court, volume moyen-haut, pitch descendant abrupt."""
        score = 0.0

        # Duree courte (poids principal)
        if duration_ms < short_ms:
            score += 0.3 + 0.1 * (1.0 - duration_ms / short_ms)
        else:
            score -= 0.2

        # Volume moyen-haut (pas ultra-fort non plus)
        if -25.0 <= rms_db <= -10.0:
            score += 0.2
        elif rms_db > -10.0:
            score += 0.1  # Trop fort → potentiellement alerte

        # Pitch descendant abrupt
        if pitch_slope < -20:
            score += 0.3
        elif pitch_slope < 0:
            score += 0.1

        # Debit rapide (bonus)
        if speech_rate > 5.0:
            score += 0.1

        return max(0.0, min(1.0, score))

    def _score_compagnon(self, duration_ms, rms_db, pitch_slope, speech_rate, long_ms):
        """Mode compagnon : long, volume bas-moyen, pitch descendant doux."""
        score = 0.0

        # Duree longue
        if duration_ms > long_ms:
            score += 0.4 * min(1.0, (duration_ms - long_ms) / long_ms)
        else:
            score -= 0.2

        # Volume bas-moyen
        if rms_db < -25.0:
            score += 0.25
        elif rms_db < -18.0:
            score += 0.15

        # Pitch descendant doux
        if -20 < pitch_slope < 0:
            score += 0.25
        elif pitch_slope < -20:
            score += 0.05  # Trop abrupt → executant

        # Debit lent
        if speech_rate < 4.0:
            score += 0.1

        return max(0.0, min(1.0, score))

    def _score_alerte(self, duration_ms, rms_db, pitch_mean_hz, pitch_slope,
                       alert_rms_db, short_ms):
        """Mode alerte : volume fort, court, pitch stable haut ou montant."""
        score = 0.0

        # Volume fort
        if rms_db > alert_rms_db:
            score += 0.4 * min(1.0, (rms_db - alert_rms_db) / 10.0)

        # Duree courte
        if duration_ms < short_ms:
            score += 0.2

        # Pitch montant ou stable haut
        if pitch_slope > 0:
            score += 0.25
        elif abs(pitch_slope) < 10 and pitch_mean_hz > 200:
            score += 0.15

        return max(0.0, min(1.0, score))
