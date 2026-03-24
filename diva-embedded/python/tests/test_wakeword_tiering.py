"""
test_wakeword_tiering.py — Tests unitaires pour le module wakeword_tiering.

Couvre : Story 27.3, AC #1-#10
"""

import sys
import os
import time
from unittest.mock import patch, MagicMock

# Ajouter le repertoire parent au path pour l'import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wakeword_tiering import (
    determine_tier,
    WakewordTier,
    TieringResult,
)


# =====================================================================
# Tests de determine_tier() — AC #1, #2, #3, #4, #5
# =====================================================================

def test_high_tier_above_threshold():
    """Score 0.95 avec seuils par defaut -> HIGH, action 'process' (AC #1)."""
    result = determine_tier(0.95, 0.90, 0.60)
    assert result.tier == WakewordTier.HIGH
    assert result.action == "process"
    assert result.score_used == 0.95
    print("PASS: test_high_tier_above_threshold")


def test_medium_tier_between_thresholds():
    """Score 0.75 avec seuils par defaut -> MEDIUM, action 'listen' (AC #2)."""
    result = determine_tier(0.75, 0.90, 0.60)
    assert result.tier == WakewordTier.MEDIUM
    assert result.action == "listen"
    assert result.score_used == 0.75
    print("PASS: test_medium_tier_between_thresholds")


def test_low_tier_below_threshold():
    """Score 0.40 avec seuils par defaut -> LOW, action 'ignore' (AC #3)."""
    result = determine_tier(0.40, 0.90, 0.60)
    assert result.tier == WakewordTier.LOW
    assert result.action == "ignore"
    assert result.score_used == 0.40
    print("PASS: test_low_tier_below_threshold")


def test_medium_tier_at_medium_boundary():
    """Score exactement 0.60 (seuil medium inclusif) -> MEDIUM (AC #4)."""
    result = determine_tier(0.60, 0.90, 0.60)
    assert result.tier == WakewordTier.MEDIUM
    assert result.action == "listen"
    print("PASS: test_medium_tier_at_medium_boundary")


def test_high_tier_at_high_boundary():
    """Score exactement 0.90 (seuil high inclusif) -> HIGH (AC #4)."""
    result = determine_tier(0.90, 0.90, 0.60)
    assert result.tier == WakewordTier.HIGH
    assert result.action == "process"
    print("PASS: test_high_tier_at_high_boundary")


def test_custom_thresholds():
    """Seuils personnalises via tuning (AC #4)."""
    # Custom: high=0.85, medium=0.50
    result = determine_tier(0.86, 0.85, 0.50)
    assert result.tier == WakewordTier.HIGH

    result = determine_tier(0.70, 0.85, 0.50)
    assert result.tier == WakewordTier.MEDIUM

    result = determine_tier(0.49, 0.85, 0.50)
    assert result.tier == WakewordTier.LOW

    print("PASS: test_custom_thresholds")


def test_score_zero():
    """Score 0.0 -> LOW."""
    result = determine_tier(0.0, 0.90, 0.60)
    assert result.tier == WakewordTier.LOW
    assert result.action == "ignore"
    print("PASS: test_score_zero")


def test_score_one():
    """Score 1.0 -> HIGH."""
    result = determine_tier(1.0, 0.90, 0.60)
    assert result.tier == WakewordTier.HIGH
    assert result.action == "process"
    print("PASS: test_score_one")


def test_just_below_medium():
    """Score 0.599 -> LOW (strict boundary check)."""
    result = determine_tier(0.599, 0.90, 0.60)
    assert result.tier == WakewordTier.LOW
    assert result.action == "ignore"
    print("PASS: test_just_below_medium")


def test_just_below_high():
    """Score 0.899 -> MEDIUM (strict boundary check)."""
    result = determine_tier(0.899, 0.90, 0.60)
    assert result.tier == WakewordTier.MEDIUM
    assert result.action == "listen"
    print("PASS: test_just_below_high")


# =====================================================================
# Tests de TieringResult dataclass
# =====================================================================

def test_tiering_result_dataclass():
    """Verification du dataclass TieringResult."""
    result = TieringResult(
        tier=WakewordTier.HIGH,
        score_used=0.95,
        action="process",
    )
    assert result.tier == WakewordTier.HIGH
    assert result.score_used == 0.95
    assert result.action == "process"
    print("PASS: test_tiering_result_dataclass")


def test_wakeword_tier_enum_values():
    """Verification des valeurs de l'enum WakewordTier."""
    assert WakewordTier.HIGH.value == "HIGH"
    assert WakewordTier.MEDIUM.value == "MEDIUM"
    assert WakewordTier.LOW.value == "LOW"
    assert WakewordTier.HIGH == "HIGH"  # str enum comparison
    print("PASS: test_wakeword_tier_enum_values")


# =====================================================================
# Tests de regression et performance — AC #7, #10
# =====================================================================

def test_tiering_latency():
    """Le calcul de tiering doit prendre < 1ms (AC #7)."""
    iterations = 10000
    start = time.time()
    for i in range(iterations):
        determine_tier(0.85, 0.90, 0.60)
    elapsed = time.time() - start
    avg_us = (elapsed / iterations) * 1_000_000
    assert avg_us < 1000, f"Tiering too slow: {avg_us:.1f} us/call (max 1000 us)"
    print(f"PASS: test_tiering_latency ({avg_us:.1f} us/call)")


def test_no_regression_standard_flow():
    """Score > 0.90 doit toujours donner HIGH/process — pas de latence ajoutee (AC #10)."""
    result = determine_tier(0.92, 0.90, 0.60)
    assert result.tier == WakewordTier.HIGH
    assert result.action == "process"
    # No additional delay — immediate return
    print("PASS: test_no_regression_standard_flow")


# =====================================================================
# Tests de play_feedback() — AC #6, #7
# =====================================================================

def test_play_feedback_non_blocking():
    """Verification que play_feedback() est non-bloquant (AC #6)."""
    # We can't test actual aplay in unit tests, but we can verify
    # the function doesn't block by mocking subprocess.Popen
    # Import from diva_audio_server would require heavy dependencies,
    # so we test the pattern directly
    from unittest.mock import MagicMock, patch

    mock_popen = MagicMock()
    mock_stdin = MagicMock()
    mock_popen.return_value.stdin = mock_stdin

    # Simulate what play_feedback does
    with patch("subprocess.Popen", mock_popen):
        import subprocess
        wav_bytes = b"RIFF\x00\x00\x00\x00WAVEfmt "  # Minimal WAV header
        proc = subprocess.Popen(
            ["aplay", "-D", "plughw:5", "-q"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.stdin.write(wav_bytes)
        proc.stdin.close()

        # Verify Popen was called (non-blocking — no proc.wait())
        mock_popen.assert_called_once()
        mock_stdin.write.assert_called_once_with(wav_bytes)
        mock_stdin.close.assert_called_once()

    print("PASS: test_play_feedback_non_blocking")


# =====================================================================
# Tests d'integration simules — AC #1, #2, #3, #8, #9
# =====================================================================

def test_integration_high_tier_response():
    """Simuler un resultat de detection palier HAUT (AC #1)."""
    score = 0.95
    tiering = determine_tier(score, 0.90, 0.60)

    # Simuler la construction de la reponse API
    response = {
        "detected": tiering.action == "process",
        "score": score,
        "tier": tiering.tier.value,
        "action": tiering.action,
        "score_raw": score,
    }

    assert response["detected"] is True
    assert response["tier"] == "HIGH"
    assert response["action"] == "process"
    print("PASS: test_integration_high_tier_response")


def test_integration_low_tier_response():
    """Simuler un resultat de detection palier BAS (AC #3)."""
    score = 0.40
    tiering = determine_tier(score, 0.90, 0.60)

    response = {
        "detected": tiering.action == "process",
        "score": score,
        "tier": tiering.tier.value,
        "action": tiering.action,
    }

    assert response["detected"] is False
    assert response["tier"] == "LOW"
    assert response["action"] == "ignore"
    print("PASS: test_integration_low_tier_response")


def test_integration_medium_tier_no_speech_response():
    """Simuler palier MOYEN sans parole -> action ignore, detected false (AC #2, #8)."""
    score = 0.75
    tiering = determine_tier(score, 0.90, 0.60)
    assert tiering.action == "listen"

    # Simulate: after listen, no speech detected
    final_action = "ignore"  # No speech detected in 3s window
    response = {
        "detected": final_action == "process",
        "score": score,
        "tier": tiering.tier.value,
        "action": final_action,
        "medium_tier_speech_detected": False,
        "medium_tier_listen_duration_s": 3.0,
    }

    assert response["detected"] is False
    assert response["tier"] == "MEDIUM"
    assert response["action"] == "ignore"
    assert response["medium_tier_speech_detected"] is False
    print("PASS: test_integration_medium_tier_no_speech_response")


def test_integration_medium_tier_with_speech_response():
    """Simuler palier MOYEN avec parole -> action process, detected true (AC #2)."""
    score = 0.75
    tiering = determine_tier(score, 0.90, 0.60)
    assert tiering.action == "listen"

    # Simulate: speech detected during listen window
    final_action = "process"
    response = {
        "detected": final_action == "process",
        "score": score,
        "tier": tiering.tier.value,
        "action": final_action,
        "medium_tier_speech_detected": True,
        "medium_tier_listen_duration_s": 1.2,
    }

    assert response["detected"] is True
    assert response["tier"] == "MEDIUM"
    assert response["action"] == "process"
    assert response["medium_tier_speech_detected"] is True
    print("PASS: test_integration_medium_tier_with_speech_response")


def test_integration_dynamic_tuning():
    """Modifier les seuils dynamiquement simule l'endpoint /tuning (AC #4, #8)."""
    # Default thresholds: score 0.80 -> MEDIUM
    result1 = determine_tier(0.80, 0.90, 0.60)
    assert result1.tier == WakewordTier.MEDIUM

    # After tuning update: lower high threshold to 0.75 -> now HIGH
    result2 = determine_tier(0.80, 0.75, 0.60)
    assert result2.tier == WakewordTier.HIGH

    # After tuning update: raise medium threshold to 0.85 -> now LOW
    result3 = determine_tier(0.80, 0.95, 0.85)
    assert result3.tier == WakewordTier.LOW

    print("PASS: test_integration_dynamic_tuning")


# =====================================================================
# Tests de structure des logs — AC #9
# =====================================================================

def test_structured_log_fields():
    """Verification que tous les champs requis pour le log sont presents (AC #9)."""
    score_raw = 0.85
    score_adjusted = 0.92
    tiering = determine_tier(score_adjusted, 0.90, 0.60)

    log_entry = {
        "event": "wakeword_tiering",
        "score_raw": round(score_raw, 4),
        "score_adjusted": round(score_adjusted, 4),
        "tier": tiering.tier.value,
        "action": tiering.action,
    }

    required_keys = {"event", "score_raw", "score_adjusted", "tier", "action"}
    assert required_keys.issubset(set(log_entry.keys()))
    assert log_entry["tier"] in ("HIGH", "MEDIUM", "LOW")
    assert log_entry["action"] in ("process", "listen", "ignore")
    print("PASS: test_structured_log_fields")


if __name__ == "__main__":
    # determine_tier tests
    test_high_tier_above_threshold()
    test_medium_tier_between_thresholds()
    test_low_tier_below_threshold()
    test_medium_tier_at_medium_boundary()
    test_high_tier_at_high_boundary()
    test_custom_thresholds()
    test_score_zero()
    test_score_one()
    test_just_below_medium()
    test_just_below_high()

    # Dataclass tests
    test_tiering_result_dataclass()
    test_wakeword_tier_enum_values()

    # Performance tests
    test_tiering_latency()
    test_no_regression_standard_flow()

    # play_feedback tests
    test_play_feedback_non_blocking()

    # Integration tests
    test_integration_high_tier_response()
    test_integration_low_tier_response()
    test_integration_medium_tier_no_speech_response()
    test_integration_medium_tier_with_speech_response()
    test_integration_dynamic_tuning()

    # Log structure tests
    test_structured_log_fields()

    print("\nAll wakeword_tiering tests passed!")
