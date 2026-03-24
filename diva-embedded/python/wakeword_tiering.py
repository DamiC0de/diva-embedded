"""
wakeword_tiering.py — Score de confiance a 3 paliers pour le wake-word.

Determine le palier de confiance (HIGH/MEDIUM/LOW) en fonction du score
ajuste et des seuils configurables, puis dicte l'action a entreprendre.

Story 27.3 — FR202, FR203, FR204
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class WakewordTier(str, Enum):
    """Palier de confiance du wake-word."""
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class TieringResult:
    """Resultat du calcul de tiering."""
    tier: WakewordTier
    score_used: float
    action: str  # "process" | "listen" | "ignore"


def determine_tier(
    score: float,
    tier_high: float = 0.90,
    tier_medium: float = 0.60,
) -> TieringResult:
    """Determine le palier de confiance et l'action associee.

    Args:
        score: score de confiance (brut ou ajuste) entre 0.0 et 1.0
        tier_high: seuil du palier HAUT (>= => process immediat)
        tier_medium: seuil du palier MOYEN (>= et < tier_high => ecoute supplementaire)

    Returns:
        TieringResult avec le palier, le score utilise et l'action

    Paliers:
        HIGH   (score >= tier_high)   -> action "process" (reponse directe)
        MEDIUM (score >= tier_medium) -> action "listen"  (bip + ecoute 3s)
        LOW    (score < tier_medium)  -> action "ignore"  (aucune reaction)
    """
    if score >= tier_high:
        return TieringResult(
            tier=WakewordTier.HIGH,
            score_used=score,
            action="process",
        )
    elif score >= tier_medium:
        return TieringResult(
            tier=WakewordTier.MEDIUM,
            score_used=score,
            action="listen",
        )
    else:
        return TieringResult(
            tier=WakewordTier.LOW,
            score_used=score,
            action="ignore",
        )
