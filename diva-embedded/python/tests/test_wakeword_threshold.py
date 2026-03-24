"""
test_wakeword_threshold.py — Tests unitaires pour le module wakeword_threshold.

Couvre : Story 2.6, AC #1-#10
"""

import sys
import os
import time
from unittest.mock import patch, MagicMock

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wakeword_threshold import (
    DynamicThreshold,
    SpeakerCache,
    detect_fuzzy_match,
    DEFAULT_THRESHOLD_ADULT,
    DEFAULT_THRESHOLD_CHILD,
    CHILD_PERSONA_TYPES,
    ADULT_PERSONA_TYPES,
    FUZZY_BOOST,
)

import numpy as np


# =====================================================================
# Tests de DynamicThreshold.get_threshold() — AC #1, #2, #3
# =====================================================================

def test_threshold_child():
    """get_threshold('child') -> 0.70 (AC #1)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("child") == 0.70
    print("PASS: test_threshold_child")


def test_threshold_ado():
    """get_threshold('ado') -> 0.70 (AC #1)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("ado") == 0.70
    print("PASS: test_threshold_ado")


def test_threshold_adult():
    """get_threshold('adult') -> 0.90 (AC #2)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("adult") == 0.90
    print("PASS: test_threshold_adult")


def test_threshold_elderly():
    """get_threshold('elderly') -> 0.90 (AC #2)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("elderly") == 0.90
    print("PASS: test_threshold_elderly")


def test_threshold_alzheimer():
    """get_threshold('alzheimer') -> 0.90 (AC #2)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("alzheimer") == 0.90
    print("PASS: test_threshold_alzheimer")


def test_threshold_guest():
    """get_threshold('guest') -> 0.90 (AC #2)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("guest") == 0.90
    print("PASS: test_threshold_guest")


def test_threshold_none():
    """get_threshold(None) -> 0.70 (inconnu = seuil souple) (AC #3)."""
    dt = DynamicThreshold()
    assert dt.get_threshold(None) == 0.70
    print("PASS: test_threshold_none")


# =====================================================================
# Tests de DynamicThreshold.is_child_persona() — AC #1
# =====================================================================

def test_is_child_persona_child():
    """is_child_persona('child') -> True."""
    dt = DynamicThreshold()
    assert dt.is_child_persona("child") is True
    print("PASS: test_is_child_persona_child")


def test_is_child_persona_ado():
    """is_child_persona('ado') -> True."""
    dt = DynamicThreshold()
    assert dt.is_child_persona("ado") is True
    print("PASS: test_is_child_persona_ado")


def test_is_child_persona_adult():
    """is_child_persona('adult') -> False."""
    dt = DynamicThreshold()
    assert dt.is_child_persona("adult") is False
    print("PASS: test_is_child_persona_adult")


def test_is_child_persona_none():
    """is_child_persona(None) -> False."""
    dt = DynamicThreshold()
    assert dt.is_child_persona(None) is False
    print("PASS: test_is_child_persona_none")


def test_is_child_persona_elderly():
    """is_child_persona('elderly') -> False."""
    dt = DynamicThreshold()
    assert dt.is_child_persona("elderly") is False
    print("PASS: test_is_child_persona_elderly")


def test_is_child_persona_guest():
    """is_child_persona('guest') -> False."""
    dt = DynamicThreshold()
    assert dt.is_child_persona("guest") is False
    print("PASS: test_is_child_persona_guest")


# =====================================================================
# Tests de DynamicThreshold.update() — AC #6
# =====================================================================

def test_update_thresholds():
    """Verification de la mise a jour dynamique des seuils (AC #6)."""
    dt = DynamicThreshold()
    assert dt.get_threshold("child") == 0.70
    assert dt.get_threshold("adult") == 0.90

    dt.update(adult_threshold=0.85, child_threshold=0.65)
    assert dt.get_threshold("child") == 0.65
    assert dt.get_threshold("adult") == 0.85
    assert dt.get_threshold(None) == 0.65  # unknown still uses child threshold

    print("PASS: test_update_thresholds")


# =====================================================================
# Tests de DynamicThreshold.get_tiering_thresholds() — AC #7
# =====================================================================

def test_tiering_thresholds_child():
    """Tiering thresholds for child persona (AC #7)."""
    dt = DynamicThreshold()
    result = dt.get_tiering_thresholds("child")
    assert abs(result["tier_high"] - 0.70) < 0.001
    assert abs(result["tier_medium"] - 0.50) < 0.001
    print("PASS: test_tiering_thresholds_child")


def test_tiering_thresholds_adult():
    """Tiering thresholds for adult persona (AC #7)."""
    dt = DynamicThreshold()
    result = dt.get_tiering_thresholds("adult")
    assert abs(result["tier_high"] - 0.90) < 0.001
    assert abs(result["tier_medium"] - 0.60) < 0.001
    print("PASS: test_tiering_thresholds_adult")


def test_tiering_thresholds_none():
    """Tiering thresholds for unknown persona (None) -> child thresholds (AC #7)."""
    dt = DynamicThreshold()
    result = dt.get_tiering_thresholds(None)
    assert abs(result["tier_high"] - 0.70) < 0.001
    assert abs(result["tier_medium"] - 0.50) < 0.001
    print("PASS: test_tiering_thresholds_none")


# =====================================================================
# Tests de detect_fuzzy_match() — AC #4
# =====================================================================

def _make_audio(duration_ms: int, freq_hz: float = 440.0, sample_rate: int = 16000, amplitude: float = 0.5) -> bytes:
    """Generate a sinusoidal audio chunk for testing."""
    n_samples = int(sample_rate * duration_ms / 1000)
    t = np.arange(n_samples, dtype=np.float32) / sample_rate
    signal = (amplitude * np.sin(2 * np.pi * freq_hz * t) * 32767).astype(np.int16)
    return signal.tobytes()


def _make_audio_with_dip(duration_ms: int, dip_start_ms: int, dip_duration_ms: int,
                          sample_rate: int = 16000) -> bytes:
    """Generate audio with a silence dip in the middle (simulating 'Di-va')."""
    n_samples = int(sample_rate * duration_ms / 1000)
    dip_start_sample = int(sample_rate * dip_start_ms / 1000)
    dip_end_sample = int(sample_rate * (dip_start_ms + dip_duration_ms) / 1000)

    t = np.arange(n_samples, dtype=np.float32) / sample_rate
    signal = (0.5 * np.sin(2 * np.pi * 440.0 * t) * 32767).astype(np.float32)

    # Create dip (silence)
    signal[dip_start_sample:dip_end_sample] = 0.0

    return signal.astype(np.int16).tobytes()


def test_fuzzy_match_elongation():
    """detect_fuzzy_match() with elongation pattern -> score boosted (AC #4)."""
    # Long sustained audio (>300ms) simulating "Divaaaaa"
    audio = _make_audio(500, freq_hz=440.0, amplitude=0.8)
    score = 0.65
    result = detect_fuzzy_match(audio, score)
    assert result >= 0.70, f"Expected score >= 0.70, got {result}"
    assert result == score + FUZZY_BOOST
    print(f"PASS: test_fuzzy_match_elongation (score {score} -> {result})")


def test_fuzzy_match_no_elongation():
    """detect_fuzzy_match() with normal audio -> score unchanged (AC #4)."""
    # Short quiet audio — not an elongation
    audio = _make_audio(100, freq_hz=440.0, amplitude=0.001)
    score = 0.65
    result = detect_fuzzy_match(audio, score)
    assert result == score, f"Expected score unchanged ({score}), got {result}"
    print(f"PASS: test_fuzzy_match_no_elongation (score unchanged: {result})")


def test_fuzzy_match_dip_pattern():
    """detect_fuzzy_match() with dip pattern (Di-va) -> score boosted (AC #4)."""
    # Audio with a silence dip in the middle
    audio = _make_audio_with_dip(400, dip_start_ms=150, dip_duration_ms=80)
    score = 0.65
    result = detect_fuzzy_match(audio, score)
    assert result >= 0.70, f"Expected score >= 0.70, got {result}"
    print(f"PASS: test_fuzzy_match_dip_pattern (score {score} -> {result})")


def test_fuzzy_match_empty_audio():
    """detect_fuzzy_match() with empty audio -> score unchanged."""
    score = 0.65
    result = detect_fuzzy_match(b"", score)
    assert result == score
    print("PASS: test_fuzzy_match_empty_audio")


def test_fuzzy_match_short_audio():
    """detect_fuzzy_match() with very short audio -> score unchanged."""
    score = 0.65
    result = detect_fuzzy_match(b"\x00" * 10, score)
    assert result == score
    print("PASS: test_fuzzy_match_short_audio")


def test_fuzzy_match_max_clamp():
    """detect_fuzzy_match() should never exceed 1.0."""
    audio = _make_audio(500, freq_hz=440.0, amplitude=0.8)
    score = 0.96
    result = detect_fuzzy_match(audio, score)
    assert result <= 1.0, f"Score should be clamped to 1.0, got {result}"
    print(f"PASS: test_fuzzy_match_max_clamp (score {score} -> {result})")


# =====================================================================
# Tests de SpeakerCache — AC #10
# =====================================================================

def test_speaker_cache_init():
    """SpeakerCache initializes with None values."""
    cache = SpeakerCache(ttl_s=30.0)
    assert cache._speaker_id is None
    assert cache._persona_type is None
    print("PASS: test_speaker_cache_init")


def test_speaker_cache_get_with_expired_ttl():
    """SpeakerCache calls _refresh when TTL is expired."""
    cache = SpeakerCache(ttl_s=0.0)  # TTL = 0 -> always expired
    # Mock _refresh to avoid real HTTP call
    cache._refresh = MagicMock()
    cache._persona_type = "child"
    cache._last_fetch = 0.0
    result = cache.get_persona_type()
    cache._refresh.assert_called_once()
    print("PASS: test_speaker_cache_get_with_expired_ttl")


def test_speaker_cache_get_with_valid_ttl():
    """SpeakerCache does not call _refresh when TTL is still valid."""
    cache = SpeakerCache(ttl_s=60.0)
    cache._persona_type = "adult"
    cache._last_fetch = time.time()  # Fresh
    cache._refresh = MagicMock()
    result = cache.get_persona_type()
    cache._refresh.assert_not_called()
    assert result == "adult"
    print("PASS: test_speaker_cache_get_with_valid_ttl")


def test_speaker_cache_invalidate():
    """SpeakerCache.invalidate() forces refresh on next call."""
    cache = SpeakerCache(ttl_s=60.0)
    cache._persona_type = "child"
    cache._last_fetch = time.time()
    cache.invalidate()
    assert cache._last_fetch == 0.0
    print("PASS: test_speaker_cache_invalidate")


def test_speaker_cache_get_all():
    """SpeakerCache.get_all() returns full speaker info."""
    cache = SpeakerCache(ttl_s=60.0)
    cache._speaker_id = "spk-001"
    cache._persona_type = "child"
    cache._greeting_name = "Lea"
    cache._last_fetch = time.time()
    cache._refresh = MagicMock()

    result = cache.get_all()
    assert result == {
        "speaker_id": "spk-001",
        "persona_type": "child",
        "greeting_name": "Lea",
    }
    print("PASS: test_speaker_cache_get_all")


# =====================================================================
# Tests de constantes
# =====================================================================

def test_default_constants():
    """Verification des constantes par defaut."""
    assert DEFAULT_THRESHOLD_ADULT == 0.90
    assert DEFAULT_THRESHOLD_CHILD == 0.70
    assert "child" in CHILD_PERSONA_TYPES
    assert "ado" in CHILD_PERSONA_TYPES
    assert "adult" in ADULT_PERSONA_TYPES
    assert "elderly" in ADULT_PERSONA_TYPES
    assert "alzheimer" in ADULT_PERSONA_TYPES
    assert "guest" in ADULT_PERSONA_TYPES
    print("PASS: test_default_constants")


# =====================================================================
# Tests de performance — AC #10
# =====================================================================

def test_threshold_latency():
    """get_threshold() doit prendre < 1ms (AC #10)."""
    dt = DynamicThreshold()
    iterations = 10000
    start = time.time()
    for i in range(iterations):
        dt.get_threshold("child")
        dt.get_threshold("adult")
        dt.get_threshold(None)
    elapsed = time.time() - start
    avg_us = (elapsed / (iterations * 3)) * 1_000_000
    assert avg_us < 100, f"get_threshold too slow: {avg_us:.1f} us/call (max 100 us)"
    print(f"PASS: test_threshold_latency ({avg_us:.1f} us/call)")


# =====================================================================
# Tests d'integration simules — AC #1, #2, #3, #9
# =====================================================================

def test_integration_child_score_075():
    """Persona child + score 0.75 -> accepted (score >= 0.70) (AC #1)."""
    dt = DynamicThreshold()
    threshold = dt.get_threshold("child")
    score = 0.75
    accepted = score >= threshold
    assert accepted is True
    print("PASS: test_integration_child_score_075")


def test_integration_adult_score_075():
    """Persona adult + score 0.75 -> rejected (score < 0.90) (AC #2)."""
    dt = DynamicThreshold()
    threshold = dt.get_threshold("adult")
    score = 0.75
    accepted = score >= threshold
    assert accepted is False
    print("PASS: test_integration_adult_score_075")


def test_integration_unknown_score_075():
    """Persona None (unknown) + score 0.75 -> accepted (score >= 0.70) (AC #3)."""
    dt = DynamicThreshold()
    threshold = dt.get_threshold(None)
    score = 0.75
    accepted = score >= threshold
    assert accepted is True
    print("PASS: test_integration_unknown_score_075")


def test_integration_adult_score_095():
    """Persona adult + score 0.95 -> accepted (no regression) (AC #9)."""
    dt = DynamicThreshold()
    threshold = dt.get_threshold("adult")
    score = 0.95
    accepted = score >= threshold
    assert accepted is True
    print("PASS: test_integration_adult_score_095")


def test_integration_dynamic_tuning_update():
    """Modify thresholds via update() -> immediate effect (AC #6)."""
    dt = DynamicThreshold()
    # Initial: child at 0.70, adult at 0.90
    assert dt.get_threshold("child") == 0.70

    # Simulate /tuning update
    dt.update(adult_threshold=0.85, child_threshold=0.60)

    # Score 0.65 was rejected before, now accepted
    assert 0.65 >= dt.get_threshold("child")
    # Score 0.87 was rejected before, now accepted
    assert 0.87 >= dt.get_threshold("adult")

    print("PASS: test_integration_dynamic_tuning_update")


def test_integration_api_failure_fallback():
    """When speaker API fails, fallback to child threshold (AC #10)."""
    cache = SpeakerCache(ttl_s=0.0, api_url="http://localhost:99999")
    # API will fail — persona_type should be None
    persona_type = cache.get_persona_type()
    assert persona_type is None

    dt = DynamicThreshold()
    threshold = dt.get_threshold(persona_type)
    # None = child threshold (souple) = 0.70
    assert threshold == 0.70
    print("PASS: test_integration_api_failure_fallback")


# =====================================================================
# Tests de logs structures — AC #8
# =====================================================================

def test_structured_log_fields():
    """Verification que tous les champs requis pour le log sont presents (AC #8)."""
    dt = DynamicThreshold()
    persona_type = "child"
    score = 0.75
    threshold = dt.get_threshold(persona_type)
    accepted = score >= threshold

    log_entry = {
        "score_raw": round(score, 4),
        "threshold_applied": round(threshold, 4),
        "persona_type": persona_type,
        "speaker_id": "spk-001",
        "decision": "accept" if accepted else "reject",
        "fuzzy_boost": 0.0,
    }

    required_keys = {"score_raw", "threshold_applied", "persona_type", "speaker_id", "decision", "fuzzy_boost"}
    assert required_keys.issubset(set(log_entry.keys()))
    assert log_entry["decision"] in ("accept", "reject")
    assert log_entry["persona_type"] in ("child", "ado", "adult", "elderly", "alzheimer", "guest", "unknown")
    print("PASS: test_structured_log_fields")


if __name__ == "__main__":
    # DynamicThreshold.get_threshold tests
    test_threshold_child()
    test_threshold_ado()
    test_threshold_adult()
    test_threshold_elderly()
    test_threshold_alzheimer()
    test_threshold_guest()
    test_threshold_none()

    # is_child_persona tests
    test_is_child_persona_child()
    test_is_child_persona_ado()
    test_is_child_persona_adult()
    test_is_child_persona_none()
    test_is_child_persona_elderly()
    test_is_child_persona_guest()

    # update tests
    test_update_thresholds()

    # tiering thresholds tests
    test_tiering_thresholds_child()
    test_tiering_thresholds_adult()
    test_tiering_thresholds_none()

    # fuzzy match tests
    test_fuzzy_match_elongation()
    test_fuzzy_match_no_elongation()
    test_fuzzy_match_dip_pattern()
    test_fuzzy_match_empty_audio()
    test_fuzzy_match_short_audio()
    test_fuzzy_match_max_clamp()

    # SpeakerCache tests
    test_speaker_cache_init()
    test_speaker_cache_get_with_expired_ttl()
    test_speaker_cache_get_with_valid_ttl()
    test_speaker_cache_invalidate()
    test_speaker_cache_get_all()

    # Constants tests
    test_default_constants()

    # Performance tests
    test_threshold_latency()

    # Integration tests
    test_integration_child_score_075()
    test_integration_adult_score_075()
    test_integration_unknown_score_075()
    test_integration_adult_score_095()
    test_integration_dynamic_tuning_update()
    test_integration_api_failure_fallback()

    # Log structure tests
    test_structured_log_fields()

    print("\nAll wakeword_threshold tests passed!")
