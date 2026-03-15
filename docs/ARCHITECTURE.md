# Architecture Technique - Diva Embedded

Documentation complète de l'architecture du système Diva Embedded fonctionnant sur Rock 5B+.

## 🏗️ Vue d'ensemble

Diva Embedded est un assistant vocal complet fonctionnant localement sur Rock 5B+ avec des appels API cloud pour l'IA. Le système combine détection de wake word local, STT cloud, LLM cloud, et TTS local.

### Composants principaux

1. **Python Wake Word Server** - Détection continue + capture audio
2. **Node.js API Server** - Orchestration STT/LLM/TTS  
3. **Piper TTS** - Synthèse vocale locale (français)
4. **OpenWakeWord** - Détection wake word local
5. **Services Cloud** - Groq STT + Anthropic Claude

## 📊 Diagramme du Flow Complet

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   ReSpeaker     │    │  Rock 5B+ SoC   │    │  Services Cloud │
│   USB Mic       │    │  (ARM64/8GB)    │    │   (Internet)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │ Audio Stream          │                       │
         │ (16kHz/16bit)         │                       │
         ▼                       │                       │
┌─────────────────────────────────────────┐              │
│           PYTHON LAYER                  │              │
│  ┌─────────────────────────────────────┐ │              │
│  │        OpenWakeWord                 │ │              │
│  │   ┌─────────────────────────────┐   │ │              │
│  │   │    hey_jarvis_v0.1.onnx     │   │ │              │
│  │   │      (Threshold: 0.5)       │   │ │              │
│  │   └─────────────────────────────┘   │ │              │
│  │              │                      │ │              │
│  │              ▼                      │ │              │
│  │    [WAKE WORD DETECTED]            │ │              │
│  │              │                      │ │              │
│  │              ▼                      │ │              │
│  │   ┌─────────────────────────────┐   │ │              │
│  │   │      Voice Capture          │   │ │              │
│  │   │   • Energy threshold: 500   │   │ │              │
│  │   │   • Silence timeout: 2.5s   │   │ │              │
│  │   │   • Max record: 30s         │   │ │              │
│  │   └─────────────────────────────┘   │ │              │
│  └─────────────────────────────────────┘ │              │
│                    │                      │              │
│                    ▼                      │              │
│         [PCM → WAV → Base64]             │              │
└─────────────────┬───────────────────────────────────────┘
                  │ TCP Socket (port 9001)
                  │ JSON: {"type":"audio", "data":"base64..."}
                  ▼
┌─────────────────────────────────────────┐              │
│            NODE.JS LAYER                │              │
│  ┌─────────────────────────────────────┐ │              │
│  │        Audio Processing             │ │              │
│  │   ┌─────────────────────────────┐   │ │              │
│  │   │    Base64 → WAV File        │   │ │              │
│  │   │  /tmp/audio_XXXXXX.wav      │   │ │              │
│  │   └─────────────────────────────┘   │ │              │
│  └─────────────────────────────────────┘ │              │
│                    │                      │              │
│                    ▼                      │              │
│  ┌─────────────────────────────────────┐ │              │
│  │         STT (Speech-to-Text)        │ │              │
│  │   ┌─────────────────────────────┐   │ │     ┌─────────┤
│  │   │       Groq Whisper-v3       │   │ │────▶│ Groq API│
│  │   │    GROQ_API_KEY required    │   │ │     │  Cloud  │
│  │   │      Format: WAV/MP3        │   │ │◀────┤   STT   │
│  │   └─────────────────────────────┘   │ │     └─────────┤
│  └─────────────────────────────────────┘ │              │
│                    │                      │              │
│                    ▼                      │              │
│              [Text Query]                │              │
│                    │                      │              │
│                    ▼                      │              │
│  ┌─────────────────────────────────────┐ │              │
│  │          LLM Processing             │ │              │
│  │   ┌─────────────────────────────┐   │ │     ┌─────────┤
│  │   │      Anthropic Claude       │   │ │────▶│Anthropic│
│  │   │  ANTHROPIC_API_KEY required │   │ │     │ Claude  │
│  │   │     + System Prompt         │   │ │◀────┤   API   │
│  │   │     + Memory Context        │   │ │     └─────────┤
│  │   └─────────────────────────────┘   │ │              │
│  └─────────────────────────────────────┘ │              │
│                    │                      │              │
│                    ▼                      │              │
│             [Response Text]              │              │
│                    │                      │              │
│                    ▼                      │              │
│  ┌─────────────────────────────────────┐ │              │
│  │         TTS (Text-to-Speech)        │ │              │
│  │   ┌─────────────────────────────┐   │ │              │
│  │   │        Piper HTTP API       │   │ │              │
│  │   │    POST localhost:8880      │   │ │              │
│  │   │  /synthesize {"text":"..."}  │   │ │              │
│  │   └─────────────────────────────┘   │ │              │
│  └─────────────────────────────────────┘ │              │
│                    │                      │              │
│                    ▼                      │              │
│              [WAV file path]             │              │
└─────────────────┬───────────────────────────────────────┘
                  │ TCP Response
                  │ JSON: {"type":"play", "path":"/tmp/..."}
                  ▼
┌─────────────────────────────────────────┐
│           PYTHON AUDIO OUT              │
│  ┌─────────────────────────────────────┐ │
│  │            aplay                    │ │
│  │   ┌─────────────────────────────┐   │ │
│  │   │     WAV File Playback       │   │ │
│  │   │    via ALSA (auto device)   │   │ │
│  │   │   Speaker/Headphones/USB    │   │ │
│  │   └─────────────────────────────┘   │ │
│  └─────────────────────────────────────┘ │
│                    │                      │
│                    ▼                      │
│        [Audio played to user]            │
│                    │                      │
│                    ▼                      │
│      [Return to wake word listening]     │
└─────────────────────────────────────────┘
```

## 🔧 Configuration et Paramètres

### Wake Word Detection
```python
# Modèle: hey_jarvis_v0.1.onnx
THRESHOLD = 0.5           # Seuil de confiance (0.0-1.0)
SAMPLE_RATE = 16000       # Fréquence échantillonnage (Hz)
CHUNK_SAMPLES = 1280      # Échantillons par chunk (80ms)
BYTES_PER_CHUNK = 2560    # Bytes par chunk (16-bit)
```

### Voice Capture
```python
ENERGY_THRESHOLD = 500    # Seuil RMS pour VAD
SILENCE_TIMEOUT_S = 2.5   # Timeout silence (secondes)
MAX_RECORD_S = 30         # Durée max enregistrement
```

### Communication TCP
```python
HOST = "127.0.0.1"        # Interface locale seulement
PORT = 9001               # Port de communication
```

### TTS Configuration
```javascript
TTS_BASE_URL = "http://localhost:8880"  # Piper HTTP server
MODEL = "fr_FR-siwis-medium.onnx"       # Modèle français
```

## 🗂️ Description des Fichiers

### Structure du projet
```
diva-embedded/
├── src/                          # Code source TypeScript
│   ├── index.ts                  # Point d'entrée Node.js
│   ├── audio/                    # Gestion audio
│   │   ├── recorder.ts           # Interface enregistrement
│   │   ├── player.ts             # Lecture audio
│   │   └── aec.ts                # Echo cancellation
│   ├── wake/                     # Wake word
│   │   ├── wakeword.ts           # Interface wake word
│   │   └── keywords.ts           # Configuration mots-clés
│   ├── stt/                      # Speech-to-Text
│   │   ├── groq-cloud.ts         # Client Groq API
│   │   └── whisper-local.ts      # Whisper local (future)
│   ├── llm/                      # Large Language Model
│   │   ├── claude.ts             # Client Anthropic
│   │   ├── tools.ts              # Outils/fonctions
│   │   ├── system-prompt.ts      # Prompt système
│   │   └── filler-manager.ts     # Sons d'attente
│   ├── tts/                      # Text-to-Speech
│   │   └── piper.ts              # Client Piper
│   ├── memory/                   # Gestion mémoire
│   │   ├── manager.ts            # Manager principal
│   │   └── embeddings.ts         # Embeddings vectoriels
│   ├── state/                    # Machine d'état
│   │   └── machine.ts            # State machine
│   └── tools/                    # Outils externes
│       ├── web-scrape.ts         # Web scraping
│       ├── brave-search.ts       # Recherche Brave
│       └── memory-tool.ts        # Outils mémoire
├── python/                       # Serveur Python
│   └── wakeword_server.py        # Serveur wake word + audio
├── dist/                         # Code compilé (généré)
│   └── index.js                  # Point d'entrée compilé
├── assets/                       # Ressources
│   └── audio/                    # Fichiers audio
│       └── acknowledgment.wav    # Son "Oui ?" 
├── models/                       # Modèles IA (téléchargés)
│   └── hey_jarvis_v0.1.onnx      # Modèle wake word
├── data/                         # Données runtime
│   └── memory/                   # Cache mémoire/embeddings
├── .env                          # Configuration (clés API)
├── package.json                  # Dépendances Node.js
└── tsconfig.json                 # Configuration TypeScript
```

### Fichiers systemd
```
/etc/systemd/system/
├── diva-embedded.service         # Service principal Node.js
└── piper-tts.service             # Service Piper TTS HTTP

/opt/piper/
├── piper/piper                   # Binaire Piper ARM64
├── voices/                       # Modèles vocaux
│   ├── fr_FR-siwis-medium.onnx   # Modèle français
│   └── fr_FR-siwis-medium.onnx.json
└── piper_http_server.py          # Serveur HTTP Flask
```

## ⚡ Pipeline Audio Détaillé

### 1. Capture Continue (Wake Word Loop)
```python
# Ouverture microphone
mic_proc = subprocess.Popen([
    "arecord", "-D", "plughw:5",     # Device ReSpeaker
    "-f", "S16_LE",                  # Format 16-bit little-endian
    "-r", "16000",                   # Échantillonnage 16kHz
    "-c", "1",                       # Mono
    "-t", "raw"                      # Raw PCM output
], stdout=subprocess.PIPE)

# Lecture chunks 80ms (1280 samples)
while not_detected:
    raw = mic_proc.stdout.read(2560)  # 1280 samples * 2 bytes
    audio = np.frombuffer(raw, dtype=np.int16)
    prediction = model.predict(audio)
    
    if prediction["hey_jarvis"] > 0.5:
        wake_word_detected = True
```

### 2. Voice Capture (Post Wake Word)
```python
# Capture jusqu'au silence
chunks = []
last_voice_time = time.time()

while recording:
    raw = mic_proc.stdout.read(2560)
    chunks.append(raw)
    
    # VAD (Voice Activity Detection)
    rms = compute_rms(raw)
    if rms > ENERGY_THRESHOLD:
        last_voice_time = time.time()
    
    # Arrêt si silence > 2.5s
    if time.time() - last_voice_time > 2.5:
        break

# Conversion PCM → WAV → Base64
pcm_data = b"".join(chunks)
wav_data = pcm_to_wav_bytes(pcm_data)
b64_audio = base64.b64encode(wav_data)
```

### 3. Communication IPC
```python
# Python → Node.js (TCP JSON)
message = {
    "type": "audio",
    "data": b64_audio.decode("ascii"),
    "duration": len(pcm_data) / (16000 * 2),
    "timestamp": time.time()
}
send_json(tcp_socket, message)

# Node.js → Python (réponse)
response = {
    "type": "play",
    "path": "/tmp/response_12345.wav",
    "text": "Voici la réponse à votre question"
}
```

### 4. Processing Node.js
```typescript
// Réception audio
const audioBuffer = Buffer.from(audioData, 'base64');
const tempFile = `/tmp/audio_${Date.now()}.wav`;
fs.writeFileSync(tempFile, audioBuffer);

// STT via Groq
const transcription = await groqClient.transcribe(tempFile);

// LLM via Anthropic
const response = await claudeClient.chat(transcription, context);

// TTS via Piper
const audioResponse = await piperClient.synthesize(response);
```

## 🔄 Machine d'État

```
     ┌─────────────┐
     │   STARTUP   │
     └──────┬──────┘
            │
            ▼
     ┌─────────────┐
     │  LISTENING  │◀─┐
     │ (Wake Word) │  │
     └──────┬──────┘  │
            │         │
    ┌───────▼─────────┤
    │  WAKE DETECTED  │
    └──────┬──────────┘
           │
           ▼
    ┌─────────────┐
    │ RECORDING   │
    │  (Voice)    │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │ PROCESSING  │
    │ STT→LLM→TTS │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  PLAYING    │
    │ (Response)  │
    └──────┬──────┘
           │
           └─────────────┘
```

### États et Timeouts
- **LISTENING**: Infini (jusqu'au wake word)
- **WAKE_DETECTED**: Immédiat (transition instantanée)
- **RECORDING**: 30s max, arrêt auto au silence (2.5s)
- **PROCESSING**: 60s timeout API
- **PLAYING**: Jusqu'à fin du fichier audio

## 🌐 APIs Externes

### Groq (STT)
```bash
curl -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@audio.wav" \
  -F "model=whisper-large-v3" \
  -F "language=fr"
```

### Anthropic Claude
```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1000,
    "system": "Tu es Diva, un assistant vocal...",
    "messages": [{"role": "user", "content": "..."}]
  }'
```

### Piper TTS (Local)
```bash
curl -X POST "http://localhost:8880/synthesize" \
  -H "Content-Type: application/json" \
  -d '{"text": "Bonjour, comment allez-vous ?"}'
# Retourne: {"audio_file": "uuid.wav"}

curl "http://localhost:8880/audio/uuid.wav" > response.wav
```

## ⚙️ Optimisations Performances

### CPU/Mémoire (RK3588)
- **OpenWakeWord**: Utilise 1 cœur ARM (~10-15% CPU)
- **Node.js**: Event loop single-thread + worker threads
- **Piper TTS**: ~2-3s pour générer 10s audio
- **Mémoire**: ~200MB total en fonctionnement

### I/O Optimizations
- **Audio streaming**: Chunks 80ms pour faible latence
- **TCP keepalive**: Connexion persistante Python↔Node
- **Fichiers temporaires**: Nettoyage automatique
- **Cache mémoire**: Embeddings vectoriels persistants

### Réseau
- **APIs cloud**: Timeout 60s, retry automatique
- **Piper local**: Pas de limitation réseau
- **Bandwidth**: ~50KB/requête STT, ~100KB réponse LLM

## 🔧 Configuration Avancée

### Fine-tuning Wake Word
```python
# Ajuster la sensibilité
THRESHOLD = 0.3  # Plus sensible (plus de faux positifs)
THRESHOLD = 0.7  # Moins sensible (moins de détections)

# Buffer de prédiction
PREDICTION_BUFFER_SIZE = 30  # Historique pour stabilité
```

### Memory Management
```typescript
// Configuration mémoire embeddings
export const MEMORY_CONFIG = {
  maxChunkSize: 1000,      // Taille max chunk de texte
  overlapSize: 200,        // Chevauchement chunks
  embeddingDim: 1536,      // Dimension embeddings
  maxMemories: 1000        // Max souvenirs stockés
};
```

### Système de Logs
```bash
# Logs structurés
journalctl -u diva-embedded -o json | jq '.MESSAGE'

# Monitoring temps réel
tail -f /var/log/syslog | grep -E "(diva|piper|wake)"

# Métriques audio
grep "RMS energy" /var/log/syslog | tail -20
```

Cette architecture modulaire permet une maintenance facile et des extensions futures (STT local, autres modèles LLM, etc.).