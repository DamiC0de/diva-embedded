#!/usr/bin/env python3
"""
Diva Intent Router v4 — Minimal regex, Claude handles the rest
Only unambiguous commands are matched locally.
Everything else → Claude for intelligent contextual handling.
HTTP server on port 8882
"""
import json, time, logging, os, re
from http.server import HTTPServer, BaseHTTPRequestHandler

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("intent-router")

HOST = os.environ.get("INTENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("INTENT_PORT", "8882"))

# ============================================================
# MINIMAL REGEX — only unambiguous commands
# Everything else goes to Claude
# ============================================================

INTENT_RULES_ORDERED = [
    # Speaker registration
    ("speaker_register", [
        r"(enregistre|apprends?)\s+(ma\s+voix|qui\s+je\s+suis)",
        r"m[eé]morise\s+ma\s+voix",
    ]),
    # Personal memory queries
    ("about_me", [
        r"\b(qu.est.ce que|que|quoi).*(sais|connais|retenu|souviens).*(sur moi|de moi|me concern)",
        r"\b(tu\s+(me\s+)?connais|tu\s+sais\s+qui\s+je\s+suis)",
        r"\b(parle[- ]moi\s+de\s+moi|dis[- ]moi\s+ce\s+que\s+tu\s+sais)",
        r"\bsais.*[aà]\s+qui\s+tu\s+parle",
        r"\b(qui\s+je\s+suis|tu\s+me\s+reconnais)",
        r"\b(c.est\s+qui\s+qui\s+te\s+parle|tu\s+sais\s+c.est\s+qui)",
    ]),
    # Time / date — only exact patterns
    ("time", [
        r"\b(quelle?\s+heure|heure\s+(est|il))\b",
        r"\bon\s+est\s+quel\s+jour\b",
        r"\bquel\s+jour\s+(sommes|est-on)\b",
        r"\bquelle\s+date\b",
        r"\b(donne|dis)[- ]moi\s+l.heure\b",
        r"\bil\s+est\s+quelle\s+heure\b",
    ]),
    # Timer — structured format only
    ("timer", [
        r"\b(minuteur|timer)\s+(\d+|de\s+\d+)",
        r"\b(dans\s+\d+\s*(minute|seconde|heure|min|sec|h)\b)",
        r"\brappelle[- ]?moi\s+dans\s+\d+",
        r"\b(annule|supprime|arr[eê]te)\s+(le\s+|les\s+)?minuteur",
    ]),
    # Calculator — digit+operator+digit only
    ("calculator", [
        r"\b(\d+)\s*(plus|\+|fois|x|\*|moins|-|divis[eé]e?\s*par|\/)\s*(\d+)",
        r"\bcombien\s+(font?|fait)\s+\d+",
    ]),
    # DND — explicit command only
    ("dnd", [
        r"\bmode\s+(nuit|silencieux|silence|ne\s+pas\s+d[eé]ranger)\b",
        r"\b(d[eé]sactive|arr[eê]te)\s+(le\s+)?mode\s+(nuit|silencieux)\b",
        r"\b(r[eé]active|remet).*mode\s+normal\b",
    ]),
]

COMPILED_RULES = []
for intent_name, patterns in INTENT_RULES_ORDERED:
    compiled = [re.compile(p, re.IGNORECASE | re.UNICODE) for p in patterns]
    COMPILED_RULES.append((intent_name, compiled))

LOCAL_CATS = {"time", "timer", "calculator", "dnd", "speaker_register", "about_me"}

def classify_regex(text):
    for intent_name, compiled_patterns in COMPILED_RULES:
        for pat in compiled_patterns:
            if pat.search(text):
                return intent_name, 0.95
    return None, 0.0

# ============================================================
# HTTP Server
# ============================================================

class IntentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok"})
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

        category, confidence = classify_regex(text)
        method = "regex"

        if category is None:
            category = "complex"
            confidence = 0.0
            method = "default"

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
    server = HTTPServer((HOST, PORT), IntentHandler)
    logger.info(f"Intent Router v4 (minimal regex) on {HOST}:{PORT}")
    logger.info(f"{len(COMPILED_RULES)} regex rules loaded, everything else → Claude")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.server_close()
