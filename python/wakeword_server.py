#!/usr/bin/env python3
"""
Wake word detection server for Diva.
Uses microphone directly via PyAudio or reads from FIFO.
Sends detections via TCP socket to Node.js.
"""

import json
import socket
import sys
import os
import time
import numpy as np

try:
    from openwakeword.model import Model
except ImportError:
    print(json.dumps({"type": "error", "message": "openwakeword not installed"}))
    sys.exit(1)

FIFO_PATH = os.environ.get("WAKEWORD_FIFO", "/tmp/ec.output")
HOST = "127.0.0.1"
PORT = 9001
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80ms at 16kHz
THRESHOLD = 0.5


def main():
    print("Loading wake word model...", flush=True)

    # OpenWakeWord 0.4.0 — load default models (includes hey_jarvis)
    try:
        model = Model(inference_framework="onnx")
    except TypeError:
        # Fallback for different API versions
        model = Model()

    print("Wake word model loaded", flush=True)

    # Start TCP server
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(1)
    print(f"TCP server listening on {HOST}:{PORT}", flush=True)

    # Accept connection from Node.js
    server.settimeout(30)
    try:
        conn, addr = server.accept()
        print(f"Client connected from {addr}", flush=True)
    except socket.timeout:
        print("No client connected within timeout", flush=True)
        server.close()
        sys.exit(1)

    # Open the AEC output FIFO (or direct audio)
    fifo = None
    if os.path.exists(FIFO_PATH):
        fifo = open(FIFO_PATH, "rb")
        print(f"Reading audio from FIFO: {FIFO_PATH}", flush=True)
    else:
        # Fallback: use microphone directly via ALSA
        print(f"FIFO {FIFO_PATH} not found, using microphone directly", flush=True)
        try:
            import subprocess
            card = os.environ.get("AUDIO_INPUT_DEVICE", "plughw:5")
            fifo = subprocess.Popen(
                ["arecord", "-D", card, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-q"],
                stdout=subprocess.PIPE
            ).stdout
        except Exception as e:
            msg = json.dumps({"type": "error", "message": f"Cannot open mic: {e}"})
            conn.sendall((msg + "\n").encode())
            conn.close()
            server.close()
            sys.exit(1)

    bytes_per_chunk = CHUNK_SAMPLES * 2  # 16-bit = 2 bytes per sample

    try:
        while True:
            raw = fifo.read(bytes_per_chunk)
            if not raw or len(raw) < bytes_per_chunk:
                time.sleep(0.01)
                continue

            # Convert to float32
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

            # Run prediction
            model.predict(audio)

            # Check all models for detection
            for model_name, scores in model.prediction_buffer.items():
                current_score = scores[-1] if len(scores) > 0 else 0.0
                if current_score > THRESHOLD:
                    detection = {
                        "type": "detection",
                        "keyword": "diva",
                        "score": float(current_score),
                        "model": model_name,
                        "timestamp": time.time()
                    }
                    msg = json.dumps(detection) + "\n"
                    try:
                        conn.sendall(msg.encode())
                    except BrokenPipeError:
                        print("Client disconnected", flush=True)
                        return
                    model.reset()
                    break

    except KeyboardInterrupt:
        pass
    finally:
        if fifo:
            fifo.close()
        conn.close()
        server.close()
        print("Wake word server stopped", flush=True)


if __name__ == "__main__":
    main()
