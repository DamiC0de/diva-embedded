#!/bin/bash
# =============================================================================
# record_on_rock.sh — Enregistre des samples "Diva" directement sur le Rock 5B+
#
# Enregistre à travers le pipeline audio réel (PulseAudio/AEC) pour que
# le modèle soit calibré sur le signal exact qu'il recevra en production.
#
# Usage (sur le Rock) :
#   bash record_on_rock.sh
#   bash record_on_rock.sh 30              # 30 samples au lieu de 50
#   bash record_on_rock.sh 50 pulse        # Source PulseAudio spécifique
#   bash record_on_rock.sh 50 aec_source   # Source AEC
#
# Ensuite, récupère les recordings depuis ton PC :
#   scp root@72.60.155.227:/tmp/diva-recordings/*.wav recordings/
# =============================================================================
set -euo pipefail

COUNT="${1:-50}"
SOURCE="${2:-default}"
OUTPUT_DIR="/tmp/diva-recordings"
SAMPLE_RATE=16000
DURATION=2

echo ""
echo "=============================================="
echo "  Enregistrement wake word 'Diva' — Rock 5B+"
echo "=============================================="
echo ""

# --- Vérifier les outils ---
if ! command -v arecord &>/dev/null; then
    echo "ERREUR: arecord non trouvé. Installe : apt install alsa-utils"
    exit 1
fi

# --- Lister les sources disponibles ---
echo "=== Sources audio disponibles ==="
if command -v pactl &>/dev/null; then
    pactl list sources short 2>/dev/null | while read -r idx name driver fmt state; do
        echo "  [$idx] $name ($state)"
    done
    echo ""
    DEFAULT_SOURCE=$(pactl get-default-source 2>/dev/null || echo "inconnu")
    echo "  Source par défaut : $DEFAULT_SOURCE"
else
    arecord -l 2>/dev/null
fi
echo ""

# --- Déterminer la commande d'enregistrement ---
if [ "$SOURCE" = "default" ]; then
    # Utiliser parecord (PulseAudio/PipeWire) si disponible, sinon arecord
    if command -v parecord &>/dev/null; then
        REC_CMD="parecord --rate=$SAMPLE_RATE --channels=1 --format=s16le --raw"
        echo "Mode : PulseAudio (source par défaut — inclut AEC si actif)"
    else
        REC_CMD="arecord -D default -f S16_LE -r $SAMPLE_RATE -c 1 -t raw"
        echo "Mode : ALSA default"
    fi
elif [ "$SOURCE" = "alsa" ]; then
    # ALSA brut, bypass PulseAudio
    # Trouver le premier device hardware
    HW_DEV=$(arecord -l 2>/dev/null | grep "^carte" | head -1 | sed 's/carte \([0-9]*\).*périphérique \([0-9]*\).*/hw:\1,\2/')
    if [ -z "$HW_DEV" ]; then
        HW_DEV="hw:0,0"
    fi
    REC_CMD="arecord -D $HW_DEV -f S16_LE -r $SAMPLE_RATE -c 1 -t raw"
    echo "Mode : ALSA brut ($HW_DEV) — PAS d'AEC"
else
    # Source PulseAudio spécifique
    if command -v parecord &>/dev/null; then
        REC_CMD="parecord -d $SOURCE --rate=$SAMPLE_RATE --channels=1 --format=s16le --raw"
        echo "Mode : PulseAudio source '$SOURCE'"
    else
        REC_CMD="arecord -D $SOURCE -f S16_LE -r $SAMPLE_RATE -c 1 -t raw"
        echo "Mode : ALSA source '$SOURCE'"
    fi
fi

echo ""

# --- Préparer le répertoire ---
mkdir -p "$OUTPUT_DIR"
EXISTING=$(ls "$OUTPUT_DIR"/*.wav 2>/dev/null | wc -l)
echo "Enregistrements existants : $EXISTING"
echo "Nouveaux à enregistrer : $COUNT"
echo ""

# --- Test micro ---
echo "=== Test micro (2 secondes) ==="
echo "Dis quelque chose..."
TEST_FILE="/tmp/diva_test.raw"
timeout $DURATION $REC_CMD > "$TEST_FILE" 2>/dev/null || true

TEST_SIZE=$(stat -f%z "$TEST_FILE" 2>/dev/null || stat -c%s "$TEST_FILE" 2>/dev/null || echo "0")
if [ "$TEST_SIZE" -lt 1000 ]; then
    echo "  ⚠ Aucun audio capturé ! Vérifie le micro et la source."
    echo "  Sources disponibles :"
    pactl list sources short 2>/dev/null || arecord -l 2>/dev/null
    exit 1
fi

# Calculer le niveau audio
LEVEL=$(python3 -c "
import struct, math
with open('$TEST_FILE', 'rb') as f:
    data = f.read()
samples = struct.unpack('<' + 'h' * (len(data)//2), data)
rms = math.sqrt(sum(s**2 for s in samples) / len(samples))
print(f'{rms:.0f}')
" 2>/dev/null || echo "0")
echo "  Niveau audio : $LEVEL (minimum recommandé : 500)"
if [ "$LEVEL" -lt 100 ]; then
    echo "  ⚠ Audio trop faible. Vérifie le volume du micro."
fi
rm -f "$TEST_FILE"
echo ""

# --- Enregistrement ---
echo "=============================================="
echo "  Prêt ! Tu vas enregistrer $COUNT clips."
echo ""
echo "  Conseils :"
echo "    - Dis 'Diva' normalement, comme pour un assistant"
echo "    - Varie le ton, le volume, la distance"
echo "    - Attends le signal avant de parler"
echo "    - Appuie Entrée pour chaque clip"
echo "    - Tape 'q' pour quitter"
echo "=============================================="
echo ""

RECORDED=0
for i in $(seq 0 $((COUNT - 1))); do
    IDX=$(printf "%04d" $((EXISTING + i)))
    printf "[%d/%d] Appuie Entrée puis dis 'Diva' > " $((i + 1)) "$COUNT"
    read -r INPUT
    if [ "$INPUT" = "q" ]; then
        break
    fi

    # Enregistrer
    RAW_FILE="/tmp/diva_raw_$IDX.raw"
    WAV_FILE="$OUTPUT_DIR/diva_$IDX.wav"

    echo -n "  Enregistrement..."
    timeout $DURATION $REC_CMD > "$RAW_FILE" 2>/dev/null || true
    echo -n " "

    # Vérifier le niveau
    LEVEL=$(python3 -c "
import struct, math
with open('$RAW_FILE', 'rb') as f:
    data = f.read()
if len(data) < 100:
    print('0')
else:
    samples = struct.unpack('<' + 'h' * (len(data)//2), data)
    rms = math.sqrt(sum(s**2 for s in samples) / len(samples))
    print(f'{rms:.0f}')
" 2>/dev/null || echo "0")

    if [ "$LEVEL" -lt 100 ]; then
        echo "Trop faible (niveau: $LEVEL). Réessaie plus fort."
        rm -f "$RAW_FILE"
        continue
    fi

    # Convertir en WAV 16kHz mono
    python3 -c "
import wave, struct
with open('$RAW_FILE', 'rb') as f:
    raw = f.read()
with wave.open('$WAV_FILE', 'w') as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate($SAMPLE_RATE)
    wf.writeframes(raw)
" 2>/dev/null

    rm -f "$RAW_FILE"
    RECORDED=$((RECORDED + 1))
    echo "OK : diva_$IDX.wav (niveau: $LEVEL)"
done

echo ""
echo "=============================================="
echo "  $RECORDED enregistrements sauvegardés"
echo "  Répertoire : $OUTPUT_DIR/"
echo "  Total : $(ls "$OUTPUT_DIR"/*.wav 2>/dev/null | wc -l) clips"
echo "=============================================="
echo ""
echo "  Récupère les fichiers depuis ton PC :"
echo "    scp root@\$(hostname -I | awk '{print \$1}'):$OUTPUT_DIR/*.wav recordings/"
echo ""
echo "  Puis réentraîne :"
echo "    cd ~/Documents/Projects/iaProject/Diva && bash run_train.sh"
echo ""
