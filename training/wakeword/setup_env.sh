#!/bin/bash
# =============================================================================
# setup_env.sh — Installe TOUT automatiquement pour enregistrer/entraîner
#
# Ce script installe :
#   - Miniconda (si pas déjà installé)
#   - Python 3.10 dans un environnement conda "diva"
#   - Toutes les dépendances (PyTorch, openWakeWord, etc.)
#   - Les dépendances système (espeak-ng, portaudio)
#
# Usage : bash setup_env.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONDA_DIR="$HOME/miniconda3"
ENV_NAME="diva"

echo ""
echo "=============================================="
echo "  Installation de l'environnement Diva"
echo "=============================================="
echo ""

# --- 1. Dépendances système ---
echo "=== [1/4] Dépendances système ==="
if command -v espeak-ng &>/dev/null && command -v git &>/dev/null; then
    echo "  ✓ Dépendances système déjà installées"
else
    echo "  Installation de espeak-ng, portaudio, git..."
    if command -v apt &>/dev/null; then
        sudo apt update -qq
        sudo apt install -y -qq espeak-ng portaudio19-dev git wget curl
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y espeak-ng portaudio-devel git wget curl
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm espeak-ng portaudio git wget curl
    else
        echo "  ⚠ Gestionnaire de paquets non reconnu."
        echo "  Installe manuellement : espeak-ng portaudio19-dev git wget"
    fi
    echo "  ✓ Dépendances système installées"
fi

# --- 2. Miniconda ---
echo ""
echo "=== [2/4] Miniconda ==="
if [ -f "$CONDA_DIR/bin/conda" ]; then
    echo "  ✓ Miniconda déjà installé ($CONDA_DIR)"
else
    echo "  Téléchargement de Miniconda..."
    wget -q --show-progress -O /tmp/miniconda.sh \
        https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
    echo "  Installation..."
    bash /tmp/miniconda.sh -b -p "$CONDA_DIR"
    rm /tmp/miniconda.sh

    # Accepter les TOS
    export PATH="$CONDA_DIR/bin:$PATH"
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main 2>/dev/null || true
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r 2>/dev/null || true

    echo "  ✓ Miniconda installé"
fi

export PATH="$CONDA_DIR/bin:$PATH"
eval "$($CONDA_DIR/bin/conda shell.bash hook)"

# --- 3. Environnement conda ---
echo ""
echo "=== [3/4] Environnement conda '$ENV_NAME' (Python 3.10) ==="
if conda env list | grep -q "^${ENV_NAME} "; then
    echo "  ✓ Environnement '$ENV_NAME' déjà créé"
else
    echo "  Création de l'environnement..."
    conda create -n "$ENV_NAME" python=3.10 portaudio -y -q
    echo "  ✓ Environnement créé"
fi

conda activate "$ENV_NAME"

# --- 4. Dépendances Python ---
echo ""
echo "=== [4/4] Dépendances Python ==="

# Vérifier si déjà installé
if python -c "import openwakeword, pyaudio, yaml" 2>/dev/null; then
    echo "  ✓ Dépendances Python déjà installées"
else
    echo "  Installation de PyTorch..."
    pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cu121 2>/dev/null \
        || pip install -q torch torchaudio  # Fallback CPU si pas de GPU

    echo "  Installation des dépendances..."
    pip install -q -r "$SCRIPT_DIR/requirements.txt"

    # Fix ALSA conda vs système
    CONDA_LIB="$CONDA_DIR/envs/$ENV_NAME/lib"
    for f in libasound.so libasound.so.2 libasound.so.2.0.0; do
        if [ -f "$CONDA_LIB/$f" ]; then
            mv "$CONDA_LIB/$f" "$CONDA_LIB/${f}.bak" 2>/dev/null || true
        fi
    done

    # Copier les modèles d'embedding dans openWakeWord
    OWW_MODELS="$CONDA_LIB/python3.10/site-packages/openwakeword/resources/models"
    if [ -d "$OWW_MODELS" ] && [ -f "$SCRIPT_DIR/data/models/melspectrogram.onnx" ]; then
        cp "$SCRIPT_DIR/data/models/melspectrogram.onnx" "$OWW_MODELS/"
        cp "$SCRIPT_DIR/data/models/embedding_model.onnx" "$OWW_MODELS/"
    fi

    echo "  ✓ Dépendances Python installées"
fi

# --- Résumé ---
echo ""
echo "=============================================="
echo "  Installation terminée !"
echo "=============================================="
echo ""
echo "  Pour activer l'environnement :"
echo "    eval \"\$(~/miniconda3/bin/conda shell.bash hook)\" && conda activate diva"
echo ""
echo "  Pour enregistrer ta voix :"
echo "    cd $SCRIPT_DIR && bash record.sh"
echo ""
echo "  Pour entraîner le modèle :"
echo "    cd $SCRIPT_DIR && bash run_train.sh"
echo ""
