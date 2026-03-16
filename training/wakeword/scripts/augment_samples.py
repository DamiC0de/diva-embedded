#!/usr/bin/env python3
"""
augment_samples.py — Augmente les échantillons audio pour l'entraînement

Applique des transformations réalistes (bruit, réverb, pitch, volume...)
pour multiplier les échantillons par 5x.

Usage:
    python scripts/augment_samples.py
    python scripts/augment_samples.py --rounds 10
"""

import argparse
import os
from pathlib import Path

import numpy as np
import soundfile as sf
import yaml
from tqdm import tqdm

try:
    from audiomentations import (
        AddBackgroundNoise,
        AddGaussianNoise,
        BandPassFilter,
        Compose,
        Gain,
        LowPassFilter,
        PitchShift,
        Shift,
        TimeStretch,
    )
except ImportError:
    print("ERREUR: audiomentations requis.")
    print("Installe avec : pip install audiomentations")
    exit(1)


def load_config(config_path: str = "config/training_config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def build_augmentation_pipeline(config: dict) -> Compose:
    """Construit le pipeline d'augmentation depuis la config."""
    aug_config = config["augmentation"]
    transforms = []

    # Bruit gaussien
    gn = aug_config["gaussian_noise"]
    transforms.append(
        AddGaussianNoise(
            min_amplitude=gn["min_amplitude"],
            max_amplitude=gn["max_amplitude"],
            p=gn["probability"],
        )
    )

    # Time stretch
    ts = aug_config["time_stretch"]
    transforms.append(
        TimeStretch(min_rate=ts["min_rate"], max_rate=ts["max_rate"], p=ts["probability"])
    )

    # Pitch shift
    ps = aug_config["pitch_shift"]
    transforms.append(
        PitchShift(
            min_semitones=ps["min_semitones"],
            max_semitones=ps["max_semitones"],
            p=ps["probability"],
        )
    )

    # Gain
    g = aug_config["gain"]
    transforms.append(Gain(min_gain_db=g["min_db"], max_gain_db=g["max_db"], p=g["probability"]))

    # Shift temporel
    s = aug_config["shift"]
    transforms.append(Shift(min_shift=s["min_shift"], max_shift=s["max_shift"], p=s["probability"]))

    # Filtre passe-bande
    bp = aug_config["bandpass_filter"]
    transforms.append(
        BandPassFilter(
            min_center_freq=bp["min_center_freq"],
            max_center_freq=bp["max_center_freq"],
            p=bp["probability"],
        )
    )

    # Filtre passe-bas
    lp = aug_config["lowpass_filter"]
    transforms.append(
        LowPassFilter(
            min_cutoff_freq=lp["min_cutoff_freq"],
            max_cutoff_freq=lp["max_cutoff_freq"],
            p=lp["probability"],
        )
    )

    return Compose(transforms)


def build_background_noise_pipeline(config: dict) -> Compose | None:
    """Pipeline d'augmentation avec bruit de fond réel."""
    bg_config = config["augmentation"]["background_noise"]
    noise_paths = [p for p in bg_config["paths"] if os.path.isdir(p)]

    if not noise_paths:
        print("  ⚠ Pas de datasets de bruit trouvés, augmentation sans bruit de fond")
        return None

    return Compose(
        [
            AddBackgroundNoise(
                sounds_path=noise_paths[0],
                min_snr_db=bg_config["min_snr_db"],
                max_snr_db=bg_config["max_snr_db"],
                p=bg_config["probability"],
            ),
            PitchShift(min_semitones=-2, max_semitones=2, p=0.3),
            Gain(min_gain_db=-6, max_gain_db=6, p=0.3),
        ]
    )


def augment_directory(
    input_dir: Path,
    output_dir: Path,
    pipeline: Compose,
    bg_pipeline: Compose | None,
    rounds: int,
):
    """Augmente tous les fichiers WAV d'un répertoire."""
    wav_files = list(input_dir.rglob("*.wav"))
    if not wav_files:
        print(f"  Aucun fichier WAV dans {input_dir}")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)
    count = 0

    for wav_path in tqdm(wav_files, desc=f"  Augmentation {input_dir.name}"):
        try:
            audio, sr = sf.read(str(wav_path), dtype="float32")
        except Exception:
            continue

        base = wav_path.stem

        for i in range(rounds):
            # Augmentation standard
            augmented = pipeline(samples=audio, sample_rate=sr)
            out_path = output_dir / f"{base}_aug{i}.wav"
            sf.write(str(out_path), augmented, sr)
            count += 1

            # Augmentation avec bruit de fond (si disponible)
            if bg_pipeline is not None and i < rounds // 2:
                augmented_bg = bg_pipeline(samples=audio, sample_rate=sr)
                out_path_bg = output_dir / f"{base}_bg{i}.wav"
                sf.write(str(out_path_bg), augmented_bg, sr)
                count += 1

    return count


def main():
    parser = argparse.ArgumentParser(description="Augmente les échantillons audio")
    parser.add_argument("--config", default="config/training_config.yaml")
    parser.add_argument("--rounds", type=int, default=None, help="Override du nombre de rounds")
    args = parser.parse_args()

    config = load_config(args.config)
    rounds = args.rounds or config["augmentation"]["rounds"]

    print(f"=== Augmentation des données (x{rounds}) ===\n")

    pipeline = build_augmentation_pipeline(config)
    bg_pipeline = build_background_noise_pipeline(config)

    # Augmenter les positifs
    print("--- Échantillons positifs ---")
    pos_count = augment_directory(
        Path("data/positive"),
        Path("data/augmented/positive"),
        pipeline,
        bg_pipeline,
        rounds,
    )

    # Augmenter les négatifs adversariaux (important pour la robustesse)
    print("\n--- Échantillons négatifs ---")
    neg_count = augment_directory(
        Path("data/negative"),
        Path("data/augmented/negative"),
        pipeline,
        bg_pipeline,
        rounds // 2,  # Moins de rounds pour les négatifs
    )

    # Augmenter les enregistrements réels
    recordings_dir = Path("recordings")
    rec_count = 0
    if recordings_dir.exists() and list(recordings_dir.glob("*.wav")):
        print("\n--- Enregistrements réels ---")
        rec_count = augment_directory(
            recordings_dir,
            Path("data/augmented/recordings"),
            pipeline,
            bg_pipeline,
            rounds * 2,  # 2x plus pour les enregistrements réels
        )

    print(f"\n{'='*50}")
    print(f"  Positifs augmentés : {pos_count}")
    print(f"  Négatifs augmentés : {neg_count}")
    print(f"  Recordings augmentés : {rec_count}")
    print(f"  Total : {pos_count + neg_count + rec_count}")
    print(f"{'='*50}")
    print(f"\nProchaine étape : python scripts/train.py")


if __name__ == "__main__":
    main()
