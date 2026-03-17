#!/usr/bin/env python3
"""
Diva Memory & Speaker ID Service
Exposes WeSpeaker + Mem0 via HTTP on port 9002
"""
import json
import os
import base64
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler

# --- Mem0 Setup ---
from mem0 import Memory
mem0_config = {
    "version": "v1.1",
    "llm": {
        "provider": "anthropic",
        "config": {
            "model": "claude-haiku-4-5-20251001",
            "temperature": 0.1,
            "max_tokens": 1000,
        }
    },
    "embedder": {
        "provider": "openai",
        "config": {
            "model": "all-MiniLM-L6-v2",
            "api_key": "not-needed",
            "openai_base_url": "http://localhost:8883/v1"
        }
    },
    "vector_store": {
        "provider": "chroma",
        "config": {
            "collection_name": "diva_memories",
            "path": "/opt/diva-embedded/data/mem0_db"
        }
    }
}

print("[Mem0] Initializing...")
try:
    memory = Memory.from_config(mem0_config)
    print("[Mem0] Ready!")
except Exception as e:
    print(f"[Mem0] Init failed: {e}, using fallback")
    memory = None

# --- WeSpeaker Setup (ONNX direct, no torchcodec) ---
print("[WeSpeaker] Initializing...")
SPEAKERS_DIR = "/opt/diva-embedded/data/speakers"
os.makedirs(SPEAKERS_DIR, exist_ok=True)

try:
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    import onnxruntime as ort
    
    WESPEAKER_MODEL = "/root/.wespeaker/en/model.onnx"
    ort_session = ort.InferenceSession(WESPEAKER_MODEL, providers=['CPUExecutionProvider'])
    ort_input_name = ort_session.get_inputs()[0].name
    
    def extract_embedding_onnx(wav_path):
        """Extract speaker embedding using ONNX model directly."""
        audio, sr = sf.read(wav_path)
        waveform = torch.from_numpy(audio).float()
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)
        else:
            waveform = waveform.T
        if sr != 16000:
            waveform = torchaudio.transforms.Resample(sr, 16000)(waveform)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        fbank = torchaudio.compliance.kaldi.fbank(
            waveform, num_mel_bins=80, sample_frequency=16000, dither=0
        ).numpy()
        fbank = np.expand_dims(fbank, axis=0).astype(np.float32)
        embedding = ort_session.run(None, {ort_input_name: fbank})[0]
        return embedding.squeeze()
    
    speaker_model = True  # Flag that model is ready
    
    # Load registered speakers
    registered_speakers = {}
    for f in os.listdir(SPEAKERS_DIR):
        if f.endswith('.npy'):
            name = f.replace('.npy', '')
            embedding = np.load(os.path.join(SPEAKERS_DIR, f))
            registered_speakers[name] = embedding
            print(f"[WeSpeaker] Loaded speaker: {name}")
    print(f"[WeSpeaker] Ready! {len(registered_speakers)} speakers registered")
except Exception as e:
    print(f"[WeSpeaker] Init failed: {e}")
    speaker_model = None
    registered_speakers = {}
    extract_embedding_onnx = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging
    
    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        
        if self.path == '/memory/add':
            # Add memory for a user
            user_id = body.get('user_id', 'default')
            messages = body.get('messages', [])
            text = body.get('text', '')
            
            if memory is None:
                self._respond(500, {"error": "Mem0 not initialized"})
                return
            
            try:
                if messages:
                    result = memory.add(messages, user_id=user_id)
                elif text:
                    result = memory.add(text, user_id=user_id)
                else:
                    self._respond(400, {"error": "No messages or text"})
                    return
                print(f"[Mem0] Added memory for {user_id}: {result}")
                self._respond(200, {"status": "ok", "result": str(result)})
            except Exception as e:
                print(f"[Mem0] Add error: {e}")
                self._respond(500, {"error": str(e)})
        
        elif self.path == '/memory/search':
            # Search memories
            user_id = body.get('user_id', 'default')
            query = body.get('query', '')
            
            if memory is None:
                self._respond(200, {"memories": []})
                return
            
            try:
                raw = memory.search(query, user_id=user_id); results = raw.get("results", raw) if isinstance(raw, dict) else raw
                memories = [{"memory": r.get("memory", ""), "score": r.get("score", 0)} for r in results]
                self._respond(200, {"memories": memories})
            except Exception as e:
                print(f"[Mem0] Search error: {e}")
                self._respond(200, {"memories": []})
        
        elif self.path == '/memory/all':
            # Get all memories for a user
            user_id = body.get('user_id', 'default')
            
            if memory is None:
                self._respond(200, {"memories": []})
                return
            
            try:
                raw = memory.get_all(user_id=user_id); results = raw.get("results", raw) if isinstance(raw, dict) else raw
                memories = [{"memory": r.get("memory", ""), "id": r.get("id", "")} for r in results]
                self._respond(200, {"memories": memories})
            except Exception as e:
                print(f"[Mem0] GetAll error: {e}")
                self._respond(200, {"memories": []})
        

        elif self.path == '/memory/delete':
            # Delete a specific memory by ID
            memory_id = body.get('memory_id', '')
            
            if memory is None:
                self._respond(500, {"error": "Mem0 not initialized"})
                return
            
            if not memory_id:
                self._respond(400, {"error": "No memory_id provided"})
                return
            
            try:
                memory.delete(memory_id)
                print(f"[Mem0] Deleted memory: {memory_id}")
                self._respond(200, {"status": "deleted", "id": memory_id})
            except Exception as e:
                print(f"[Mem0] Delete error: {e}")
                self._respond(500, {"error": str(e)})
        
        elif self.path == '/memory/update':
            # Update a specific memory
            memory_id = body.get('memory_id', '')
            new_text = body.get('text', '')
            
            if memory is None:
                self._respond(500, {"error": "Mem0 not initialized"})
                return
            
            if not memory_id or not new_text:
                self._respond(400, {"error": "Need memory_id and text"})
                return
            
            try:
                memory.update(memory_id, new_text)
                print(f"[Mem0] Updated memory {memory_id}: {new_text}")
                self._respond(200, {"status": "updated", "id": memory_id})
            except Exception as e:
                print(f"[Mem0] Update error: {e}")
                self._respond(500, {"error": str(e)})

        elif self.path == '/speaker/identify':
            # Identify speaker from audio
            if speaker_model is None:
                self._respond(200, {"speaker": "unknown"})
                return
            
            audio_b64 = body.get('audio', '')
            if not audio_b64:
                self._respond(400, {"error": "No audio"})
                return
            
            try:
                import numpy as np
                audio_bytes = base64.b64decode(audio_b64)
                # Save to temp WAV
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                    f.write(audio_bytes)
                    tmp_path = f.name
                
                # Extract embedding
                embedding = extract_embedding_onnx(tmp_path)
                os.unlink(tmp_path)
                
                if not registered_speakers:
                    self._respond(200, {"speaker": "unknown", "confidence": 0})
                    return
                
                # Compare with registered speakers
                best_name = "unknown"
                best_score = 0
                for name, ref_emb in registered_speakers.items():
                    score = float(np.dot(embedding, ref_emb) / (np.linalg.norm(embedding) * np.linalg.norm(ref_emb)))
                    if score > best_score:
                        best_score = score
                        best_name = name
                
                # Threshold
                if best_score < 0.3:
                    best_name = "unknown"
                
                self._respond(200, {"speaker": best_name, "confidence": round(best_score, 3)})
            except Exception as e:
                print(f"[WeSpeaker] Error: {e}")
                self._respond(200, {"speaker": "unknown", "confidence": 0})
        
        elif self.path == '/speaker/register':
            # Register a new speaker
            if speaker_model is None:
                self._respond(500, {"error": "WeSpeaker not initialized"})
                return
            
            name = body.get('name', '')
            audio_b64 = body.get('audio', '')
            if not name or not audio_b64:
                self._respond(400, {"error": "Need name and audio"})
                return
            
            try:
                import numpy as np
                audio_bytes = base64.b64decode(audio_b64)
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                    f.write(audio_bytes)
                    tmp_path = f.name
                
                embedding = extract_embedding_onnx(tmp_path)
                os.unlink(tmp_path)
                
                # Save embedding
                np.save(os.path.join(SPEAKERS_DIR, f"{name}.npy"), embedding)
                registered_speakers[name] = embedding
                print(f"[WeSpeaker] Registered speaker: {name}")
                self._respond(200, {"status": "ok", "speaker": name})
            except Exception as e:
                print(f"[WeSpeaker] Register error: {e}")
                self._respond(500, {"error": str(e)})
        
        else:
            self._respond(404, {"error": "Not found"})
    
    def do_GET(self):
        if self.path == '/health':
            self._respond(200, {
                "status": "ok",
                "mem0": memory is not None,
                "wespeaker": speaker_model is not None,
                "speakers": list(registered_speakers.keys())
            })
        else:
            self._respond(404, {"error": "Not found"})


if __name__ == '__main__':
    PORT = 9002
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f"[Diva-Memory] Service running on port {PORT}")
    server.serve_forever()
