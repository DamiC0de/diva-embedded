#!/bin/bash
# =============================================================================
# setup_data.sh — Télécharge toutes les données nécessaires à l'entraînement
#
# Données téléchargées :
#   - 3 voix Piper TTS françaises (~300 Mo)
#   - Features ACAV100M pré-calculées (~2 Go)
#   - Features de validation openWakeWord
#   - Modèles d'embedding openWakeWord (melspectrogram + embedding)
#   - Datasets de bruit MS-SNSD (~1 Go)
#
# Usage : bash scripts/setup_data.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
VOICES_DIR="$PROJECT_DIR/voices"

echo "=============================================="
echo "  Setup des données pour l'entraînement Diva"
echo "=============================================="
echo ""

# --- Créer l'arborescence ---
echo "--- Création des répertoires ---"
mkdir -p "$VOICES_DIR"
mkdir -p "$DATA_DIR"/{features,noise/ms-snsd,positive,negative,augmented}
mkdir -p "$PROJECT_DIR"/{models/checkpoints,recordings}

# =============================================================================
# 1. Voix Piper TTS françaises
# =============================================================================
echo ""
echo "=== [1/5] Téléchargement des voix Piper françaises ==="

PIPER_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR"
for voice in siwis tom upmc; do
    MODEL_FILE="$VOICES_DIR/fr_FR-${voice}-medium.onnx"
    CONFIG_FILE="$VOICES_DIR/fr_FR-${voice}-medium.onnx.json"

    if [ -f "$MODEL_FILE" ]; then
        echo "  ✓ fr_FR-${voice}-medium déjà présent"
    else
        echo "  Téléchargement de fr_FR-${voice}-medium..."
        wget -q --show-progress -O "$MODEL_FILE" \
            "${PIPER_BASE}/${voice}/medium/fr_FR-${voice}-medium.onnx?download=true"
        wget -q --show-progress -O "$CONFIG_FILE" \
            "${PIPER_BASE}/${voice}/medium/fr_FR-${voice}-medium.onnx.json"
        echo "  ✓ fr_FR-${voice}-medium téléchargé"
    fi
done

# =============================================================================
# 2. Features ACAV100M pré-calculées (données négatives)
# =============================================================================
echo ""
echo "=== [2/5] Téléchargement des features ACAV100M ==="

FEATURES_DIR="$DATA_DIR/features"
HF_FEATURES="https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main"

ACAV_FILE="$FEATURES_DIR/openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
if [ -f "$ACAV_FILE" ]; then
    echo "  ✓ Features ACAV100M déjà présentes"
else
    echo "  Téléchargement des features ACAV100M (~2 Go)..."
    echo "  (Cela peut prendre plusieurs minutes)"
    wget -q --show-progress -O "$ACAV_FILE" \
        "$HF_FEATURES/openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
    echo "  ✓ Features ACAV100M téléchargées"
fi

VAL_FILE="$FEATURES_DIR/validation_set_features.npy"
if [ -f "$VAL_FILE" ]; then
    echo "  ✓ Features de validation déjà présentes"
else
    echo "  Téléchargement des features de validation..."
    wget -q --show-progress -O "$VAL_FILE" \
        "$HF_FEATURES/validation_set_features.npy"
    echo "  ✓ Features de validation téléchargées"
fi

# =============================================================================
# 3. Modèles d'embedding openWakeWord
# =============================================================================
echo ""
echo "=== [3/5] Téléchargement des modèles d'embedding ==="

MODELS_DIR="$DATA_DIR/models"
mkdir -p "$MODELS_DIR"
OWW_RELEASES="https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"

for model in embedding_model.onnx melspectrogram.onnx; do
    if [ -f "$MODELS_DIR/$model" ]; then
        echo "  ✓ $model déjà présent"
    else
        echo "  Téléchargement de $model..."
        wget -q --show-progress -O "$MODELS_DIR/$model" "$OWW_RELEASES/$model"
        echo "  ✓ $model téléchargé"
    fi
done

# =============================================================================
# 4. Dataset de bruit MS-SNSD
# =============================================================================
echo ""
echo "=== [4/5] Téléchargement du dataset de bruit MS-SNSD ==="

MSSNSD_DIR="$DATA_DIR/noise/ms-snsd"
if [ -f "$MSSNSD_DIR/.download_complete" ]; then
    echo "  ✓ MS-SNSD déjà présent"
else
    echo "  Clonage de MS-SNSD..."
    git clone --depth 1 https://github.com/microsoft/MS-SNSD.git "$MSSNSD_DIR/repo" 2>/dev/null || true
    if [ -d "$MSSNSD_DIR/repo/noise_train" ]; then
        mv "$MSSNSD_DIR/repo/noise_train"/*.wav "$MSSNSD_DIR/" 2>/dev/null || true
        mv "$MSSNSD_DIR/repo/noise_test"/*.wav "$MSSNSD_DIR/" 2>/dev/null || true
        rm -rf "$MSSNSD_DIR/repo"
        touch "$MSSNSD_DIR/.download_complete"
        echo "  ✓ MS-SNSD téléchargé"
    else
        echo "  ⚠ Échec du téléchargement MS-SNSD (optionnel, on continue)"
    fi
fi

# =============================================================================
# 5. Cloner les repos nécessaires
# =============================================================================
echo ""
echo "=== [5/5] Clonage des repos ==="

OWW_DIR="$PROJECT_DIR/deps/openWakeWord"
if [ -d "$OWW_DIR" ]; then
    echo "  ✓ openWakeWord déjà cloné"
else
    echo "  Clonage de openWakeWord..."
    mkdir -p "$PROJECT_DIR/deps"
    git clone --depth 1 https://github.com/dscripka/openWakeWord.git "$OWW_DIR"
    echo "  ✓ openWakeWord cloné"
fi

PSG_DIR="$PROJECT_DIR/deps/piper-sample-generator"
if [ -d "$PSG_DIR" ]; then
    echo "  ✓ piper-sample-generator déjà cloné"
else
    echo "  Clonage de piper-sample-generator..."
    git clone --depth 1 https://github.com/rhasspy/piper-sample-generator.git "$PSG_DIR"
    echo "  ✓ piper-sample-generator cloné"
fi

# =============================================================================
# Résumé
# =============================================================================
echo ""
echo "=============================================="
echo "  Setup terminé !"
echo "=============================================="
echo ""
echo "Structure :"
echo "  voices/          — 3 voix Piper françaises"
echo "  data/features/   — Features ACAV100M + validation"
echo "  data/models/     — Embedding + melspectrogram"
echo "  data/noise/      — Bruit de fond MS-SNSD"
echo "  deps/            — openWakeWord + piper-sample-generator"
echo ""
du -sh "$VOICES_DIR" "$DATA_DIR" "$PROJECT_DIR/deps" 2>/dev/null || true
echo ""
echo "Prochaine étape : make generate"
