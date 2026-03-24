#!/usr/bin/env python3
"""
Diva PROTO — Wake word + voice capture + playback.
Python handles ALL audio. Node.js handles APIs only.
Communication: TCP JSON lines on port 9001.

Flow:
1. Open mic, run OpenWakeWord continuously
2. Wake word detected → stop wake word, capture voice until silence
3. Send audio as base64 WAV to Node via TCP
4. Receive play command from Node (WAV path)
5. Play WAV via aplay
6. Resume wake word listening
"""

import json
import socket
import sys
import os
import time
import subprocess
import struct
import base64
import wave
import tempfile
import urllib.request

import numpy as np

# --- Groq Transcription for Speaker Registration ---
def transcribe_audio(audio_bytes):
    """Transcribe audio using Groq Whisper API."""
    import requests
    
    GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
    if not GROQ_API_KEY:
        env_path = "/opt/diva-embedded/.env"
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("GROQ_API_KEY="):
                        GROQ_API_KEY = line.strip().split("=", 1)[1].strip('"').strip("'")
                        break
    
    if not GROQ_API_KEY:
        print("[Transcribe] No GROQ_API_KEY", flush=True)
        return None
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    
    try:
        with open(tmp_path, "rb") as audio_file:
            response = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                files={"file": ("audio.wav", audio_file, "audio/wav")},
                data={"model": "whisper-large-v3", "language": "fr"},
                timeout=30
            )
        
        if response.ok:
            text = response.json().get("text", "").strip()
            print(f"[Transcribe] {text}", flush=True)
            return text
        else:
            print(f"[Transcribe] Error: {response.status_code}", flush=True)
            return None
    except Exception as e:
        print(f"[Transcribe] {e}", flush=True)
        return None
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)



# --- Silero VAD ---
try:
    import torch
    from silero_vad import load_silero_vad
    vad_model = load_silero_vad()
    VAD_AVAILABLE = True
    print("[Wake] Silero VAD loaded!", flush=True)
except Exception as e:
    print(f"[Wake] Silero VAD not available ({e}), using RMS fallback", flush=True)
    VAD_AVAILABLE = False
    vad_model = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HOST = "127.0.0.1"
PORT = 9001
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80ms at 16kHz
BYTES_PER_CHUNK = CHUNK_SAMPLES * 2  # 16-bit
THRESHOLD_DEFAULT = 0.35
THRESHOLD_CHILD = 0.25  # Story 2.6 / FR82: Softer threshold for child voices
THRESHOLD = THRESHOLD_DEFAULT

THRESHOLD_FILE = "/tmp/diva-wake-threshold"

def check_threshold_file():
    """Story 2.6: Check if Node.js has signaled a threshold change via shared file."""
    global THRESHOLD
    try:
        if os.path.exists(THRESHOLD_FILE):
            with open(THRESHOLD_FILE) as f:
                mode = f.read().strip()
            if mode == "child" and THRESHOLD != THRESHOLD_CHILD:
                THRESHOLD = THRESHOLD_CHILD
                print(f"[Wake] Threshold → child mode ({THRESHOLD})", flush=True)
            elif mode == "adult" and THRESHOLD != THRESHOLD_DEFAULT:
                THRESHOLD = THRESHOLD_DEFAULT
                print(f"[Wake] Threshold → adult mode ({THRESHOLD})", flush=True)
    except Exception:
        pass
SILENCE_TIMEOUT_S = 0.8  # Brainstorm session 3: reduced from 1.2s for faster response
MAX_RECORD_S = 30
ENERGY_THRESHOLD = 1500  # RMS threshold for VAD
FOLLOW_UP_TIMEOUT_S = 5.0  # Extended for slower speakers
_pending_messages = []  # Buffer for messages received during speak_tts

MODEL_NAME = "diva_fr"
MODEL_FILE = f"{MODEL_NAME}.onnx"
MODEL_URL = f"https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/{MODEL_FILE}"


# ---------------------------------------------------------------------------
# Auto-detect ReSpeaker card number
# ---------------------------------------------------------------------------
def detect_respeaker_card() -> str:
    """Auto-detect ReSpeaker Lite USB card number via arecord -l."""
    try:
        result = subprocess.run(
            ["arecord", "-l"], capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if "ReSpeaker" in line or "respeaker" in line.lower():
                # Line format: "card X: ..."
                parts = line.split(":")
                if parts:
                    card_str = parts[0].strip().split()[-1]
                    if card_str.isdigit():
                        device = f"plughw:{card_str}"
                        print(f"[Wake] Auto-detected ReSpeaker on {device}", flush=True)
                        return device
    except Exception as e:
        print(f"[Wake] arecord -l failed: {e}", flush=True)

    # Fallback to env or default
    fallback = os.environ.get("AUDIO_INPUT_DEVICE", "plughw:5")
    print(f"[Wake] ReSpeaker not found, using fallback: {fallback}", flush=True)
    return fallback


# ---------------------------------------------------------------------------
# Download wake word model if missing
# ---------------------------------------------------------------------------
def ensure_model() -> str:
    """Find custom or pre-trained wake word model. Returns path to model file."""
    # First check in assets directory (custom models)
    assets_model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MODEL_FILE)
    if os.path.exists(assets_model) and os.path.getsize(assets_model) > 1000:
        print(f"[Wake] Custom model found: {assets_model}", flush=True)
        return assets_model

    # Then check in openwakeword package directory
    try:
        import openwakeword
        pkg_dir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
        pkg_model = os.path.join(pkg_dir, MODEL_FILE)
        if os.path.exists(pkg_model) and os.path.getsize(pkg_model) > 100000:
            print(f"[Wake] Model found in package: {pkg_model}", flush=True)
            return pkg_model
    except Exception:
        pass

    # Fallback: download to project models dir
    model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, MODEL_FILE)

    if os.path.exists(model_path) and os.path.getsize(model_path) > 100000:
        print(f"[Wake] Model found: {model_path}", flush=True)
        return model_path

    print(f"[Wake] Downloading model from {MODEL_URL}...", flush=True)
    try:
        urllib.request.urlretrieve(MODEL_URL, model_path)
        print(f"[Wake] Model downloaded: {model_path}", flush=True)
    except Exception as e:
        print(f"[Wake] ERROR downloading model: {e}", flush=True)
        sys.exit(1)

    return model_path


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------
def open_mic(device: str) -> subprocess.Popen:
    """Open microphone via parecord (PulseAudio AEC) with retry."""
    for attempt in range(3):
        try:
            proc = subprocess.Popen(
                ["arecord", "-D", device, "-f", "S16_LE", "-r", str(SAMPLE_RATE),
                 "-c", "1", "-t", "raw", "-q"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            # Check if it started OK (wait a tiny bit)
            time.sleep(0.1)
            if proc.poll() is not None:
                raise RuntimeError(f"arecord exited with {proc.returncode}")
            print(f"[Wake] Mic opened on {device} (pid={proc.pid})", flush=True)
            return proc
        except Exception as e:
            print(f"[Wake] Mic open attempt {attempt+1} failed: {e}", flush=True)
            # Kill any lingering arecord
            subprocess.run(["pkill", "-9", "arecord"], capture_output=True)
            time.sleep(0.5)
    # Last resort
    proc = subprocess.Popen(
        ["arecord", "-D", device, "-f", "S16_LE", "-r", str(SAMPLE_RATE),
         "-c", "1", "-t", "raw", "-q"],
        stdout=subprocess.PIPE
    )
    print(f"[Wake] Mic opened on {device} (pid={proc.pid}) [last resort]", flush=True)
    return proc


def close_mic(proc: subprocess.Popen | None):
    """Safely close microphone process."""
    if proc is None:
        return
    try:
        proc.kill()
        proc.wait(timeout=2)
    except Exception:
        pass
    # Ensure ALSA device is released
    time.sleep(0.5)
    print("[Wake] Mic closed", flush=True)

def play_filler_audio(path: str, mic_proc):
    """Play a pre-cached filler WAV file.
    
    Called by Node.js via type: play_filler message.
    Closes mic if open, plays WAV, does NOT reopen mic (Node.js handles that).
    """
    print(f"[Wake] Playing filler: {path}", flush=True)
    
    # Close mic if open to avoid ALSA conflicts
    if mic_proc is not None:
        close_mic(mic_proc)
    
    if not os.path.exists(path):
        print(f"[Wake] Filler not found: {path}", flush=True)
        return None
    
    try:
        subprocess.run(
            ["aplay", "-D", "plughw:5", path],
            timeout=10,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("[Wake] Filler playback done", flush=True)
    except subprocess.TimeoutExpired:
        print("[Wake] Filler playback timeout", flush=True)
    except Exception as e:
        print(f"[Wake] Filler playback error: {e}", flush=True)
    
    return None  # Mic is closed, return None so caller knows



def strip_emojis(text):
    import re
    return re.sub(r'[😀-🙏🌀-🗿🚀-🛿🇠-🇿✂-➰🤦-🤷☀-⭕️]+', '', text).strip()

def speak_tts(text: str, device: str, oww_model=None, conn=None):
    """TTS via Piper HTTP server (model stays loaded) + aplay. Returns keyword or False."""
    text = strip_emojis(text)
    if not text:
        return False
    print(f"[Wake] Speaking: {text[:60]}...", flush=True)
    # Detect goodbye responses to end conversation
    goodbye_phrases = ["bonne nuit", "à bientôt", "à plus", "au revoir", "salut", "ciao", "bye"]
    is_goodbye = any(phrase in text.lower() for phrase in goodbye_phrases)
    try:
        # Use Piper HTTP server (model already in memory = fast)
        req = urllib.request.Request(
            "http://localhost:8880/v1/audio/speech",
            data=json.dumps({"input": text, "voice": "fr_FR-siwis-medium", "response_format": "wav"}).encode(),
            headers={"Content-Type": "application/json"}
        )
        wav_data = urllib.request.urlopen(req, timeout=15).read()
        # Write to temp file and play
        tmp_wav = "/tmp/diva_speak.wav"
        with open(tmp_wav, "wb") as f:
            f.write(wav_data)
        env = dict(os.environ, PULSE_SERVER="unix:/var/run/pulse/native")
        play_proc = subprocess.Popen(
            ["aplay", "-D", "plughw:5", tmp_wav],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env
        )
        piper_proc = None  # No piper process to manage
        
        # Barge-in monitoring DISABLED — causes echo capture
        # Re-enable when hardware AEC (ReSpeaker XVF3800) is available
        if False and conn:
            mic_listen = subprocess.Popen(
                ["arecord", "-D", device, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-q"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
            )
            CHUNK_DURATION = 1.5
            BARGEIN_RATE = 16000
            BARGEIN_BYTES = int(BARGEIN_RATE * 2 * CHUNK_DURATION)
            grace_start = time.time()
            while play_proc.poll() is None:
                raw = mic_listen.stdout.read(BARGEIN_BYTES)
                if not raw:
                    break
                if time.time() - grace_start < 1.0:
                    continue
                try:
                    wav_data = pcm_to_wav_bytes(raw)
                    b64_audio = base64.b64encode(wav_data).decode("ascii")
                    send_json(conn, {"type": "keyword_check", "data": b64_audio})
                    response = recv_json(conn, timeout=3)
                    if response and response.get("type") == "keyword_detected":
                        keyword = response.get("keyword", "")
                        print(f"[Wake] KEYWORD BARGE-IN! Detected '{keyword}'", flush=True)
                        play_proc.kill()
                        pass  # piper_proc not used
                        try:
                            mic_listen.kill()
                            mic_listen.wait(timeout=1)
                        except Exception:
                            pass
                        return keyword
                    elif response and response.get("type") not in (None, "keyword_not_detected"):
                        _pending_messages.append(response)
                except Exception as e:
                    print(f"[Wake] Keyword check error: {e}", flush=True)
            try:
                mic_listen.kill()
                mic_listen.wait(timeout=1)
            except Exception:
                pass
        
        play_proc.wait(timeout=30)
        print("[Wake] Speaking done", flush=True)
        if is_goodbye:
            print("[Wake] Goodbye phrase detected — will end conversation", flush=True)
            return "GOODBYE"
        return False
    except Exception as e:
        print(f"[Wake] speak_tts error: {e}", flush=True)
        return False

def recv_json_buffered(conn, timeout=30):
    """Read from pending buffer first, then TCP."""
    if _pending_messages:
        return _pending_messages.pop(0)
    return recv_json(conn, timeout=timeout)

def compute_rms(raw: bytes) -> float:
    """Compute RMS energy of 16-bit PCM audio."""
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples ** 2)))


def is_speech_vad(raw: bytes) -> bool:
    """Check if audio chunk contains speech using Silero VAD.
    Falls back to RMS threshold if Silero not available."""
    if not VAD_AVAILABLE or vad_model is None:
        return compute_rms(raw) > ENERGY_THRESHOLD
    
    try:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        tensor = torch.from_numpy(samples)
        # Silero VAD expects 16kHz, 512 sample windows
        for i in range(0, len(tensor) - 512, 512):
            chunk = tensor[i:i+512]
            confidence = vad_model(chunk, 16000).item()
            if confidence > 0.5:
                return True
        return False
    except Exception:
        return compute_rms(raw) > ENERGY_THRESHOLD


def pcm_to_wav_bytes(pcm: bytes) -> bytes:
    """Convert raw PCM to WAV format in memory."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        with wave.open(tmp.name, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm)
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)


def play_wav(path: str, device: str, oww_model=None, conn=None):
    """Play a WAV file via aplay. During playback, record mic chunks and send to Node for keyword detection."""
    INTERRUPT_KEYWORDS = ['stop', 'arrête', 'tais-toi', 'ta gueule', 'attend', 'attends', 'diva', 'hey jarvis']
    KEYWORD_CHUNK_S = 1.5  # Record 1.5s chunks for keyword detection
    
    print(f"[Wake] Playing {path}...", flush=True)
    try:
        play_proc = subprocess.Popen(
            ["aplay", "-D", "plughw:5", path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        
        if conn is None:
            # No connection for keyword check — just wait
            play_proc.wait()
            print("[Wake] Playback done", flush=True)
            return False
        
        # Open mic to listen during playback
        mic_listen = subprocess.Popen(
            ["arecord", "-D", device, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-q"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        
        barged = False
        play_start = time.time()
        chunk_bytes = int(KEYWORD_CHUNK_S * SAMPLE_RATE * 2)  # 1.5s of 16kHz 16-bit
        
        while play_proc.poll() is None:
            # Skip first 1.5s (speaker startup echo)
            if time.time() - play_start < 1.5:
                mic_listen.stdout.read(BYTES_PER_CHUNK)
                continue
            
            # Read 1.5s of audio
            raw = mic_listen.stdout.read(chunk_bytes)
            if not raw or len(raw) < chunk_bytes // 2:
                continue
            
            # Check RMS — only send to STT if there's actual sound
            audio = np.frombuffer(raw, dtype=np.int16).astype(float)
            rms = int((sum(x*x for x in audio) / len(audio)) ** 0.5)
            if rms < 3000:
                continue  # Too quiet, skip
            
            # Send to Node for keyword check via Groq STT
            wav_data = pcm_to_wav_bytes(raw)
            b64_audio = base64.b64encode(wav_data).decode("ascii")
            
            try:
                send_json(conn, {"type": "keyword_check", "data": b64_audio})
                response = recv_json(conn, timeout=3)
                if response and response.get("type") == "keyword_detected":
                    keyword = response.get("keyword", "")
                    print(f"[Wake] KEYWORD BARGE-IN! Detected '{keyword}' — Cutting playback...", flush=True)
                    play_proc.kill()
                    barged = keyword
                    break
            except Exception as e:
                print(f"[Wake] Keyword check error: {e}", flush=True)
        
        mic_listen.kill()
        mic_listen.wait()
        if not barged:
            play_proc.wait()
            print("[Wake] Playback done", flush=True)
        return barged  # False or keyword string
    except Exception as e:
        print(f"[Wake] Playback error: {e}", flush=True)
        return False

# ---------------------------------------------------------------------------
# TCP communication
# ---------------------------------------------------------------------------
def send_json(sock: socket.socket, data: dict):
    """Send a JSON line over TCP."""
    msg = json.dumps(data) + "\n"
    sock.sendall(msg.encode())


def recv_json(sock: socket.socket, timeout: float = 30.0) -> dict | None:
    """Receive a JSON line from TCP with timeout."""
    sock.settimeout(timeout)
    buf = b""
    try:
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                return None
            buf += chunk
            if b"\n" in buf:
                line, _ = buf.split(b"\n", 1)
                return json.loads(line.decode())
    except socket.timeout:
        print("[Wake] TCP recv timeout", flush=True)
        return None
    except Exception as e:
        print(f"[Wake] TCP recv error: {e}", flush=True)
        return None


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
# === SPEAKER REGISTRATION FLOW ===
REGISTRATION_PHRASES = [
    "Bonjour Diva, comment ça va ?",
    "Diva, quelle heure est-il ?",
    "Dis-moi la météo de demain",
]

def handle_speaker_registration(conn, device, model):
    """Interactive flow to register a new speaker voice."""
    import requests
    import base64
    import tempfile
    
    MEM0_URL = "http://localhost:9002"
    BEEP_PATH = "/opt/diva-embedded/assets/thinking.wav"  # Sound to indicate "speak now"
    
    def play_beep():
        """Play a beep to indicate user should speak."""
        try:
            subprocess.run(['aplay', '-D', device, BEEP_PATH], capture_output=True, timeout=3)
        except:
            pass
    
    print("[Register] Starting speaker registration flow", flush=True)
    
    # Step 1: Ask for name
    speak_tts("D'accord ! Comment tu t'appelles ?", device)
    play_beep()  # Signal to speak
    
    # Record response
    print("[Register] Recording name...", flush=True)
    audio_data = record_audio_chunk(device, duration=3.0)
    if not audio_data:
        speak_tts("Je n'ai pas entendu. On réessaie plus tard.", device)
        return None
    
    # Transcribe to get name
    print(f"[Register] Got {len(audio_data) if audio_data else 0} bytes of audio", flush=True)
    transcript = transcribe_audio(audio_data)
    print(f"[Register] Transcribed name: {transcript}", flush=True)
    if not transcript:
        speak_tts("Je n'ai pas compris. Réessayons plus tard.", device)
        return None
    
    # Extract name from transcript
    import re
    name_match = re.search(r"(?:je (?:m'appelle|suis)|c'est|moi c'est)\s+(\w+)", transcript.lower())
    if name_match:
        speaker_name = name_match.group(1).capitalize()
    else:
        # Use first word as name
        words = transcript.strip().split()
        speaker_name = words[0].capitalize() if words else "Inconnu"
    
    speak_tts(f"OK {speaker_name} ! Je vais te demander de répéter quelques phrases pour apprendre ta voix.", device)
    time.sleep(0.5)
    
    # Step 2: Collect samples
    samples = []
    for i, phrase in enumerate(REGISTRATION_PHRASES):
        speak_tts(f"Répète : {phrase}", device)
        play_beep()  # Signal to speak
        print(f"[Register] Recording phrase {i+1}/{len(REGISTRATION_PHRASES)}...", flush=True)
        
        # Record sample (longer for full phrase)
        audio_data = record_audio_chunk(device, duration=4.0)
        print(f"[Register] Got {len(audio_data) if audio_data else 0} bytes", flush=True)
        if audio_data:
            samples.append(audio_data)
            if i < len(REGISTRATION_PHRASES) - 1:
                speak_tts("Parfait !", device)
        else:
            speak_tts("Je n'ai pas entendu, on continue.", device)
    
    if len(samples) < 2:
        speak_tts("Pas assez d'échantillons. Réessayons plus tard.", device)
        return None
    
    # Step 3: Register with WeSpeaker
    speak_tts("Je traite tes échantillons...", device)
    
    print(f"[Register] Processing {len(samples)} samples for {speaker_name}", flush=True)
    success = False
    for idx, sample in enumerate(samples):
        try:
            print(f"[Register] Sending sample {idx+1} ({len(sample)} bytes)...", flush=True)
            # sample is already WAV data from arecord, encode directly
            audio_b64 = base64.b64encode(sample).decode()
            
            # Register
            print(f"[Register] Calling API for {speaker_name.lower()}...", flush=True)
            resp = requests.post(f"{MEM0_URL}/speaker/register", json={
                "name": speaker_name.lower(),
                "audio": audio_b64
            }, timeout=30)
            
            print(f"[Register] API response: {resp.status_code}", flush=True)
            if resp.ok:
                print(f"[Register] Success! {resp.text}", flush=True)
                success = True
                break
            else:
                print(f"[Register] API error: {resp.text}", flush=True)
        except Exception as e:
            print(f"[Register] Exception: {e}", flush=True)
    
    if success:
        speak_tts(f"C'est bon {speaker_name} ! Je te reconnaîtrai maintenant.", device)
        return speaker_name
    else:
        speak_tts("Il y a eu un problème. Réessayons plus tard.", device)
        return None

def record_audio_chunk(device, duration=3.0):
    """Record a short audio chunk for registration."""
    import subprocess
    import tempfile
    
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp_path = f.name
    
    try:
        subprocess.run([
            'arecord', '-D', device, '-f', 'S16_LE', '-r', '16000', '-c', '1',
            '-d', str(int(duration)), tmp_path
        ], capture_output=True, timeout=duration + 2)
        
        with open(tmp_path, 'rb') as f:
            return f.read()
    except Exception as e:
        print(f"[Record] Error: {e}")
        return None
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

def write_wav(path, pcm_data):
    """Write PCM data to WAV file."""
    import wave
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(pcm_data)


def main():
    # Step 1: Detect hardware
    device = detect_respeaker_card()

    # Step 2: Ensure model is downloaded
    model_path = ensure_model()

    # Step 3: Load OpenWakeWord model
    print("[Wake] Loading wake word model...", flush=True)
    try:
        from openwakeword.model import Model
    except ImportError:
        print("[Wake] ERROR: openwakeword not installed. Run: pip3 install openwakeword", flush=True)
        sys.exit(1)

    # Ensure embedding/melspectrogram ONNX models are available
    try:
        import openwakeword
        pkg_dir = os.path.dirname(openwakeword.__file__)
        res_dir = os.path.join(pkg_dir, "resources", "models")
        os.makedirs(res_dir, exist_ok=True)
        # Download onnx feature models and copy over tflite names (openwakeword defaults to tflite)
        for feat in ["melspectrogram", "embedding_model"]:
            onnx_path = os.path.join(res_dir, f"{feat}.onnx")
            tflite_path = os.path.join(res_dir, f"{feat}.tflite")
            # Download onnx if missing
            if not os.path.exists(onnx_path) or os.path.getsize(onnx_path) < 10000:
                url = f"https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/{feat}.onnx"
                print(f"[Wake] Downloading {feat}.onnx...", flush=True)
                urllib.request.urlretrieve(url, onnx_path)
            # Copy onnx over tflite so the default loader finds it
            import shutil
            shutil.copy2(onnx_path, tflite_path)
    except Exception as e:
        print(f"[Wake] Warning: could not ensure feature models: {e}", flush=True)

    model = Model(wakeword_model_paths=[model_path])
    loaded = list(model.models.keys()) if hasattr(model, 'models') else list(model.prediction_buffer.keys())
    print(f"[Wake] Models loaded: {loaded}", flush=True)
    if not loaded:
        print("[Wake] FATAL: No models loaded! Exiting.", flush=True)
        sys.exit(1)

    # Step 4: Connect to Node.js TCP server
    print(f"[Wake] Connecting to Node.js on {HOST}:{PORT}...", flush=True)
    max_retries = 30
    conn = None
    for attempt in range(max_retries):
        try:
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.connect((HOST, PORT))
            print(f"[Wake] Connected to Node.js", flush=True)
            break
        except ConnectionRefusedError:
            conn.close()
            conn = None
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                print(f"[Wake] Could not connect to Node.js after {max_retries} attempts", flush=True)
                sys.exit(1)

    # Step 5: Main loop
    mic_proc = None
    try:
        while True:
            # --- Wake word detection phase ---
            print("\n[Wake] Listening for wake word...", flush=True)
            mic_proc = open_mic(device)

            # Drain audio buffer + reset model to avoid stale embeddings
            # triggering false positives from previous detection
            print("[Wake] Draining audio buffer...", flush=True)
            drain_chunks = int(2.0 * SAMPLE_RATE / CHUNK_SAMPLES)
            for _ in range(drain_chunks):
                raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                if raw and len(raw) == BYTES_PER_CHUNK:
                    audio = np.frombuffer(raw, dtype=np.int16)
                    model.predict(audio)
            model.reset()
            print("[Wake] Buffer drained, ready.", flush=True)

            detected = False
            chunk_count = 0
            wake_listen_start = time.time()
            while not detected:
                raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                if not raw or len(raw) < BYTES_PER_CHUNK:
                    time.sleep(0.01)
                    continue

                chunk_count += 1
                if chunk_count == 1:
                    print(f"[Wake] First audio chunk received ({len(raw)} bytes)", flush=True)

                try:
                    audio = np.frombuffer(raw, dtype=np.int16)
                    prediction = model.predict(audio)
                except Exception as e:
                    print(f"[Wake] predict() error: {e}", flush=True)
                    import traceback
                    traceback.print_exc()
                    continue

                # Story 2.6: Check for dynamic threshold updates from Node.js
                check_threshold_file()

                # Use raw prediction scores (prediction_buffer saturates with custom models)
                for model_name in prediction:
                    raw_score = prediction[model_name]
                    if raw_score > 0.01:
                        print(f"[Wake] Score: {raw_score:.3f} (threshold={THRESHOLD})", flush=True)
                    if raw_score > THRESHOLD:
                        print(f"[Wake] *** WAKE WORD DETECTED *** (score={raw_score:.3f})", flush=True)
                        model.reset()
                        detected = True
                        break

            # --- Voice capture phase ---
            # Say "Oui?" instantly (pre-generated WAV)
            close_mic(mic_proc)
            # Play thinking chime immediately
            chime_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "thinking.wav")
            if os.path.exists(chime_path):
                subprocess.run(["aplay", "-D", "plughw:5", chime_path], timeout=2, env=dict(os.environ, PULSE_SERVER="unix:/var/run/pulse/native"))
            oui_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "oui.wav")
            subprocess.run(["aplay", "-D", "plughw:5", oui_path], timeout=3, env=dict(os.environ, PULSE_SERVER="unix:/var/run/pulse/native"))
            mic_proc = open_mic(device)
            print("[Wake] Recording voice...", flush=True)
            chunks = []
            last_voice_time = time.time()
            start_time = time.time()
            got_any_speech = False
            no_speech_timeout = False
            early_stt_sent = False
            early_stt_thread = None
            early_stt_result = [None]  # mutable container for thread result

            # CP#1 / FR: Anticipation — send early STT after 500ms of speech
            EARLY_STT_THRESHOLD_S = 0.5
            speech_start_time = None

            def send_early_stt(early_pcm):
                """Send partial audio to Groq for early intent detection."""
                try:
                    early_wav = pcm_to_wav_bytes(early_pcm)
                    import tempfile
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                        f.write(early_wav)
                        tmp = f.name
                    with open(tmp, "rb") as af:
                        resp = requests.post(
                            "https://api.groq.com/openai/v1/audio/transcriptions",
                            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                            files={"file": ("audio.wav", af, "audio/wav")},
                            data={"model": "whisper-large-v3", "language": "fr"},
                            timeout=10
                        )
                    os.unlink(tmp)
                    if resp.ok:
                        text = resp.json().get("text", "").strip()
                        if text and len(text) > 2:
                            early_stt_result[0] = text
                            print(f"[Wake] Early STT: '{text}'", flush=True)
                except Exception as e:
                    print(f"[Wake] Early STT error: {e}", flush=True)

            while True:
                raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                if not raw or len(raw) < BYTES_PER_CHUNK:
                    time.sleep(0.01)
                    continue

                chunks.append(raw)
                if is_speech_vad(raw):
                    last_voice_time = time.time()
                    if not got_any_speech:
                        speech_start_time = time.time()
                    got_any_speech = True

                now = time.time()
                elapsed = now - start_time
                silence_duration = now - last_voice_time

                # CP#1: Send early STT after 500ms of speech (in parallel)
                if (got_any_speech and not early_stt_sent
                    and speech_start_time
                    and now - speech_start_time >= EARLY_STT_THRESHOLD_S):
                    early_pcm = b"".join(chunks)
                    early_stt_thread = threading.Thread(
                        target=send_early_stt, args=(early_pcm,), daemon=True
                    )
                    early_stt_thread.start()
                    early_stt_sent = True
                    print(f"[Wake] Early STT sent ({len(early_pcm)} bytes, {now - speech_start_time:.1f}s of speech)", flush=True)

                if got_any_speech and silence_duration > SILENCE_TIMEOUT_S:
                    print(f"[Wake] Silence detected after {elapsed:.1f}s", flush=True)
                    break
                if not got_any_speech and elapsed > 3.0:
                    print(f"[Wake] No speech detected after 3s, giving up", flush=True)
                    no_speech_timeout = True
                    break
                if elapsed > MAX_RECORD_S:
                    print(f"[Wake] Max recording time reached ({MAX_RECORD_S}s)", flush=True)
                    break

            # Close mic before sending/playing
            close_mic(mic_proc)
            mic_proc = None

            # Check if we got enough audio
            pcm_data = b"".join(chunks)
            duration_s = len(pcm_data) / (SAMPLE_RATE * 2)
            print(f"[Wake] Captured {duration_s:.1f}s of audio ({len(pcm_data)} bytes)", flush=True)

            if duration_s < 0.3:
                print("[Wake] Audio too short, ignoring", flush=True)
                continue

            if no_speech_timeout:
                print("[Wake] No speech was detected, skipping transcription", flush=True)
                continue

            # Convert to WAV and send to Node.js
            wav_data = pcm_to_wav_bytes(pcm_data)
            b64_audio = base64.b64encode(wav_data).decode("ascii")

            # Play a filler phrase while waiting for LLM response
            import threading
            import random
            import glob

            def play_filler():
                FILLER_PHRASES = [
                    "Hmm, laisse-moi réfléchir...",
                    "Alors voyons voir...",
                    "Bonne question...",
                    "Attends deux secondes...",
                    "Je réfléchis...",
                    "Intéressant...",
                ]
                phrase = random.choice(FILLER_PHRASES)
                print(f"[Wake] Playing filler: {phrase}", flush=True)
                try:
                    subprocess.run(
                        f"echo '{phrase}' | /opt/piper/piper --model /opt/piper/fr_FR-siwis-medium.onnx --output_raw 2>/dev/null | aplay -D {device} -f S16_LE -r 22050 -c 1 -q",
                        shell=True, timeout=8
                    )
                except Exception as e:
                    print(f"[Wake] Filler error: {e}", flush=True)
                return
                filler_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "fillers")
                categories = ["casual", "factual"]
                mp3s = []
                for cat in categories:
                    mp3s.extend(glob.glob(os.path.join(filler_dir, cat, "*.mp3")))
                if not mp3s:
                    mp3s = glob.glob(os.path.join(filler_dir, "*.mp3"))
                if mp3s:
                    filler = random.choice(mp3s)
                    print(f"[Wake] Playing filler: {os.path.basename(filler)}", flush=True)
                    # Convert MP3 to WAV on the fly and play
                    subprocess.run(
                        f"ffmpeg -y -i '{filler}' -f wav -ar 16000 -ac 1 /tmp/filler.wav 2>/dev/null && aplay -D {device} /tmp/filler.wav",
                        shell=True, capture_output=True, timeout=10
                    )

            # filler_thread = threading.Thread(target=play_filler, daemon=True)
            # filler_thread.start()

            # CP#1: Wait for early STT thread to finish (max 2s)
            if early_stt_thread and early_stt_thread.is_alive():
                early_stt_thread.join(timeout=2)

            early_text = early_stt_result[0] if early_stt_result[0] else None
            if early_text:
                print(f"[Wake] Early STT available: '{early_text}'", flush=True)

            print("[Wake] Sending audio to Node.js...", flush=True)
            send_json(conn, {
                "type": "audio",
                "data": b64_audio,
                "early_stt": early_text,  # CP#1: Partial transcription for early intent routing
            })

            # Wait for response from Node.js
            print("[Wake] Waiting for response...", flush=True)
            response = recv_json(conn, timeout=60)

            # Wait for filler to finish before playing response
            # filler_thread.join(timeout=5)

            # Handle filler playback requests from Node.js
            while response and response.get("type") == "play_filler":
                filler_path = response.get("path", "")
                if filler_path:
                    mic_proc = play_filler_audio(filler_path, mic_proc)
                response = recv_json(conn, timeout=60)
            # Skip keyword detection messages (handled elsewhere)
            while response and response.get("type") in ("keyword_not_detected", "keyword_detected"):
                response = recv_json(conn, timeout=60)
            if response and response.get("type") == "shutdown":
                print("[Wake] Shutdown command — back to wake word", flush=True)
                continue
            if response and response.get("type") == "speaker_register":
                print("[Wake] Speaker registration flow starting...", flush=True)
                try:
                    handle_speaker_registration(conn, device, model)
                except Exception as e:
                    print(f"[Wake] Speaker registration error: {e}", flush=True)
                continue
            if response and response.get("type") == "speak":
                text = response.get("text", "")
                end_conversation = response.get("end", False)
                print(f"[Wake] Got speak: end={end_conversation}", flush=True)
                if text:
                    SHUTDOWN_KEYWORDS = ["ta gueule", "tais-toi", "ferme"]
                    
                    # Speak first sentence via TTS pipe (no file)
                    barged = speak_tts(text, device, oww_model=model, conn=conn)
                    # Play queued sentences (or detect shutdown)
                    got_shutdown = False
                    if not barged:
                        while True:
                            q = recv_json_buffered(conn, timeout=0.5)
                            if not q:
                                break
                            if q.get("type") == "shutdown":
                                got_shutdown = True
                                break
                            if q.get("type") == "speak_queue":
                                qtext = q.get("text", "")
                                if qtext:
                                    barged = speak_tts(qtext, device, oww_model=model, conn=conn)
                                    if barged:
                                        while True:
                                            d = recv_json_buffered(conn, timeout=0.5)
                                            if not d or d.get("type") == "play_done":
                                                break
                                        break
                            elif q.get("type") == "play_done":
                                break
                            else:
                                break
                    
                    # Check end flag from initial speak message (goodbye/shutdown)
                    if end_conversation:
                        print("[Wake] End conversation (goodbye) — back to wake word", flush=True)
                        try:
                            goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                            if os.path.exists(goodbye_path):
                                subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except: pass
                        continue  # Back to wake word

                    # Check if we got shutdown signal
                    if not got_shutdown:
                        next_msg = recv_json_buffered(conn, timeout=0.5)
                        if next_msg and next_msg.get("type") == "shutdown":
                            got_shutdown = True
                    if got_shutdown:
                        print("[Wake] Shutdown signal received — ending conversation", flush=True)
                        # Play goodbye sound
                        try:
                            goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                            if os.path.exists(goodbye_path):
                                subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except: pass
                        continue
                    
                    # If shutdown keyword detected via barge-in, go back to wake word
                    if barged and any(kw in str(barged).lower() for kw in SHUTDOWN_KEYWORDS):
                        print("[Wake] Shutdown keyword — ending conversation", flush=True)
                        # Play goodbye sound
                        try:
                            goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                            if os.path.exists(goodbye_path):
                                subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except: pass
                        continue
                    
                    # Check if conversation should end (goodbye/shutdown)
                    if end_conversation:
                        print("[Wake] End conversation flag — back to wake word", flush=True)
                        try:
                            goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                            if os.path.exists(goodbye_path):
                                subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        except: pass
                        continue  # Back to main wake word loop
                    
                    # Conversation loop — keep listening after each response
                    while True:
                        # After barge-in, reset flag (no "Oui?" in follow-up)
                        barged = False
                        print(f"[Wake] Follow-up mode ({FOLLOW_UP_TIMEOUT_S}s)...", flush=True)
                        close_mic(mic_proc)  # Close mic BEFORE playing sound
                        # Play notification sound to indicate user can speak
                        try:
                            notify_path = os.path.join(os.path.dirname(__file__), "..", "assets", "thinking.wav")
                            if os.path.exists(notify_path):
                                print(f"[Wake] Playing follow-up notification...", flush=True)
                                subprocess.run(["aplay", "-D", "plughw:5", notify_path], timeout=2)
                                print(f"[Wake] Ready to listen", flush=True)
                        except Exception as e:
                            print(f"[Wake] Notification sound error: {e}", flush=True)
                        mic_proc = open_mic(device)
                        # Flush 1s of audio buffer (discard barge-in residual)
                        flush_end = time.time() + 0.8
                        while time.time() < flush_end:
                            mic_proc.stdout.read(BYTES_PER_CHUNK)
                        follow_start = time.time()
                        follow_chunks = []
                        follow_silence_start = None
                        got_speech = False
                        
                        while time.time() - follow_start < FOLLOW_UP_TIMEOUT_S + 30:
                            raw = mic_proc.stdout.read(BYTES_PER_CHUNK)
                            if not raw or len(raw) < BYTES_PER_CHUNK:
                                time.sleep(0.01)
                                continue
                            follow_chunks.append(raw)
                            rms = int((sum(x*x for x in np.frombuffer(raw, dtype=np.int16).astype(float)) / len(np.frombuffer(raw, dtype=np.int16))) ** 0.5)
                            if rms > ENERGY_THRESHOLD:
                                got_speech = True
                                follow_silence_start = None
                            else:
                                if got_speech and follow_silence_start is None:
                                    follow_silence_start = time.time()
                                elif got_speech and follow_silence_start and time.time() - follow_silence_start > SILENCE_TIMEOUT_S:
                                    print("[Wake] Follow-up captured!", flush=True)
                                    break
                                elif not got_speech and time.time() - follow_start > FOLLOW_UP_TIMEOUT_S:
                                    print("[Wake] No follow-up detected, back to wake word", flush=True)
                                    # Play goodbye sound
                                    try:
                                        goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                                        if os.path.exists(goodbye_path):
                                            subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                    except: pass
                                    follow_chunks = []
                                    break
                        
                        # No speech detected — exit conversation
                        if not follow_chunks or not got_speech:
                            break
                        
                        # Process follow-up audio
                        close_mic(mic_proc)
                        mic_proc = None
                        pcm_data = b"".join(follow_chunks)
                        duration_s = len(pcm_data) / (SAMPLE_RATE * 2)
                        print(f"[Wake] Follow-up: {duration_s:.1f}s ({len(pcm_data)} bytes)", flush=True)
                        
                        if duration_s < 0.3:
                            break
                        
                        wav_data = pcm_to_wav_bytes(pcm_data)
                        b64_audio = base64.b64encode(wav_data).decode("ascii")
                        # filler_thread = threading.Thread(target=play_filler, daemon=True)
                        # filler_thread.start()
                        send_json(conn, {"type": "audio", "data": b64_audio})
                        resp2 = recv_json(conn, timeout=15)
                        # filler_thread.join(timeout=5)
                        
                        while resp2 and resp2.get("type") == "play_filler":
                            filler_path = resp2.get("path", "")
                            if filler_path:
                                mic_proc = play_filler_audio(filler_path, mic_proc)
                            resp2 = recv_json(conn, timeout=15)
                        if resp2 and resp2.get("type") == "shutdown":
                            print("[Wake] Shutdown command — ending conversation", flush=True)
                            # Play goodbye sound
                            try:
                                goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                                if os.path.exists(goodbye_path):
                                    subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            except: pass
                            break
                        if resp2 and resp2.get("type") == "speak":
                            text2 = resp2.get("text", "")
                            end_convo2 = resp2.get("end", False)
                            print(f"[Wake] Follow-up speak: end={end_convo2}", flush=True)
                            if text2:
                                barged2 = speak_tts(text2, device, oww_model=model, conn=conn)
                                # Check if this was a goodbye
                                if barged2 == "GOODBYE":
                                    print("[Wake] Goodbye spoken — back to wake word", flush=True)
                                    try:
                                        goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                                        if os.path.exists(goodbye_path):
                                            subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                    except: pass
                                    break
                                # Check if conversation should end
                                if end_convo2:
                                    print("[Wake] End flag in follow-up — back to wake word", flush=True)
                                    try:
                                        goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                                        if os.path.exists(goodbye_path):
                                            subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                    except: pass
                                    break  # Exit follow-up loop
                                # Play queued sentences
                                if not barged2:
                                    while True:
                                        q2 = recv_json_buffered(conn, timeout=0.5)
                                        if not q2:
                                            break
                                        if q2.get("type") == "speak_queue":
                                            qt = q2.get("text", "")
                                            if qt:
                                                barged2 = speak_tts(qt, device, oww_model=model, conn=conn)
                                                if barged2:
                                                    while True:
                                                        d2 = recv_json_buffered(conn, timeout=0.5)
                                                        if not d2 or d2.get("type") == "play_done":
                                                            break
                                                    break
                                        elif q2.get("type") == "play_done":
                                            print("[Wake] Received play_done, going to follow-up", flush=True)
                                            break
                                        else:
                                            break
                                if barged2 and any(kw in str(barged2).lower() for kw in SHUTDOWN_KEYWORDS):
                                    print("[Wake] Shutdown keyword — ending conversation", flush=True)
                                    break
                                barged = barged2  # Pass keyword so "Oui?" plays
                                # Otherwise loop back to follow-up
                            else:
                                break
                        elif resp2 and resp2.get("type") == "error":
                            print(f"[Wake] Node.js error: {resp2.get('message', 'unknown')}", flush=True)
                            break
                        else:
                            break
                    continue
                else:
                    print(f"[Wake] WAV file not found: {wav_path}", flush=True)
            elif response and response.get("type") == "error":
                print(f"[Wake] Node.js error: {response.get('message', 'unknown')}", flush=True)
            elif response and response.get("type") == "play_done":
                # play_done arrived before speak — keep waiting
                print("[Wake] Got play_done early, waiting for speak...", flush=True)
                response = recv_json_buffered(conn, timeout=5.0)
                if response and response.get("type") == "speak":
                    text = response.get("text", "")
                    if text:
                        barged = speak_tts(text, device, oww_model=model, conn=conn)
                        if barged == "GOODBYE":
                            print("[Wake] Goodbye spoken — back to wake word", flush=True)
                            try:
                                goodbye_path = os.path.join(os.path.dirname(__file__), "..", "assets", "goodbye.wav")
                                if os.path.exists(goodbye_path):
                                    subprocess.run(["aplay", "-D", "plughw:5", goodbye_path], timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            except: pass
                            continue
                else:
                    print(f"[Wake] Still no speak after play_done: {response}", flush=True)
            else:
                print(f"[Wake] Unexpected response: {response}", flush=True)

    except KeyboardInterrupt:
        print("\n[Wake] Interrupted by user", flush=True)
    except BrokenPipeError:
        print("[Wake] Node.js disconnected", flush=True)
    except Exception as e:
        print(f"[Wake] Fatal error: {e}", flush=True)
    finally:
        close_mic(mic_proc)
        if conn:
            conn.close()
        print("[Wake] Server stopped", flush=True)


if __name__ == "__main__":
    main()


    main()