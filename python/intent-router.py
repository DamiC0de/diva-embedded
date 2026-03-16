#!/usr/bin/env python3
"""
Diva Intent Router v3 — Hybrid Regex + Qwen NPU
Pass 1: Regex keywords (0.05ms) for obvious intents
Pass 2: Qwen 0.5B NPU (~360ms) for ambiguous phrases
HTTP server on port 8882
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
    # Instructions/mémoire → toujours Claude
    ("instruction", [
        r"(enregistre|memorise|retiens|note|rappelle-toi|souviens|sauvegarde)",
        r"(il faut que tu|je vais te donner|je te donne|n'oublie pas)",
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
        r"\b(porte|garage|volet|store|rideau|ferme|ouvre|verrouill)",
        r"\b(aspirateur|robot|machine|lave)",
    ]),
    # Timer / alarm
    ("timer", [
        r"\b(timer|minuteur|minuterie|chrono|compte?\s*[aà]\s*rebours|countdown)",
        r"\b(alarme|alarm|r[eé]veil)\b",
        r"\b(rappel|remind|rappelle)",
        r"\b(dans\s+\d+\s*(minute|seconde|heure|min|sec|h)\b)",
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
    # Baby / BabySync
    ("baby", [
        r"\b(b[eé]b[eé]|baby|jean|nourrisson|nouveau.n[eé])",
        r"\b(biberon|couche|t[eé]t[eé]e|allaitement|sieste|dodo)",
        r"\b(babysync|baby.sync)",
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
        r"\b(quel\s+jour|quelle?\s+date|date\s+d.aujourd|what\s+day)",
        r"(la\s+date|l.heure|le\s+jour)\b",
        r"\b(donne|dis|dire|donner).*(heure|date|jour)",
        r"\b(il\s+est\s+quelle|as.l.heure)",
    ]),
    # Greeting (standalone ONLY)
    ("greeting", [
        r"^(salut|bonjour|coucou|hello|hi|hey|yo|bonsoir)[\s,!.]*$",
        r"^(wesh|ciao|ola)[\s,!.]*$",
    ]),
    # Goodbye
    ("goodbye", [
        r"\b(au\s+revoir|bye|bonne?\s+nuit|good\s*night|adieu)\b",
        r"^(bonne\s+soir[eé]e|[aà]\s+demain|[aà]\s+bient[oô]t|[aà]\s+plus)[\s,!.]*$",
    ]),
    # Shutdown
    ("shutdown", [
        r"\b(ta\s+gueule|tais[- ]toi|ferme[- ]la|shut\s+up|silence|arr[eê]te)\b",
    ]),
]

COMPILED_RULES = []
for intent_name, patterns in INTENT_RULES_ORDERED:
    compiled = [re.compile(p, re.IGNORECASE | re.UNICODE) for p in patterns]
    COMPILED_RULES.append((intent_name, compiled))

# Intent → routing type
LOCAL_CATS = {"time", "timer", "calculator", "greeting", "goodbye", "identity", "baby", "shutdown"}
QWEN_CATS = {"conversational"}
HA_CATS = {"home_control", "music"}
CLAUDE_CATS = {"weather", "news", "instruction", "complex"}


def classify_keywords(text):
    """Pass 1: Regex keywords. Returns (category, confidence) or (None, 0)."""
    text_clean = text.strip()
    # Memory/instruction bypass
    if re.search(r"(enregistre|memorise|retiens|note|rappelle-toi|souviens|sauvegarde|il faut que tu|je vais te donner|je te donne)", text_clean, re.IGNORECASE):
        return "instruction", 0.95
    for category, patterns in COMPILED_RULES:
        for pattern in patterns:
            if pattern.search(text_clean):
                return category, 0.95
    return None, 0.0


# ============================================================
# PASS 2 — Qwen NPU classification (~360ms)
# Only called when regex has no match
# ============================================================

QWEN_CLASSIFY_PROMPT = """Tu es un classifieur d'intent. Classe cette phrase en UNE seule catégorie.

Catégories possibles:
- conversational: salutations avec question (comment vas-tu, ça va, quoi de neuf)
- time: demande d'heure ou de date
- weather: demande de météo
- home_control: contrôle maison (lumière, chauffage, porte)
- timer: minuteur, alarme, rappel
- calculator: calcul, conversion
- identity: qui es-tu, comment tu t'appelles
- news: actualités, infos du jour
- complex: tout le reste (questions, raisonnement, recherche)

Exemples:
- "comment vas-tu ce matin" → conversational
- "raconte-moi une blague" → complex
- "tu connais Besançon" → complex
- "bonjour, donne-moi la date" → time
- "c'est quoi le programme ce soir" → complex

Réponds UNIQUEMENT avec le nom de la catégorie, rien d'autre.

Phrase: """


def classify_qwen(text):
    """Pass 2: Qwen NPU classification. Returns (category, confidence)."""
    try:
        data = json.dumps({
            "model": "qwen2.5-0.5b",
            "messages": [{"role": "user", "content": QWEN_CLASSIFY_PROMPT + text}],
            "max_tokens": 10,
            "temperature": 0.0,
        }).encode()

        req = urllib.request.Request(
            f"{QWEN_URL}/v1/chat/completions",
            data=data,
            headers={"Content-Type": "application/json"},
        )

        start = time.perf_counter()
        resp = urllib.request.urlopen(req, timeout=3)
        result = json.loads(resp.read())
        elapsed_ms = (time.perf_counter() - start) * 1000

        category = result["choices"][0]["message"]["content"].strip().lower()
        # Clean up the category
        category = category.split()[0].strip(".,!?:;\"'")

        # Validate it's a known category
        valid = {"conversational", "time", "weather", "home_control", "timer",
                 "calculator", "identity", "news", "complex", "greeting", "goodbye"}
        if category not in valid:
            category = "complex"
        # Safety: if Qwen says home_control/timer/calculator for a non-obvious phrase,
        # it is probably wrong. Default to complex for safety.
        risky_local = {"home_control", "timer", "calculator", "baby", "identity"}
        if category in risky_local:
            logger.info(f"  [Qwen] Overriding risky category {category} -> complex")
            category = "complex"

        logger.info(f"  [Qwen] '{text[:40]}' -> {category} ({elapsed_ms:.0f}ms)")
        return category, 0.8

    except Exception as e:
        logger.warning(f"  [Qwen] Failed: {e}, defaulting to complex")
        return "complex", 0.5


# ============================================================
# Main classification: Regex first, Qwen fallback
# ============================================================

def classify(text):
    start = time.perf_counter()

    # Pass 1: Regex (instant)
    category, confidence = classify_keywords(text)

    # Pass 2: Qwen NPU (if regex found nothing)
    if category is None:
        category, confidence = classify_qwen(text)

    elapsed_ms = (time.perf_counter() - start) * 1000

    if category in LOCAL_CATS:
        intent = "local_simple"
    elif category in QWEN_CATS:
        intent = "local_simple"  # handled by Qwen in index.ts
    elif category in HA_CATS:
        intent = "home_control"
    else:
        intent = "complex"

    return {
        "intent": intent,
        "category": category,
        "confidence": confidence,
        "latency_ms": round(elapsed_ms, 3)
    }


# ============================================================
# HTTP Server
# ============================================================

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        if self.path == "/v1/classify":
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            text = body.get("text", "")
            if not text:
                self._respond(400, {"error": "No text"})
                return
            result = classify(text)
            logger.info(f"'{text[:60]}' -> {result['intent']} ({result['category']}) [{result['latency_ms']}ms]")
            self._respond(200, result)
        else:
            self._respond(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok", "version": "3.0", "mode": "hybrid-regex-qwen"})
        else:
            self._respond(404, {"error": "Not found"})


def main():
    logger.info("Starting Intent Router v3 (Hybrid Regex + Qwen NPU)...")

    tests = [
        ("quelle heure il est", "time"),
        ("quel temps fait-il demain", "weather"),
        ("allume la lumiere du salon", "home_control"),
        ("salut", "greeting"),
        ("combien font 47 fois 23", "calculator"),
        ("mets un timer de 5 minutes", "timer"),
        ("bonne nuit", "goodbye"),
        ("qui es-tu", "identity"),
        ("comment va le bebe", "baby"),
        ("ta gueule", "shutdown"),
        ("baisse le volume", "music"),
        ("enregistre mon adresse", "instruction"),
    ]
    passed = 0
    for text, expected in tests:
        result = classify(text)
        ok = result["category"] == expected
        if ok: passed += 1
        status = "OK" if ok else f"FAIL (got {result['category']})"
        logger.info(f"  {status}: '{text}' -> {result['category']} [{result['latency_ms']}ms]")

    # Test Qwen fallback with ambiguous phrases
    logger.info("--- Qwen NPU tests (ambiguous) ---")
    qwen_tests = [
        "comment vas-tu ce matin",
        "raconte-moi une blague",
        "est-ce que tu connais Besançon",
        "Bonjour je voudrais la date et l'heure",
    ]
    for text in qwen_tests:
        result = classify(text)
        logger.info(f"  '{text}' -> {result['category']} [{result['latency_ms']}ms]")

    logger.info(f"Regex self-test: {passed}/{len(tests)} passed")
    server = HTTPServer((HOST, PORT), Handler)
    logger.info(f"Intent Router v3 on {HOST}:{PORT} (hybrid regex+qwen)")
    server.serve_forever()

if __name__ == "__main__":
    main()
