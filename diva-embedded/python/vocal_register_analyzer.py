"""
vocal_register_analyzer.py — Analyse du registre vocal de l'utilisateur.

Detecte si l'utilisateur chuchote, parle de maniere pressee ou de maniere posee,
afin d'adapter le comportement de Diva (volume, debit TTS, longueur de reponse).

Story 28.1 — FR208
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional

import numpy as np


class RegisterType(str, Enum):
    WHISPER = "whisper"
    PRESSED = "pressed"
    CALM = "calm"


@dataclass
class VocalRegister:
    register: RegisterType
    rms_db: float
    estimated_speech_rate: float
    confidence: float


# Default thresholds — overridden by tuning config
_DEFAULT_WHISPER_RMS_DB = -35.0
_DEFAULT_PRESSED_RATE_THRESHOLD = 5.5
_DEFAULT_CALM_RATE_MAX = 4.5


class VocalRegisterAnalyzer:
    """Analyse le registre vocal a partir d'un buffer audio PCM 16-bit."""

    def __init__(self, tuning: Optional[dict] = None):
        self._tuning = tuning or {}

    def _get_threshold(self, key: str, default: float) -> float:
        return float(self._tuning.get(key, default))

    def analyze(self, audio_bytes: bytes, sample_rate: int = 16000) -> VocalRegister:
        """
        Analyse le registre vocal d'un buffer audio PCM 16-bit mono.

        Args:
            audio_bytes: PCM brut, int16, little-endian, mono
            sample_rate: Frequence d'echantillonnage (defaut 16000 Hz)

        Returns:
            VocalRegister avec le registre detecte, le RMS en dB,
            le debit estime en syllabes/sec, et la confiance (0-1).
        """
        # Fallback: audio vide ou trop court (< 100ms)
        min_samples = int(sample_rate * 0.1)
        if len(audio_bytes) < min_samples * 2:  # 2 bytes per sample (int16)
            return VocalRegister(
                register=RegisterType.CALM,
                rms_db=-96.0,
                estimated_speech_rate=0.0,
                confidence=0.0,
            )

        # Decode PCM int16
        audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
        audio_float = audio_int16.astype(np.float32) / 32768.0

        # RMS en dB
        rms = np.sqrt(np.mean(audio_float ** 2))
        if rms < 1e-10:
            rms_db = -96.0
        else:
            rms_db = 20.0 * np.log10(rms)

        # Estimation du debit vocal via segments d'energie
        estimated_rate = self._estimate_speech_rate(audio_float, sample_rate)

        # Seuils configurables
        whisper_rms_db = self._get_threshold("register_whisper_rms_db", _DEFAULT_WHISPER_RMS_DB)
        pressed_rate = self._get_threshold("register_pressed_rate_threshold", _DEFAULT_PRESSED_RATE_THRESHOLD)
        calm_rate_max = self._get_threshold("register_calm_rate_max", _DEFAULT_CALM_RATE_MAX)

        # Classification
        register, confidence = self._classify(
            rms_db, estimated_rate,
            whisper_rms_db, pressed_rate, calm_rate_max,
        )

        return VocalRegister(
            register=register,
            rms_db=float(round(rms_db, 2)),
            estimated_speech_rate=float(round(estimated_rate, 2)),
            confidence=float(round(confidence, 3)),
        )

    def _estimate_speech_rate(self, audio_float: np.ndarray, sample_rate: int) -> float:
        """
        Estime le debit vocal en syllabes/seconde.

        Heuristique: segmente l'audio en fenetres de 20ms, compte les transitions
        silence→parole (approximation des syllabes), divise par la duree totale.
        """
        duration_s = len(audio_float) / sample_rate
        if duration_s < 0.2:
            return 0.0

        # Fenetres de 20ms
        window_samples = int(sample_rate * 0.02)
        n_windows = len(audio_float) // window_samples
        if n_windows < 2:
            return 0.0

        # Energie par fenetre
        energies = np.array([
            np.sqrt(np.mean(audio_float[i * window_samples:(i + 1) * window_samples] ** 2))
            for i in range(n_windows)
        ])

        # Seuil d'energie: utiliser la mediane des fenetres ayant de l'energie
        # Si la plupart des fenetres sont silencieuses, la mediane globale est 0
        non_zero_energies = energies[energies > 1e-6]
        if len(non_zero_energies) == 0:
            return 0.0
        energy_threshold = np.median(non_zero_energies) * 0.3

        # Detecter les transitions silence → parole
        is_speech = energies > energy_threshold
        transitions = 0
        for i in range(1, len(is_speech)):
            if is_speech[i] and not is_speech[i - 1]:
                transitions += 1

        # Au minimum 1 transition si de la parole est detectee
        if np.any(is_speech) and transitions == 0:
            transitions = 1

        # Heuristique: ~1.5 syllabes par transition silence->parole
        estimated_syllables = transitions * 1.5
        rate = estimated_syllables / duration_s

        return rate

    def _classify(
        self,
        rms_db: float,
        speech_rate: float,
        whisper_rms_db: float,
        pressed_rate: float,
        calm_rate_max: float,
    ) -> tuple[RegisterType, float]:
        """Classifie le registre et calcule la confiance."""

        # Chuchotement: RMS bas
        if rms_db < whisper_rms_db:
            # Plus c'est bas, plus on est confiant
            margin = whisper_rms_db - rms_db
            confidence = min(1.0, 0.6 + margin / 20.0)
            return RegisterType.WHISPER, confidence

        # Presse: debit rapide
        if speech_rate > pressed_rate:
            margin = speech_rate - pressed_rate
            confidence = min(1.0, 0.6 + margin / 5.0)
            return RegisterType.PRESSED, confidence

        # Calme: debit normal
        if speech_rate <= calm_rate_max:
            confidence = 0.8
        else:
            # Zone entre calm_rate_max et pressed_rate: confiance plus basse
            confidence = 0.5
        return RegisterType.CALM, confidence
