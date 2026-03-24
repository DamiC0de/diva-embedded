"""
prosody_analyzer.py — Analyseur prosodique pour detection de fin d'enonce.

Detecte la fin d'enonce par analyse prosodique en temps reel :
- Extraction F0 (frequence fondamentale) par autocorrelation normalisee (NSDF)
- Calcul d'energie RMS descendante
- Detection d'allongement syllabique
- Detection de patterns d'hesitation (micro-pauses)

Le score prosodique combine (0.0 a 1.0) determine un timeout dynamique
entre prosody_early_cutoff_s (0.4s) et prosody_hesitation_timeout_s (1.5s).

Story 27.6 — FR210
"""

import collections
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


# =====================================================================
# Data classes
# =====================================================================

@dataclass
class ProsodyResult:
    """Resultat de l'analyse prosodique pour une frame audio."""
    end_score: float  # 0.0 (pas fini) a 1.0 (fin claire)
    f0_slope: float  # -1.0 (descendant) a +1.0 (montant)
    energy_ratio: float  # ratio energie courante / moyenne
    lengthening_ratio: float  # ratio allongement syllabique
    hesitation_detected: bool  # True si micro-pauses detectees
    f0_hz: Optional[float]  # F0 en Hz ou None si non-voise


@dataclass
class ProsodyEvent:
    """Evenement de fin d'enonce pour les metriques."""
    timestamp: float
    end_score: float
    f0_slope: float
    energy_ratio: float
    lengthening_ratio: float
    hesitation_detected: bool
    effective_timeout_s: float
    standard_timeout_s: float
    time_saved_ms: float
    correlation_id: str = ""


# =====================================================================
# ProsodyAnalyzer
# =====================================================================

class ProsodyAnalyzer:
    """Analyseur prosodique temps reel pour detection de fin d'enonce.

    Fonctionne en complement du VAD Silero existant. Analyse les indices
    prosodiques (F0, energie, allongement, hesitation) pour determiner
    un timeout de silence dynamique.

    Args:
        sample_rate: Taux d'echantillonnage (defaut 16000 Hz)
        frame_size: Taille de la frame en samples (defaut 512 = 32ms)
    """

    # F0 detection range (human voice)
    F0_MIN_HZ = 80
    F0_MAX_HZ = 400

    # NSDF clarity threshold for valid F0
    NSDF_CLARITY_THRESHOLD = 0.7

    # Number of F0 history frames (~1 second)
    F0_HISTORY_SIZE = 30

    # Minimum F0 values needed for slope calculation
    MIN_F0_FOR_SLOPE = 5

    # Energy history for ratio calculation
    ENERGY_HISTORY_SIZE = 5

    # Speech segment tracking
    MAX_SPEECH_SEGMENTS = 20

    # Hesitation detection window (seconds)
    HESITATION_WINDOW_S = 3.0

    def __init__(self, sample_rate: int = 16000, frame_size: int = 512):
        self.sample_rate = sample_rate
        self.frame_size = frame_size

        # F0 detection lag range
        self._lag_min = max(1, sample_rate // self.F0_MAX_HZ)  # 40 for 16kHz
        self._lag_max = sample_rate // self.F0_MIN_HZ  # 200 for 16kHz

        # Buffers
        self._f0_history: list[Optional[float]] = []
        self._energy_history: list[float] = []
        self._speech_segments: list[float] = []  # durations in seconds
        self._current_speech_duration: float = 0.0
        self._is_currently_speaking: bool = False

        # Transition tracking for hesitation detection
        self._transitions: list[dict] = []  # {"time": t, "type": "speech"|"silence"}
        self._last_is_speech: bool = False
        self._start_time: float = time.time()

        # Metrics
        self._events: collections.deque = collections.deque(maxlen=100)
        self._total_events: int = 0
        self._early_cutoff_count: int = 0
        self._extended_timeout_count: int = 0
        self._fallback_count: int = 0

    def reset(self) -> None:
        """Reinitialise les buffers entre les enregistrements."""
        self._f0_history.clear()
        self._energy_history.clear()
        self._speech_segments.clear()
        self._current_speech_duration = 0.0
        self._is_currently_speaking = False
        self._transitions.clear()
        self._last_is_speech = False
        self._start_time = time.time()

    # =================================================================
    # F0 extraction (NSDF — Normalized Square Difference Function)
    # =================================================================

    def _extract_f0(self, audio_frame: np.ndarray) -> Optional[float]:
        """Extrait la frequence fondamentale par autocorrelation normalisee (NSDF).

        Args:
            audio_frame: Array numpy de samples int16 ou float32

        Returns:
            F0 en Hz (80-400) ou None si non-voise
        """
        # Convert to float64 for precision
        if audio_frame.dtype == np.int16:
            x = audio_frame.astype(np.float64) / 32768.0
        else:
            x = audio_frame.astype(np.float64)

        n = len(x)
        if n < self._lag_max + 1:
            return None

        # Compute NSDF using autocorrelation
        # NSDF(tau) = 2 * r(tau) / (m(tau))
        # where r(tau) = sum(x[i] * x[i+tau]) and
        # m(tau) = sum(x[i]^2) + sum(x[i+tau]^2)

        # Compute autocorrelation via numpy correlate for the needed range
        # We only need lags from lag_min to lag_max
        lag_min = self._lag_min
        lag_max = min(self._lag_max, n - 1)

        if lag_max <= lag_min:
            return None

        # Precompute cumulative sum of squares for normalization
        x_sq = x * x
        cumsum_sq = np.cumsum(x_sq)

        best_lag = None
        best_nsdf = -1.0

        # Vectorized computation of NSDF for all lags
        lags = np.arange(lag_min, lag_max + 1)
        nsdf_values = np.empty(len(lags))

        for idx, tau in enumerate(lags):
            # r(tau) = sum(x[0:n-tau] * x[tau:n])
            segment_len = n - tau
            r = np.dot(x[:segment_len], x[tau:tau + segment_len])

            # m(tau) = sum(x[0:n-tau]^2) + sum(x[tau:n]^2)
            m1 = cumsum_sq[segment_len - 1]  # sum of x[0..segment_len-1]^2
            m2 = cumsum_sq[n - 1] - cumsum_sq[tau - 1]  # sum of x[tau..n-1]^2

            m = m1 + m2
            if m < 1e-10:
                nsdf_values[idx] = 0.0
            else:
                nsdf_values[idx] = 2.0 * r / m

        # Peak picking: find first peak above clarity threshold
        # Look for zero crossings from positive to find peaks
        for idx in range(1, len(nsdf_values) - 1):
            val = nsdf_values[idx]
            if val >= self.NSDF_CLARITY_THRESHOLD:
                # Check if local maximum
                if val >= nsdf_values[idx - 1] and val >= nsdf_values[idx + 1]:
                    if val > best_nsdf:
                        best_nsdf = val
                        best_lag = lags[idx]
                    # Take first good peak (lowest frequency harmonic avoidance)
                    break

        if best_lag is None or best_nsdf < self.NSDF_CLARITY_THRESHOLD:
            return None

        f0 = self.sample_rate / best_lag

        # Validate range
        if f0 < self.F0_MIN_HZ or f0 > self.F0_MAX_HZ:
            return None

        return float(f0)

    # =================================================================
    # F0 slope (linear regression over last ~300ms)
    # =================================================================

    def _compute_f0_slope(self) -> float:
        """Calcule la pente de regression lineaire sur les 10 dernieres valeurs F0 valides.

        Returns:
            Valeur normalisee de -1.0 (pente tres descendante) a +1.0 (montante).
            Retourne 0.0 si pas assez de donnees.
        """
        # Collect last valid F0 values (up to 10)
        valid_f0 = [v for v in self._f0_history[-self.F0_HISTORY_SIZE:] if v is not None]

        if len(valid_f0) < self.MIN_F0_FOR_SLOPE:
            return 0.0

        # Use last 10 values
        values = valid_f0[-10:]
        n = len(values)

        # Linear regression: slope of F0 over time
        x = np.arange(n, dtype=np.float64)
        y = np.array(values, dtype=np.float64)

        # slope = (n * sum(xy) - sum(x) * sum(y)) / (n * sum(x^2) - sum(x)^2)
        sx = x.sum()
        sy = y.sum()
        sxy = (x * y).sum()
        sx2 = (x * x).sum()

        denom = n * sx2 - sx * sx
        if abs(denom) < 1e-10:
            return 0.0

        slope = (n * sxy - sx * sy) / denom

        # Normalize: slope is in Hz/frame. Typical range is about -10 to +10 Hz/frame
        # for natural speech. Map to [-1, 1] using tanh-like normalization.
        # A slope of -5 Hz/frame is a clear descending pattern.
        normalized = np.clip(slope / 5.0, -1.0, 1.0)

        return float(normalized)

    # =================================================================
    # Energy ratio
    # =================================================================

    def _compute_energy_ratio(self, audio_frame: np.ndarray) -> float:
        """Calcule le ratio d'energie RMS courante vs moyenne des 5 frames precedentes.

        Args:
            audio_frame: Array numpy de samples

        Returns:
            Ratio energie courante / moyenne. < 0.3 indique une chute d'energie.
        """
        if audio_frame.dtype == np.int16:
            samples = audio_frame.astype(np.float64) / 32768.0
        else:
            samples = audio_frame.astype(np.float64)

        # RMS energy of current frame
        rms = float(np.sqrt(np.mean(samples * samples)))

        # Store in history
        self._energy_history.append(rms)
        if len(self._energy_history) > self.ENERGY_HISTORY_SIZE + 1:
            self._energy_history = self._energy_history[-(self.ENERGY_HISTORY_SIZE + 1):]

        # Need at least 2 frames (1 current + 1 previous)
        if len(self._energy_history) < 2:
            return 1.0

        # Mean of previous frames (excluding current)
        prev_energies = self._energy_history[:-1]
        mean_prev = sum(prev_energies) / len(prev_energies)

        if mean_prev < 1e-10:
            return 1.0 if rms < 1e-10 else 10.0

        return rms / mean_prev

    # =================================================================
    # Lengthening ratio (allongement syllabique)
    # =================================================================

    def _compute_lengthening_ratio(self) -> float:
        """Compare la duree du dernier segment de parole a la moyenne des precedents.

        Returns:
            Ratio >= 1.0 si le dernier segment est plus long que la moyenne.
            > 1.5 indique un allongement (fin d'enonce probable).
        """
        if len(self._speech_segments) < 2:
            return 1.0

        last_duration = self._speech_segments[-1]
        prev_durations = self._speech_segments[:-1]
        mean_prev = sum(prev_durations) / len(prev_durations)

        if mean_prev < 0.001:  # < 1ms
            return 1.0

        return last_duration / mean_prev

    # =================================================================
    # Hesitation detection
    # =================================================================

    def _detect_hesitation(self) -> bool:
        """Detecte des patterns d'hesitation dans les 3 dernieres secondes.

        Recherche des micro-pauses (50-500ms) suivies de reprises vocales.

        Returns:
            True si un pattern d'hesitation est detecte.
        """
        now = time.time()
        window_start = now - self.HESITATION_WINDOW_S

        # Filter recent transitions
        recent = [t for t in self._transitions if t["time"] >= window_start]

        if len(recent) < 3:
            return False

        # Look for silence-speech alternation with short silences (50-500ms)
        micro_pause_count = 0

        for i in range(len(recent) - 1):
            if recent[i]["type"] == "silence" and recent[i + 1]["type"] == "speech":
                pause_duration = recent[i + 1]["time"] - recent[i]["time"]
                if 0.05 <= pause_duration <= 0.5:
                    micro_pause_count += 1

        # 2 or more micro-pauses in the window = hesitation
        return micro_pause_count >= 2

    # =================================================================
    # Score prosodique combine
    # =================================================================

    def compute_end_score(self, audio_frame: np.ndarray, is_speech: bool) -> ProsodyResult:
        """Calcule le score prosodique de fin d'enonce.

        Doit etre appele a chaque frame audio (32ms / 512 samples).

        Args:
            audio_frame: Array numpy int16 de 512 samples
            is_speech: True si speech_prob > seuil (fourni par Silero VAD)

        Returns:
            ProsodyResult avec le score combine et les indices individuels
        """
        now = time.time()
        frame_duration = self.frame_size / self.sample_rate

        # Track speech/silence transitions
        if is_speech != self._last_is_speech:
            self._transitions.append({"time": now, "type": "speech" if is_speech else "silence"})
            # Prune old transitions
            cutoff = now - self.HESITATION_WINDOW_S * 2
            self._transitions = [t for t in self._transitions if t["time"] >= cutoff]

            # Track speech segments
            if is_speech:
                # Starting speech
                self._is_currently_speaking = True
                self._current_speech_duration = 0.0
            else:
                # Ending speech — record segment
                if self._is_currently_speaking and self._current_speech_duration > 0:
                    self._speech_segments.append(self._current_speech_duration)
                    if len(self._speech_segments) > self.MAX_SPEECH_SEGMENTS:
                        self._speech_segments = self._speech_segments[-self.MAX_SPEECH_SEGMENTS:]
                self._is_currently_speaking = False

        self._last_is_speech = is_speech

        # Update speech duration
        if is_speech:
            self._current_speech_duration += frame_duration

        # Extract F0 only during speech
        f0 = None
        if is_speech:
            f0 = self._extract_f0(audio_frame)
            self._f0_history.append(f0)
            if len(self._f0_history) > self.F0_HISTORY_SIZE:
                self._f0_history = self._f0_history[-self.F0_HISTORY_SIZE:]

        # Compute individual indicators
        f0_slope = self._compute_f0_slope()
        energy_ratio = self._compute_energy_ratio(audio_frame)
        lengthening_ratio = self._compute_lengthening_ratio()
        hesitation = self._detect_hesitation()

        # Combine into end score
        # F0 slope: negative = end likely, map [-1,0] to [0.5, 1.0] contribution
        f0_indicator = max(0.0, -f0_slope)  # 0 when stable/rising, 1 when strongly falling

        # Energy ratio: low = end likely
        # Map ratio 0.0-0.3 to indicator 1.0-0.0
        energy_indicator = max(0.0, min(1.0, 1.0 - energy_ratio / 0.5))

        # Lengthening: high = end likely
        # Map ratio 1.0-2.0 to indicator 0.0-1.0
        lengthening_indicator = max(0.0, min(1.0, (lengthening_ratio - 1.0) / 1.0))

        # Hesitation: negative indicator (user not finished)
        hesitation_indicator = 1.0 if hesitation else 0.0

        # Weighted combination
        # Note: hesitation_weight is subtracted
        raw_score = (
            0.35 * f0_indicator
            + 0.25 * energy_indicator
            + 0.20 * lengthening_indicator
            - 0.20 * hesitation_indicator
        )

        # Clamp to [0, 1]
        end_score = max(0.0, min(1.0, raw_score))

        return ProsodyResult(
            end_score=end_score,
            f0_slope=f0_slope,
            energy_ratio=energy_ratio,
            lengthening_ratio=lengthening_ratio,
            hesitation_detected=hesitation,
            f0_hz=f0,
        )

    def compute_end_score_weighted(
        self,
        audio_frame: np.ndarray,
        is_speech: bool,
        config: dict,
    ) -> ProsodyResult:
        """Calcule le score avec poids configurables depuis tuning.json.

        Args:
            audio_frame: Array numpy int16 de 512 samples
            is_speech: True si speech_prob > seuil
            config: Dict de tuning contenant les poids prosodiques

        Returns:
            ProsodyResult avec le score combine et les indices individuels
        """
        now = time.time()
        frame_duration = self.frame_size / self.sample_rate

        # Track speech/silence transitions
        if is_speech != self._last_is_speech:
            self._transitions.append({"time": now, "type": "speech" if is_speech else "silence"})
            cutoff = now - self.HESITATION_WINDOW_S * 2
            self._transitions = [t for t in self._transitions if t["time"] >= cutoff]

            if is_speech:
                self._is_currently_speaking = True
                self._current_speech_duration = 0.0
            else:
                if self._is_currently_speaking and self._current_speech_duration > 0:
                    self._speech_segments.append(self._current_speech_duration)
                    if len(self._speech_segments) > self.MAX_SPEECH_SEGMENTS:
                        self._speech_segments = self._speech_segments[-self.MAX_SPEECH_SEGMENTS:]
                self._is_currently_speaking = False

        self._last_is_speech = is_speech

        if is_speech:
            self._current_speech_duration += frame_duration

        # Extract F0 only during speech
        f0 = None
        if is_speech:
            f0 = self._extract_f0(audio_frame)
            self._f0_history.append(f0)
            if len(self._f0_history) > self.F0_HISTORY_SIZE:
                self._f0_history = self._f0_history[-self.F0_HISTORY_SIZE:]

        # Compute individual indicators
        f0_slope = self._compute_f0_slope()
        energy_ratio = self._compute_energy_ratio(audio_frame)
        lengthening_ratio = self._compute_lengthening_ratio()
        hesitation = self._detect_hesitation()

        # Individual indicator mapping
        f0_indicator = max(0.0, -f0_slope)
        energy_indicator = max(0.0, min(1.0, 1.0 - energy_ratio / 0.5))
        lengthening_indicator = max(0.0, min(1.0, (lengthening_ratio - 1.0) / 1.0))
        hesitation_indicator = 1.0 if hesitation else 0.0

        # Read weights from config
        w_f0 = config.get("prosody_f0_weight", 0.35)
        w_energy = config.get("prosody_energy_weight", 0.25)
        w_lengthening = config.get("prosody_lengthening_weight", 0.20)
        w_hesitation = config.get("prosody_hesitation_weight", 0.20)

        raw_score = (
            w_f0 * f0_indicator
            + w_energy * energy_indicator
            + w_lengthening * lengthening_indicator
            - w_hesitation * hesitation_indicator
        )

        end_score = max(0.0, min(1.0, raw_score))

        return ProsodyResult(
            end_score=end_score,
            f0_slope=f0_slope,
            energy_ratio=energy_ratio,
            lengthening_ratio=lengthening_ratio,
            hesitation_detected=hesitation,
            f0_hz=f0,
        )

    # =================================================================
    # Timeout dynamique
    # =================================================================

    @staticmethod
    def get_effective_timeout(end_score: float, config: dict) -> float:
        """Determine le timeout de silence dynamique selon le score prosodique.

        Args:
            end_score: Score de fin d'enonce (0.0 a 1.0)
            config: Dict de tuning

        Returns:
            Timeout effectif en secondes
        """
        if not config.get("prosody_endpoint_enabled", True):
            return config.get("vad_silence_timeout_s", 0.8)

        early_cutoff = config.get("prosody_early_cutoff_s", 0.4)
        hesitation_timeout = config.get("prosody_hesitation_timeout_s", 1.5)
        high_threshold = config.get("prosody_score_high_threshold", 0.8)
        low_threshold = config.get("prosody_score_low_threshold", 0.3)

        if end_score >= high_threshold:
            return early_cutoff
        elif end_score <= low_threshold:
            return hesitation_timeout
        else:
            # Linear interpolation between the two
            t = (end_score - low_threshold) / (high_threshold - low_threshold)
            return hesitation_timeout + t * (early_cutoff - hesitation_timeout)

    # =================================================================
    # Metriques
    # =================================================================

    def record_event(
        self,
        result: ProsodyResult,
        effective_timeout_s: float,
        standard_timeout_s: float,
        correlation_id: str = "",
    ) -> ProsodyEvent:
        """Enregistre un evenement de fin d'enonce pour les metriques.

        Args:
            result: Resultat prosodique
            effective_timeout_s: Timeout effectif applique
            standard_timeout_s: Timeout standard (sans prosodie)
            correlation_id: ID de correlation pour le suivi

        Returns:
            ProsodyEvent enregistre
        """
        time_saved_ms = max(0.0, (standard_timeout_s - effective_timeout_s) * 1000)

        event = ProsodyEvent(
            timestamp=time.time(),
            end_score=result.end_score,
            f0_slope=result.f0_slope,
            energy_ratio=result.energy_ratio,
            lengthening_ratio=result.lengthening_ratio,
            hesitation_detected=result.hesitation_detected,
            effective_timeout_s=effective_timeout_s,
            standard_timeout_s=standard_timeout_s,
            time_saved_ms=time_saved_ms,
            correlation_id=correlation_id,
        )

        self._events.append(event)
        self._total_events += 1

        # Classify event
        high_threshold = 0.8  # Could read from config but keep simple
        low_threshold = 0.3
        if result.end_score >= high_threshold:
            self._early_cutoff_count += 1
        elif result.end_score <= low_threshold:
            self._extended_timeout_count += 1
        else:
            self._fallback_count += 1

        return event

    def get_metrics(self) -> dict:
        """Retourne les metriques prosodiques aggregees.

        Returns:
            Dict avec les metriques pour l'endpoint /metrics/prosody
        """
        if not self._events:
            return {
                "avg_time_saved_ms": 0.0,
                "avg_end_score": 0.0,
                "hesitation_pct": 0.0,
                "total_events": self._total_events,
                "early_cutoff_count": self._early_cutoff_count,
                "extended_timeout_count": self._extended_timeout_count,
                "fallback_count": self._fallback_count,
            }

        events_list = list(self._events)
        n = len(events_list)

        avg_time_saved = sum(e.time_saved_ms for e in events_list) / n
        avg_end_score = sum(e.end_score for e in events_list) / n
        hesitation_count = sum(1 for e in events_list if e.hesitation_detected)
        hesitation_pct = (hesitation_count / n) * 100

        return {
            "avg_time_saved_ms": round(avg_time_saved, 1),
            "avg_end_score": round(avg_end_score, 3),
            "hesitation_pct": round(hesitation_pct, 1),
            "total_events": self._total_events,
            "early_cutoff_count": self._early_cutoff_count,
            "extended_timeout_count": self._extended_timeout_count,
            "fallback_count": self._fallback_count,
        }
