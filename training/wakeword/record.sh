#!/bin/bash
# =============================================================================
# record.sh — Enregistre ta voix disant "Diva"
#
# Usage : bash record.sh
#         bash record.sh 30        # 30 enregistrements au lieu de 50
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COUNT="${1:-50}"

# Activer conda
if [ -f "$HOME/miniconda3/bin/conda" ]; then
    export PATH="$HOME/miniconda3/bin:$PATH"
    eval "$($HOME/miniconda3/bin/conda shell.bash hook)"
    conda activate diva
else
    echo "ERREUR: Miniconda non installé. Lance d'abord : bash setup_env.sh"
    exit 1
fi

# Vérifier les dépendances
if ! python -c "import pyaudio" 2>/dev/null; then
    echo "ERREUR: Dépendances manquantes. Lance d'abord : bash setup_env.sh"
    exit 1
fi

echo ""
echo "=============================================="
echo "  Enregistrement du wake word 'Diva'"
echo "=============================================="
echo ""
echo "  Tu vas enregistrer $COUNT clips de 2 secondes."
echo "  Dis 'Diva' comme tu le ferais pour appeler"
echo "  un assistant vocal. Varie le ton, le volume,"
echo "  et la distance au micro."
echo ""
echo "  Les fichiers seront dans : $SCRIPT_DIR/recordings/"
echo ""

cd "$SCRIPT_DIR"
python scripts/record_samples.py --count "$COUNT" --output-dir recordings --wake-word diva

echo ""
echo "=============================================="
echo "  Enregistrements terminés !"
echo "=============================================="
echo ""
echo "  Fichiers dans : $SCRIPT_DIR/recordings/"
echo "  Total : $(ls recordings/*.wav 2>/dev/null | wc -l) clips"
echo ""
echo "  Pour envoyer tes enregistrements :"
echo "    zip -r mes_recordings.zip recordings/"
echo "    # Puis envoie mes_recordings.zip à l'équipe"
echo ""
