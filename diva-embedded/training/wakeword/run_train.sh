#!/bin/bash
# Lance l'entraînement.
# Usage : cd ~/Documents/Projects/iaProject/Diva && bash run_train.sh

set -euo pipefail
cd "$(dirname "$0")"

export PATH="/home/jojo/miniconda3/bin:/usr/bin:$PATH"
eval "$(conda shell.bash hook)"
conda activate diva

echo "=== Lancement de l'entraînement ==="
echo "Log : train.log"
echo ""

# PYTHONUNBUFFERED=1 force le flush immédiat de tous les prints
PYTHONUNBUFFERED=1 python scripts/train.py --config config/training_config.yaml 2>&1 | tee train.log

echo ""
echo "=== Terminé ==="
