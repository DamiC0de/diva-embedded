#!/usr/bin/env python3
"""
Wake word detection server for Diva.
Reads raw PCM audio from /tmp/ec.output (AEC clean audio),
runs OpenWakeWord detection, and sends JSON messages via TCP socket.
"""

import json
import socket
import sys
import struct
import time
import numpy as np

try:
    from openwakeword.model import Model
except ImportError:
    print(json.dumps({"type": "error", "message": "openwakeword not installed"}))
    sys.exit(1)

FIFO_PATH = "/tmp/ec.output"
HOST = "127.0.0.1"
PORT = 9001
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80ms at 16kHz
THRESHOLD = 0.5

def main():
    # Load OpenWakeWord model
    print(json.dumps({"type": "status", "message": "Loading wake word model..."}), flush=True)
    model = Model(
        wakeword_models=["hey_jarvis"],  # closest available; custom "diva" model can be swapped in
        inference_framework="onnx"
    )
    print(json.dumps({"type": "status", "message": "Wake word model loaded"}), flush=True)

    # Start TCP server
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(1)
    print(json.dumps({"type": "status", "message": f"TCP server listening on {HOST}:{PORT}"}), flush=True)

    # Accept connection from Node.js
    server.settimeout(30)
    try:
        conn, addr = server.accept()
        print(json.dumps({"type": "status", "message": f"Client connected from {addr}"}), flush=True)
    except socket.timeout:
        print(json.dumps({"type": "error", "message": "No client connected within timeout"}), flush=True)
        server.close()
        sys.exit(1)

    # Open the AEC output FIFO for reading
    try:
        fifo = open(FIFO_PATH, "rb")
    except FileNotFoundError:
        msg = json.dumps({"type": "error", "message": f"FIFO {FIFO_PATH} not found"})
        conn.sendall((msg + "\n").encode())
        conn.close()
        server.close()
        sys.exit(1)

    print(json.dumps({"type": "status", "message": "Reading audio from FIFO..."}), flush=True)
    bytes_per_chunk = CHUNK_SAMPLES * 2  # 16-bit = 2 bytes per sample

    try:
        while True:
            raw = fifo.read(bytes_per_chunk)
            if not raw or len(raw) < bytes_per_chunk:
                time.sleep(0.01)
                continue

            # Convert to float32 numpy array
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

            # Run prediction
            prediction = model.predict(audio)

            # Check all models for detection
            for model_name, score in model.prediction_buffer.items():
                current_score = score[-1] if len(score) > 0 else 0.0
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
                        print(json.dumps({"type": "error", "message": "Client disconnected"}), flush=True)
                        break
                    # Reset to avoid repeated detections
                    model.reset()
                    break

    except KeyboardInterrupt:
        pass
    finally:
        fifo.close()
        conn.close()
        server.close()
        print(json.dumps({"type": "status", "message": "Wake word server stopped"}), flush=True)


if __name__ == "__main__":
    main()
