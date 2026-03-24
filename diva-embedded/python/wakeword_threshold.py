"""
wakeword_threshold.py — Seuil dynamique du wake-word base sur le type de persona.

Adapte le seuil de detection pour les enfants (souple, 0.7) vs adultes (strict, 0.9).
Inclut le matching phonetique flou pour les variantes de prononciation.

Story 2.6 — FR82
"""

import time
import threading
from typing import Optional

import numpy as np


# =====================================================================
# Constantes
# =====================================================================

DEFAULT_THRESHOLD_ADULT = 0.90
DEFAULT_THRESHOLD_CHILD = 0.70

CHILD_PERSONA_TYPES = {"child", "ado"}
ADULT_PERSONA_TYPES = {"adult", "elderly", "alzheimer", "guest"}

# Fuzzy matching
FUZZY_BOOST = 0.1
ELONGATION_ENERGY_THRESHOLD_DB = -30.0
ELONGATION_MIN_DURATION_MS = 300


# =====================================================================
# DynamicThreshold
# =====================================================================

class DynamicThreshold:
    """Seuil dynamique du wake-word base sur le type de persona.

    Pour un enfant (child/ado), le seuil est plus souple (0.70 par defaut).
    Pour un adulte ou inconnu, le seuil est strict (0.90 par defaut).
    Pour une voix inconnue (None), le seuil souple est applique par defaut.
    """

    def __init__(
        self,
        adult_threshold: float = DEFAULT_THRESHOLD_ADULT,
        child_threshold: float = DEFAULT_THRESHOLD_CHILD,
    ):
        self.adult_threshold = adult_threshold
        self.child_threshold = child_threshold

    def get_threshold(self, persona_type: Optional[str]) -> float:
        """Retourne le seuil adapte au type de persona.

        Args:
            persona_type: type de persona ("child", "ado", "adult", "elderly",
                          "alzheimer", "guest") ou None si inconnu.

        Returns:
            Seuil de detection (0.70 pour enfants/inconnu, 0.90 pour adultes).
        """
        if persona_type is None:
            # Inconnu = seuil souple (mieux vaut un faux positif qu'un enfant bloque)
            return self.child_threshold
        if self.is_child_persona(persona_type):
            return self.child_threshold
        return self.adult_threshold

    def is_child_persona(self, persona_type: Optional[str]) -> bool:
        """Helper pour detecter si le persona est un enfant.

        Args:
            persona_type: type de persona ou None.

        Returns:
            True si "child" ou "ado", False sinon.
        """
        if persona_type is None:
            return False
        return persona_type in CHILD_PERSONA_TYPES

    def get_tiering_thresholds(self, persona_type: Optional[str]) -> dict:
        """Retourne les seuils de tiering adaptes au persona.

        Pour un enfant : tier_high = child_threshold (0.70), tier_medium = 0.50
        Pour un adulte : tier_high = adult_threshold (0.90), tier_medium = 0.60

        Args:
            persona_type: type de persona ou None.

        Returns:
            dict avec "tier_high" et "tier_medium".
        """
        if persona_type is None or self.is_child_persona(persona_type):
            return {
                "tier_high": self.child_threshold,
                "tier_medium": max(0.40, self.child_threshold - 0.20),
            }
        return {
            "tier_high": self.adult_threshold,
            "tier_medium": max(0.50, self.adult_threshold - 0.30),
        }

    def update(self, adult_threshold: float, child_threshold: float) -> None:
        """Met a jour les seuils dynamiquement (via /tuning).

        Args:
            adult_threshold: nouveau seuil adulte.
            child_threshold: nouveau seuil enfant.
        """
        self.adult_threshold = adult_threshold
        self.child_threshold = child_threshold


# =====================================================================
# SpeakerCache — Cache du persona type avec TTL
# =====================================================================

class SpeakerCache:
    """Cache local du persona type du speaker courant avec TTL.

    Evite un appel HTTP a chaque chunk audio (80ms = 12.5 appels/seconde).
    Le cache est rafraichi en arriere-plan.
    """

    def __init__(self, ttl_s: float = 30.0, api_url: str = "http://localhost:3002"):
        self.ttl_s = ttl_s
        self.api_url = api_url
        self._speaker_id: Optional[str] = None
        self._persona_type: Optional[str] = None
        self._greeting_name: Optional[str] = None
        self._last_fetch: float = 0.0
        self._lock = threading.Lock()

    def get_persona_type(self) -> Optional[str]:
        """Retourne le persona type cache, ou le rafraichit si expire.

        Returns:
            Type de persona ou None si inconnu/erreur.
        """
        now = time.time()
        if (now - self._last_fetch) >= self.ttl_s:
            self._refresh()
        return self._persona_type

    def get_speaker_id(self) -> Optional[str]:
        """Retourne le speaker ID cache."""
        now = time.time()
        if (now - self._last_fetch) >= self.ttl_s:
            self._refresh()
        return self._speaker_id

    def get_all(self) -> dict:
        """Retourne toutes les infos du speaker cache."""
        now = time.time()
        if (now - self._last_fetch) >= self.ttl_s:
            self._refresh()
        return {
            "speaker_id": self._speaker_id,
            "persona_type": self._persona_type,
            "greeting_name": self._greeting_name,
        }

    def _refresh(self) -> None:
        """Rafraichit le cache via un appel HTTP a /v1/speaker/current."""
        import urllib.request
        import json

        try:
            url = f"{self.api_url}/v1/speaker/current"
            req = urllib.request.Request(url, method="GET")
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=0.5) as resp:
                data = json.loads(resp.read().decode())
                with self._lock:
                    self._speaker_id = data.get("speakerId")
                    self._persona_type = data.get("personaType")
                    self._greeting_name = data.get("greetingName")
                    self._last_fetch = time.time()
        except Exception as e:
            # Degradation gracieuse: on garde la valeur cachee ou None
            with self._lock:
                self._last_fetch = time.time()  # Eviter de re-essayer immediatement
            # Pas de log bruyant — c'est normal au premier demarrage
            pass

    def invalidate(self) -> None:
        """Force le rafraichissement au prochain appel."""
        with self._lock:
            self._last_fetch = 0.0


# =====================================================================
# Matching phonetique flou
# =====================================================================

def detect_fuzzy_match(audio_chunk: bytes, score: float, sample_rate: int = 16000) -> float:
    """Detecte les variantes de prononciation et booste le score si necessaire.

    Variantes detectees :
    - Etirements ("Divaaaaa") : voyelles repetees, energie soutenue
    - Coupures ("Di-va") : silence court (< 200ms) au milieu du wake word

    Args:
        audio_chunk: PCM 16-bit LE mono, les ~500ms autour du wake word.
        score: score brut retourne par openWakeWord.
        sample_rate: taux d'echantillonnage (defaut 16000).

    Returns:
        Score booste (+0.1) si une variante est detectee, sinon score inchange.
    """
    if not audio_chunk or len(audio_chunk) < 64:
        return score

    # Convertir en numpy
    audio_int16 = np.frombuffer(audio_chunk, dtype=np.int16)
    audio_float = audio_int16.astype(np.float32) / 32768.0

    # Calculer l'energie RMS globale en dB
    rms = np.sqrt(np.mean(audio_float ** 2))
    energy_db = 20.0 * np.log10(max(rms, 1e-10))

    # Si trop peu d'energie, pas de variante a detecter
    if energy_db < ELONGATION_ENERGY_THRESHOLD_DB:
        return score

    # Detection d'etirement : energie soutenue sur une duree longue
    # Un wake word normal "Diva" dure ~400ms. Un etirement "Divaaaaa" > 600ms
    duration_ms = (len(audio_int16) / sample_rate) * 1000

    # Analyse par segments de 50ms
    segment_samples = int(sample_rate * 0.05)  # 50ms
    if segment_samples == 0:
        return score

    segment_energies = []
    for i in range(0, len(audio_float) - segment_samples + 1, segment_samples):
        seg = audio_float[i:i + segment_samples]
        seg_rms = np.sqrt(np.mean(seg ** 2))
        seg_db = 20.0 * np.log10(max(seg_rms, 1e-10))
        segment_energies.append(seg_db)

    if not segment_energies:
        return score

    # Detection d'etirement : beaucoup de segments avec de l'energie > seuil
    active_segments = sum(1 for e in segment_energies if e > ELONGATION_ENERGY_THRESHOLD_DB)
    active_ratio = active_segments / len(segment_energies) if segment_energies else 0

    # Etirement : duree longue + energie soutenue
    if duration_ms > ELONGATION_MIN_DURATION_MS and active_ratio > 0.7:
        return min(1.0, score + FUZZY_BOOST)

    # Detection de coupure : un creux d'energie < 200ms entre deux parties actives
    if len(segment_energies) >= 4:
        has_dip = False
        for i in range(1, len(segment_energies) - 1):
            prev_active = segment_energies[i - 1] > ELONGATION_ENERGY_THRESHOLD_DB
            curr_silent = segment_energies[i] <= ELONGATION_ENERGY_THRESHOLD_DB
            next_active = segment_energies[i + 1] > ELONGATION_ENERGY_THRESHOLD_DB
            if prev_active and curr_silent and next_active:
                has_dip = True
                break
        if has_dip:
            return min(1.0, score + FUZZY_BOOST)

    return score
