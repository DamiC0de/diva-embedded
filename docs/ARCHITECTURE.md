# Architecture Diva Embedded — Rock 5B+

> **Dernière mise à jour :** 16 mars 2026
> **Hardware :** Rock 5B+ (RK3588, 16GB RAM, NVMe 128GB, Armbian Trixie)
> **Audio :** ReSpeaker Lite 2-Mic USB-C (ALSA Card 5)

---

## Vue d'ensemble

Diva est un assistant vocal embarqué qui utilise les 3 cores NPU du RK3588 (6 TOPS total) pour le TTS, le LLM local et les embeddings, avec un fallback cloud (Groq STT + Claude Haiku) pour les tâches complexes.

---

## NPU — 3 Cores × 2 TOPS

| Core | Composant | Modèle | Format | Latence | Service | Port |
|------|-----------|--------|--------|---------|---------|------|
| **Core 0** | Piper TTS Decoder | `decoder_110.rknn` | RKNN | RTF 0.089 (~100ms/phrase) | `npu-tts` | 8880 |
| **Core 1** | Qwen2.5-0.5B LLM | via RKLLaMA | RKLLM Q8 | ~360ms warm | `rkllama` | 8080 |
| **Core 2** | Embeddings Mem0 | `all-MiniLM-L6-v2` | RKNN (rk-transformers) | ~280ms/batch | `npu-embeddings` | 8883 |

### Détails NPU

- **Piper TTS** : L'encoder tourne en ONNX sur CPU, seul le decoder est sur NPU. Le decoder a une taille fixe de 110 frames (`decoder_110.rknn`), l'audio est généré par chunks.
- **Qwen 0.5B** : Modèle Qwen2.5-0.5B-Instruct quantifié W8A8. Géré par RKLLaMA (fork Ollama pour NPU Rockchip). API OpenAI-compatible. Premier appel ~3s (chargement modèle), appels suivants ~360ms.
- **Embeddings** : `rk-transformers/all-MiniLM-L6-v2` pré-converti en RKNN depuis HuggingFace. Serveur HTTP custom avec API `/v1/embeddings` compatible OpenAI. Mem0 l'utilise via le provider OpenAI.

---

## CPU — 4× Cortex-A76 + 4× Cortex-A55

### Services systemd

| Service | Runtime | Port | Rôle | RAM |
|---------|---------|------|------|-----|
| `diva-embedded` | Node.js + Python 3.12 | 9001 | Orchestrateur principal | ~350MB |
| `intent-router` | Python 3.12 (npu-env) | 8882 | Classifieur d'intent (regex) | ~10MB |
| `diva-memory` | Python 3.13 | 9002 | Mem0 + WeSpeaker | ~500MB |
| `npu-tts` | Python 3.12 (npu-env) | 8880 | Piper TTS (encoder CPU + decoder NPU) | ~130MB |
| `npu-stt` | Python 3.12 (npu-env) | 8881 | SenseVoice Small (**non utilisé**, pas de FR) | ~580MB |
| `rkllama` | Python 3.12 (rkllama-venv) | 8080 | Qwen 0.5B NPU | ~435MB |
| `npu-embeddings` | Python 3.12 (npu-env) | 8883 | Embeddings all-MiniLM-L6-v2 NPU | ~175MB |
| Docker `searxng` | Alpine container | 8888 | Métasearch (Google+Qwant+Brave+DDG) | ~150MB |

### diva-embedded — Architecture interne

```
diva-embedded.service
├── Node.js (index.js) — Orchestrateur TCP
│   ├── ClaudeStreamingClient — LLM cloud (streaming phrase par phrase)
│   ├── chatQwen() — LLM local NPU (conversationnel simple)
│   ├── classifyIntent() — HTTP vers intent-router (port 8882)
│   ├── transcribeLocal() — Groq Whisper cloud (STT)
│   ├── handleWebSearch() — SearXNG local (port 8888)
│   ├── synthesize() — Piper NPU (port 8880)
│   └── memory tools — Mem0 (port 9002)
│
└── Python 3.12 (subprocess) — wakeword_server.py
    ├── openWakeWord 0.4.0 — Wake word "diva_fr" (ONNX, CPU)
    ├── Silero VAD v6 — Détection parole (2MB, CPU)
    ├── arecord — Capture micro ALSA
    ├── aplay — Lecture speaker ALSA
    └── Communication TCP JSON lines avec Node.js (port 9001)
```

### Intent Router — 13 catégories

| Catégorie | Exemples | Routing |
|-----------|----------|---------|
| `weather` | "quel temps", "il fait beau" | Claude + SearXNG |
| `home_control` | "allume la lumière" | Home Assistant (futur) |
| `timer` | "timer 5 minutes" | Local |
| `music` | "mets de la musique" | Home Assistant (futur) |
| `calculator` | "47 fois 23" | Local |
| `baby` | "comment va le bébé" | Local (BabySync) |
| `identity` | "qui es-tu" | Local |
| `news` | "actualités" | Claude + SearXNG |
| `conversational` | "comment vas-tu" | Qwen NPU local |
| `time` | "quelle heure", "la date" | Local |
| `greeting` | "salut" (standalone) | Local |
| `goodbye` | "bonne nuit" | Local |
| `shutdown` | "ta gueule" | Local |

**Priorité :** Si la phrase contient des mots d'instruction ("enregistre", "mémorise", "je vais te donner"), elle passe toujours par Claude.

---

## Pipeline vocal — Flux de données

```
Utilisateur dit "Diva"
    │
    ▼
openWakeWord (CPU, ONNX) ─── score > 0.35 ?
    │                              non → continue écoute
    ▼ oui
Chime + "Oui?" (aplay)
    │
    ▼
arecord + Silero VAD (CPU) ─── silence > 1.2s ?
    │                              non → continue capture
    ▼ oui
Audio WAV base64 → Node.js TCP
    │
    ▼
Groq Whisper (☁️ cloud) ─── transcription française
    │
    ▼
Intent Router (CPU, port 8882) ─── classification regex ~0.05ms
    │
    ├── LOCAL (time/greeting/calculator...) → réponse immédiate (0ms)
    │
    ├── QWEN NPU (conversational) → port 8080, ~360ms
    │
    └── CLAUDE CLOUD (complex/actu) → streaming + SearXNG si besoin
         │
         ├── SearXNG (Docker, port 8888) ─── recherche web ~1-2s
         └── Mem0 (port 9002) ─── mémoire utilisateur
              └── Embeddings NPU Core 2 (port 8883)
    │
    ▼
Réponse texte
    │
    ▼
Piper TTS NPU (port 8880) ─── streaming phrase par phrase
    │                          encoder (CPU) + decoder (NPU Core 0)
    ▼
aplay → Speaker ReSpeaker
    │
    ▼
Follow-up mode (2s) → écoute nouvelle question ou retour wake word
```

---

## Latences mesurées

| Scénario | Latence totale | Détail |
|----------|---------------|--------|
| "Quelle heure" (local) | **~200ms** | Intent 0.05ms + réponse 0ms + TTS 200ms |
| "Salut" (local) | **~200ms** | Intent + TTS |
| "Comment vas-tu" (Qwen NPU) | **~700ms** | Intent + Qwen 360ms + TTS 200ms |
| Question complexe (Claude) | **~2.5s** | Intent + Claude TTFT 600ms + TTS streaming |
| Question actu (Claude + SearXNG) | **~3.5s** | Intent + SearXNG 1-2s + Claude + TTS |

*Note : + ~500ms de Groq STT cloud pour la transcription*

---

## Cloud vs Local

| Composant | Local/Cloud | Coût | Pourquoi |
|-----------|------------|------|----------|
| Wake word | ✅ Local (CPU) | 0€ | openWakeWord ONNX |
| VAD | ✅ Local (CPU) | 0€ | Silero VAD |
| Intent Router | ✅ Local (CPU) | 0€ | Regex, ~0.05ms |
| LLM simple | ✅ Local (NPU) | 0€ | Qwen 0.5B, ~360ms |
| TTS | ✅ Local (NPU) | 0€ | Piper RKNN |
| Embeddings | ✅ Local (NPU) | 0€ | rk-transformers |
| Search | ✅ Local (Docker) | 0€ | SearXNG |
| Mémoire | ✅ Local (CPU) | 0€ | ChromaDB |
| **STT** | ☁️ Cloud | gratuit* | Groq Whisper (pas de bon STT FR local) |
| **LLM complexe** | ☁️ Cloud | ~0.001€/req | Claude Haiku 4.5 |

*Groq gratuit pour l'instant, coûtera probablement à terme*

---

## Fichiers clés

```
/opt/diva-embedded/
├── src/                          # TypeScript source
│   ├── index.ts                  # Orchestrateur principal
│   ├── llm/
│   │   ├── claude-streaming.ts   # Claude avec streaming phrase par phrase
│   │   ├── qwen-local.ts        # Client Qwen NPU
│   │   └── system-prompt.ts     # Prompt système Diva
│   ├── stt/
│   │   └── local-npu.ts         # STT avec validation + fallback Groq
│   ├── tts/
│   │   └── piper.ts             # Client Piper TTS NPU
│   ├── routing/
│   │   └── intent-router.ts     # Handlers locaux (heure, météo, calc...)
│   └── tools/
│       ├── searxng-search.ts    # SearXNG + fallback Brave
│       └── memory-tool.ts       # Interface Mem0
├── python/
│   ├── wakeword_server.py       # Wake word + capture audio + playback
│   └── memory-service.py        # Serveur Mem0 + WeSpeaker (port 9002)
├── assets/
│   ├── diva_fr.onnx             # Modèle wake word "Diva" (openWakeWord)
│   ├── diva_fr.rknn             # Version NPU (non fonctionnel actuellement)
│   ├── thinking.wav             # Chime de réflexion
│   ├── oui.wav                  # Confirmation wake word
│   └── cached-responses/        # Réponses pré-générées (oui.wav, merci.wav...)
├── docs/
│   ├── ARCHITECTURE.md          # Ce fichier
│   ├── INSTALL.md               # Guide d'installation
│   └── POST-MORTEM-2026-03-16.md # Analyse des incidents
└── data/
    ├── mem0_db/                  # ChromaDB vector store
    ├── memory.db                 # SQLite conversations
    └── speakers/                 # Embeddings vocaux (WeSpeaker)
```

---

## Problèmes connus

1. **Wake word capricieux** — Le modèle `diva_fr.onnx` trigger parfois au 1er essai, parfois au 3ème. Besoin de plus d'échantillons d'entraînement (voix variées).
2. **Groq hallucine sur les follow-ups** — L'écho du speaker est capté par le micro. Sans AEC hardware, les follow-ups sont aléatoires.
3. **PulseAudio AEC incompatible** — Le filtrage WebRTC altère le signal audio et casse la détection wake word. Désactivé.
4. **openWakeWord RKNN** — La version 0.6.0 fork RKNN ne produit que des scores 0.000 avec le modèle actuel. Utilisation CPU (v0.4.0) en attendant investigation.
5. **SenseVoice STT inutilisé** — Le modèle Small ne supporte pas le français. Le modèle Large (50 langues) n'est pas publié par Alibaba.

---

## Améliorations planifiées

- [ ] ReSpeaker XVF3800 (~50€) — AEC hardware pour réactiver le follow-up
- [ ] Re-entraîner wake word avec voix de toute la famille
- [ ] Whisper local (sherpa-onnx) pour remplacer Groq cloud
- [ ] Wrapper Mem0 custom pour embeddings NPU directes
- [ ] Home Assistant integration (Wyoming protocol)
- [ ] YAMNet sur NPU — détection pleurs bébé, sonnette, alarme
