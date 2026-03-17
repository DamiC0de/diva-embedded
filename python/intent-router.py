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
    ("goodbye", [        r"\b(au\s+revoir|bye|bonne?\s+nuit|adieu|ciao|tchao)\b",        r"\b([aà]\s+plus|[aà]\s+bient[oô]t|[aà]\s+demain|bonne\s+soir[eé]e)\b",        r"\b(c.est\s+(bon|fini|tout|termin[eé])|j.(en\s+)?ai\s+fini|on\s+arr[eê]te)\b",        r"\bmerci.{0,15}([aà]\s+plus|[aà]\s+bient[oô]t)\b",    ]),
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
