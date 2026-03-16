#!/usr/bin/env python3
"""
record_samples.py — Enregistre ta voix disant "Diva"

Enregistre des clips de 2 secondes depuis ton micro.
Ces enregistrements réels sont pondérés 3x dans l'entraînement.

Usage:
    python scripts/record_samples.py
    python scripts/record_samples.py --count 50
"""

import argparse
import sys
import wave
from pathlib import Path

import numpy as np

try:
    import pyaudio
except ImportError:
    print("ERREUR: PyAudio requis.")
    print("  sudo apt install portaudio19-dev && pip install pyaudio")
    sys.exit(1)

SAMPLE_RATE = 16000
CHANNELS = 1
FORMAT = pyaudio.paInt16
CHUNK = 1024
RECORD_SECONDS = 2.0


def record_clip(pa: pyaudio.PyAudio) -> bytes:
    stream = pa.open(
        format=FORMAT, channels=CHANNELS, rate=SAMPLE_RATE,
        input=True, frames_per_buffer=CHUNK,
    )
    frames = []
    for _ in range(int(SAMPLE_RATE / CHUNK * RECORD_SECONDS)):
        frames.append(stream.read(CHUNK, exception_on_overflow=False))
    stream.stop_stream()
    stream.close()
    return b"".join(frames)


def save_wav(data: bytes, path: str):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(data)


def main():
    parser = argparse.ArgumentParser(description="Enregistre des échantillons vocaux")
    parser.add_argument("--count", type=int, default=30, help="Nombre d'enregistrements")
    parser.add_argument("--output-dir", default="recordings")
    parser.add_argument("--wake-word", default="diva")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    existing = list(output_dir.glob("*.wav"))
    start_idx = len(existing)

    pa = pyaudio.PyAudio()

    print("=" * 50)
    print(f"  Enregistrement : '{args.wake_word}'")
    print(f"  {args.count} clips de {RECORD_SECONDS}s")
    print(f"  Déjà enregistrés : {start_idx}")
    print("=" * 50)
    print()
    print("Conseils :")
    print("  - Parle normalement")
    print("  - Varie le ton et le volume")
    print("  - Essaie différentes distances du micro")
    print("  - Entrée = enregistrer, 'q' = quitter")
    print()

    recorded = 0
    try:
        for i in range(args.count):
            user_input = input(f"[{i+1}/{args.count}] Entrée pour enregistrer > ")
            if user_input.strip().lower() == "q":
                break

            print(f"  Enregistrement... ({RECORD_SECONDS}s)")
            data = record_clip(pa)

            # Vérifier le niveau
            level = np.sqrt(np.mean(np.frombuffer(data, dtype=np.int16).astype(np.float32) ** 2))
            if level < 100:
                print(f"  Trop faible (niveau: {level:.0f}). Réessaie.")
                continue

            path = output_dir / f"{args.wake_word}_{start_idx + i:04d}.wav"
            save_wav(data, str(path))
            recorded += 1
            print(f"  OK : {path.name} (niveau: {level:.0f})")
    except KeyboardInterrupt:
        pass
    finally:
        pa.terminate()

    print(f"\n{recorded} enregistrements sauvegardés dans {output_dir}/")


if __name__ == "__main__":
    main()
