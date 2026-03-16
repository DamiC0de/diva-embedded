# Post-Mortem & Plan de Stabilisation — Diva Voice Pipeline

> **Date de l'incident** : 16 mars 2026, 11h00–12h00
> **Participants** : Nico (test utilisateur), Jarvis (debug), The Rock (R&D NPU)
> **Environnement** : Rock 5B+ · Piper NPU (TTS) · Groq Whisper (STT) · Claude Haiku (LLM) · SearXNG (Search)
> **Statut** : Pipeline partiellement fonctionnel, follow-up désactivé

---

## 1. Résumé Exécutif

Suite à l'intégration NPU de Piper TTS et aux optimisations de timeouts dans
la nuit du 15-16 mars, la pipeline vocale "Diva" a présenté plusieurs régressions :
hallucinations STT sur les follow-ups, intent router trop agressif sur les
greetings, timeouts trop courts pour les réponses SearXNG, et une boucle
d'auto-écoute (Diva captait sa propre voix et se répondait).

**Ce qui fonctionne :**
- Wake word → question → réponse : pipeline de base OK
- Piper NPU (TTS) : RTF 0.089, aucun problème
- SearXNG : recherches fonctionnelles (pape Léon XIV trouvé)
- Intent routing basique : heure, date, greetings simples

**Ce qui ne fonctionne pas :**
- Follow-up conversationnel (désactivé)
- Transcription Groq sur audio mélangé (écho speaker)
- Réponses trop verbeuses de Claude
- Intent router qui capture trop de phrases en "greeting"

---

## 2. Chronologie des Incidents

```
11:00  Nico lance un test. TTS passe par NPU (confirmé), STT reste cloud (Groq).
11:05  Premier test : "Bonjour comment vas-tu ce matin"
       → Groq transcrit correctement
       → Intent router classe en "greeting" → réponse locale "Je t'écoute"
       → BUG : devrait passer par Claude pour une réponse conversationnelle
       
11:08  Fix 1 : "comment vas-tu" retiré des patterns greeting
       → Pattern regex non mis à jour (problème encodage ç/à)
       → Fix 2 : réécriture complète du pattern

11:12  "Donne-moi la date et l'heure"
       → Intent router matche "heure" → donne l'heure seulement
       → BUG : ne check pas si "date" est aussi demandé
       → Fix 3 : vérification combinée date+heure

11:12  "Qui est le pape actuel"
       → Claude répond avec données obsolètes (élu 2013)
       → Ne lance PAS de recherche SearXNG automatiquement
       → BUG : system prompt ne force pas la recherche pour les questions factuelles
       → Fix 4 : ajout de triggers de recherche automatique

11:17  Follow-up après wake word :
       → Groq transcrit "Merci." au lieu de la vraie question
       → BUG : écho du speaker capté par le micro
       
11:20  Follow-up ne capte plus rien :
       → FOLLOW_UP_TIMEOUT_S trop court
       → Fix 5 : augmenté à 4s, puis 5s

11:26  Flush audio trop agressif (2s) :
       → Jette la voix de l'utilisateur avec l'écho
       → Fix 6 : réduit à 0.5s
       
11:38  Diva répond dans une "langue bizarre" :
       → Groq hallucine complètement sur audio bruité
       
11:40  INCIDENT CRITIQUE : Diva parle toute seule en boucle
       → Capte sa propre voix → Groq transcrit → Claude répond → TTS → boucle
       → Fix 7 : reboot + désactivation follow-up
       
11:49  Nico identifie la cause racine :
       "Avant de changer le system pour utiliser le NPU, le micro ne posait 
        pas de souci, ça fonctionnait bien"
       → Les timeouts modifiés cette nuit sont la vraie cause
       → Fix 8 : restauration des timeouts raisonnables
```

---

## 3. Analyse des Causes Racines

### Cause 1 : Timeouts trop agressifs (CRITIQUE)

Les modifications de la nuit du 15-16 mars ont cassé l'équilibre du pipeline :

| Paramètre | Avant | Après (nuit) | Recommandé |
|-----------|-------|-------------|------------|
| `SILENCE_TIMEOUT_S` | 1.5 | 0.8 | **1.2** |
| `recv_json timeout (1er)` | 60 | 10 | **30** |
| `recv_json timeout (2e)` | 30 | 3 | **15** |
| `FOLLOW_UP_TIMEOUT_S` | (actif) | varié | **0** (désactivé) |
| `FLUSH_AUDIO_S` | 1.0 | varié (0.5-2.0) | **0.8** |

**Impact** : Le `recv_json` à 10s timeout avant que SearXNG + Claude aient fini
de répondre (4-5s recherche + 3-5s streaming). Le `SILENCE_TIMEOUT_S` à 0.8s
coupe l'utilisateur en milieu de phrase.

**Leçon** : Ne jamais optimiser la latence en baissant les timeouts. Optimiser
chaque composant individuellement (streaming STT, prompt caching, sentence-level TTS).

### Cause 2 : Absence d'AEC (Annulation d'Écho Acoustique)

Le micro ReSpeaker Lite capte la voix TTS de Diva sortant du speaker. Groq reçoit
un mélange voix utilisateur + écho Diva et hallucine ("Merci.", "...", répétition
de la phrase précédente).

Ce problème n'existait pas (ou moins) avant car :
- Les timeouts plus longs laissaient le temps à l'écho de se dissiper
- Le follow-up était peut-être moins agressif
- Le flush audio de 1s suffisait avec les anciens timings

**Ce n'est PAS un problème de qualité micro.** Le ReSpeaker Lite fonctionne bien
en capture primaire. C'est l'absence de soustraction du signal speaker qui cause
les hallucinations Groq.

### Cause 3 : Intent Router trop simpliste

Le routage par regex est fragile :
- "Bonjour, je voudrais la date et l'heure" → classé `greeting` à cause de "Bonjour"
- "Comment vas-tu ce matin" → classé `greeting` au lieu de `conversational`
- "Donne-moi la date et l'heure" → matche `time` mais ne vérifie pas `date`

Les regex ne comprennent pas le contexte — une phrase qui commence par un greeting
mais contient une question doit être traitée comme une question.

### Cause 4 : Claude pas assez contraint

- Réponses trop verbeuses (6 phrases pour dire "je ne sais pas")
- Ne lance pas automatiquement SearXNG pour les questions factuelles
- Mentionne ses limitations au lieu de chercher directement

---

## 4. Plan de Stabilisation

### Phase 0 — Restauration Immédiate (FAIT)

```javascript
// wakeword_server.py — Valeurs stables
const SILENCE_TIMEOUT_S = 1.2;        // Pas 0.8, laisse finir les phrases
const FOLLOW_UP_TIMEOUT_S = 0;        // Désactivé — wake word obligatoire
const FLUSH_AUDIO_S = 0.8;            // Compromis écho/réactivité
const RECV_JSON_TIMEOUT_1 = 30;       // Assez pour SearXNG + Claude
const RECV_JSON_TIMEOUT_2 = 15;       // Assez pour le streaming TTS
```

**Statut** : ✅ Appliqué. Pipeline stable en mode wake-word-only.

### Phase 1 — AEC Logiciel (1-2 jours)

Avant d'acheter du hardware, tester l'AEC logiciel via PulseAudio/PipeWire.

```bash
# === Option A : PulseAudio module-echo-cancel (WebRTC AEC) ===

# 1. Identifier le sink (speaker) et la source (micro)
pactl list short sinks    # → ex: alsa_output.usb-seeed-...
pactl list short sources  # → ex: alsa_input.usb-seeed-...

# 2. Charger le module d'annulation d'écho
pactl load-module module-echo-cancel \
  source_name=aec_source \
  sink_name=aec_sink \
  source_master=alsa_input.usb-seeed-respeaker \
  sink_master=alsa_output.usb-seeed-respeaker \
  aec_method=webrtc \
  aec_args="analog_gain_control=0 digital_gain_control=1 noise_suppression=1" \
  rate=16000 \
  channels=1

# 3. Configurer l'application pour utiliser la source AEC
# Dans le code Python/Node, utiliser "aec_source" comme device d'entrée

# 4. Tester
arecord -D pulse -f S16_LE -r 16000 -c 1 test_aec.wav
# Pendant l'enregistrement, jouer du son sur le speaker
# Vérifier que test_aec.wav ne contient pas l'écho
```

```bash
# === Option B : PipeWire filter-chain (si PipeWire est utilisé) ===

# Créer un fichier de config AEC
cat > ~/.config/pipewire/filter-chain/echo-cancel.conf << 'EOF'
context.modules = [
    { name = libpipewire-module-echo-cancel
        args = {
            capture.props = {
                node.name = "Echo Cancellation Capture"
            }
            source.props = {
                node.name = "Echo Cancellation Source"
            }
            sink.props = {
                node.name = "Echo Cancellation Sink"
            }
            playback.props = {
                node.name = "Echo Cancellation Playback"
            }
            library.name = aec/libspa-aec-webrtc
            aec.args = {
                webrtc.gain_control = false
                webrtc.extended_filter = true
            }
        }
    }
]
EOF

# Redémarrer PipeWire
systemctl --user restart pipewire
```

**Critère de succès** : Enregistrer un follow-up pendant que Diva parle,
envoyer à Groq, obtenir une transcription correcte.

**Si l'AEC logiciel fonctionne** → réactiver le follow-up avec FOLLOW_UP_TIMEOUT_S = 4.

### Phase 2 — Intent Router Amélioré (2-3 jours)

Remplacer le système de regex par un routage en deux passes :

```javascript
// intent_router.js — Routage intelligent

/**
 * PRINCIPE : 
 * 1. Extraire les MOTS-CLÉS de question (heure, date, météo, qui, quoi, quel...)
 * 2. Si un mot-clé de question est trouvé → TOUJOURS traiter comme question
 * 3. Le greeting au début est ignoré si suivi d'une question
 * 4. Seules les phrases PUREMENT greeting ("salut", "bonjour diva") → greeting
 */

const QUESTION_KEYWORDS = [
    // Temps
    /\b(heure|heures|date|jour|mois|année)\b/i,
    // Météo
    /\b(météo|température|temps qu'il fait|pleut|pluie|soleil)\b/i,
    // Personnes/Actualité (toujours passer par Claude + SearXNG)
    /\b(qui est|qui sont|président|pape|ministre|mort|élu)\b/i,
    // Questions directes
    /\b(combien|pourquoi|comment|qu'est-ce|c'est quoi|quel|quelle)\b/i,
    // Commandes domotiques
    /\b(allume|éteins|allumer|éteindre|lumière|lampe|chauffage|volet)\b/i,
    // Minuteur
    /\b(minuteur|timer|rappel|alarme|réveille)\b/i,
];

const PURE_GREETING_PATTERNS = [
    /^(salut|bonjour|coucou|hey|hello|bonsoir)(\s+(diva|openclaw))?\s*[.!]?$/i,
    /^ça va\s*\??$/i,
];

function classifyIntent(text) {
    const cleanText = text.trim().toLowerCase();
    
    // 1. Vérifier d'abord si c'est une QUESTION (prioritaire)
    for (const pattern of QUESTION_KEYWORDS) {
        if (pattern.test(cleanText)) {
            // Extraire le type spécifique
            if (/\b(heure|heures)\b/i.test(cleanText) && /\bdate\b/i.test(cleanText)) {
                return { intent: "datetime", handler: "local" };
            }
            if (/\b(heure|heures)\b/i.test(cleanText)) {
                return { intent: "time", handler: "local" };
            }
            if (/\bdate\b/i.test(cleanText)) {
                return { intent: "date", handler: "local" };
            }
            if (/\b(météo|température)\b/i.test(cleanText)) {
                return { intent: "weather", handler: "local_api" };
            }
            if (/\b(allume|éteins|lumière|lampe|chauffage|volet)\b/i.test(cleanText)) {
                return { intent: "home_control", handler: "home_assistant" };
            }
            if (/\b(minuteur|timer|alarme)\b/i.test(cleanText)) {
                return { intent: "timer", handler: "local" };
            }
            // Tout le reste → Claude + SearXNG
            return { intent: "complex", handler: "claude" };
        }
    }
    
    // 2. Vérifier si c'est un PURE greeting (rien d'autre)
    for (const pattern of PURE_GREETING_PATTERNS) {
        if (pattern.test(cleanText)) {
            return { intent: "greeting", handler: "local" };
        }
    }
    
    // 3. Par défaut → Claude (mieux vaut un appel API en trop qu'une mauvaise réponse)
    return { intent: "complex", handler: "claude" };
}

// === Handlers locaux ===
function handleLocal(intent, text) {
    const now = new Date();
    
    switch (intent) {
        case "greeting":
            const greetings = [
                "Salut ! Qu'est-ce que je peux faire pour toi ?",
                "Hey ! Je t'écoute.",
                "Bonjour ! Dis-moi.",
            ];
            return greetings[Math.floor(Math.random() * greetings.length)];
        
        case "time":
            return `Il est ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}.`;
        
        case "date":
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            return `On est le ${now.toLocaleDateString('fr-FR', options)}.`;
        
        case "datetime":
            const dateOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            return `Il est ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}, ` +
                   `et on est le ${now.toLocaleDateString('fr-FR', dateOpts)}.`;
        
        case "timer":
            // Extraire la durée et créer le minuteur
            return null; // → passer à Claude si extraction complexe
        
        default:
            return null; // → passer à Claude
    }
}
```

### Phase 3 — System Prompt Claude Optimisé (1 jour)

```
Tu es Diva, le compagnon vocal de la famille.

## Règles ABSOLUES pour le mode vocal
1. MAX 2 phrases par réponse. Si c'est plus complexe, donne la réponse courte
   puis demande si on veut les détails.
2. NE MENTIONNE JAMAIS tes limitations, ta date de coupure, ou le fait que tu
   vas chercher. Cherche silencieusement et donne la réponse.
3. NE COMMENCE JAMAIS par "Bien sûr", "Excellente question", "Je serais ravi".
   Va directement au contenu.
4. TOUJOURS utiliser l'outil search pour : personnes, politique, actualité, 
   événements récents, prix, horaires, météo. Ne réponds JAMAIS de mémoire
   pour ces sujets.

## Outil search
Quand tu utilises search, la réponse doit intégrer le résultat naturellement.
MAUVAIS : "D'après mes recherches, le pape actuel est..."
BON : "Le pape actuel c'est Léon XIV, élu en mai 2025."

## Exemples de bonnes réponses
User: "qui est le pape actuel"
→ [search] → "Le pape actuel c'est Léon XIV, élu en mai 2025."

User: "il fait combien dehors"
→ [weather] → "17 degrés, couvert. Prends une veste."

User: "bonjour comment vas-tu"
→ "Ça va bien, merci ! Et toi, bien dormi ?"

User: "mets un minuteur 10 minutes"
→ "C'est parti, 10 minutes."
```

### Phase 4 — Prompt Whisper pour Groq (immédiat)

Ajouter un `prompt` parameter à chaque appel Groq pour guider la transcription :

```python
# Dans le code STT
response = await client.post(
    GROQ_STT_URL,
    files={"file": ("audio.wav", audio_bytes, "audio/wav")},
    data={
        "model": "whisper-large-v3-turbo",
        "language": "fr",
        "response_format": "text",
        "temperature": 0.0,
        # CE PROMPT GUIDE WHISPER POUR MIEUX TRANSCRIRE LE FRANÇAIS
        "prompt": (
            "Conversation en français avec un assistant vocal nommé Diva. "
            "L'utilisateur pose des questions sur l'heure, la date, la météo, "
            "l'actualité, la domotique, ou fait la conversation. "
            "Vocabulaire courant : Diva, bonjour, quelle heure, quel temps, "
            "allume, éteins, salon, cuisine, chambre, bébé, Jean."
        ),
    }
)
```

Ce prompt conditionne Whisper pour s'attendre à du français courant plutôt que
d'halluciner de l'anglais ou "Merci." en boucle. Impact attendu : réduction
significative des hallucinations sur les audios courts.

### Phase 5 — AEC Hardware (quand budget OK)

**ReSpeaker XVF3800** (~50€) — Solution définitive :
- AEC hardware XMOS (soustraction du signal speaker en temps réel)
- 4 microphones avec beamforming
- Suppression de bruit DNN
- USB, plug & play sur Linux

Une fois installé :
1. Réactiver `FOLLOW_UP_TIMEOUT_S = 4`
2. Réduire `FLUSH_AUDIO_S = 0.3`
3. Le pipeline follow-up redevient fiable
4. Plus de boucle d'auto-écoute possible

---

## 5. Matrice de Priorisation

| # | Action | Impact | Effort | Priorité |
|---|--------|--------|--------|----------|
| 1 | Restaurer timeouts stables | ★★★★★ | 5 min | ✅ FAIT |
| 2 | Prompt Whisper français | ★★★★☆ | 10 min | 🔴 IMMÉDIAT |
| 3 | System prompt Claude concis | ★★★★☆ | 30 min | 🔴 IMMÉDIAT |
| 4 | Intent router amélioré | ★★★★☆ | 2-3h | 🟡 CETTE SEMAINE |
| 5 | AEC logiciel (PulseAudio) | ★★★★★ | 2-4h | 🟡 CETTE SEMAINE |
| 6 | Réactiver follow-up (si AEC OK) | ★★★☆☆ | 30 min | 🟡 APRÈS AEC |
| 7 | ReSpeaker XVF3800 (hardware) | ★★★★★ | 1h install | 🟢 BUDGET OK |

---

## 6. Règles de Stabilité pour le Futur

### Règle 1 : Ne jamais modifier les timeouts sans test

```
AVANT de modifier un timeout :
1. Documenter la valeur actuelle et pourquoi elle est là
2. Tester la nouvelle valeur sur 10 interactions complètes
3. Si > 2 échecs → rollback immédiat
```

### Règle 2 : Tester le pipeline bout-en-bout après chaque modif

Créer un script de test automatisé :

```bash
#!/bin/bash
# test_pipeline.sh — Tests de régression vocaux

echo "=== TEST 1 : Greeting simple ==="
echo "Test: 'Bonjour'" 
# Attendu: réponse locale greeting

echo "=== TEST 2 : Question + greeting ==="
echo "Test: 'Bonjour, quelle heure est-il ?'"
# Attendu: réponse locale avec l'heure (PAS un greeting)

echo "=== TEST 3 : Date et heure ==="
echo "Test: 'Donne-moi la date et l'heure'"
# Attendu: date ET heure dans la réponse

echo "=== TEST 4 : Question factuelle ==="
echo "Test: 'Qui est le président de la France ?'"
# Attendu: recherche SearXNG + réponse factuelle

echo "=== TEST 5 : Conversationnel ==="
echo "Test: 'Comment vas-tu ce matin ?'"
# Attendu: réponse conversationnelle via Claude (PAS greeting)

echo "=== TEST 6 : Timeout SearXNG ==="
echo "Test: Vérifier que la réponse arrive même si SearXNG prend 4s"
# Attendu: réponse complète sans timeout

echo "=== TEST 7 : Audio court ==="
echo "Test: Audio de 1s 'Oui'"
# Attendu: transcription correcte (pas hallucination)
```

### Règle 3 : Séparer optimisation latence et stabilité

```
OPTIMISATION LATENCE (safe) :
  ✅ Prompt caching Claude → réduit TTFT sans risque
  ✅ Streaming TTS par phrase → réduit latence perçue
  ✅ Connection pooling HTTP/2 → réduit overhead réseau
  ✅ Pré-génération réponses courantes → zéro latence

OPTIMISATION LATENCE (risqué) :
  ⚠️ Réduire SILENCE_TIMEOUT → risque de couper l'utilisateur
  ⚠️ Réduire recv_json timeout → risque de timeout sur SearXNG
  ⚠️ Réduire FLUSH_AUDIO → risque d'écho
  ⚠️ Activer follow-up sans AEC → risque de boucle
```

### Règle 4 : Un seul changement à la fois

Quand Jarvis/The Rock modifient le pipeline :
1. **Un seul changement par commit**
2. **Tester immédiatement** avec Nico
3. **Si ça casse** → rollback en 30 secondes
4. **Logger** la valeur avant/après et le résultat du test

---

## 7. État Actuel du Pipeline

```
┌─────────────────────────────────────────────────┐
│            ÉTAT AU 16 MARS 2026 — 12h00          │
├─────────────────────────────────────────────────┤
│                                                  │
│  Wake Word ──→ OK (ReSpeaker Lite)               │
│       │                                          │
│  Groq STT ──→ OK en primaire                     │
│       │        ⚠️ Hallucine sur follow-up (écho)  │
│       │                                          │
│  Intent  ──→ AMÉLIORÉ mais encore fragile        │
│  Router       ✅ "date et heure" → datetime       │
│       │       ✅ "comment vas-tu" → claude         │
│       │       ⚠️ Regex, pas de vrai NLU           │
│       │                                          │
│  Claude  ──→ OK avec SearXNG                     │
│  Haiku       ✅ Recherche auto sur personnes       │
│       │       ⚠️ Encore un peu verbeux             │
│       │                                          │
│  SearXNG ──→ ✅ Fonctionnel (Léon XIV trouvé)     │
│       │                                          │
│  Piper  ──→ ✅ NPU RTF 0.089 — parfait            │
│  NPU TTS                                         │
│       │                                          │
│  Follow-up → ❌ DÉSACTIVÉ (pas d'AEC)             │
│               Wake word obligatoire               │
│                                                  │
├─────────────────────────────────────────────────┤
│  PROCHAINES ACTIONS :                            │
│  1. Prompt Whisper FR (10 min)                   │
│  2. System prompt Claude concis (30 min)         │
│  3. AEC logiciel PulseAudio (2-4h)              │
│  4. Intent router v2 (2-3h)                      │
│  5. ReSpeaker XVF3800 quand budget OK (50€)     │
└─────────────────────────────────────────────────┘
```

---

## 8. Métriques à Suivre

Après chaque session de test, mesurer :

| Métrique | Cible | Actuel |
|----------|-------|--------|
| Taux de transcription correcte Groq | > 95% | ~70% (follow-up) |
| Latence wake word → 1ère syllabe réponse | < 2.0s | ~2.5s |
| Taux de réponse correcte (intent routing) | > 90% | ~75% |
| Taux de recherche SearXNG quand nécessaire | 100% | ~60% |
| Nombre de phrases par réponse Claude | ≤ 2 | ~4-6 |
| Boucles d'auto-écoute par session | 0 | 1 (corrigé) |

---

*Document post-mortem — Projet OpenClaw/Diva — 16 mars 2026*
*À utiliser comme référence pour Claude Code lors des prochaines modifications*
