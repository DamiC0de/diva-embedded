# 🎤 Diva Embedded

Assistant vocal intelligent standalone pour Rock 5B (RK3588).

## Stack

| Composant | Techno |
|-----------|--------|
| Wake Word | OpenWakeWord ("Diva") |
| STT | Whisper.cpp (local) / Groq API |
| LLM | Claude Haiku 4.5 (API Anthropic) |
| TTS | Piper (fr_FR-siwis-medium) |
| AEC | voice-engine/ec (SpeexDSP) |
| Recherche | Brave Search API |
| Scraping | Puppeteer headless |
| Mémoire | Markdown + SQLite |
| Runtime | Node.js 22 + TypeScript |

## Hardware

- **SBC** : Rock 5B (RK3588, 16GB RAM)
- **Audio** : ReSpeaker Lite 2-Mic (USB-C)
- **Stockage** : NVMe

## Architecture

```
ReSpeaker → AEC (SpeexDSP) → OpenWakeWord → STT → Claude Haiku → Piper TTS → Speaker
```

## Setup

Voir `docs/setup-guide.md`

## License

Private — © 2026
