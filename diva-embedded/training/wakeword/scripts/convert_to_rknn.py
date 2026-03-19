#!/usr/bin/env python3
"""
convert_to_rknn.py — Convertit les modèles pour le NPU RK3588

Architecture hybride recommandée :
  - melspectrogram.onnx  → RESTE en ONNX sur CPU (ops STFT non supportées NPU)
  - embedding_model.onnx → Converti RKNN, NPU Core 0 (convolutions lourdes)
  - diva_fr.onnx         → Converti RKNN, NPU Core 1 (classifieur léger)

IMPORTANT :
  - La conversion s'effectue sur une machine x86_64 Linux (pas sur le RK3588)
  - Le classifieur est en FP16 (pas INT8) car trop petit pour la quantification
  - L'embedding peut être quantifié INT8 avec dataset de calibration

Usage:
    python scripts/convert_to_rknn.py
    python scripts/convert_to_rknn.py --model models/diva_fr/diva_fr.onnx --platform rk3588
    python scripts/convert_to_rknn.py --convert-embedding
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import yaml


def load_config(config_path: str = "config/training_config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def check_rknn_toolkit():
    """Vérifie que rknn-toolkit2 est installé."""
    try:
        from rknn.api import RKNN
        return True
    except ImportError:
        print("ERREUR: rknn-toolkit2 non installé.")
        print("")
        print("Installation (x86_64 Linux uniquement) :")
        print("  git clone https://github.com/airockchip/rknn-toolkit2.git")
        print("  pip install rknn-toolkit2/rknn-toolkit2/packages/rknn_toolkit2-*-cp310-cp310-linux_x86_64.whl")
        print("")
        print("Documentation : https://github.com/airockchip/rknn-toolkit2")
        return False


def generate_calibration_data(mel_model_path: str, emb_model_path: str, output_path: str, n_samples: int = 100):
    """
    Génère un dataset de calibration pour la quantification INT8 de l'embedding.
    Passe de l'audio réel à travers le melspectrogram et sauve les tenseurs.
    """
    import librosa
    import onnxruntime as ort

    print("  Génération du dataset de calibration...")

    mel_session = ort.InferenceSession(mel_model_path)

    # Utiliser les samples positifs + négatifs comme calibration
    wav_files = []
    for d in ["data/positive", "data/negative", "recordings"]:
        p = Path(d)
        if p.exists():
            wav_files.extend(list(p.rglob("*.wav"))[:n_samples])

    if not wav_files:
        print("  ⚠ Pas de fichiers audio pour la calibration")
        return None

    cal_data = []
    for wav_path in wav_files[:n_samples]:
        try:
            audio, sr = librosa.load(str(wav_path), sr=16000, mono=True)
            target_len = 16000 * 2
            if len(audio) < target_len:
                audio = np.pad(audio, (0, target_len - len(audio)))
            else:
                audio = audio[:target_len]

            mel_buffer = []
            for start in range(0, len(audio) - 1279, 1280):
                chunk = audio[start : start + 1280].reshape(1, -1).astype(np.float32)
                mel_out = mel_session.run(None, {"input": chunk})[0]
                mel_out = (mel_out / 10.0) + 2.0
                mel_buffer.append(mel_out)

            if len(mel_buffer) >= 76:
                mel_window = np.stack(mel_buffer[:76]).reshape(1, 76, 32, 1).astype(np.float32)
                np.save(f"{output_path}/cal_{len(cal_data):04d}.npy", mel_window)
                cal_data.append(f"{output_path}/cal_{len(cal_data):04d}.npy")
        except Exception:
            continue

    # Écrire le fichier liste pour RKNN
    list_file = f"{output_path}/calibration_list.txt"
    with open(list_file, "w") as f:
        for path in cal_data:
            f.write(f"{path}\n")

    print(f"  → {len(cal_data)} échantillons de calibration générés")
    return list_file


def get_onnx_input_shape(onnx_path: str) -> list:
    """Récupère les shapes d'input du modèle ONNX et fixe les dims dynamiques."""
    import onnx
    model = onnx.load(onnx_path)
    inputs = []
    input_size_list = []
    for inp in model.graph.input:
        inputs.append(inp.name)
        shape = []
        for dim in inp.type.tensor_type.shape.dim:
            if dim.dim_value > 0:
                shape.append(dim.dim_value)
            else:
                shape.append(1)  # Fixer les dims dynamiques (batch) à 1
        input_size_list.append(shape)
    return inputs, input_size_list


def convert_model(
    onnx_path: str,
    rknn_path: str,
    platform: str,
    quantize: bool = False,
    calibration_file: str = None,
):
    """Convertit un modèle ONNX en RKNN."""
    from rknn.api import RKNN

    print(f"\n--- Conversion : {os.path.basename(onnx_path)} ---")
    print(f"  Source : {onnx_path}")
    print(f"  Cible : {rknn_path}")
    print(f"  Plateforme : {platform}")
    print(f"  Quantification : {'INT8' if quantize else 'FP16'}")

    # Récupérer et fixer les shapes d'input (batch=1)
    inputs, input_size_list = get_onnx_input_shape(onnx_path)
    print(f"  Inputs : {inputs} → {input_size_list}")

    rknn = RKNN(verbose=False)
    rknn.config(target_platform=platform)

    ret = rknn.load_onnx(model=onnx_path, inputs=inputs, input_size_list=input_size_list)
    if ret != 0:
        print(f"  ERREUR: Échec chargement ONNX (code {ret})")
        rknn.release()
        return False

    if quantize and calibration_file:
        ret = rknn.build(do_quantization=True, dataset=calibration_file)
    else:
        ret = rknn.build(do_quantization=False)

    if ret != 0:
        print(f"  ERREUR: Échec build (code {ret})")
        rknn.release()
        return False

    ret = rknn.export_rknn(rknn_path)
    if ret != 0:
        print(f"  ERREUR: Échec export (code {ret})")
        rknn.release()
        return False

    rknn.release()

    size_kb = Path(rknn_path).stat().st_size / 1024
    print(f"  ✓ Conversion réussie ({size_kb:.1f} KB)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Convertit les modèles pour RKNN NPU")
    parser.add_argument("--config", default="config/training_config.yaml")
    parser.add_argument("--model", default=None, help="Chemin du classifieur ONNX")
    parser.add_argument("--platform", default=None, choices=["rk3588", "rk3568", "rk3566", "rk3562"])
    parser.add_argument("--convert-embedding", action="store_true", help="Convertir aussi l'embedding model")
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    if not check_rknn_toolkit():
        sys.exit(1)

    config = load_config(args.config)
    platform = args.platform or config["rknn"]["platform"]
    output_dir = Path(args.output_dir or config["output_dir"])
    rknn_dir = output_dir / "rknn"
    rknn_dir.mkdir(parents=True, exist_ok=True)

    model_name = config["model_name"]
    classifier_onnx = args.model or str(output_dir / f"{model_name}.onnx")

    if not os.path.exists(classifier_onnx):
        print(f"ERREUR: Modèle non trouvé : {classifier_onnx}")
        print("Lance d'abord : python scripts/train.py")
        sys.exit(1)

    # 1. Convertir le classifieur (FP16 — trop petit pour INT8)
    convert_model(
        onnx_path=classifier_onnx,
        rknn_path=str(rknn_dir / f"{model_name}.rknn"),
        platform=platform,
        quantize=config["rknn"]["quantize_classifier"],
    )

    # 2. Convertir l'embedding model (optionnel, INT8 avec calibration)
    if args.convert_embedding:
        emb_onnx = "data/models/embedding_model.onnx"
        mel_onnx = "data/models/melspectrogram.onnx"

        if not os.path.exists(emb_onnx):
            print(f"  ⚠ {emb_onnx} non trouvé")
        else:
            calibration_file = None
            if config["rknn"]["quantize_embedding"]:
                cal_dir = str(rknn_dir / "calibration")
                os.makedirs(cal_dir, exist_ok=True)
                calibration_file = generate_calibration_data(mel_onnx, emb_onnx, cal_dir)

            convert_model(
                onnx_path=emb_onnx,
                rknn_path=str(rknn_dir / "embedding_model.rknn"),
                platform=platform,
                quantize=config["rknn"]["quantize_embedding"],
                calibration_file=calibration_file,
            )

    # 3. Copier le melspectrogram (reste en ONNX pour le CPU)
    import shutil
    mel_src = "data/models/melspectrogram.onnx"
    mel_dst = rknn_dir / "melspectrogram.onnx"
    if os.path.exists(mel_src) and not mel_dst.exists():
        shutil.copy(mel_src, mel_dst)
        print(f"\n  ✓ melspectrogram.onnx copié (reste sur CPU)")

    # Résumé
    print(f"\n{'='*50}")
    print(f"  Conversion RKNN terminée !")
    print(f"  Fichiers dans : {rknn_dir}/")
    for f in sorted(rknn_dir.glob("*.*")):
        if f.is_file() and f.suffix in [".rknn", ".onnx"]:
            print(f"    {f.name} ({f.stat().st_size / 1024:.1f} KB)")
    print(f"{'='*50}")
    print(f"\n  Architecture hybride :")
    print(f"    melspectrogram.onnx  → CPU")
    print(f"    embedding_model.rknn → NPU Core 0")
    print(f"    {model_name}.rknn    → NPU Core 1")
    print(f"\n  Déploiement : copier {rknn_dir}/ sur le RK3588")


if __name__ == "__main__":
    main()
