---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
status: 'complete'
completedAt: '2026-03-19'
lastStep: 8
inputDocuments: ['prd.md', 'technical-amelioration-tts-voix-naturelle-research-2026-03-19.md']
workflowType: 'architecture'
project_name: 'Diva'
user_name: 'Jojo'
date: '2026-03-19'
---

# Architecture Decision Document — Diva

_Ce document se construit collaborativement a travers une decouverte etape par etape. Les sections sont ajoutees au fur et a mesure des decisions architecturales._

## Project Context Analysis

### Requirements Overview

**Functional Requirements :**
55 FR couvrant 9 domaines — conversation (FR1-8), identification/personas (FR9-13), onboarding (FR14-18), memoire (FR19-21), proactivite (FR22-26), ethique/confidentialite (FR27-32), resilience (FR33-40), securite (FR41-44), qualite audio (FR45-46), infrastructure (FR47-55). Le systeme brownfield existant couvre partiellement l'identification, la memoire, la proactivite et la musique. Les fondations conversationnelles (FR1-8), la resilience (FR33-40), et le DevOps (FR47-55) sont entierement nouveaux.

**Non-Functional Requirements :**
- Performance : latence < 2s locale, < 5s Claude, streaming TTS RTF < 0.5
- Securite : AES-256, TLS 1.3, WeSpeaker faux positifs < 2%, audit non-modifiable
- Fiabilite : uptime 99.5% (99.9% medical), MTTR < 60s, rollback < 30s, zero perte donnees
- Scalabilite : 1000 devices fleet, 20 personas/device, 5 ans de donnees
- Integration : Claude API, Home Assistant, Google Calendar, SMTP, WeSpeaker, Mem0, SenseVoice, Piper TTS

**Scale & Complexite :**
- Domaine principal : IoT embarque avec Edge AI
- Complexite : Haute
- Composants architecturaux estimes : ~15 modules
- Services existants : 9 (diva-server, intent-router, diva-memory, diva-audio, npu-stt, npu-tts, npu-embeddings, piper-tts, rkllama)

### Contraintes Techniques & Dependances

- **Hardware fixe :** Rock 5B+ RK3588, NPU 6 TOPS partage entre STT, TTS, embeddings, Qwen
- **NPU partage :** Arbitrage obligatoire — STT > intent > embeddings. Pas de concurrence non-coordonnee
- **Claude API :** Dependance externe pour les conversations complexes. Fallback LLM local obligatoire
- **Donnees de sante 100% local :** Aucune donnee medicale ne transite par Claude API ni aucun cloud non-HDS
- **Piper TTS archive :** Le projet est archive — investissement fine-tuning viable mais pas d'evolution upstream
- **Node.js monolithique :** Le diva-server est un process unique qui orchestre tout. A surveiller pour la scalabilite interne

### Preoccupations Transversales Identifiees

1. **Gestion d'etat conversationnel** — impacte intent router, Claude, TTS, toutes les interactions
2. **Classification confidentialite des donnees** — impacte Mem0, dashboard, messagerie, proactive scheduler, journal de vie
3. **Monitoring et observabilite** — correlation ID a travers les 9 services, metriques unifiees
4. **Authentification vocale comme barriere** — impacte le pipeline complet du wake word a l'action
5. **Chiffrement et cloisonnement sante** — impacte stockage, backup, dashboard, API aidants
6. **Mode degrade multi-niveaux** — impacte Claude, recherche web, calendrier, messagerie, musique

## Stack Technique & Fondations

### Stack Existant (Brownfield)

Le projet Diva v0.2.0-proto est un systeme brownfield fonctionnel deploye sur Rock 5B+ (RK3588). L'architecture evolue a partir de cette base.

**Runtime principal :** Node.js 22+ / TypeScript / ESM modules
**LLM :** Anthropic SDK pour Claude API
**Base de donnees device :** SQLite (better-sqlite3)
**Services OS :** 9 services systemd (diva-server, intent-router, diva-memory, diva-audio, npu-stt, npu-tts, npu-embeddings, piper-tts, rkllama)
**Audio NPU :** SenseVoice STT, Piper TTS, Qwen 0.5B intent, MiniLM embeddings — via RKNN/ONNX
**Integrations :** Google Calendar OAuth2, Nodemailer SMTP, Home Assistant REST/webhooks, Brave Search, YouTube/Spotify

### Decisions Stack pour le MVP

**Multi-stack cible :**

| Composant | Langage | Justification |
|-----------|---------|---------------|
| Application Diva (coeur) | Node.js / TypeScript | Stack existant, ecosysteme Anthropic SDK, code brownfield |
| Watchdog systeme | Go | Binaire statique, survit au crash Node, zero dependance runtime |
| Traitement audio (RNNoise, AEC) | C/C++ | Performance temps reel, libs existantes, appel via child_process ou addon natif |
| Satellites ESP32 | C++ (ESP-IDF) | Framework natif ESP32, contraintes memoire/performance |
| Fleet management serveur | Node.js / TypeScript (Next.js) | Meme langage, API routes + SSR dashboard |
| Dashboard client | React / Next.js / TypeScript | Composants riches (metriques, graphiques, config), meme stack |

**Bases de donnees :**

| Contexte | Technologie | Justification |
|----------|-------------|---------------|
| Device Diva (embarque) | SQLite (better-sqlite3) | Leger, fiable, zero config, parfait pour embarque mono-process |
| Serveur Fleet (cloud) | PostgreSQL | Multi-connexions, 1000 devices, metriques, facturation, scalable |

**Containerisation :**
- Device Diva : services natifs systemd sur Armbian (Docker trop lourd pour 24/7 embarque)
- Serveur fleet : Docker Compose (PostgreSQL + Next.js + API)

## Decisions Architecturales

### Principe Fondamental

Tout tourne sur le Rock 5B+ en local. Le serveur fleet est un outil d'administration (monitoring, mises a jour, alertes, metriques) — pas une dependance. Si le serveur fleet tombe, les Diva continuent de fonctionner normalement. Le serveur fleet peut demarrer sur un simple VPS a 5€/mois et scaler quand il y a 100+ devices.

### Architecture des Donnees

**Trois domaines de donnees cloisonnes :**

**Domaine "Compagnon" — SQLite `diva.db` (device) :**
- Memoires Mem0 (preferences, faits, souvenirs)
- Personas (migration JSON → SQLite pour transactions atomiques)
- Gamification, rappels, liste de courses, routines
- Conversations : sliding window en RAM uniquement, pas persiste
- Chiffrement : LUKS volume complet

**Domaine "Sante" — SQLite `diva-medical.db` (device) :**
- Wellness scoring, compliance medicaments, detection chute, patterns comportementaux
- Chiffrement : AES-256 applicatif EN PLUS de LUKS
- Journal d'audit medical separe, append-only, non-modifiable
- Ne transite JAMAIS par Claude API ni aucun reseau

**Domaine "Fleet" — PostgreSQL (serveur cloud) :**
- Devices, metriques agregees, versions, incidents, utilisateurs, facturation
- Aucune donnee personnelle des utilisateurs finaux — uniquement metriques agregees

**Migration :** Scripts versionnees sequentiels (`001-init.sql`, `002-add-wellness.sql`...) dans `data/migrations/`. Version courante tracee dans la DB. Execution automatique au demarrage.

**Cache :** Meteo, calendrier, dernieres recherches — en RAM (Map TypeScript) avec TTL configurable. Pas de Redis — trop lourd pour l'embarque.

### Authentification & Securite

**Sur le device :**
- **Auth vocale WeSpeaker :** 3 niveaux (ouvert/protege/critique) integres dans le pipeline AVANT le routing d'intent
- **Dashboard local :** Mot de passe bcrypt + session cookie HttpOnly + option TOTP 2FA
- **Services internes :** Localhost only, zero auth inter-services (trust boundary = le device)
- **Cles API :** Fichier `.env` chiffre au repos via SOPS ou age, dechiffre en RAM au demarrage
- **Audit :** SQLite append-only separe (`audit.db`), rotation mensuelle, non-modifiable

**Sur le serveur fleet :**
- **Auth :** JWT + refresh tokens pour le dashboard fleet
- **Device auth :** Cle API unique par device, rotable, transmise via WireGuard
- **RBAC :** Admin (tout), Support (lecture + restart), Utilisateur (son device uniquement)

### API & Communication

**Inter-services device (interne) :**
- HTTP REST localhost — simple, deja en place
- **Correlation ID** (UUID v4) cree au wake word, propage dans tous les headers `X-Correlation-Id`
- Format erreur standardise : `{ error: string, code: string, correlationId: string }`

**Device ↔ Serveur Fleet :**
- **MQTT** pour telemetrie temps reel (metriques, heartbeat, alertes) — push toutes les 5 min
- **HTTPS REST** pour operations ponctuelles (check update, download, report incident)
- Le tout via **WireGuard VPN** — aucun port expose sur internet

**Device ↔ Satellites ESP32 (post-MVP) :**
- **WebSocket** pour streaming audio bidirectionnel
- Protocole leger : `{ type: "audio"|"command"|"status", payload: Buffer|JSON }`
- Discovery via mDNS sur le reseau local

### Pipeline Conversationnel (Changement Structurant)

Le pipeline actuel est stateless. Le nouveau est stateful via le Session Manager.

```
[Wake Word / Satellite]
    |
[Audio Preprocessing] — NOUVEAU : RNNoise + AEC (C/C++)
    |
[STT NPU] (SenseVoice)
    |
[Session Manager] — NOUVEAU : sliding window, etat, correlation ID
    |
[Auth Gate] — NOUVEAU : WeSpeaker verifie le niveau de permission
    |
[Intent Router] (Qwen NPU) — enrichi avec lastIntent/lastEntity
    |
    +-- Local handler (heure, meteo cache, domotique...)
    |       |
    |   [TTS Piper NPU] → audio
    |
    +-- Claude API (avec context window + etat + memoires)
            |
        [Streaming TTS] — NOUVEAU : phrase par phrase
            |
        audio
```

**Session Manager — nouveau composant central :**
- Maintient un `ConversationSession` par persona actif
- Sliding window : 10 derniers echanges (user + Diva) en RAM
- Etat enrichi : musique en cours, minuteurs, derniere recherche, derniere action
- TTL : reset apres 10 minutes de silence
- Injecte le contexte dans chaque appel Claude et dans l'intent router

### Infrastructure & Deploiement

**Sur le device :**
- **Blue-green :** `/opt/diva-current` et `/opt/diva-next`. Build dans next, bascule par symlink atomique + restart systemd
- **Rollback :** Healthcheck echoue en 60s → `ln -sf diva-previous diva-current` + restart
- **Health check :** Watchdog Go verifie que les 9 services repondent sur leurs ports
- **Logs :** JSON structure avec correlation ID → fichier rotatif (logrotate)
- **Metriques :** SQLite `metrics.db` local, push vers fleet toutes les 5 min via MQTT

**Serveur fleet :**
- **Docker Compose :** PostgreSQL + Next.js API/dashboard + Mosquitto MQTT broker
- **Hebergement :** VPS simple (Hetzner, OVH) pour commencer — ~5€/mois
- **CI/CD :** GitHub Actions → build → push image → staging → promotion production
- **Monitoring :** Metriques via MQTT, stockees PostgreSQL, visualisees dans dashboard Next.js

### Impact sur les Decisions

**Sequence d'implementation recommandee :**
1. Session Manager (debloque FR1-8 — fondations conversationnelles)
2. Audio Preprocessing RNNoise + AEC (debloque FR45-46)
3. Auth Gate WeSpeaker (debloque FR41)
4. Streaming TTS (debloque FR8)
5. Watchdog Go (debloque FR33)
6. Cloisonnement donnees sante (debloque FR27, exigence MDR)
7. Systeme de migration DB (debloque FR48)
8. Blue-green + rollback (debloque FR47)
9. Correlation ID + logs structures (debloque FR50-52)
10. Serveur fleet MVP (debloque FR49-50, monitoring distant)

**Dependances croisees :**
- Le Session Manager doit exister AVANT l'Auth Gate (l'auth a besoin du contexte de session)
- Le Streaming TTS necessite que le pipeline Claude soit refactorise pour le streaming
- Le Blue-green necessite que les migrations DB soient en place (sinon rollback = schema incompatible)
- Le Watchdog Go doit etre le PREMIER composant deploye (il surveille tout le reste)

## Patterns d'Implementation & Regles de Consistance

### Patterns de Nommage

**Base de donnees SQLite :**
- Tables : `snake_case` pluriel — `personas`, `memories`, `reminders`, `wellness_entries`
- Colonnes : `snake_case` — `speaker_id`, `created_at`, `is_active`
- Cles etrangeres : `{table_singulier}_id` — `persona_id`, `reminder_id`
- Index : `idx_{table}_{colonnes}` — `idx_memories_speaker_id`

**API interne (HTTP localhost) :**
- Endpoints : `kebab-case` — `/v1/classify`, `/v1/health-check`
- Parametres query : `camelCase` — `?speakerId=xxx&maxResults=10`
- Headers custom : `X-Correlation-Id`, `X-Speaker-Id`

**Code TypeScript :**
- Fichiers : `kebab-case.ts` — `session-manager.ts`, `audio-client.ts`
- Classes/Interfaces : `PascalCase` — `ConversationSession`, `PersonaProfile`
- Fonctions : `camelCase` — `buildSystemPrompt`, `handlePresenceEvent`
- Constantes : `UPPER_SNAKE_CASE` — `ASSETS_DIR`, `MAX_RETRY`
- Types : `PascalCase` — `PersonaType`, `ContentFilter`

**Configuration :**
- Fichiers config : `kebab-case.json` — `proactive-config.json`
- Variables d'environnement : `UPPER_SNAKE_CASE` — `CLAUDE_API_KEY`, `INTENT_URL`

### Patterns de Structure

**Organisation par domaine fonctionnel :**
```
src/
  audio/          # Capture, lecture, filler, lock, preprocessing (RNNoise, AEC)
  calendar/       # Google Calendar
  companion/      # Ambient, gamification, journal, milestones, safety
  dashboard/      # Serveur dashboard local
  elderly/        # Proactive scheduler, medication, cognition, distress
  llm/            # Claude, Qwen, system prompt, tools, streaming
  memory/         # Mem0 manager
  messaging/      # Email, SMS
  music/          # YouTube, Spotify, radio
  persona/        # Engine, onboarding, registration
  routing/        # Intent router
  session/        # NOUVEAU — Session manager, conversation state
  security/       # NOUVEAU — Auth gate, audit logger, crypto
  smarthome/      # Home Assistant connector, presence, notifications
  stt/            # Groq cloud, NPU local
  tools/          # Brave search, reminders, shopping, timers, routines
  tts/            # Piper
  watchdog/       # NOUVEAU — Health check client
  index.ts
```

**Tests :** Co-localises — `session-manager.test.ts` a cote de `session-manager.ts`
**Migrations :** `data/migrations/` — `001-init.sql`, `002-add-sessions.sql`

### Patterns de Format

**Reponses API internes :**
- Succes : `{ success: true, data: T }`
- Erreur : `{ success: false, error: string, code: string, correlationId: string }`

**Donnees JSON :** `camelCase` — `{ speakerId, greetingName, createdAt }`
**Dates :** ISO 8601 — `"2026-03-19T14:30:00.000Z"`. Timezone `Europe/Paris` pour affichage.

**Logs structures (JSON) :**
```json
{
  "ts": "2026-03-19T14:30:00.000Z",
  "level": "info",
  "service": "intent-router",
  "correlationId": "uuid-v4",
  "speakerId": "thomas",
  "msg": "Intent classified",
  "data": { "intent": "music", "confidence": 0.95, "latencyMs": 15 }
}
```

**Niveaux de log :** `error` (crash/perte donnees), `warn` (degradation/retry), `info` (action normale), `debug` (details dev)

### Patterns de Communication

**Correlation ID :**
- Cree dans `diva-server` au wake word (UUID v4)
- Propage via header `X-Correlation-Id` a chaque appel inter-service
- Inclus dans chaque ligne de log
- Stocke avec les metriques pour le mode replay

**Evenements internes :**
- Nommage : `domain.action` kebab-case — `presence.arrival`, `session.timeout`, `audio.error`
- Payload : `{ type: string, speakerId?: string, data: Record<string, unknown>, correlationId: string }`

**Metriques :**
- Nommage : `domain_metric_unit` — `stt_latency_ms`, `claude_tokens_total`, `intent_confidence_pct`
- Stockees SQLite `metrics.db` avec timestamp et correlation ID

### Patterns de Process

**Gestion d'erreurs :**
- Try/catch au niveau service, log structure, propagation propre
- Erreurs Claude API → fallback LLM local, JAMAIS crash
- Erreurs STT → "Desole, je n'ai pas bien entendu" via TTS
- Erreurs domotique → log + message utilisateur, JAMAIS silence
- Erreurs non-critiques → log warn, continue

**Retry :** Max 3 retries, backoff exponentiel (1s, 2s, 4s). Uniquement appels reseau.

**Timeouts :**
- Claude API : 10s
- Brave Search : 5s
- Google Calendar : 5s
- Services locaux (STT, TTS, intent) : 3s
- Home Assistant : 3s

### Regles d'Enforcement

**Tout agent IA implementant du code pour Diva DOIT :**

1. Utiliser le correlation ID dans chaque appel inter-service et chaque ligne de log
2. Suivre les conventions de nommage definies sans variation
3. Gerer les erreurs avec try/catch + log structure + fallback — jamais de crash silencieux
4. Ecrire les donnees de sante UNIQUEMENT dans `diva-medical.db`, jamais dans `diva.db`
5. Ne jamais envoyer de donnees de sante a Claude API
6. Utiliser les timeouts definis pour chaque service
7. Co-localiser les tests avec le code source
8. Suivre le format de log JSON structure

## Structure Projet & Frontieres

### Principe d'Autonomie

100% des services Diva tournent sur le Rock 5B+. Le serveur fleet (`diva-fleet/`) est un repo separe, sur un VPS separe, qui ne fait que monitoring/mises a jour/alertes. Si le fleet tombe, les Diva continuent a 100%. Le Rock est le cerveau. Le fleet est les yeux a distance. Pas de dependance.

### Structure Device — `/opt/diva-embedded/`

```
/opt/diva-embedded/
├── package.json
├── tsconfig.json
├── .env.encrypted                     # Cles API chiffrees (SOPS/age)
├── .env.example
├── deploy.sh                          # Script deploiement blue-green
├── src/
│   ├── index.ts                       # Point d'entree principal
│   ├── session/                       # NOUVEAU — Composant central
│   │   ├── session-manager.ts         # ConversationSession, sliding window, etat
│   │   ├── session-manager.test.ts
│   │   ├── context-injector.ts        # Injecte contexte dans Claude/intent router
│   │   └── anaphora-resolver.ts       # Resolution "le suivant", "la meme chose"
│   ├── security/                      # NOUVEAU
│   │   ├── auth-gate.ts               # 3 niveaux auth vocale WeSpeaker
│   │   ├── audit-logger.ts            # Journal append-only non-modifiable
│   │   ├── crypto.ts                  # Chiffrement AES-256 donnees sante
│   │   └── data-classifier.ts         # Classification rouge/orange/vert
│   ├── audio/
│   │   ├── audio-client.ts
│   │   ├── audio-lock.ts
│   │   ├── filler-manager.ts          # Fillers contextuels (enrichi)
│   │   ├── noise-suppressor.ts        # NOUVEAU — RNNoise via child_process C
│   │   └── echo-canceller.ts          # NOUVEAU — AEC via child_process C
│   ├── llm/
│   │   ├── claude.ts
│   │   ├── claude-streaming.ts        # Streaming phrase par phrase (refactorise)
│   │   ├── qwen-local.ts
│   │   ├── llm-router.ts             # NOUVEAU — Routage Claude → cloud alt → Qwen
│   │   ├── system-prompt.ts
│   │   └── tools.ts
│   ├── routing/
│   │   └── intent-router.ts           # Enrichi avec lastIntent/lastEntity
│   ├── persona/
│   │   ├── engine.ts                  # Migration JSON → SQLite
│   │   ├── onboarding.ts             # Refonte onboarding chaleureux
│   │   ├── registration.ts            # Enregistrement vocal progressif
│   │   └── visitor-classifier.ts      # NOUVEAU — familier/invite/inconnu
│   ├── memory/
│   │   ├── manager.ts
│   │   └── correction-tracker.ts      # NOUVEAU — Memoire de correction
│   ├── companion/
│   │   ├── ambient.ts
│   │   ├── gamification.ts
│   │   ├── life-journal.ts
│   │   ├── milestones.ts
│   │   └── safety.ts
│   ├── elderly/
│   │   ├── cognitive-exercises.ts
│   │   ├── distress-detector.ts
│   │   ├── medication-manager.ts
│   │   ├── notifications.ts
│   │   ├── proactive-scheduler.ts     # Enrichi budget attentionnel
│   │   └── repetition-tracker.ts
│   ├── dashboard/
│   │   └── server.ts                  # Enrichi auth + metriques
│   ├── calendar/
│   │   └── google-calendar.ts
│   ├── messaging/
│   │   └── sender.ts                  # + file d'attente offline
│   ├── music/
│   │   ├── music-tool.ts
│   │   ├── spotify-player.ts
│   │   ├── youtube-player.ts
│   │   └── local-player.ts            # NOUVEAU — Musique locale secours
│   ├── smarthome/
│   │   ├── ha-connector.ts
│   │   ├── ha-notifications.ts
│   │   └── ha-presence.ts
│   ├── stt/
│   │   ├── groq-cloud.ts
│   │   └── local-npu.ts
│   ├── tts/
│   │   ├── piper.ts
│   │   └── streaming-tts.ts           # NOUVEAU — TTS phrase par phrase
│   ├── tools/
│   │   ├── brave-search.ts
│   │   ├── circuit-breaker.ts
│   │   ├── dnd-manager.ts
│   │   ├── jokes.ts
│   │   ├── memory-tool.ts
│   │   ├── morning-briefing.ts        # Enrichi briefing fractionne
│   │   ├── radio.ts
│   │   ├── reminder-manager.ts
│   │   ├── routines.ts
│   │   ├── searxng-search.ts
│   │   ├── shopping-list-tool.ts
│   │   ├── shopping-list.ts
│   │   └── timer-manager.ts
│   ├── monitoring/                    # NOUVEAU
│   │   ├── correlation.ts             # Generation et propagation correlation ID
│   │   ├── logger.ts                  # Logger JSON structure
│   │   ├── metrics-collector.ts       # Collecte metriques → metrics.db
│   │   ├── health-check.ts            # Endpoint health pour watchdog
│   │   └── fleet-reporter.ts          # Push metriques vers fleet (MQTT)
│   └── resilience/                    # NOUVEAU
│       ├── network-detector.ts        # Detection perte reseau
│       ├── offline-queue.ts           # File d'attente actions offline
│       ├── cache-manager.ts           # Cache meteo, calendrier, recherches
│       └── degradation-announcer.ts   # "J'ai un souci technique"
├── data/
│   ├── migrations/
│   │   ├── 001-init-sessions.sql
│   │   ├── 002-init-audit.sql
│   │   └── 003-init-medical.sql
│   ├── personas/
│   ├── diva.db                        # SQLite compagnon
│   ├── diva-medical.db                # SQLite sante (chiffree AES-256)
│   ├── audit.db                       # SQLite audit (append-only)
│   ├── metrics.db                     # SQLite metriques
│   └── proactive-config.json
├── assets/
│   ├── listen.wav, oui.wav, bibop.wav
│   └── local-music/                   # Musique locale de secours
├── models/
│   ├── fr_FR-custom/                  # Piper fine-tune SIWIS
│   └── wespeaker/
└── dist/                              # Build compile

/opt/diva-watchdog/                    # Watchdog Go (process separe)
├── main.go, go.mod, config.yaml
└── diva-watchdog                      # Binaire compile ARM64

/opt/diva-audio-native/                # Traitement audio C/C++
├── rnnoise/denoise.c + Makefile
├── aec/aec.c + Makefile
└── build/                             # Binaires ARM64
```

### Structure Serveur Fleet — `diva-fleet/` (repo separe, VPS separe)

```
diva-fleet/
├── docker-compose.yml                 # PostgreSQL + Next.js + Mosquitto
├── package.json, tsconfig.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── dashboard/, devices/
│   │   ├── api/devices/, api/updates/, api/metrics/, api/auth/
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── db.ts, mqtt.ts, auth.ts
│   └── components/
│       ├── device-status/, metrics-charts/, update-manager/
└── mosquitto/mosquitto.conf
```

### Frontieres Architecturales

**Frontiere Device (Trust Boundary) :**
- Services internes en localhost HTTP — zero auth inter-services
- Le device est la frontiere de confiance. Rien n'entre sans wake word + WeSpeaker
- Donnees de sante ne quittent jamais le device

**Frontiere Reseau (WireGuard) :**
- Device ↔ Fleet : uniquement via WireGuard VPN
- Metriques agregees uniquement, pas de donnees personnelles
- Heartbeat + metriques toutes les 5 min, alertes temps reel

**Frontiere Donnees Sante :**
- `diva-medical.db` chiffre AES-256, acces restreint aux modules elderly/ et companion/safety.ts
- Ne transite pas par Claude API, pas par fleet, pas par reseau
- Audit trail separe dans `audit.db`

### Mapping FR → Structure

| Domaine FR | Repertoires | Fichiers cles |
|-----------|-------------|---------------|
| FR1-8 Conversation | session/, routing/, llm/ | session-manager.ts, anaphora-resolver.ts, context-injector.ts |
| FR9-13 Personas | persona/, security/ | engine.ts, visitor-classifier.ts, auth-gate.ts |
| FR14-18 Onboarding | persona/ | onboarding.ts, registration.ts |
| FR19-21 Memoire | memory/ | manager.ts, correction-tracker.ts |
| FR22-26 Proactivite | elderly/, smarthome/ | proactive-scheduler.ts, ha-presence.ts |
| FR27-32 Ethique | security/ | data-classifier.ts, auth-gate.ts, audit-logger.ts |
| FR33-40 Resilience | resilience/, watchdog Go | network-detector.ts, offline-queue.ts, cache-manager.ts |
| FR41-44 Securite | security/, monitoring/ | auth-gate.ts, audit-logger.ts, crypto.ts |
| FR45-46 Audio | audio/ | noise-suppressor.ts, echo-canceller.ts |
| FR47-55 Infra | monitoring/, watchdog Go | correlation.ts, metrics-collector.ts, fleet-reporter.ts |

## Validation de l'Architecture

### Coherence ✅

**Compatibilite des decisions :**
- Node.js/TypeScript + SQLite + Go watchdog + C/C++ audio — pas de conflits
- Pipeline conversationnel (Session Manager → Auth Gate → Intent Router → Claude/Local) lineaire et coherent
- Cloisonnement 3 DB (diva.db, diva-medical.db, audit.db) propre et sans chevauchement

**Consistance des patterns :**
- Conventions de nommage coherentes avec le code existant
- Correlation ID propage partout — pas de zone morte
- Format de log JSON uniforme pour tous les services

### Couverture des Exigences ✅

**Couverture FR : 55/55 — 100%**

| Domaine | FR | Support architectural |
|---------|-----|----------------------|
| Conversation | FR1-8 (8/8) | Session Manager, Context Injector, Anaphora Resolver, Streaming TTS |
| Personas | FR9-13 (5/5) | Engine SQLite, Visitor Classifier, Auth Gate |
| Onboarding | FR14-18 (5/5) | Onboarding refonte, Registration progressive |
| Memoire | FR19-21 (3/3) | Mem0 Manager, Correction Tracker |
| Proactivite | FR22-26 (5/5) | Proactive Scheduler enrichi, budget attentionnel |
| Ethique | FR27-32 (6/6) | Data Classifier, Auth Gate, Audit Logger, Crypto |
| Resilience | FR33-40 (8/8) | Watchdog Go, LLM Router, Network Detector, Offline Queue, Cache |
| Securite | FR41-44 (4/4) | Auth Gate 3 niveaux, localhost, Audit, Backup chiffre |
| Audio | FR45-46 (2/2) | RNNoise C, AEC Speex C |
| Infra | FR47-55 (9/9) | Blue-green, migrations, beta/stable, metriques, replay, correlation |

**Couverture NFR : complete** — latence, uptime, chiffrement, rollback, fleet scalabilite

### Readiness d'Implementation ✅

- Toutes decisions critiques documentees avec rationale
- Patterns complets avec exemples
- Structure fichier par fichier, mapping FR → repertoire

### Analyse des Gaps

**Gaps critiques : Aucun**

**Gaps importants (non-bloquants) :**
1. Schemas SQLite detailles (colonnes) — a faire pendant les epics/stories
2. Protocole satellites ESP32 detaille — post-MVP
3. Schema API fleet detaille — repo separe, son propre design

### Checklist de Completude

- [x] Contexte projet analyse — scale, complexite, contraintes, preoccupations transversales
- [x] Stack multi-langage defini — Node/TS + Go + C/C++
- [x] 3 domaines donnees cloisonnes — compagnon, sante, fleet
- [x] Pipeline conversationnel stateful — Session Manager central
- [x] Securite vocale 3 niveaux — Auth Gate WeSpeaker
- [x] OTA semi-automatique — beta/stable + rollback
- [x] Separation device autonome / fleet backup
- [x] Conventions nommage, structure, communication, process
- [x] 8 regles enforcement agents IA
- [x] Arborescence complete device + fleet
- [x] Frontieres et points integration mappes
- [x] Mapping FR → structure 100%

### Evaluation de Readiness

**Statut : PRET POUR L'IMPLEMENTATION**
**Confiance : ELEVEE**

**Forces :** Architecture pragmatique brownfield, separation compagnon/medical, resilience multi-niveaux, autonomie device
**Ameliorations futures :** Schemas DB detailles (epics), protocole satellites (post-MVP), diagrammes sequence (implementation)

### Handoff Implementation

**Directives agents IA :**
1. Suivre toutes les decisions architecturales exactement comme documentees
2. Utiliser les patterns de maniere consistante
3. Respecter structure et frontieres
4. Ne JAMAIS faire transiter des donnees de sante par Claude API

**Sequence d'implementation :**
1. Watchdog Go (doit surveiller avant tout changement)
2. Session Manager (debloque fondations conversationnelles)
3. Systeme migration DB (prerequis changements schema)
