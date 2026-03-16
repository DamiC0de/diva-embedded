#!/usr/bin/env python3
"""
train.py — Entraîne le classifieur wake word "diva" pour openWakeWord

Architecture openWakeWord (3 modèles en cascade) :
  1. melspectrogram.onnx     — audio brut → mel spectrogram (chunks 1280 samples / 80ms)
  2. embedding_model.onnx    — mel → vecteur 96 dimensions (modèle Google, gelé)
  3. VOTRE CLASSIFIEUR       — 16 derniers embeddings [1,16,96] → score 0-1

Ce script entraîne uniquement le classifieur (étape 3).

Usage:
    python scripts/train.py
    python scripts/train.py --config config/training_config.yaml
    python scripts/train.py --steps 100000
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import yaml
from tqdm import tqdm

from gpu_guard import GPUGuard


def load_config(config_path: str) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def collect_wav_files(directory: Path) -> list:
    """Collecte récursivement tous les fichiers WAV."""
    return sorted(directory.rglob("*.wav"))


# =============================================================================
# Extraction de features via le pipeline openWakeWord
# =============================================================================
def extract_features(
    audio_files: list,
    mel_model_path: str,
    emb_model_path: str,
    label: str = "samples",
) -> np.ndarray:
    """
    Extrait les features openWakeWord pour une liste de fichiers audio.

    Pipeline : audio → melspectrogram → embedding (96-dim)
    Le classifieur prend 16 embeddings consécutifs → shape finale [N, 16, 96]
    """
    import librosa
    import onnxruntime as ort

    mel_session = ort.InferenceSession(mel_model_path)
    emb_session = ort.InferenceSession(emb_model_path)

    guard = GPUGuard(max_temp=80, max_memory_pct=90, cooldown_temp=70)
    all_features = []

    # Le mel model produit ~5 frames par chunk de 1280 samples.
    # L'embedding model prend 76 mel frames en entrée.
    # Le classifieur prend 16 embeddings consécutifs.
    # Pour 16 embeddings avec un slide de 8 : 76 + 15*8 = 196 mel frames nécessaires.
    # 196 frames / 5 frames_per_chunk = ~40 chunks * 1280 = 51200 samples (~3.2s)
    min_audio_len = 51200  # ~3.2 secondes minimum

    skipped = 0
    for filepath in tqdm(audio_files, desc=f"  Features {label}"):
        guard.check()
        try:
            audio, sr = librosa.load(str(filepath), sr=16000, mono=True)

            # Padder les clips courts en centrant le wake word dans du silence
            if len(audio) < min_audio_len:
                pad_total = min_audio_len - len(audio)
                pad_left = pad_total // 2
                pad_right = pad_total - pad_left
                audio = np.pad(audio, (pad_left, pad_right), mode="constant")

            # Traiter en chunks de 1280 samples (80ms)
            # Chaque chunk produit ~5 mel frames de shape [32]
            chunk_size = 1280
            all_mel_frames = []

            for start in range(0, len(audio) - chunk_size + 1, chunk_size):
                chunk = audio[start : start + chunk_size].reshape(1, -1).astype(np.float32)
                mel_out = mel_session.run(None, {"input": chunk})[0]
                mel_out = (mel_out / 10.0) + 2.0
                # mel_out shape: [time, 1, N, 32] — extraire chaque frame individuelle
                for t in range(mel_out.shape[0]):
                    frame = mel_out[t, 0, :, :]  # [N, 32]
                    for f in range(frame.shape[0]):
                        all_mel_frames.append(frame[f, :])  # [32]

            # Extraire les embeddings par fenêtres de 76 mel frames
            embeddings = []
            if len(all_mel_frames) >= 76:
                for i in range(0, len(all_mel_frames) - 75, 8):  # Slide de 8 frames
                    mel_window = np.array(all_mel_frames[i : i + 76]).reshape(1, 76, 32, 1).astype(np.float32)
                    emb = emb_session.run(None, {"input_1": mel_window})[0]
                    embeddings.append(emb.reshape(-1)[:96])  # 96-dim

            # Le classifieur prend les 16 derniers embeddings
            if len(embeddings) >= 16:
                feature_window = np.array(embeddings[-16:])  # [16, 96]
                all_features.append(feature_window)
            else:
                skipped += 1

        except Exception as e:
            skipped += 1
            continue

    if skipped > 0:
        print(f"  ({skipped} fichiers ignorés — trop courts)")

    if all_features:
        return np.array(all_features)  # [N, 16, 96]
    return np.array([])


# =============================================================================
# Modèle
# =============================================================================
def build_model(input_shape: tuple, config: dict):
    """Construit le modèle DNN ou RNN."""
    import torch
    import torch.nn as nn

    model_type = config["model_type"]
    layer_size = config["layer_size"]

    if model_type == "dnn":
        # Flatten [16, 96] → 1536, puis couches denses
        input_dim = input_shape[0] * input_shape[1]  # 16 * 96 = 1536
        layers = [
            nn.Flatten(),
            nn.Linear(input_dim, layer_size),
            nn.LayerNorm(layer_size),
            nn.ReLU(),
            nn.Linear(layer_size, layer_size),
            nn.LayerNorm(layer_size),
            nn.ReLU(),
            nn.Linear(layer_size, layer_size),
            nn.LayerNorm(layer_size),
            nn.ReLU(),
            nn.Linear(layer_size, 1),
            nn.Sigmoid(),
        ]
        model = nn.Sequential(*layers)
    elif model_type == "rnn":
        class RNNModel(nn.Module):
            def __init__(self):
                super().__init__()
                self.lstm = nn.LSTM(
                    input_size=96,
                    hidden_size=layer_size,
                    num_layers=2,
                    bidirectional=True,
                    batch_first=True,
                )
                self.fc = nn.Linear(layer_size * 2, 1)
                self.sigmoid = nn.Sigmoid()

            def forward(self, x):
                out, _ = self.lstm(x)
                out = self.fc(out[:, -1, :])  # Dernier timestep
                return self.sigmoid(out)

        model = RNNModel()
    else:
        raise ValueError(f"model_type inconnu : {model_type}")

    return model


# =============================================================================
# Entraînement
# =============================================================================
def train_model(
    positive_features: np.ndarray,
    negative_features: np.ndarray,
    config: dict,
    output_dir: Path,
):
    """Entraîne le classifieur."""
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset

    train_config = config["training"]

    print(f"\n=== Entraînement du classifieur ===")
    print(f"  Type : {config['model_type']}")
    print(f"  Layer size : {config['layer_size']}")
    print(f"  Positifs : {len(positive_features)}")
    print(f"  Négatifs : {len(negative_features)}")

    # Équilibrage : ratio positifs/négatifs max 1:10
    max_neg = len(positive_features) * 10
    if len(negative_features) > max_neg:
        indices = np.random.choice(len(negative_features), max_neg, replace=False)
        negative_features = negative_features[indices]
        print(f"  Négatifs (après sampling) : {len(negative_features)}")

    # Labels
    X = np.vstack([positive_features, negative_features])
    y = np.concatenate([
        np.ones(len(positive_features)),
        np.zeros(len(negative_features)),
    ])

    # Shuffle
    perm = np.random.permutation(len(X))
    X, y = X[perm], y[perm]

    # Split train/val
    val_size = int(len(X) * train_config["validation_split"])
    X_train, X_val = X[val_size:], X[:val_size]
    y_train, y_val = y[val_size:], y[:val_size]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  Device : {device}")

    # GPU Guard — limite température et VRAM
    guard = GPUGuard(max_temp=80, max_memory_pct=90, cooldown_temp=70)
    guard.limit_torch_memory()
    guard.status()

    train_ds = TensorDataset(torch.FloatTensor(X_train), torch.FloatTensor(y_train))
    val_ds = TensorDataset(torch.FloatTensor(X_val), torch.FloatTensor(y_val))

    train_loader = DataLoader(train_ds, batch_size=train_config["batch_size"], shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=train_config["batch_size"])

    # Modèle
    input_shape = (X_train.shape[1], X_train.shape[2])  # (16, 96)
    model = build_model(input_shape, config).to(device)
    print(f"  Paramètres : {sum(p.numel() for p in model.parameters()):,}")

    optimizer = torch.optim.Adam(model.parameters(), lr=train_config["learning_rate"])
    criterion = nn.BCELoss()

    # Training loop
    steps = train_config["steps"]
    checkpoint_dir = output_dir / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")
    step = 0
    epoch = 0

    while step < steps:
        epoch += 1
        model.train()
        for X_batch, y_batch in train_loader:
            guard.check()  # Pause si GPU trop chaud

            X_batch, y_batch = X_batch.to(device), y_batch.to(device)

            optimizer.zero_grad()
            pred = model(X_batch).squeeze()
            loss = criterion(pred, y_batch)
            loss.backward()
            optimizer.step()
            step += 1

            if step >= steps:
                break

        # Validation
        model.eval()
        val_loss, correct, total, tp, fp, fn = 0, 0, 0, 0, 0, 0
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                pred = model(X_batch).squeeze()
                val_loss += criterion(pred, y_batch).item()
                predicted = (pred > 0.5).float()
                correct += (predicted == y_batch).sum().item()
                total += len(y_batch)
                tp += ((predicted == 1) & (y_batch == 1)).sum().item()
                fp += ((predicted == 1) & (y_batch == 0)).sum().item()
                fn += ((predicted == 0) & (y_batch == 1)).sum().item()

        avg_val_loss = val_loss / max(len(val_loader), 1)
        accuracy = correct / max(total, 1) * 100
        recall = tp / max(tp + fn, 1) * 100
        precision = tp / max(tp + fp, 1) * 100

        if epoch % 10 == 0 or step >= steps:
            print(
                f"  Epoch {epoch:4d} | Step {step:6d}/{steps} | "
                f"Loss: {avg_val_loss:.4f} | Acc: {accuracy:.1f}% | "
                f"Recall: {recall:.1f}% | Precision: {precision:.1f}%"
            )

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), checkpoint_dir / "best_model.pt")

    # Charger le meilleur
    model.load_state_dict(
        torch.load(checkpoint_dir / "best_model.pt", weights_only=True, map_location=device)
    )
    return model, input_shape


# =============================================================================
# Export
# =============================================================================
def export_onnx(model, input_shape: tuple, output_path: Path):
    """Exporte en ONNX."""
    import torch

    model.eval().cpu()
    dummy = torch.randn(1, *input_shape)  # [1, 16, 96]

    torch.onnx.export(
        model,
        dummy,
        str(output_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=11,
    )
    size_kb = output_path.stat().st_size / 1024
    print(f"  → ONNX exporté : {output_path} ({size_kb:.1f} KB)")


def export_tflite(onnx_path: Path, tflite_path: Path):
    """Convertit ONNX → TFLite."""
    try:
        import onnx2tf

        tf_dir = tflite_path.parent / "tf_tmp"
        onnx2tf.convert(
            input_onnx_file_path=str(onnx_path),
            output_folder_path=str(tf_dir),
            non_verbose=True,
        )

        for f in tf_dir.rglob("*.tflite"):
            import shutil
            shutil.copy(f, tflite_path)
            size_kb = tflite_path.stat().st_size / 1024
            print(f"  → TFLite exporté : {tflite_path} ({size_kb:.1f} KB)")
            shutil.rmtree(tf_dir, ignore_errors=True)
            return

        print("  ⚠ Fichier TFLite non trouvé après conversion")
    except Exception as e:
        print(f"  ⚠ Conversion TFLite échouée : {e}")


# =============================================================================
# Main
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="Entraîne le classifieur wake word")
    parser.add_argument("--config", default="config/training_config.yaml")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--steps", type=int, default=None)
    args = parser.parse_args()

    config = load_config(args.config)
    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir or config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.steps:
        config["training"]["steps"] = args.steps

    model_name = config["model_name"]
    print(f"=== Entraînement wake word : '{config['target_phrase'][0]}' ===")
    print(f"  Modèle : {model_name}")
    print()

    # Chemins des modèles d'embedding
    mel_model = str(data_dir / "models" / "melspectrogram.onnx")
    emb_model = str(data_dir / "models" / "embedding_model.onnx")

    for path in [mel_model, emb_model]:
        if not os.path.exists(path):
            print(f"ERREUR: {path} non trouvé. Lance : bash scripts/setup_data.sh")
            sys.exit(1)

    # --- Collecter et extraire les features positifs ---
    print("--- Features positifs ---")
    positive_files = []

    # Samples générés
    for subdir in ["data/positive", "data/augmented/positive"]:
        d = Path(subdir)
        if d.exists():
            files = collect_wav_files(d)
            positive_files.extend(files)
            print(f"  {subdir} : {len(files)} fichiers")

    # Enregistrements réels (pondérés 3x)
    rec_weight = config["training"]["real_recordings"]["weight"]
    for rec_dir in ["recordings", "data/augmented/recordings"]:
        d = Path(rec_dir)
        if d.exists():
            rec_files = collect_wav_files(d)
            if rec_files:
                positive_files.extend(rec_files * rec_weight)
                print(f"  {rec_dir} : {len(rec_files)} fichiers (x{rec_weight})")

    if not positive_files:
        print("\nERREUR: Aucun échantillon positif.")
        print("Lance d'abord :")
        print("  python scripts/generate_samples.py")
        print("  python scripts/augment_samples.py")
        sys.exit(1)

    print(f"  Total positifs : {len(positive_files)}")
    positive_features = extract_features(positive_files, mel_model, emb_model, "positifs")
    print(f"  Shape features positifs : {positive_features.shape}")

    # --- Features négatifs ---
    print("\n--- Features négatifs ---")
    negative_features_list = []

    # ACAV100M pré-calculées — charger un bloc contigu pour éviter l'accès aléatoire
    acav_path = config["negatives"]["acav100m_features"]
    if os.path.exists(acav_path):
        acav_mmap = np.load(acav_path, mmap_mode="r")
        print(f"  ACAV100M (fichier) : {acav_mmap.shape}")

        max_neg_samples = 50_000  # ~5x les positifs, suffisant et léger en RAM

        if acav_mmap.ndim == 2 and acav_mmap.shape[1] == 96:
            # Shape [N, 96] — prendre un bloc contigu et reshaper en [N/16, 16, 96]
            needed_rows = max_neg_samples * 16
            # Choisir un offset aléatoire pour varier entre les runs
            max_offset = max(0, len(acav_mmap) - needed_rows)
            offset = np.random.randint(0, max_offset + 1) if max_offset > 0 else 0
            block = np.array(acav_mmap[offset : offset + needed_rows])  # Lecture séquentielle rapide
            acav = block.reshape(-1, 16, 96)
        else:
            # Déjà en [N, 16, 96] — prendre un bloc contigu
            max_offset = max(0, len(acav_mmap) - max_neg_samples)
            offset = np.random.randint(0, max_offset + 1) if max_offset > 0 else 0
            acav = np.array(acav_mmap[offset : offset + max_neg_samples])

        negative_features_list.append(acav)
        print(f"  ACAV100M (bloc contigu) : {acav.shape} ({acav.nbytes / 1024**2:.0f} Mo RAM)")
        del acav_mmap

    # Négatifs générés + augmentés
    for neg_dir in ["data/negative", "data/augmented/negative"]:
        d = Path(neg_dir)
        if d.exists():
            neg_files = collect_wav_files(d)
            if neg_files:
                neg_feats = extract_features(neg_files, mel_model, emb_model, f"négatifs {neg_dir}")
                if len(neg_feats) > 0:
                    negative_features_list.append(neg_feats)

    if not negative_features_list:
        print("ERREUR: Aucune donnée négative. Lance : bash scripts/setup_data.sh")
        sys.exit(1)

    print("  Concaténation des features négatifs...")
    import gc
    for i, nf in enumerate(negative_features_list):
        print(f"    [{i}] shape={nf.shape} dtype={nf.dtype}")
    negative_features = np.vstack(negative_features_list)
    del negative_features_list
    gc.collect()
    print(f"  Total features négatifs : {negative_features.shape}")
    print(f"  RAM négatifs : {negative_features.nbytes / 1024**2:.0f} Mo")

    # --- Entraînement ---
    print("\n  Lancement de l'entraînement...")
    sys.stdout.flush()
    model, input_shape = train_model(positive_features, negative_features, config, output_dir)

    # --- Export ---
    print(f"\n--- Export ---")
    onnx_path = output_dir / f"{model_name}.onnx"
    export_onnx(model, input_shape, onnx_path)

    if "tflite" in config["export"]["formats"]:
        tflite_path = output_dir / f"{model_name}.tflite"
        export_tflite(onnx_path, tflite_path)

    print(f"\n{'='*50}")
    print(f"  Entraînement terminé !")
    print(f"  Modèles dans : {output_dir}/")
    for f in output_dir.glob(f"{model_name}.*"):
        print(f"    {f.name} ({f.stat().st_size / 1024:.1f} KB)")
    print(f"{'='*50}")
    print(f"\nProchaines étapes :")
    print(f"  1. Tester : python scripts/test_model.py --model {onnx_path}")
    print(f"  2. Convertir RKNN : python scripts/convert_to_rknn.py --model {onnx_path}")


if __name__ == "__main__":
    main()
