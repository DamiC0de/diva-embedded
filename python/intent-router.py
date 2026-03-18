#!/usr/bin/env python3
"""
Diva Intent Router v3 — Hybrid Regex + Qwen NPU
Pass 1: Regex keywords (0.05ms) for obvious intents
Pass 2: Qwen 0.5B NPU (~360ms) for ambiguous phrases
HTTP server on port 8882

v3.1: Added Qwen preloading at startup for instant first query
"""
import json, time, logging, os, re
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("intent-router")

HOST = os.environ.get("INTENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("INTENT_PORT", "8882"))
QWEN_URL = os.environ.get("QWEN_URL", "http://localhost:8080")

# ============================================================
# PASS 1 — Regex keywords (instant, <0.1ms)
# ORDER MATTERS — first match wins
# ============================================================

INTENT_RULES_ORDERED = [
    # Emergency / distress (HIGHEST PRIORITY)
    ("emergency", [
        r"\b(j.ai\s+mal|au\s+secours|aide[- ]?moi|urgence)\b",
        r"\b(je\s+suis\s+tomb[eé]|je\s+ne\s+peux\s+pas)\b",
        r"\b(appel.*aide|help|sos)\b",
        r"\b(mal\s+au\s+(coeur|ventre|poitrine|bras|dos))\b",
        r"\b(je\s+me\s+sens\s+mal|j.ai\s+peur)\b",
    ]),

    # Speaker registration (FIRST - before instruction captures "enregistre")
    ("speaker_register", [
        r"(enregistre|apprends?)\s+(ma\s+voix|qui\s+je\s+suis)",
        r"m[eé]morise\s+ma\s+voix",
    ]),
    # Instructions/mémoire → toujours Claude
    ("instruction", [
        r"(enregistre|memorise|retiens|note|rappelle-toi|souviens|sauvegarde)",
        r"(il faut que tu|je vais te donner|je te donne|n'oublie pas)",
    ]),
    # Shopping list
    ("shopping", [
        r"\b(liste\s+(de\s+)?course|course|courses)\b",
        r"\b(ajoute|mets?|rajoute)\b.*(liste|course)",
        r"\b(enl[eè]ve|retire|supprime)\b.*(liste|course)",
    ]),
    # Radio / music
    ("radio", [
        r"\b(radio|mets\s+(france|fip|rtl|nrj|nostalgie|jazz|classique))",
        r"\b(arr[eê]te|coupe|stop)\s+(la\s+)?(radio|musique)",
        r"\b(quelle\s+radio|quelles?\s+radios?\s+disponible)",
    ]),
    # Routines
    ("routine", [
        r"\b(routine\s+\w+)",
        r"\b(lance|d[eé]marre|active)\s+(la\s+)?routine",
    ]),

    # Morning briefing
    ("briefing", [
        r"^(bonjour|bonsoir|coucou)\s*!?\s*(diva)?\s*!?\s*$",
        r"\b(briefing|r[eé]sum[eé]\s+du\s+jour|quoi\s+de\s+neuf\s+aujourd)",
    ]),

    # Jokes / riddles / fun facts
    ("joke", [
        r"\b(blague|joke|raconte.*(blague|histoire\s+dr[oô]le)|fais.moi\s+rire)\b",
        r"\b(devinette|riddle|charade|enigme|[eé]nigme)\b",
        r"\b(fait\s+(du\s+jour|amusant|int[eé]ressant|marrant)|anecdote|le\s+savais.tu)\b",
    ]),
    # Weather
    ("weather", [
        r"\b(m[eé]t[eé]o|weather|forecast|pr[eé]vision)",
        r"\b(quel\s+temps|il\s+fait\s+(beau|chaud|froid|moche|combien))",
        r"\b(pleut|pluie|neige|soleil|vent|orage|nuage|brouillard)",
        r"\b(va.t.il\s+(pleuvoir|neiger|faire))",
    ]),
    # Home control
    ("home_control", [
        r"\b(allume|[eé]teins?|lumi[eè]re|lampe|light|turn\s+(on|off)|switch)",
        r"\b(thermostat|chauffage|clim|climatisation|ventil)",
        r"\b(porte|garage|volet|store|rideau|ouvre|verrouill)",
        r"\b(aspirateur|robot|machine|lave)",
    ]),
    # Timer / alarm / reminders
    ("timer", [
        r"\b(timer|minuteur|minuterie|chrono|compte?\s*[aà]\s*rebours|countdown)",
        r"\b(alarme|alarm|r[eé]veil)\b",
        r"\b(rappel|remind|rappelle)",
        r"\b(dans\s+\d+\s*(minute|seconde|heure|min|sec|h)\b)",
    ]),
    # Do Not Disturb / Night Mode
    ("dnd", [
        r"\b(mode\s+(nuit|silencieux|silence|dnd|ne\s+pas\s+d[eé]ranger))\b",
        r"\b(ne\s+(me\s+)?d[eé]range\s+(plus|pas))\b",
        r"\b(tais[- ]toi\s+jusqu)\b",
        r"\b(d[eé]sactive|arr[eê]te)\s+(le\s+)?mode\s+(nuit|silencieux)\b",
        r"\b(r[eé]active|remet)[- ]?(toi)?\s+(en\s+)?mode\s+normal\b",
    ]),
    # Music / media
    ("music", [
        r"\b(musique|music|play|joue|mets|lance)\s+(de\s+la|du|the|some)",
        r"\b(spotify|playlist|chanson|song|album|artiste)",
        r"\b(pause|stop|suivant|next|pr[eé]c[eé]dent|previous|skip)",
        r"\b(volume|baisse|monte|plus\s+fort|moins\s+fort|mute|sourdine)",
    ]),
    # Calculator
    ("calculator", [
        r"\b(combien\s+(font?|fait|vaut))",
        r"\b(\d+\s*[\+\-\*\/x]\s*\d+)",
        r"\b(\d+\s*(plus|moins|fois|divis[eé])\s+\d*)",
        r"\b(convert|conver[st]i|combien\s+(de|en)\s+(kilo|gramm|m[eè]tre|litre))",
    ]),
    # Identity
    ("identity", [
        r"\b(qui\s+(es[- ]tu|[eê]tes.vous)|who\s+are\s+you)",
        r"\b(comment\s+tu\s+t.appelle|ton\s+nom|your\s+name)",
        r"\b(pr[eé]sente[- ]toi|tu\s+fais\s+quoi|que\s+sais[- ]tu\s+faire)",
    ]),
    # Time / date
    ("time", [
        r"\b(quelle?\s+heure|heure\s+(est|il)|what\s+time)",
        r"\bon\s+est\s+quel\s+jour\b|\bquel\s+jour\s+(sommes|est-on)\b|\bquelle\s+date\s+(sommes|est-on)\b",
        r"\bla\s+date\s+d.aujourd.hui\b|\bl.heure\s+(s.il|qu.il)\b",
        r"\b(donne|dis).*l.heure\b",
        r"\b(il\s+est\s+quelle|as.l.heure)",
    ]),
    # Conversational (greetings + how are you)
    ("conversational", [
        r"(comment|ca|ça)\s*(vas?|va|allez|roule)",
        r"quoi\s+de\s+(neuf|beau|bon)",
        r"la\s+forme",
    ]),
    # Greeting (standalone ONLY)
    ("greeting", [
        r"^(salut|bonjour|coucou|hello|hi|hey|yo|bonsoir)[\s,!.]*$",
        r"^(wesh|ciao|ola)[\s,!.]*$",
    ]),
    # Goodbye
    ("goodbye", [
        r"\b(au\s+revoir|bye|bonne?\s+nuit|adieu|ciao|tchao)\b",
        r"\b([aà]\s+plus|[aà]\s+bient[oô]t|[aà]\s+demain|bonne\s+soir[eé]e)\b",
        r"\b(c.est\s+(bon|fini|tout|termin[eé])|j.(en\s+)?ai\s+fini|on\s+arr[eê]te)\b",
        r"\bmerci.{0,15}([aà]\s+plus|[aà]\s+bient[oô]t)\b",
    ]),
    # Shutdown
    ("shutdown", [
        r"\b(ta\s+gueule|tais[- ]toi|ferme|ferme[- ]la|ferme[- ]ta|shut\s+up|silence|arr[eê]te)\b",
    ]),
]

COMPILED_RULES = []
for intent_name, patterns in INTENT_RULES_ORDERED:
    compiled = [re.compile(p, re.IGNORECASE | re.UNICODE) for p in patterns]
    COMPILED_RULES.append((intent_name, compiled))

# Intent → routing type
LOCAL_CATS = {
    "greeting", "goodbye", "shutdown", "time", "identity",
    "conversational", "calculator", "timer", "weather",
    "speaker_register", "joke", "dnd", "shopping", "radio", "briefing", "routine",
}

def classify_regex(text):
    """Pass 1: fast regex matching."""
    for intent_name, compiled_patterns in COMPILED_RULES:
        for pat in compiled_patterns:
            if pat.search(text):
                return intent_name, 0.95
    return None, 0.0

def classify_qwen(text):
    """Pass 2: Qwen 0.5B NPU for ambiguous input (OpenAI chat API)."""
    valid = {
        "greeting", "goodbye", "shutdown", "time", "weather",
        "home_control", "timer", "music", "calculator", "identity",
        "instruction", "conversational", "speaker_register", "joke",
        "dnd", "shopping", "radio", "briefing", "routine", "complex",
    }
    categories = ", ".join(sorted(valid))
    try:
        payload = json.dumps({
            "model": "qwen2.5-0.5b",
            "messages": [
                {"role": "system", "content": f"Classify the user's French text into exactly ONE category: {categories}. Reply with ONLY the category name, nothing else."},
                {"role": "user", "content": text},
            ],
            "max_tokens": 10,
            "temperature": 0.1,
        }).encode()
        req = urllib.request.Request(
            f"{QWEN_URL}/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            result = json.loads(resp.read())
        cat = result["choices"][0]["message"]["content"].strip().lower().strip('"').strip("'")
        if cat not in valid:
            cat = "complex"
        return cat, 0.7
    except Exception as e:
        logger.warning(f"Qwen error: {e}")
        return "complex", 0.0

def preload_qwen():
    """Warmup Qwen NPU model at startup to avoid cold start latency."""
    logger.info("Preloading Qwen NPU model...")
    t0 = time.monotonic()
    try:
        cat, _ = classify_qwen("Bonjour, comment ça va ?")
        latency = round((time.monotonic() - t0) * 1000, 1)
        logger.info(f"Qwen preload OK: '{cat}' in {latency}ms (cold start)")
        # Second call to confirm warm performance
        t1 = time.monotonic()
        cat2, _ = classify_qwen("Quelle heure est-il ?")
        latency2 = round((time.monotonic() - t1) * 1000, 1)
        logger.info(f"Qwen warm verify: '{cat2}' in {latency2}ms")
    except Exception as e:
        logger.warning(f"Qwen preload failed (non-fatal): {e}")

# ============================================================
# HTTP Server
# ============================================================

class IntentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logging

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok", "qwen_url": QWEN_URL})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/classify":
            self._respond(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        text = body.get("text", "").strip()
        if not text:
            self._respond(400, {"error": "missing text"})
            return

        t0 = time.monotonic()

        # Pass 1: regex
        category, confidence = classify_regex(text)
        method = "regex"

        # Pass 2: Qwen if no regex match
        if category is None:
            category, confidence = classify_qwen(text)
            method = "qwen"

        intent = "local" if category in LOCAL_CATS else "complex"
        latency_ms = round((time.monotonic() - t0) * 1000, 1)

        result = {
            "intent": intent,
            "category": category,
            "confidence": confidence,
            "method": method,
            "latency_ms": latency_ms,
        }
        logger.info(f"[{method}] \"{text}\" → {category} ({intent}) {latency_ms}ms")
        self._respond(200, result)


if __name__ == "__main__":
    # Preload Qwen model before accepting requests
    preload_qwen()

    server = HTTPServer((HOST, PORT), IntentHandler)
    logger.info(f"Intent Router listening on {HOST}:{PORT}")
    logger.info(f"Qwen NPU at {QWEN_URL}")
    logger.info(f"{len(COMPILED_RULES)} regex rules loaded")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.server_close()
