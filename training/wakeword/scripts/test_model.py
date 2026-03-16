#!/usr/bin/env python3
"""
test_model.py — Teste le modèle wake word "Diva" en temps réel

Modes :
  - ONNX standard (CPU/GPU)
  - RKNN hybride (melspectrogram CPU + embedding/classifieur NPU)

Usage:
    python scripts/test_model.py --model models/diva_fr/diva_fr.onnx
    python scripts/test_model.py --model models/diva_fr/diva_fr.onnx --threshold 0.7
    python scripts/test_model.py --rknn --model models/diva_fr/rknn/
"""

import argparse
import sys
import time

import numpy as np

try:
    import pyaudio
except ImportError:
    print("ERREUR: PyAudio requis.")
    print("  sudo apt install portaudio19-dev && pip install pyaudio")
    sys.exit(1)

OWW_RATE = 16000    # openWakeWord attend 16kHz
CHANNELS = 1
FORMAT = pyaudio.paInt16
OWW_CHUNK = 1280    # 80ms frames à 16kHz (requis par openWakeWord)


def find_device(pa: pyaudio.PyAudio, device_name: str = None) -> tuple:
    """Trouve le device audio et son sample rate. Retourne (index, sample_rate)."""
    if device_name:
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            if info["maxInputChannels"] > 0 and device_name.lower() in info["name"].lower():
                return i, int(info["defaultSampleRate"])
        # Pas trouvé par nom, essayer par index ALSA hw:X,0
        print(f"  Device '{device_name}' non trouvé par nom, recherche ALSA...")

    info = pa.get_default_input_device_info()
    return int(info["index"]), int(info["defaultSampleRate"])


def test_openwakeword(model_path: str, threshold: float, device_name: str = None):
    """Test via la librairie openWakeWord standard."""
    try:
        from openwakeword.model import Model
    except ImportError:
        print("ERREUR: pip install openwakeword")
        sys.exit(1)
    from scipy.signal import resample

    print(f"=== Test ONNX en temps réel ===")
    print(f"  Modèle : {model_path}")
    print(f"  Seuil : {threshold}")

    oww = Model(wakeword_models=[model_path], inference_framework="onnx")
    model_name = list(oww.models.keys())[0]

    pa = pyaudio.PyAudio()
    dev_index, mic_rate = find_device(pa, device_name)
    dev_info = pa.get_device_info_by_index(dev_index)
    # Chunk micro : même durée que OWW_CHUNK mais au sample rate du micro
    mic_chunk = int(OWW_CHUNK * mic_rate / OWW_RATE)

    print(f"  Micro : [{dev_index}] {dev_info['name']} @ {mic_rate}Hz")
    print(f"  Ctrl+C pour arrêter\n")

    stream = pa.open(
        format=FORMAT, channels=CHANNELS, rate=mic_rate,
        input=True, input_device_index=dev_index, frames_per_buffer=mic_chunk,
    )

    print("Écoute en cours... Dis 'Diva' !\n")
    detections = 0

    try:
        while True:
            raw = stream.read(mic_chunk, exception_on_overflow=False)
            audio_48k = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
            # Resample 48kHz → 16kHz
            audio_16k = resample(audio_48k, OWW_CHUNK).astype(np.int16)

            pred = oww.predict(audio_16k)
            score = pred[model_name]

            bar = "#" * int(score * 40) + "." * (40 - int(score * 40))
            if score >= threshold:
                detections += 1
                print(f"\r  DETECTE ! [{bar}] {score:.3f}  (#{detections})")
                print()
                oww.reset()  # Reset les buffers pour éviter les détections en boucle
                time.sleep(1.5)
            else:
                print(f"\r  [{bar}] {score:.3f}", end="", flush=True)
    except KeyboardInterrupt:
        print(f"\n\nTotal détections : {detections}")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


def test_rknn_hybrid(rknn_dir: str, threshold: float):
    """
    Test avec l'architecture hybride RKNN.

    melspectrogram.onnx  → CPU (ONNX Runtime)
    embedding_model.rknn → NPU Core 0
    diva_fr.rknn         → NPU Core 1
    """
    import onnxruntime as ort
    from pathlib import Path

    try:
        from rknnlite.api import RKNNLite
    except ImportError:
        print("ERREUR: rknnlite non installé sur ce dispositif.")
        print("  Ce test doit être lancé sur le RK3588.")
        sys.exit(1)

    rknn_path = Path(rknn_dir)
    print(f"=== Test RKNN hybride en temps réel ===")
    print(f"  Répertoire : {rknn_dir}")
    print(f"  Seuil : {threshold}")
    print()

    # Charger les modèles
    mel_session = ort.InferenceSession(str(rknn_path / "melspectrogram.onnx"))
    print("  melspectrogram.onnx → CPU")

    emb_rknn = RKNNLite()
    emb_rknn.load_rknn(str(rknn_path / "embedding_model.rknn"))
    emb_rknn.init_runtime(core_mask=RKNNLite.NPU_CORE_0)
    print("  embedding_model.rknn → NPU Core 0")

    # Trouver le classifieur
    cls_files = list(rknn_path.glob("diva*.rknn"))
    if not cls_files:
        print("ERREUR: Aucun classifieur diva*.rknn trouvé")
        sys.exit(1)

    cls_rknn = RKNNLite()
    cls_rknn.load_rknn(str(cls_files[0]))
    cls_rknn.init_runtime(core_mask=RKNNLite.NPU_CORE_1)
    print(f"  {cls_files[0].name} → NPU Core 1")

    # Buffers
    mel_buffer = []
    emb_buffer = []

    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=FORMAT, channels=CHANNELS, rate=SAMPLE_RATE,
        input=True, frames_per_buffer=CHUNK,
    )

    print(f"\nÉcoute en cours... Dis 'Diva' !\n")
    detections = 0

    try:
        while True:
            audio_raw = stream.read(CHUNK, exception_on_overflow=False)
            audio = np.frombuffer(audio_raw, dtype=np.int16).astype(np.float32) / 32768.0
            audio_input = audio.reshape(1, -1).astype(np.float32)

            # Étape 1 : Melspectrogram (CPU)
            mel_out = mel_session.run(None, {"input": audio_input})[0]
            mel_out = (mel_out / 10.0) + 2.0
            mel_buffer.append(mel_out)

            score = 0.0

            if len(mel_buffer) >= 76:
                # Étape 2 : Embedding (NPU Core 0)
                mel_window = np.stack(mel_buffer[-76:]).reshape(1, 76, 32, 1).astype(np.float32)
                embedding = emb_rknn.inference(inputs=[mel_window])[0]
                emb_buffer.append(embedding.flatten())
                mel_buffer = mel_buffer[8:]  # Slide de 8 frames

                if len(emb_buffer) >= 16:
                    # Étape 3 : Classification (NPU Core 1)
                    emb_input = np.array(emb_buffer[-16:]).reshape(1, 16, 96).astype(np.float32)
                    result = cls_rknn.inference(inputs=[emb_input])[0]
                    score = float(result.flatten()[0])

                    if len(emb_buffer) > 32:
                        emb_buffer = emb_buffer[-16:]

            bar = "#" * int(score * 40) + "." * (40 - int(score * 40))
            if score >= threshold:
                detections += 1
                print(f"\r  DETECTE ! [{bar}] {score:.3f}  (#{detections})")
                print()
                time.sleep(1)
            else:
                print(f"\r  [{bar}] {score:.3f}", end="", flush=True)

    except KeyboardInterrupt:
        print(f"\n\nTotal détections : {detections}")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        emb_rknn.release()
        cls_rknn.release()


def main():
    parser = argparse.ArgumentParser(description="Teste le wake word en temps réel")
    parser.add_argument("--model", default="models/diva_fr/diva_fr.onnx", help="Modèle ONNX ou répertoire RKNN")
    parser.add_argument("--threshold", type=float, default=0.7, help="Seuil de détection (défaut: 0.7)")
    parser.add_argument("--device", default=None, help="Nom du micro (ex: C01U, ROG)")
    parser.add_argument("--rknn", action="store_true", help="Mode RKNN hybride (sur RK3588)")
    args = parser.parse_args()

    if args.rknn:
        test_rknn_hybrid(args.model, args.threshold)
    else:
        test_openwakeword(args.model, args.threshold, args.device)


if __name__ == "__main__":
    main()
