"""
circular_buffer.py — Buffer audio circulaire pour le pre-wake-word audio.

Maintient les N dernieres secondes d'audio PCM 16-bit mono 16kHz en RAM.
Thread-safe pour ecriture depuis le thread d'ecoute.
Jamais persiste sur disque — vie privee preservee.
"""

import threading


class CircularAudioBuffer:
    """Buffer circulaire de taille fixe pour audio PCM brut.

    Parametres:
        duration_s: duree du buffer en secondes (defaut 3.0)
        sample_rate: taux d'echantillonnage (defaut 16000)
        sample_width: taille d'un echantillon en octets (defaut 2 pour 16-bit)
        channels: nombre de canaux (defaut 1 pour mono)
    """

    def __init__(
        self,
        duration_s: float = 3.0,
        sample_rate: int = 16000,
        sample_width: int = 2,
        channels: int = 1,
    ):
        self._max_bytes = int(duration_s * sample_rate * sample_width * channels)
        self._buf = bytearray(self._max_bytes)
        self._write_pos = 0
        self._filled = 0  # how many bytes have been written total (capped at max)
        self._lock = threading.Lock()

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    def write(self, chunk: bytes) -> None:
        """Ecrit un chunk audio dans le buffer (ecrase les anciennes donnees si plein)."""
        chunk_len = len(chunk)
        if chunk_len == 0:
            return

        with self._lock:
            if chunk_len >= self._max_bytes:
                # Le chunk est plus grand que le buffer : garder seulement la fin
                self._buf[:] = chunk[-self._max_bytes:]
                self._write_pos = 0
                self._filled = self._max_bytes
                return

            end_pos = self._write_pos + chunk_len
            if end_pos <= self._max_bytes:
                self._buf[self._write_pos:end_pos] = chunk
            else:
                # Wrap around
                first_part = self._max_bytes - self._write_pos
                self._buf[self._write_pos:] = chunk[:first_part]
                remaining = chunk_len - first_part
                self._buf[:remaining] = chunk[first_part:]

            self._write_pos = end_pos % self._max_bytes
            self._filled = min(self._filled + chunk_len, self._max_bytes)

    def read_all(self) -> bytes:
        """Retourne tout le contenu du buffer dans l'ordre chronologique."""
        with self._lock:
            if self._filled < self._max_bytes:
                # Buffer pas encore plein : retourner du debut jusqu'a write_pos
                return bytes(self._buf[:self._write_pos])
            else:
                # Buffer plein et circulaire : read_pos = write_pos (le plus ancien)
                return bytes(self._buf[self._write_pos:] + self._buf[:self._write_pos])

    def clear(self) -> None:
        """Vide le buffer."""
        with self._lock:
            self._buf = bytearray(self._max_bytes)
            self._write_pos = 0
            self._filled = 0

    def __len__(self) -> int:
        """Retourne le nombre d'octets actuellement dans le buffer."""
        with self._lock:
            return self._filled
