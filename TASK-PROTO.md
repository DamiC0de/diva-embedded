# Task: Rewrite Diva Embedded for PROTO mode (no AEC, simplified)

## Context
The current code has bugs: AEC conflicts with mic access, OpenWakeWord models not downloaded, race conditions. We need a WORKING proto.

## Hardware facts (tested on the actual Rock 5B+)
- ReSpeaker Lite = USB audio, detected as card 5 (but may vary) → auto-detect with `arecord -l | grep ReSpeaker`
- ALSA device format: `plughw:X` where X is the card number
- Micro works perfectly with: `arecord -D plughw:5 -f S16_LE -r 16000 -c 1`
- Speaker works perfectly with: `aplay -D plughw:5`
- Only ONE process can open the mic at a time

## Architecture (validated by Winston)
- Sequential, NOT parallel
- Python handles ALL audio (wake word + voice capture)
- Node.js handles APIs only (Groq STT, Claude LLM, Piper TTS)
- Communication: Python↔Node via TCP JSON lines on port 9001
- NO AEC for proto
- NO barge-in for proto
- NO Puppeteer scraping for proto

## Flow
1. Python opens mic, runs OpenWakeWord continuously
2. Wake word detected ("hey jarvis") → Python stops wake word, captures voice until silence (2.5s)
3. Python sends audio as base64 WAV to Node via TCP
4. Node sends to Groq Whisper → gets text
5. Node sends text to Claude Haiku (with tools: brave_search, memory_read, memory_write)
6. Node sends response text to Piper TTS → gets WAV back
7. Node sends WAV path back to Python
8. Python plays the WAV via aplay
9. Python resumes wake word listening
10. Loop

## Files to rewrite

### python/wakeword_server.py — COMPLETE REWRITE
- Auto-detect ReSpeaker card number
- Download hey_jarvis model if not present
- Run wake word detection on mic
- On detection: stop wake word, record until silence (energy-based VAD)
- Send recorded audio to Node via TCP as JSON: {"type":"audio","data":"<base64 wav>"}
- Receive response from Node: {"type":"play","path":"/tmp/diva_response.wav"}
- Play the WAV with aplay
- Resume wake word listening
- Handle all errors gracefully (retry, reconnect)

### src/index.ts — SIMPLIFIED
- TCP server on port 9001
- Receive audio from Python
- Save to temp WAV file
- Send to Groq Whisper → transcription
- Send to Claude Haiku (with memory context + tools)
- Send transcription to Piper TTS → get WAV
- Save WAV to /tmp/diva_response.wav
- Send play command back to Python
- Keep it simple, sequential, no state machine needed

### src/stt/groq-cloud.ts — KEEP but fix
- Accept WAV file path or buffer
- POST to Groq API
- Return text

### src/llm/claude.ts — KEEP but simplify
- Remove streaming for proto (just get full response)
- Keep tool use (brave_search, memory_read, memory_write)

### src/tts/piper.ts — SIMPLIFY
- POST text to Piper HTTP
- Save WAV to file
- Return file path

### src/tools/brave-search.ts — KEEP as is
### src/tools/memory-tool.ts — KEEP as is
### src/memory/manager.ts — KEEP as is

### DELETE (not needed for proto)
- src/audio/aec.ts
- src/audio/player.ts
- src/audio/recorder.ts
- src/wake/keywords.ts
- src/state/machine.ts
- src/stt/whisper-local.ts
- src/tools/web-scrape.ts
- src/memory/embeddings.ts

### scripts/deploy-rock-black.sh — NEW
Complete deployment script that:
1. Auto-detects ReSpeaker card number
2. Installs system deps (alsa-utils, python3-pip, etc) if missing
3. Downloads OpenWakeWord model (hey_jarvis_v0.1.onnx)
4. Configures .env with auto-detected card
5. Tests mic (arecord 2s, check file size > 10KB)
6. Tests Piper TTS (curl health endpoint)
7. Tests wake word model load
8. npm install + npm run build
9. Creates systemd services
10. Reports ✅/❌ for each step
The script must be completely self-contained and work on a fresh Rock 5B+ with Armbian.

## Critical rules
- Auto-detect ReSpeaker card number, NEVER hardcode
- Download wake word model automatically
- Test each component before proceeding
- All error handling must be robust
- Python script must handle mic resource properly (close when not needed)
- Use SO_REUSEADDR + SO_REUSEPORT on TCP socket
- Kill any existing process on port 9001 before binding
- The deploy script must work ONE SHOT, no manual intervention

## npm dependencies needed
- dotenv, @anthropic-ai/sdk (keep existing)
- Add: form-data, node-fetch (if needed for Groq multipart)
- Remove puppeteer (not needed for proto)

When completely finished, run: openclaw system event --text "Done: Diva proto rewritten and pushed" --mode now
