"""
test_wakeword_variants.py — Tests unitaires pour le module wakeword_variants.

Couvre : Story 27.2, AC #1-#8
"""

import sys
import os
import struct

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from wakeword_variants import (
    detect_prefix,
    adjust_score,
    PrefixResult,
    DEFAULT_VARIANTS,
)


# === Helpers pour generer de l'audio synthetique ===

def _silence_pcm(duration_ms: int, sample_rate: int = 16000) -> bytes:
    """Genere du silence PCM 16-bit LE mono."""
    n_samples = int(sample_rate * duration_ms / 1000)
    return b"\x00\x00" * n_samples


def _tone_pcm(duration_ms: int, frequency: float = 440.0, amplitude: float = 0.3,
              sample_rate: int = 16000) -> bytes:
    """Genere un ton sinusoidal PCM 16-bit LE mono."""
    n_samples = int(sample_rate * duration_ms / 1000)
    t = np.arange(n_samples, dtype=np.float32) / sample_rate
    audio = (amplitude * np.sin(2.0 * np.pi * frequency * t) * 32767).astype(np.int16)
    return audio.tobytes()


def _speech_like_pcm(duration_ms: int, sample_rate: int = 16000) -> bytes:
    """Genere un signal pseudo-parole (bruit rose filtre) PCM 16-bit LE mono.
    Suffisamment fort pour depasser les seuils d'energie.
    """
    n_samples = int(sample_rate * duration_ms / 1000)
    # Bruit blanc a amplitude moderee
    noise = np.random.default_rng(42).normal(0, 0.15, n_samples).astype(np.float32)
    # Filtre passe-bas simple pour simuler la parole (300-3000Hz)
    # Moyenne glissante comme filtre passe-bas rudimentaire
    kernel = np.ones(8) / 8
    filtered = np.convolve(noise, kernel, mode="same")
    audio = (filtered * 32767).clip(-32767, 32767).astype(np.int16)
    return audio.tobytes()


def _build_pre_audio(
    prefix_duration_ms: int = 0,
    silence_before_prefix_ms: int = 1000,
    wakeword_duration_ms: int = 500,
    sample_rate: int = 16000,
    prefix_is_speech: bool = True,
    far_speech_ms: int = 0,
) -> bytes:
    """Construit un buffer pre-audio simulant le buffer circulaire.

    Structure: [silence/far_speech] + [prefix_audio] + [wakeword_audio]
    """
    parts = []

    if far_speech_ms > 0:
        # Parole continue loin du wake-word (contexte conversationnel)
        parts.append(_speech_like_pcm(far_speech_ms, sample_rate))
        remaining_silence = max(0, silence_before_prefix_ms - far_speech_ms)
        if remaining_silence > 0:
            parts.append(_silence_pcm(remaining_silence, sample_rate))
    else:
        parts.append(_silence_pcm(silence_before_prefix_ms, sample_rate))

    if prefix_duration_ms > 0:
        if prefix_is_speech:
            parts.append(_speech_like_pcm(prefix_duration_ms, sample_rate))
        else:
            parts.append(_silence_pcm(prefix_duration_ms, sample_rate))

    # Simuler le wake-word "Diva" a la fin du buffer
    parts.append(_speech_like_pcm(wakeword_duration_ms, sample_rate))

    return b"".join(parts)


# =====================================================================
# Tests de detect_prefix()
# =====================================================================

def test_detect_prefix_with_hey_prefix():
    """Audio contenant un prefixe interpellatif avant 'Diva' => is_interpellative=True."""
    pre_audio = _build_pre_audio(
        prefix_duration_ms=200,  # "Hey" dure ~200ms
        silence_before_prefix_ms=1500,
        prefix_is_speech=True,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500)
    assert result.is_interpellative, f"Expected interpellative, got {result}"
    assert result.prefix_detected is not None, f"Expected prefix_detected, got None"
    assert result.confidence_boost > 0, f"Expected positive boost, got {result.confidence_boost}"
    print("PASS: test_detect_prefix_with_hey_prefix")


def test_detect_prefix_silence_before_diva():
    """Silence avant 'Diva' => pas de prefixe."""
    pre_audio = _build_pre_audio(
        prefix_duration_ms=0,
        silence_before_prefix_ms=2000,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500)
    assert not result.is_interpellative, f"Expected not interpellative, got {result}"
    assert result.prefix_detected is None, f"Expected None, got {result.prefix_detected}"
    assert result.confidence_boost == 0.0, f"Expected 0.0 boost, got {result.confidence_boost}"
    print("PASS: test_detect_prefix_silence_before_diva")


def test_detect_prefix_continuous_speech():
    """Parole continue avant 'Diva' (contexte conversationnel) => has_continuous_speech=True."""
    pre_audio = _build_pre_audio(
        prefix_duration_ms=300,
        silence_before_prefix_ms=1000,
        far_speech_ms=800,  # Parole loin du wake-word
        prefix_is_speech=True,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500)
    assert result.has_continuous_speech, f"Expected continuous speech, got {result}"
    assert not result.is_interpellative, f"Should not be interpellative with continuous speech"
    print("PASS: test_detect_prefix_continuous_speech")


def test_detect_prefix_empty_audio():
    """Pas d'audio => resultat par defaut."""
    result = detect_prefix(b"", prefix_window_ms=500)
    assert not result.is_interpellative
    assert result.prefix_detected is None
    assert result.confidence_boost == 0.0
    assert result.energy_db == -96.0
    print("PASS: test_detect_prefix_empty_audio")


def test_detect_prefix_too_short_audio():
    """Audio trop court (< wakeword_duration) => pas de prefixe."""
    # Seulement 100ms d'audio, pas assez pour contenir wakeword + prefixe
    short_audio = _silence_pcm(100)
    result = detect_prefix(short_audio, prefix_window_ms=500)
    assert not result.is_interpellative
    assert result.prefix_detected is None
    print("PASS: test_detect_prefix_too_short_audio")


def test_detect_prefix_custom_variants():
    """Variantes personnalisees."""
    pre_audio = _build_pre_audio(
        prefix_duration_ms=200,
        silence_before_prefix_ms=1500,
        prefix_is_speech=True,
    )
    custom_variants = ["Salut Diva", "Coucou Diva"]
    result = detect_prefix(pre_audio, prefix_window_ms=500, variants=custom_variants)
    assert result.is_interpellative
    assert result.prefix_detected in custom_variants
    print("PASS: test_detect_prefix_custom_variants")


def test_detect_prefix_custom_boost():
    """Boost personnalise."""
    pre_audio = _build_pre_audio(
        prefix_duration_ms=200,
        silence_before_prefix_ms=1500,
        prefix_is_speech=True,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500, prefix_boost=0.25)
    assert result.confidence_boost == 0.25, f"Expected 0.25, got {result.confidence_boost}"
    print("PASS: test_detect_prefix_custom_boost")


# =====================================================================
# Tests de adjust_score()
# =====================================================================

def test_adjust_score_with_prefix_boost():
    """Score booste quand prefixe interpellatif detecte."""
    prefix_result = PrefixResult(
        prefix_detected="Hey Diva",
        confidence_boost=0.15,
        is_interpellative=True,
        has_continuous_speech=False,
        energy_db=-20.0,
    )
    raw_score = 0.85
    adjusted = adjust_score(raw_score, prefix_result)
    expected = 0.85 * (1.0 + 0.15)
    assert abs(adjusted - expected) < 0.001, f"Expected {expected}, got {adjusted}"
    print("PASS: test_adjust_score_with_prefix_boost")


def test_adjust_score_capped_at_1():
    """Score ajuste ne depasse jamais 1.0."""
    prefix_result = PrefixResult(
        prefix_detected="Hey Diva",
        confidence_boost=0.15,
        is_interpellative=True,
        has_continuous_speech=False,
        energy_db=-20.0,
    )
    raw_score = 0.95
    adjusted = adjust_score(raw_score, prefix_result)
    assert adjusted <= 1.0, f"Score should not exceed 1.0, got {adjusted}"
    assert adjusted == 1.0, f"Expected 1.0 (capped), got {adjusted}"
    print("PASS: test_adjust_score_capped_at_1")


def test_adjust_score_with_penalty():
    """Score penalise quand parole continue sans prefixe interpellatif."""
    prefix_result = PrefixResult(
        prefix_detected=None,
        confidence_boost=0.0,
        is_interpellative=False,
        has_continuous_speech=True,
        energy_db=-20.0,
    )
    raw_score = 0.85
    adjusted = adjust_score(raw_score, prefix_result, no_prefix_penalty=0.10)
    expected = 0.85 * (1.0 - 0.10)
    assert abs(adjusted - expected) < 0.001, f"Expected {expected}, got {adjusted}"
    print("PASS: test_adjust_score_with_penalty")


def test_adjust_score_no_modification():
    """Score inchange quand pas de parole avant le wake-word."""
    prefix_result = PrefixResult(
        prefix_detected=None,
        confidence_boost=0.0,
        is_interpellative=False,
        has_continuous_speech=False,
        energy_db=-50.0,
    )
    raw_score = 0.90
    adjusted = adjust_score(raw_score, prefix_result)
    assert adjusted == raw_score, f"Expected {raw_score}, got {adjusted}"
    print("PASS: test_adjust_score_no_modification")


def test_adjust_score_penalty_never_negative():
    """Score ajuste ne descend jamais sous 0.0."""
    prefix_result = PrefixResult(
        prefix_detected=None,
        confidence_boost=0.0,
        is_interpellative=False,
        has_continuous_speech=True,
        energy_db=-20.0,
    )
    raw_score = 0.05
    adjusted = adjust_score(raw_score, prefix_result, no_prefix_penalty=0.99)
    assert adjusted >= 0.0, f"Score should not be negative, got {adjusted}"
    print("PASS: test_adjust_score_penalty_never_negative")


# =====================================================================
# Tests de regression et coherence
# =====================================================================

def test_diva_alone_no_regression():
    """'Diva' seul (pas de prefixe, silence avant) => score inchange.
    Verifie qu'il n'y a pas de regression sur le cas standard.
    """
    pre_audio = _build_pre_audio(
        prefix_duration_ms=0,
        silence_before_prefix_ms=2500,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500)
    raw_score = 0.90
    adjusted = adjust_score(raw_score, result)
    assert adjusted == raw_score, f"Diva alone should not change score: {adjusted} != {raw_score}"
    print("PASS: test_diva_alone_no_regression")


def test_false_positive_context_penalized():
    """'Tu connais Diva ?' (contexte conversationnel) => score penalise."""
    # Simuler une phrase longue avant "Diva"
    pre_audio = _build_pre_audio(
        prefix_duration_ms=300,
        silence_before_prefix_ms=500,
        far_speech_ms=1500,  # Longue phrase avant
        prefix_is_speech=True,
    )
    result = detect_prefix(pre_audio, prefix_window_ms=500)
    raw_score = 0.87
    adjusted = adjust_score(raw_score, result, no_prefix_penalty=0.10)
    assert adjusted < raw_score, f"Context speech should penalize: {adjusted} >= {raw_score}"
    print("PASS: test_false_positive_context_penalized")


def test_scoring_coherent_across_variants():
    """Le scoring est coherent : meme boost pour toutes les variantes."""
    boost = 0.15
    raw_score = 0.85

    for variant in DEFAULT_VARIANTS:
        if variant == "Diva ?":
            continue  # Diva seul n'a pas de prefixe
        prefix_result = PrefixResult(
            prefix_detected=variant,
            confidence_boost=boost,
            is_interpellative=True,
            has_continuous_speech=False,
            energy_db=-20.0,
        )
        adjusted = adjust_score(raw_score, prefix_result)
        expected = min(1.0, raw_score * (1.0 + boost))
        assert abs(adjusted - expected) < 0.001, f"Variant {variant}: {adjusted} != {expected}"

    print("PASS: test_scoring_coherent_across_variants")


def test_default_variants_list():
    """Verifier que DEFAULT_VARIANTS contient les 5 variantes attendues."""
    expected = {"Hey Diva", "Oh Diva", "Dis Diva", "Diva ?", "Eh Diva"}
    assert set(DEFAULT_VARIANTS) == expected, f"Unexpected variants: {DEFAULT_VARIANTS}"
    print("PASS: test_default_variants_list")


def test_prefix_result_dataclass():
    """Verifier que PrefixResult est un dataclass correct."""
    result = PrefixResult(
        prefix_detected="Hey Diva",
        confidence_boost=0.15,
        is_interpellative=True,
        has_continuous_speech=False,
        energy_db=-22.5,
    )
    assert result.prefix_detected == "Hey Diva"
    assert result.confidence_boost == 0.15
    assert result.is_interpellative is True
    assert result.has_continuous_speech is False
    assert result.energy_db == -22.5
    print("PASS: test_prefix_result_dataclass")


if __name__ == "__main__":
    # detect_prefix tests
    test_detect_prefix_with_hey_prefix()
    test_detect_prefix_silence_before_diva()
    test_detect_prefix_continuous_speech()
    test_detect_prefix_empty_audio()
    test_detect_prefix_too_short_audio()
    test_detect_prefix_custom_variants()
    test_detect_prefix_custom_boost()

    # adjust_score tests
    test_adjust_score_with_prefix_boost()
    test_adjust_score_capped_at_1()
    test_adjust_score_with_penalty()
    test_adjust_score_no_modification()
    test_adjust_score_penalty_never_negative()

    # Regression and coherence tests
    test_diva_alone_no_regression()
    test_false_positive_context_penalized()
    test_scoring_coherent_across_variants()
    test_default_variants_list()
    test_prefix_result_dataclass()

    print("\nAll wakeword_variants tests passed!")
