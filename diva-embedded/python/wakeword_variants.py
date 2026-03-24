"""
wakeword_variants.py — Detection de prefixe interpellatif pour variantes du wake-word.

Analyse les ~500ms d'audio pre-wake-word (extraites du buffer circulaire)
pour detecter un prefixe interpellatif ("Hey", "Oh", "Dis", "Eh")
et ajuster le score de confiance en consequence.

Approche A (post-processing) : le modele openWakeWord detecte "Diva" dans
toutes les variantes. Le prefixe sert de signal contextuel pour booster
ou penaliser le score.

Story 27.2 — FR201
"""

from dataclasses import dataclass
from typing import Optional, List

import numpy as np


@dataclass
class PrefixResult:
    """Resultat de la detection de prefixe interpellatif."""
    prefix_detected: Optional[str]  # ex: "Hey Diva", "Oh Diva", None
    confidence_boost: float          # boost a appliquer au score (0.0 si pas de prefixe)
    is_interpellative: bool          # True si prefixe interpellatif detecte
    has_continuous_speech: bool       # True si parole continue detectee (contexte conversationnel)
    energy_db: float                 # energie RMS en dB de la fenetre pre-wake-word


# Prefixes interpellatifs reconnus avec leur pattern
# Le matching est base sur la duree et l'energie du prefixe
DEFAULT_VARIANTS: List[str] = [
    "Hey Diva",
    "Oh Diva",
    "Dis Diva",
    "Diva ?",
    "Eh Diva",
]

# Duree typique d'un prefixe interpellatif (ms)
_PREFIX_DURATION_MIN_MS = 80
_PREFIX_DURATION_MAX_MS = 500

# Seuils d'energie pour la detection
_ENERGY_THRESHOLD_DB = -35.0   # en dessous = silence
_SPEECH_ENERGY_THRESHOLD_DB = -28.0  # au dessus = parole active


def detect_prefix(
    pre_audio_bytes: bytes,
    sample_rate: int = 16000,
    prefix_window_ms: int = 500,
    vad_model=None,
    variants: Optional[List[str]] = None,
    prefix_boost: float = 0.15,
) -> PrefixResult:
    """Analyse l'audio pre-wake-word pour detecter un prefixe interpellatif.

    Args:
        pre_audio_bytes: PCM 16-bit LE mono, extrait du buffer circulaire
        sample_rate: taux d'echantillonnage (defaut 16000)
        prefix_window_ms: fenetre d'analyse en ms avant le wake-word
        vad_model: modele Silero VAD (optionnel, pour confirmation parole)
        variants: liste des variantes acceptees (defaut DEFAULT_VARIANTS)
        prefix_boost: boost de confiance quand prefixe detecte

    Returns:
        PrefixResult avec les informations de detection
    """
    if variants is None:
        variants = DEFAULT_VARIANTS

    # Pas de pre-audio => pas de prefixe
    if not pre_audio_bytes or len(pre_audio_bytes) < 64:
        return PrefixResult(
            prefix_detected=None,
            confidence_boost=0.0,
            is_interpellative=False,
            has_continuous_speech=False,
            energy_db=-96.0,
        )

    # Extraire la fenetre d'analyse (les derniers prefix_window_ms avant le wake-word)
    bytes_per_ms = sample_rate * 2 // 1000  # 2 bytes par sample (16-bit)
    window_bytes = prefix_window_ms * bytes_per_ms
    # Le wake-word "Diva" dure environ 400-500ms, on prend juste avant
    # Le pre_audio est tout le buffer circulaire, "Diva" est a la fin
    # On analyse la fenetre juste avant les derniers ~500ms (ou le wake-word est)
    wakeword_duration_bytes = 500 * bytes_per_ms  # ~500ms pour "Diva"

    total_bytes = len(pre_audio_bytes)

    # Si le buffer est trop petit, prendre ce qu'on a
    if total_bytes <= wakeword_duration_bytes:
        # Pas assez d'audio avant le wake-word
        return PrefixResult(
            prefix_detected=None,
            confidence_boost=0.0,
            is_interpellative=False,
            has_continuous_speech=False,
            energy_db=-96.0,
        )

    # Fenetre d'analyse : de (fin - wakeword_duration - prefix_window) a (fin - wakeword_duration)
    analysis_end = total_bytes - wakeword_duration_bytes
    analysis_start = max(0, analysis_end - window_bytes)

    prefix_audio = pre_audio_bytes[analysis_start:analysis_end]

    if len(prefix_audio) < 64:
        return PrefixResult(
            prefix_detected=None,
            confidence_boost=0.0,
            is_interpellative=False,
            has_continuous_speech=False,
            energy_db=-96.0,
        )

    # Convertir en numpy pour l'analyse
    audio_int16 = np.frombuffer(prefix_audio, dtype=np.int16)
    audio_float = audio_int16.astype(np.float32) / 32768.0

    # Calculer l'energie RMS en dB
    rms = np.sqrt(np.mean(audio_float ** 2))
    energy_db = 20.0 * np.log10(max(rms, 1e-10))

    # Analyse de l'activite vocale dans la fenetre
    has_speech = energy_db > _ENERGY_THRESHOLD_DB
    has_strong_speech = energy_db > _SPEECH_ENERGY_THRESHOLD_DB

    # Utiliser Silero VAD si disponible pour confirmer la presence de parole
    vad_speech_detected = False
    if vad_model is not None and has_speech:
        try:
            vad_speech_detected = _check_vad(audio_float, sample_rate, vad_model)
        except Exception:
            # Degradation gracieuse : on se base uniquement sur l'energie
            vad_speech_detected = has_strong_speech

    # Determiner si c'est un prefixe interpellatif ou du contexte conversationnel
    # Prefixe interpellatif : parole courte (< 500ms) juste avant "Diva"
    # Contexte conversationnel : parole longue et continue

    # Verifier aussi s'il y a de la parole plus loin dans le buffer (contexte continu)
    far_audio_bytes = pre_audio_bytes[:analysis_start] if analysis_start > 0 else b""
    has_far_speech = False
    if len(far_audio_bytes) >= 64:
        far_int16 = np.frombuffer(far_audio_bytes, dtype=np.int16)
        far_float = far_int16.astype(np.float32) / 32768.0
        far_rms = np.sqrt(np.mean(far_float ** 2))
        far_energy_db = 20.0 * np.log10(max(far_rms, 1e-10))
        has_far_speech = far_energy_db > _SPEECH_ENERGY_THRESHOLD_DB

    # Classification
    is_interpellative = False
    has_continuous_speech = False
    prefix_name: Optional[str] = None

    if has_speech or vad_speech_detected:
        if has_far_speech:
            # Parole continue avant le prefixe => contexte conversationnel
            has_continuous_speech = True
            is_interpellative = False
        else:
            # Parole uniquement dans la fenetre de prefixe => interpellatif
            is_interpellative = True
            # Choisir le meilleur match de variante (pour le logging)
            prefix_name = _match_variant(variants)

    return PrefixResult(
        prefix_detected=prefix_name,
        confidence_boost=prefix_boost if is_interpellative else 0.0,
        is_interpellative=is_interpellative,
        has_continuous_speech=has_continuous_speech,
        energy_db=float(energy_db),
    )


def adjust_score(
    raw_score: float,
    prefix_result: PrefixResult,
    no_prefix_penalty: float = 0.10,
) -> float:
    """Calcule le score ajuste en fonction du resultat de detection de prefixe.

    Args:
        raw_score: score brut retourne par openWakeWord
        prefix_result: resultat de detect_prefix()
        no_prefix_penalty: penalite si parole continue sans prefixe interpellatif

    Returns:
        Score ajuste entre 0.0 et 1.0
    """
    if prefix_result.is_interpellative:
        # Prefixe interpellatif detecte => booster le score
        adjusted = raw_score * (1.0 + prefix_result.confidence_boost)
    elif prefix_result.has_continuous_speech:
        # Parole continue sans prefixe interpellatif => penaliser
        adjusted = raw_score * (1.0 - no_prefix_penalty)
    else:
        # Pas de parole avant le wake-word => score inchange
        adjusted = raw_score

    # Clamp entre 0.0 et 1.0
    return max(0.0, min(1.0, adjusted))


def _check_vad(
    audio_float: np.ndarray,
    sample_rate: int,
    vad_model,
) -> bool:
    """Utilise Silero VAD pour verifier la presence de parole.

    Analyse l'audio en chunks de 512 samples (32ms a 16kHz).
    Retourne True si au moins un chunk contient de la parole.
    """
    try:
        import torch
    except ImportError:
        return False

    chunk_samples = 512  # 32ms a 16kHz
    speech_count = 0
    total_chunks = 0

    for i in range(0, len(audio_float) - chunk_samples + 1, chunk_samples):
        chunk = audio_float[i:i + chunk_samples]
        tensor = torch.from_numpy(chunk.copy())
        prob = vad_model(tensor, sample_rate).item()
        if prob > 0.5:
            speech_count += 1
        total_chunks += 1

    if total_chunks == 0:
        return False

    # Parole detectee si au moins 30% des chunks ont de la parole
    return (speech_count / total_chunks) >= 0.3


def _match_variant(variants: List[str]) -> Optional[str]:
    """Retourne le nom de la premiere variante qui a un prefixe (pas "Diva" seul).

    Pour le MVP, on ne distingue pas entre "Hey Diva" et "Oh Diva" par l'audio
    (ce serait de la reconnaissance vocale). On retourne simplement la premiere
    variante a prefixe comme label generique.
    """
    for v in variants:
        if v.strip().lower() != "diva" and v.strip().lower() != "diva ?":
            return v
    return variants[0] if variants else None
