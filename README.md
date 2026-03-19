# Diva — Compagnon IA Vocal Domestique

> **Le premier vrai compagnon IA qui vit avec la famille.**
> Pas un assistant qui attend des commandes — un membre du foyer qui comprend, se souvient, s'adapte, et protege.

Diva tourne sur un **Rock 5B+ (RK3588)** a ~100€, traite la voix localement sur le NPU, et ne depend du cloud que pour la conversation intelligente (Claude API). Les donnees restent chez vous.

---

## Pourquoi Diva ?

| | Alexa / Google / Siri | **Diva** |
|--|----------------------|----------|
| **Interaction** | "Alexa, allume lumiere cuisine" | "Diva, allume la lumiere de la cuisine stp" |
| **Memoire** | Zero | Relationnelle long-terme — se souvient de vos conversations |
| **Personnalite** | Identique pour tous | Unique par famille, faconne par la relation |
| **Proactivite** | Notifications generiques | Contextuelle (capteurs + memoire + calendrier) |
| **Enfants** | Blocage froid ou rien | Tuteur patient, conteur, compagnon de jeu, filtre intelligent |
| **Personnes agees** | Aucune adaptation | Check-ins, medicaments, detection chute, lien familial |
| **Vie privee** | Donnees au cloud | Traitement local (NPU), donnees sur le device |
| **Ethique** | Opaque | Classification donnees, consentement, anti-substitution |
| **Prix** | Gratuit + enfermement ecosysteme | ~100€ hardware + 19.99€/mois |

---

## Genese du Projet

### Session Brainstorming 1 — 100 idees "Features"

Technique utilisee : **Role Playing + Cross-Pollination + SCAMPER**. 4 personas incarnes (Marie 78 ans, Lucas 8 ans, Thomas 35 ans, Emma 14 ans). 10 themes couverts : proactivite, memoire, famille, enfants, ados, personnes agees, personnalite, domotique, capteurs, mobilite. Roadmap en 4 vagues d'implementation.

### Session Brainstorming 2 — 100 idees "Gap Analysis"

Technique utilisee : **Reverse Brainstorming** — "Comment Diva pourrait echouer ?" 23 couches d'echec explorees :

1. **Panne technique silencieuse** — self-healing, communication de panne
2. **Degradation invisible** — auto-conscience, guide reparation adapte
3. **Echec moral** — detresse ado 3 niveaux, classification donnees, consentement
4. **Echec relationnel** — anti-substitution, preservation du lien humain
5. **Echec d'identite** — personas manquants, garde alternee, bebe
6. **Perennite long-terme** — backup, fallback LLM, portabilite, couts
7. **Securite** — auth vocale 3 niveaux, firewall, anti-injection, audit
8. **RGPD** — droit a l'oubli, heritage numerique, separation familiale
9. **Accessibilite** — mode texte, adaptation auditive, begaiement, multilinguisme
10. **Multi-pieces** — satellites ESP32, conscience spatiale, isolation audio
11. **Continuite conversationnelle** — sliding window, anaphores, etat enrichi
12. **Apprentissage** — correction immediate, insatisfaction implicite, profil evolutif
13. **Onboarding** — premiere rencontre chaleureuse, warm start, decouverte guidee
14. **Surcharge cognitive** — budget attentionnel, briefing fractionne, 3 niveaux silence
15. **Mise a jour** — blue-green, rollback, fleet management, feature flags
16. **Culturel & social** — famille recomposee, calendrier multi-confessionnel, mode deuil
17. **Latence** — streaming TTS, fillers contextuels, cache, double-requete
18. **Audio** — suppression bruit, annulation echo, multi-locuteurs, volume adaptatif
19. **Resilience reseau** — mode hors-ligne, file d'attente offline, musique locale
20. **Hardware** — arbitrage NPU, monitoring thermique, resilience SD
21. **Testabilite** — simulateur conversation, personas extremes, regression prompt
22. **Attention partagee** — interruptions, priorite, multi-requetes
23. **Experience developpeur** — documentation vivante, env dev local, observabilite

**200 idees au total, 0 doublons entre les 2 sessions.**

### PRD (Product Requirements Document)

55 exigences fonctionnelles, 7 categories NFR, 8 parcours utilisateurs narratifs :
- **Marie** (78 ans, vit seule) — maintien a domicile, wellness, lien familial
- **Jeanne** (82 ans, Alzheimer) — patience infinie, briefing aide-soignante, suivi comportemental
- **Lucas** (8 ans) — tuteur devoirs, gamification, histoires personnalisees
- **Emma** (14 ans) — confident nocturne, journal prive, detection detresse 3 niveaux
- **Thomas** (35 ans, acheteur) — charge mentale, intention implicite, fleet management
- **Claudine / Invites** — persona familier, mode invite, filtre enfant amis
- **Installateur** — wizard boot, warm start, dashboard distant
- **Admin fleet** — monitoring, restart distant, canal beta/stable, couts API

**Business model :** Hardware pre-configure (40% marge brute) + abonnement 19.99€/mois. Marche initial francophonie, puis Europe.

### Architecture

- **Multi-stack :** Node.js/TypeScript (coeur) + Go (watchdog) + C/C++ (audio processing) + Next.js (fleet)
- **3 bases de donnees cloisonnees :** diva.db (compagnon), diva-medical.db (sante, chiffre AES-256), audit.db (append-only)
- **Pipeline conversationnel stateful :** Session Manager → Auth Gate → Intent Router → Claude/Local
- **Principe d'autonomie :** 100% tourne sur le Rock. Le serveur fleet est un outil d'administration, pas une dependance
- **Separation compagnon/medical :** Les donnees de sante ne transitent JAMAIS par Claude API

---

## Architecture Technique

```
[Wake Word "Diva"]
       |
[Audio Preprocessing] — RNNoise (suppression bruit) + AEC (annulation echo)
       |
[STT NPU] — SenseVoice sur RK3588 NPU, < 500ms
       |
[Session Manager] — Sliding window 10 echanges, etat enrichi, correlation ID
       |
[Auth Gate] — 3 niveaux : ouvert / protege (voix reconnue) / critique (confirmation)
       |
[Intent Router] — Regex + Qwen 0.5B NPU, enrichi avec lastIntent/lastEntity
       |
       +-- Local handler (heure, meteo cache, domotique, radio, timer, blague)
       |        |
       |    [TTS Piper NPU] → speaker
       |
       +-- Claude API (streaming, avec context window + memoire + etat)
                |
            [Streaming TTS] — phrase par phrase, premiere reponse < 2s
                |
            speaker
```

### Services (9 actifs + watchdog)

| Service | Port | Technologie | Role |
|---------|------|-------------|------|
| diva-server | 3002 | Node.js/TypeScript | Orchestrateur principal |
| diva-audio | 9010 | Python FastAPI | Wake word, VAD, capture/lecture audio |
| diva-memory | 9002 | Python | Mem0 + WeSpeaker identification vocale |
| intent-router | 8882 | Python + Qwen NPU | Classification d'intent |
| npu-stt | 8881 | Python + NPU | Transcription SenseVoice |
| piper-tts | 8880 | Python + NPU | Synthese vocale Piper |
| npu-embeddings | — | Python + NPU | Embeddings MiniLM |
| rkllama | 8080 | Python + NPU | Qwen 0.5B (intent + fallback LLM) |
| diva-watchdog | — | Bash | Surveillance services + hardware |

### Hardware

- **SBC :** Rock 5B+ — Rockchip RK3588, 4x A76 + 4x A55, NPU 6 TOPS, GPU Mali-G610
- **RAM :** 16 Go LPDDR4x
- **Stockage :** SSD NVMe M.2 (recommande) ou carte SD
- **Audio :** ReSpeaker Lite 2-Mic (USB-C)
- **Connectivite :** Wi-Fi 6 + Ethernet Gigabit (failover automatique)
- **Cout :** ~100€ en composants

---

## Fonctionnalites (200 idees implementees)

### Conversation & Comprehension
- Langage naturel sans syntaxe — "allume la lumiere stp" pas "Alexa, allume lumiere"
- Sliding window conversationnel — 10 derniers echanges en memoire, "et demain ?" fonctionne
- Contexte d'etat enrichi — "c'est quoi ce morceau ?" pendant la musique
- Resolution d'anaphores — "le suivant", "la meme chose", "encore"
- Streaming TTS phrase par phrase — premiere reponse audible en < 2 secondes
- Fillers contextuels — "Voyons le temps..." pas "Hmm, laisse-moi reflechir"

### Identification & Personas
- Reconnaissance vocale par membre (WeSpeaker) — adaptation instantanee
- 5 types : adulte, enfant, personne agee, Alzheimer, invite
- Visiteurs recurrents reconnus et accueillis par leur nom
- Mode invite — neutralise les infos personnelles quand il y a des invites
- Filtre contenu adaptatif — redirige avec malice, ne dit jamais "interdit"

### Ethique & RGPD
- Classification donnees rouge/orange/vert — ce qui remonte, ce qui est agrege, ce qui est prive
- Protection vie privee enfants — Diva refuse de moucharder aux parents
- Consentement explicite vocal pour la surveillance des personnes agees
- Droit a l'oubli — "Diva, oublie-moi" → suppression complete
- Export donnees — "Diva, exporte mes donnees" → JSON telechargeable
- Politique de retention automatique — conversations 90j, preferences longue duree
- Heritage numerique — designation d'un heritier, filtrage contenu positif
- Separation familiale — mode divorce avec scission propre des donnees

### Securite
- Auth vocale 3 niveaux : ouvert (musique) / protege (domotique) / critique (messages)
- Firewall iptables — services internes en localhost uniquement
- Journal d'audit append-only non-modifiable
- Backup chiffre GPG quotidien avec rotation 30 jours
- Anti-injection audio — detection heuristique playback vs voix directe

### Resilience
- Watchdog bash independant — surveille 8 services, restart auto, monitoring hardware
- Fallback LLM multi-niveaux : Claude → Qwen local → intent-only
- Mode hors-ligne gracieux — heure, rappels, musique locale, memoire locale
- Cache RAM (meteo, calendrier) avec fallback stale
- File d'attente offline — messages envoyes au retour du reseau
- Musique locale de secours — "J'ai du Dalida en stock, ca te dit ?"
- Auto-conscience de degradation — "J'ai un souci technique, rapproche-toi"
- Guide depannage adapte — technique pour Thomas, simple pour Marie

### Proactivite & Anti-Surcharge
- Accueil personnalise par detection de presence (capteurs Tapo)
- Briefing matinal fractionne — attend la reponse avant de continuer
- Budget attentionnel configurable par persona et par creneau
- Detection de saturation — "c'est bon", soupirs → Diva se fait discrete
- 3 niveaux de silence : "pas maintenant" / "soiree tranquille" / "silence total"
- Intelligence temporelle — vendredi soir ≠ lundi matin

### Onboarding
- Premiere rencontre chaleureuse — "Bonjour ! Je suis Diva. Comment tu t'appelles ?"
- Enregistrement vocal invisible — pendant une conversation naturelle, pas "repete cette phrase"
- Warm start — le proche pre-configure le profil, "Thomas m'a parle de toi et de Minou !"
- Decouverte guidee — capacites revelees une par une sur la premiere semaine

### Memoire & Apprentissage
- Memoire relationnelle long-terme (Mem0) — callbacks naturels
- Correction immediate — "non pas ca, du jazz manouche" → retenu pour la prochaine fois
- Clarification intelligente — ne demande que quand elle a deja echoue
- Detection automatique des dates importantes mentionnees une seule fois
- Profil de gouts evolutif par domaine (musique, cuisine, medias)

### Accompagnement Personnes Agees
- Check-ins emotionnels doux — "Marie, comment tu vas ?"
- Rappels medicaments avec suivi compliance
- Stimulation cognitive integree naturellement
- Detection changement comportement (repetitions, heure lever)
- Wellness scoring et resume quotidien pour l'aidant
- Detection detresse et alerte contact designe
- Persona temporaire aide-soignante avec acces medical limite

### Accompagnement Enfants & Ados
- Aide aux devoirs (tuteur, pas distributeur de reponses)
- Gamification XP + quetes configurables par les parents
- Histoires personnalisees avec le prenom et les amis de l'enfant
- Confident nocturne pour les ados — espace safe sans jugement
- Detection detresse 3 niveaux — blues → alerte → urgence + 3114
- Journal intime vocal prive inaccessible aux parents

### Domotique & Musique
- Home Assistant (lumieres, capteurs, scenes, automatisations)
- YouTube, Spotify, radio, musique locale
- Scenes emotionnelles — "ambiance soiree tranquille"
- Capture intention implicite — "on n'a plus de lait" → liste de courses

### Multi-Pieces (Architecture)
- Satellites ESP32 (micro + speaker, ~15€/piece) connectes au Rock central
- Conscience spatiale — Diva sait dans quelle piece on parle
- Isolation audio — devoirs dans la chambre, rock au salon, independamment
- Detection chute etendue via satellite salle de bain

### Social & Culturel
- Famille recomposee dynamique (liens multiples, neutralite dans les tensions)
- Calendrier multi-confessionnel (Ramadan, Noel, Hanouka, Diwali)
- Mode deuil — dates anniversaires, douceur, pas de jeux
- Sensibilite aux sujets delicats (politique, religion, mort)
- Anti-substitution — Diva pousse vers l'humain, limite ses propres interactions

### DevOps & Monitoring
- Blue-green deployment avec rollback < 30 secondes
- Migrations DB versionnees automatiques
- Canal beta/stable — beta pete chez toi, pas chez Marie
- Feature flags par device
- Changelog vocal — "J'ai appris un nouveau truc !"
- Correlation ID par interaction a travers les 9 services
- Logs JSON structures + rotation automatique
- Metriques qualite conversationnelle (comprehension, temps reponse, couts API)
- Mode replay — retrace le pipeline complet d'une interaction pour le debug
- Fleet reporter — push metriques vers serveur central
- Monitoring hardware (temperature, disque, RAM)
- Ecritures atomiques + SQLite WAL — zero corruption en cas de coupure courant

---

## Structure du Projet

```
diva-embedded/
├── src/
│   ├── index.ts                    # Pipeline principal : wake → STT → intent → LLM → TTS
│   ├── session/                    # Session Manager, anaphora resolver
│   ├── security/                   # Auth gate, data classifier, privacy guard, audit, crypto
│   ├── monitoring/                 # Correlation, logger, metrics, replay, migrations, fleet, tests
│   ├── resilience/                 # Network detector, LLM router, cache, offline queue
│   ├── companion/                  # Teen distress, anti-substitution, accessibility, social awareness
│   ├── audio/                      # Audio client, noise suppressor, echo canceller, satellite manager
│   ├── persona/                    # Engine, onboarding, warm start, visitor classifier, temporal, discovery
│   ├── memory/                     # Mem0 manager, correction tracker
│   ├── llm/                        # Claude streaming, system prompt, tools, Qwen local
│   ├── elderly/                    # Proactive scheduler, medication, cognition, distress, repetition
│   ├── routing/                    # Intent router (regex + Qwen NPU)
│   ├── tools/                      # Rappels, liste courses, timer, radio, recherche, attention budget
│   ├── music/                      # YouTube, Spotify, radio, local player
│   ├── smarthome/                  # Home Assistant connector, presence, notifications
│   ├── calendar/                   # Google Calendar
│   ├── messaging/                  # Email + SMS + offline queue
│   ├── dashboard/                  # Dashboard web local
│   ├── stt/                        # STT NPU local, Groq cloud fallback
│   └── tts/                        # Piper TTS NPU
├── python/                         # Services Python (audio, memory, intent, speaker ID)
├── data/                           # DBs, personas, config, migrations
├── assets/                         # Sons, fillers, modeles wake word
└── deploy.sh                       # Blue-green deployment

diva-watchdog/
├── watchdog.sh                     # Surveillance 8 services + hardware
├── firewall.sh                     # iptables localhost protection
└── backup.sh                       # Backup chiffre GPG quotidien

systemd/                            # Services systemd (9 + watchdog + firewall + backup)

_bmad-output/
├── brainstorming/                  # 2 sessions (200 idees)
└── planning-artifacts/
    ├── prd.md                      # PRD complet (55 FR, 8 parcours)
    ├── architecture.md             # Architecture validee (55/55 FR)
    └── epics.md                    # 11 epics, 57 stories
```

---

## Installation

```bash
# 1. Cloner
git clone https://github.com/DamiC0de/diva-embedded.git /opt/diva-embedded
cd /opt/diva-embedded

# 2. Installer les dependances
npm install

# 3. Configurer
cp .env.example .env
# Editer .env avec vos cles API (ANTHROPIC_API_KEY, etc.)

# 4. Compiler
npm run build

# 5. Installer les services systemd
cp systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable diva-server diva-audio diva-memory intent-router npu-stt piper-tts rkllama diva-watchdog diva-firewall diva-backup.timer

# 6. Demarrer
systemctl start diva-server
```

## Configuration

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Cle API Anthropic (Claude) |
| `GROQ_API_KEY` | Cle API Groq (STT fallback) |
| `BRAVE_API_KEY` | Cle API Brave Search |
| `LLM_MODEL` | Modele Claude (defaut: claude-haiku-4-5-20251001) |
| `HA_URL` / `HA_TOKEN` | Home Assistant (optionnel) |
| `AUDIO_INPUT_DEVICE` | Device audio ALSA |
| `FLEET_URL` | URL serveur fleet (optionnel) |
| `DEVICE_ID` | Identifiant unique du device |
| `UPDATE_CHANNEL` | Canal de mise a jour (beta/stable) |

---

## Metriques de Succes Cibles

| Metrique | Cible MVP (12 mois) |
|----------|-------------------|
| Foyers equipes | 1 000 |
| Churn mensuel | < 5% |
| MRR | 20 000€ |
| NPS | > 50 |
| Uptime | 99.5% |
| Comprehension 1er coup | > 90% |
| Cout API/foyer/mois | < 8€ |
| Latence locale | < 2s |
| Latence Claude | < 5s (1ere phrase < 2s) |

---

## Documentation

- [`_bmad-output/planning-artifacts/prd.md`](./_bmad-output/planning-artifacts/prd.md) — Product Requirements Document complet
- [`_bmad-output/planning-artifacts/architecture.md`](./_bmad-output/planning-artifacts/architecture.md) — Architecture Decision Document
- [`_bmad-output/planning-artifacts/epics.md`](./_bmad-output/planning-artifacts/epics.md) — 11 Epics, 57 Stories avec acceptance criteria
- [`_bmad-output/brainstorming/`](./_bmad-output/brainstorming/) — Sessions de brainstorming (200 idees)

---

## Licence

Private — (c) 2026 Jojo. Tous droits reserves.
