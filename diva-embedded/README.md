# Diva Embedded

Assistant vocal intelligent et adaptatif tournant sur **Rock 5B+** (RK3588). Diva reconnaît ses utilisateurs par leur voix, adapte sa personnalité à chacun, et fonctionne en quasi-autonomie avec un pipeline 100% local sauf le LLM.

## Architecture

```
ReSpeaker 2-Mic (USB-C)
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  diva-audio (Python FastAPI, port 9010)             │
│  Wake Word (OpenWakeWord) → VAD → Enregistrement    │
└──────────────┬──────────────────────────────────────┘
               ▼
┌──────────────────────────┐
│  STT — SenseVoice NPU   │ ← port 8881
│  (local, accéléré NPU)  │
└──────────────┬───────────┘
               ▼
┌──────────────────────────┐    ┌──────────────────────┐
│  Intent Router           │───▶│  Qwen 2.5 NPU       │ ← port 8080
│  (regex + LLM, port 8882)│    │  (RKLLaMA, classif.) │
└──────────┬───────────────┘    └──────────────────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌─────────┐  ┌──────────────────┐
│  Local  │  │  Claude Haiku    │
│  Handler│  │  (API Anthropic) │
│         │  │  Streaming +     │
│  Heure  │  │  Tool Use        │
│  Météo  │  └────────┬─────────┘
│  Timer  │           │
│  Radio  │     ┌─────┴──────────────────────┐
│  Blague │     │  Tools : recherche web,    │
│  DND    │     │  mémoire, musique, agenda, │
│  ...    │     │  rappels, liste courses,   │
└─────────┘     │  journal, domotique...     │
                └─────┬──────────────────────┘
                      ▼
            ┌──────────────────┐
            │  Piper TTS       │ ← port 8880
            │  (fr_FR, RKNN)   │
            └──────────────────┘
                      ▼
                  🔊 Speaker
```

## Stack Technique

| Composant | Technologie | Port |
|-----------|-------------|------|
| **Orchestrateur** | Node.js 22 + TypeScript | 3001 |
| **Audio** | Python FastAPI (wake word, VAD, enregistrement, playback) | 9010 |
| **Wake Word** | OpenWakeWord (modèle custom "Diva") | — |
| **STT** | SenseVoice NPU (local) | 8881 |
| **LLM principal** | Claude Haiku 4.5 (streaming + tool use) | API |
| **LLM local** | Qwen 2.5 via RKLLaMA (classification d'intent) | 8080 |
| **TTS** | Piper (fr_FR-siwis-medium, décodeur RKNN) | 8880 |
| **Mémoire** | Mem0 + WeSpeaker (identification vocale) | 9002 |
| **Embeddings** | MiniLM | 8883 |
| **Recherche** | SearXNG (self-hosted) | 8888 |
| **Intent Router** | Regex + Qwen NPU | 8882 |

## Hardware

- **SBC** : Rock 5B+ (Rockchip RK3588, NPU 6 TOPS, 16 GB RAM)
- **Audio** : ReSpeaker Lite 2-Mic (USB-C)
- **Stockage** : NVMe

## Fonctionnalités

### Core
- **Reconnaissance vocale par speaker** — identifie qui parle via WeSpeaker
- **Personas adaptatifs** — personnalité, ton et comportement ajustés par utilisateur
- **Onboarding interactif** — découverte progressive de chaque nouvel utilisateur
- **Multi-turn conversationnel** — conversations à plusieurs échanges avec suivi de contexte
- **Intent routing hybride** — réponses locales ultra-rapides (heure, météo, timer) + Claude pour le reste

### Outils (Claude Tool Use)
- 🔍 Recherche web (SearXNG)
- 🧠 Mémoire persistante (lecture/écriture par utilisateur)
- 🎵 Musique (Spotify, YouTube, radio)
- 📅 Agenda Google Calendar
- ⏰ Rappels et timers
- 🛒 Liste de courses
- 📝 Journal de vie
- 🏠 Domotique Home Assistant
- 📧 Envoi de messages (email)
- 🎮 Gamification (streaks, badges)
- 🌙 Ambiance sonore

### Accompagnement (module elderly/companion)
- Détection de détresse vocale
- Suivi de médication
- Exercices cognitifs
- Détection de répétitions
- Notifications proactives
- Sécurité nocturne
- Milestones et capsules temporelles

## Structure du Projet

```
src/
├── index.ts                    # Boucle principale : wake → record → STT → intent → LLM → TTS
├── audio/                      # Client audio, fillers, lock
├── calendar/                   # Intégration Google Calendar
├── companion/                  # Ambient, gamification, journal, milestones, sécurité
├── dashboard/                  # Dashboard web de monitoring
├── elderly/                    # Modules d'accompagnement senior
├── llm/                        # Claude streaming, system prompt, tools, Qwen local
├── memory/                     # Gestionnaire mémoire
├── messaging/                  # Envoi de messages
├── music/                      # Spotify, YouTube, outil musique
├── persona/                    # Moteur de personnalité, onboarding, registration
├── routing/                    # Intent router (regex + LLM)
├── smarthome/                  # Home Assistant connector, notifications, présence
├── stt/                        # STT local NPU, Groq cloud (fallback)
├── tools/                      # Tous les outils Claude (recherche, timer, radio, etc.)
└── tts/                        # Synthèse vocale Piper

python/
├── diva_audio_server.py        # Serveur audio FastAPI (wake word, VAD, record, playback)
├── intent-router.py            # Classification d'intent (regex + Qwen)
├── memory-service.py           # Service mémoire Mem0 + speaker ID
├── speaker_identification.py   # Identification vocale WeSpeaker
└── wakeword_server.py          # Serveur wake word OpenWakeWord

assets/                         # Sons (fillers, wake, goodbye), modèle wake word
data/personas/                  # Fichiers de personnalité par utilisateur
scripts/                        # Scripts de déploiement et installation
models/                         # Modèles ML (wake word)
```

## Services Systemd

```bash
# Service principal
systemctl status diva-embedded    # Orchestrateur Node.js

# Services dépendants (démarrés séparément)
systemctl status diva-audio       # Serveur audio Python
systemctl status piper-tts        # TTS Piper
systemctl status sensevoice       # STT NPU
systemctl status rkllama          # Qwen NPU (RKLLaMA)
systemctl status diva-memory      # Service mémoire
systemctl status intent-router    # Router d'intent
systemctl status searxng          # Recherche web
```

## Installation

```bash
# 1. Cloner le repo
git clone https://github.com/DamiC0de/diva-embedded.git /opt/diva-embedded
cd /opt/diva-embedded

# 2. Installer les dépendances
npm install

# 3. Configurer
cp .env.example .env
# Éditer .env avec vos clés API

# 4. Compiler
npm run build

# 5. Lancer
npm start
```

## Configuration

Copier `.env.example` vers `.env` et renseigner :

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Clé API Anthropic (Claude) |
| `GROQ_API_KEY` | Clé API Groq (STT fallback) |
| `BRAVE_API_KEY` | Clé API Brave Search |
| `LLM_MODEL` | Modèle Claude (défaut: claude-haiku-4-5-20251001) |
| `HA_URL` / `HA_TOKEN` | Home Assistant (optionnel) |
| `AUDIO_INPUT_DEVICE` | Device audio ALSA |

## Licence

Private — © 2026
