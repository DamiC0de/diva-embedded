# Task: Implement all Diva Embedded stories

You are implementing a standalone voice assistant for Rock 5B (ARM64 Linux).
Repo: /root/projects/diva-embedded
Push to: https://github.com/DamiC0de/diva-embedded.git (main branch)

## Tech Stack
- Node.js 22 + TypeScript (strict)
- Runtime: Linux ARM64 (Rock 5B, RK3588)
- Audio: ALSA via ReSpeaker Lite USB
- AEC: voice-engine/ec (SpeexDSP) via FIFOs /tmp/ec.input and /tmp/ec.output
- Wake Word: OpenWakeWord (Python subprocess)
- STT: Groq Whisper API (primary) + whisper.cpp local (fallback)
- LLM: Claude Haiku 4.5 via Anthropic API (with tool use for search, scrape, memory)
- TTS: Piper via HTTP server on localhost:8880 (POST /v1/audio/speech)
- Search: Brave Search API
- Scraping: Puppeteer headless (Chromium)
- Memory: Markdown files in data/memory/

## Stories to implement (in order)

### MUST

1. **US-RB-006 — TTS Piper client** (src/tts/piper.ts)
   - HTTP client to POST text to Piper server, get WAV back
   - Convert WAV to raw PCM (16kHz, 16bit, mono) for AEC pipeline
   - Support streaming: write raw PCM to /tmp/ec.input FIFO
   - Export: synthesize(text) → Buffer, playViaAec(text) → void

2. **US-RB-002 — AEC integration** (src/audio/aec.ts)
   - Spawn /opt/ec/ec process with correct ALSA devices
   - Create FIFOs /tmp/ec.input and /tmp/ec.output
   - Provide methods to write audio to speaker (via FIFO) and read clean audio from mic (via FIFO)
   - Service management (start/stop)

3. **US-RB-001 — Wake Word** (src/wake/wakeword.ts + python/wakeword_server.py)
   - Python script using openWakeWord library, listening on /tmp/ec.output (clean audio)
   - Communicates with Node.js via stdout JSON messages or a simple TCP socket (localhost:9001)
   - Detects "Diva" wake word
   - Node.js bridge class that starts Python process and listens for detections

4. **US-RB-003 — Interruption / Barge-in** (src/wake/keywords.ts + src/state/machine.ts)
   - State machine: IDLE → LISTENING → PROCESSING → SPEAKING → (interrupt back to IDLE or LISTENING)
   - During SPEAKING state, monitor for keywords: "diva" (re-listen), "attend"/"arrête"/"stop" (back to idle)
   - Keywords detected via wake word engine + simple keyword matching on STT partial results

5. **US-RB-004 — STT** (src/stt/groq-cloud.ts + src/stt/whisper-local.ts)
   - Groq: POST audio to Groq Whisper API, return transcription
   - Read audio from /tmp/ec.output, detect silence (2.5s), send chunk to STT
   - VAD (Voice Activity Detection): simple energy-based threshold
   - Whisper local: spawn whisper.cpp process with audio file, parse output

6. **US-RB-005 — LLM Claude Haiku** (src/llm/claude.ts + src/llm/system-prompt.ts + src/llm/tools.ts)
   - Anthropic SDK client, model claude-3-5-haiku-20241022
   - System prompt optimized for voice (concise answers, conversational french)
   - Streaming responses (get text chunks as they arrive for faster TTS)
   - Tool definitions: brave_search, web_scrape, memory_read, memory_write
   - Handle tool use responses (execute tool, feed result back)

### SHOULD

7. **US-RB-007 — Memory** (src/memory/manager.ts + src/tools/memory-tool.ts)
   - Read/write markdown files in data/memory/
   - MemoryManager class: read(userId), append(userId, entry), search(query)
   - Tool wrapper for Claude tool use
   - Auto-load memory summary in system prompt

8. **US-RB-008 — Conversation history** (src/memory/manager.ts extension)
   - JSONL file per day in data/memory/conversations/
   - Maintain rolling context window (last N messages)
   - Auto-reset after 30min inactivity

9. **US-RB-009 — Brave Search** (src/tools/brave-search.ts)
   - Brave Search API client (GET https://api.search.brave.com/res/v1/web/search)
   - Return top 5 results (title, url, snippet)
   - Simple result cache (Map with TTL)

10. **US-RB-010 — Web Scraping** (src/tools/web-scrape.ts)
    - Launch Puppeteer, navigate to URL, extract text content
    - Timeout 10s, max 5000 chars returned
    - Cleanup: close browser after each scrape

### ENTRY POINT

11. **src/index.ts** — Main entry point that wires everything together:
    - Initialize AEC → Wake Word → STT → LLM → TTS
    - Start state machine loop
    - Handle graceful shutdown (SIGINT/SIGTERM)
    - Log state transitions

## Rules
- TypeScript strict, no `any`
- Use ES modules (type: "module" in package.json)
- Install all needed npm dependencies (npm install)
- Commit each story separately: feat(module): description
- Push to main after all stories
- Add proper error handling everywhere
- Add JSDoc comments on public methods
- Create a .env.example with all required env vars
- The code should be FUNCTIONAL and COMPLETE, not stubs

## Environment
- All API keys come from .env (use dotenv)
- Audio devices configurable via env vars
- Default audio device: plughw:1 (ReSpeaker USB)
