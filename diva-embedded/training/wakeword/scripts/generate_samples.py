#!/usr/bin/env python3
"""
generate_samples.py — Génère tous les échantillons audio pour l'entraînement de "diva"

Sources de génération :
  1. Piper TTS français (3 voix × variations vitesse/bruit) → ~945 samples
  2. eSpeak-ng (9 voix × 5 vitesses × 4 pitches) → ~180 samples
  3. Négatifs adversariaux (mots proches phonétiquement)
  4. Négatifs génériques

Usage:
    python scripts/generate_samples.py
    python scripts/generate_samples.py --skip-espeak
"""

import argparse
import os
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
import yaml
from scipy.signal import resample as scipy_resample
from tqdm import tqdm


def load_config(config_path: str = "config/training_config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def resample_to_16k(audio: np.ndarray, orig_sr: int) -> np.ndarray:
    """Rééchantillonne à 16kHz (requis par openWakeWord)."""
    if orig_sr == 16000:
        return audio
    num_samples = int(len(audio) * 16000 / orig_sr)
    return scipy_resample(audio, num_samples)


def ensure_16k_wav(filepath: str):
    """Vérifie et corrige le sample rate d'un fichier WAV."""
    audio, sr = sf.read(filepath)
    if sr != 16000:
        audio = resample_to_16k(audio, sr)
        sf.write(filepath, audio, 16000)


# =============================================================================
# 1. Piper TTS français
# =============================================================================
def generate_piper_samples(config: dict, output_dir: Path) -> int:
    """Génère des échantillons via Piper TTS français (3 voix)."""
    try:
        from piper.voice import PiperVoice
        from piper.config import SynthesisConfig
    except ImportError:
        print("  ⚠ piper-tts non installé, tentative via CLI...")
        return generate_piper_cli(config, output_dir)

    tts_config = config["tts"]["piper"]
    voices_dir = Path(tts_config["voices_dir"])
    wake_word = config["target_phrase"][0]

    print(f"\n=== Génération Piper TTS : '{wake_word}' ===")

    count = 0
    piper_dir = output_dir / "piper"
    piper_dir.mkdir(parents=True, exist_ok=True)

    for voice_name in tts_config["voices"]:
        model_path = voices_dir / f"{voice_name}.onnx"
        if not model_path.exists():
            print(f"  ⚠ Voix non trouvée : {model_path}")
            continue

        print(f"  Voix : {voice_name}")
        voice = PiperVoice.load(str(model_path))

        for ls in tts_config["length_scales"]:
            for ns in tts_config["noise_scales"]:
                for i in range(tts_config["variations_per_combo"]):
                    filename = piper_dir / f"{voice_name}_ls{ls}_ns{ns}_{i:02d}.wav"
                    try:
                        syn_config = SynthesisConfig(
                            length_scale=ls,
                            noise_scale=ns,
                            noise_w_scale=tts_config["noise_w"],
                        )
                        wav_file = wave.open(str(filename), "w")
                        wav_file.setframerate(voice.config.sample_rate)
                        wav_file.setsampwidth(2)
                        wav_file.setnchannels(1)
                        for chunk in voice.synthesize(wake_word, syn_config):
                            wav_file.writeframes(chunk.audio_int16_bytes)
                        wav_file.close()
                        ensure_16k_wav(str(filename))
                        count += 1
                    except Exception as e:
                        print(f"    Erreur : {e}")

    print(f"  → {count} échantillons Piper générés")
    return count


def generate_piper_cli(config: dict, output_dir: Path) -> int:
    """Fallback : génération via la CLI piper."""
    tts_config = config["tts"]["piper"]
    voices_dir = Path(tts_config["voices_dir"])
    wake_word = config["target_phrase"][0]

    count = 0
    piper_dir = output_dir / "piper"
    piper_dir.mkdir(parents=True, exist_ok=True)

    for voice_name in tts_config["voices"]:
        model_path = voices_dir / f"{voice_name}.onnx"
        if not model_path.exists():
            continue

        for ls in tts_config["length_scales"]:
            for ns in tts_config["noise_scales"]:
                for i in range(tts_config["variations_per_combo"]):
                    filename = piper_dir / f"{voice_name}_ls{ls}_ns{ns}_{i:02d}.wav"
                    try:
                        result = subprocess.run(
                            [
                                "piper",
                                "--model", str(model_path),
                                "--output_file", str(filename),
                                "--length-scale", str(ls),
                                "--noise-scale", str(ns),
                                "--noise-w", str(tts_config["noise_w"]),
                            ],
                            input=wake_word,
                            capture_output=True,
                            text=True,
                            timeout=30,
                        )
                        if result.returncode == 0 and filename.exists():
                            ensure_16k_wav(str(filename))
                            count += 1
                    except Exception as e:
                        continue

    print(f"  → {count} échantillons Piper (CLI) générés")
    return count


# =============================================================================
# 2. eSpeak-ng
# =============================================================================
def generate_espeak_samples(config: dict, output_dir: Path) -> int:
    """Génère des échantillons via eSpeak-ng (variabilité paramétrique)."""
    espeak_config = config["tts"]["espeak"]
    wake_word = config["target_phrase"][0]

    print(f"\n=== Génération eSpeak-ng : '{wake_word}' ===")

    # Vérifier que espeak-ng est installé
    try:
        subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("  ⚠ espeak-ng non installé. Installe avec : sudo apt install espeak-ng")
        return 0

    count = 0
    espeak_dir = output_dir / "espeak"
    espeak_dir.mkdir(parents=True, exist_ok=True)

    for voice in tqdm(espeak_config["voices"], desc="  Voix eSpeak"):
        for speed in espeak_config["speeds"]:
            for pitch in espeak_config["pitches"]:
                filename = espeak_dir / f"espeak_{voice}_{speed}_{pitch}.wav"
                try:
                    result = subprocess.run(
                        [
                            "espeak-ng",
                            "-v", voice,
                            "-s", str(speed),
                            "-p", str(pitch),
                            "-w", str(filename),
                            wake_word,
                        ],
                        capture_output=True,
                        timeout=10,
                    )
                    if result.returncode == 0 and filename.exists():
                        ensure_16k_wav(str(filename))
                        count += 1
                except Exception:
                    continue

    print(f"  → {count} échantillons eSpeak générés")
    return count


# =============================================================================
# 3. Négatifs (adversariaux + génériques)
# =============================================================================
def generate_negative_samples(config: dict, output_dir: Path) -> int:
    """Génère les échantillons négatifs via Piper + eSpeak."""
    adversarial = config["negatives"]["adversarial_phrases"]
    generic = config["negatives"]["generic_phrases"]
    all_phrases = adversarial + generic

    print(f"\n=== Génération des échantillons négatifs ({len(all_phrases)} phrases) ===")

    neg_dir = output_dir
    neg_dir.mkdir(parents=True, exist_ok=True)

    count = 0

    # Via eSpeak (rapide, toujours disponible)
    try:
        subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
        has_espeak = True
    except (FileNotFoundError, subprocess.CalledProcessError):
        has_espeak = False

    if has_espeak:
        for phrase in tqdm(all_phrases, desc="  Négatifs eSpeak"):
            for voice in ["fr", "fr+m1", "fr+f1"]:
                for speed in [150, 200]:
                    safe_phrase = phrase.replace(" ", "_")
                    filename = neg_dir / f"neg_{safe_phrase}_{voice}_{speed}.wav"
                    try:
                        subprocess.run(
                            [
                                "espeak-ng", "-v", voice, "-s", str(speed),
                                "-w", str(filename), phrase,
                            ],
                            capture_output=True,
                            timeout=10,
                        )
                        if filename.exists():
                            ensure_16k_wav(str(filename))
                            count += 1
                    except Exception:
                        continue

    # Via Piper (si disponible)
    voices_dir = Path(config["tts"]["piper"]["voices_dir"])
    try:
        from piper.voice import PiperVoice

        for voice_name in config["tts"]["piper"]["voices"][:1]:  # 1 voix suffit
            model_path = voices_dir / f"{voice_name}.onnx"
            if not model_path.exists():
                continue
            voice = PiperVoice.load(str(model_path))
            for phrase in tqdm(all_phrases, desc="  Négatifs Piper"):
                safe_phrase = phrase.replace(" ", "_")
                filename = neg_dir / f"neg_piper_{safe_phrase}.wav"
                try:
                    wav_file = wave.open(str(filename), "w")
                    wav_file.setframerate(voice.config.sample_rate)
                    wav_file.setsampwidth(2)
                    wav_file.setnchannels(1)
                    for chunk in voice.synthesize(phrase):
                        wav_file.writeframes(chunk.audio_int16_bytes)
                    wav_file.close()
                    ensure_16k_wav(str(filename))
                    count += 1
                except Exception:
                    continue
    except ImportError:
        pass

    print(f"  → {count} échantillons négatifs générés")
    return count


# =============================================================================
# Main
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="Génère les échantillons audio")
    parser.add_argument("--config", default="config/training_config.yaml")
    parser.add_argument("--skip-piper", action="store_true")
    parser.add_argument("--skip-espeak", action="store_true")
    parser.add_argument("--skip-negative", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)

    positive_dir = Path("data/positive")
    negative_dir = Path("data/negative")
    positive_dir.mkdir(parents=True, exist_ok=True)
    negative_dir.mkdir(parents=True, exist_ok=True)

    total_positive = 0

    if not args.skip_piper:
        total_positive += generate_piper_samples(config, positive_dir)

    if not args.skip_espeak:
        total_positive += generate_espeak_samples(config, positive_dir)

    if not args.skip_negative:
        generate_negative_samples(config, negative_dir)

    print(f"\n{'='*50}")
    print(f"  Total échantillons positifs : {total_positive}")
    print(f"  Fichiers dans data/positive/ : {len(list(positive_dir.rglob('*.wav')))}")
    print(f"  Fichiers dans data/negative/ : {len(list(negative_dir.rglob('*.wav')))}")
    print(f"{'='*50}")
    print(f"\nProchaine étape : python scripts/augment_samples.py")


if __name__ == "__main__":
    main()
