#!/bin/bash
# Register a new speaker for Diva voice identification
# Uses running services (diva-audio:9010 + diva-memory:9002)
set -e

AUDIO_URL="http://localhost:9010"
MEMORY_URL="http://localhost:9002"

echo "=== Enregistrement d'un nouveau locuteur ==="
echo ""

# Check services
if ! curl -sf "$AUDIO_URL/health" > /dev/null 2>&1; then
    echo "ERREUR: diva-audio ne tourne pas (port 9010)"; exit 1
fi
if ! curl -sf "$MEMORY_URL/health" > /dev/null 2>&1; then
    echo "ERREUR: diva-memory ne tourne pas (port 9002)"; exit 1
fi

read -p "Nom du locuteur (ex: nicolas, natacha): " SPEAKER_NAME
[ -z "$SPEAKER_NAME" ] && echo "Nom requis" && exit 1
SPEAKER_NAME=$(echo "$SPEAKER_NAME" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

echo ""
echo "3 echantillons vocaux a enregistrer."
echo "Parlez 3-5 secondes a chaque fois."
echo ""

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

for i in 1 2 3; do
    while true; do
        echo "=== Echantillon $i/3 ==="
        read -p "Entree pour commencer..." -r
        echo "Parlez maintenant..."

        curl -sf -X POST "$AUDIO_URL/audio/record" \
            -H "Content-Type: application/json" \
            -d '{"max_duration_s": 5, "silence_timeout_s": 2, "min_speech_ms": 500}' \
            > "$TMPDIR/resp_$i.json"

        HAS=$(python3 -c "import json; print(json.load(open('$TMPDIR/resp_$i.json'))['has_speech'])")
        if [ "$HAS" = "True" ]; then
            DUR=$(python3 -c "import json; print(json.load(open('$TMPDIR/resp_$i.json')).get('duration_ms','?'))")
            echo "OK - echantillon $i (${DUR}ms)"
            break
        else
            echo "Pas de voix, reessayez"
        fi
    done
    echo ""
done

echo "Traitement..."

python3 - "$TMPDIR" "$SPEAKER_NAME" "$MEMORY_URL" << 'PYEOF'
import base64, io, wave, json, sys, os
from urllib.request import Request, urlopen

tmpdir, name, mem_url = sys.argv[1], sys.argv[2], sys.argv[3]

all_frames = b""
params = None

for i in range(1, 4):
    with open(os.path.join(tmpdir, f"resp_{i}.json")) as f:
        data = json.load(f)
    wav_bytes = base64.b64decode(data["wav_base64"])
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        if params is None:
            params = wf.getparams()
        all_frames += wf.readframes(wf.getnframes())

combined = io.BytesIO()
with wave.open(combined, "wb") as wf:
    wf.setparams(params)
    wf.writeframes(all_frames)
combined.seek(0)
combined_b64 = base64.b64encode(combined.read()).decode()

payload = json.dumps({"name": name, "audio": combined_b64}).encode()
req = Request(f"{mem_url}/speaker/register", data=payload,
              headers={"Content-Type": "application/json"})
resp = urlopen(req)
result = json.loads(resp.read())

if result.get("status") == "ok":
    resp2 = urlopen(f"{mem_url}/health")
    health = json.loads(resp2.read())
    speakers = health.get("speakers", [])
    print(f"Locuteur '{name}' enregistre!")
    print("Locuteurs: " + ", ".join(speakers))
else:
    print(f"Erreur: {result}")
    sys.exit(1)
PYEOF

echo ""
echo "Termine! Le locuteur '$SPEAKER_NAME' sera identifie par Diva."
