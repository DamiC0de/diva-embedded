#!/usr/bin/env bash
# ==============================================================================
# Diva PROTO — One-shot deployment script for Rock 5B+ with Armbian
# Auto-detects ReSpeaker, installs deps, tests everything, creates services.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$PROJECT_DIR/models"
MODEL_FILE="hey_jarvis_v0.1.tflite"
MODEL_URL="https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/$MODEL_FILE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "   $1"; }

ERRORS=0

# ==============================================================================
# Step 1: Auto-detect ReSpeaker card number
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 1: Detect ReSpeaker USB mic"
echo "========================================="

CARD_NUM=""
if command -v arecord &>/dev/null; then
    CARD_LINE=$(arecord -l 2>/dev/null | grep -i respeaker | head -1 || true)
    if [ -n "$CARD_LINE" ]; then
        CARD_NUM=$(echo "$CARD_LINE" | sed 's/card \([0-9]*\):.*/\1/')
        pass "ReSpeaker detected on card $CARD_NUM"
    else
        fail "ReSpeaker not found in arecord -l"
        warn "Available cards:"
        arecord -l 2>/dev/null || true
        ERRORS=$((ERRORS + 1))
    fi
else
    fail "arecord not found"
    ERRORS=$((ERRORS + 1))
fi

AUDIO_DEVICE="plughw:${CARD_NUM:-5}"
info "Using audio device: $AUDIO_DEVICE"

# ==============================================================================
# Step 2: Install system dependencies
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 2: System dependencies"
echo "========================================="

PKGS=(alsa-utils python3-pip python3-venv curl wget)
MISSING=()

for pkg in "${PKGS[@]}"; do
    if ! dpkg -s "$pkg" &>/dev/null; then
        MISSING+=("$pkg")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    info "Installing missing packages: ${MISSING[*]}"
    apt-get update -qq
    apt-get install -y -qq "${MISSING[@]}"
    pass "System packages installed"
else
    pass "All system packages present"
fi

# Check Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    pass "Node.js $NODE_VERSION found"
else
    fail "Node.js not found — install Node.js >= 22"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Step 3: Python dependencies
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 3: Python dependencies"
echo "========================================="

# Install openwakeword + numpy
pip3 install --quiet --break-system-packages --upgrade openwakeword numpy tflite-runtime 2>/dev/null || \
pip3 install --quiet --upgrade openwakeword numpy tflite-runtime 2>/dev/null || \
pip3 install --quiet --break-system-packages --upgrade openwakeword numpy 2>/dev/null || \
pip3 install --quiet --upgrade openwakeword numpy 2>/dev/null || {
    fail "Failed to install Python packages"
    ERRORS=$((ERRORS + 1))
}

if python3 -c "import openwakeword" 2>/dev/null; then
    pass "openwakeword installed"
else
    fail "openwakeword import failed"
    ERRORS=$((ERRORS + 1))
fi

if python3 -c "import numpy" 2>/dev/null; then
    pass "numpy installed"
else
    fail "numpy import failed"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Step 4: Download OpenWakeWord model
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 4: Wake word model"
echo "========================================="

mkdir -p "$MODEL_DIR"

# Also need the embedding + melspectrogram models in the openwakeword package dir
OWW_PKG_DIR=$(python3 -c "import openwakeword; import os; print(os.path.dirname(openwakeword.__file__))" 2>/dev/null || echo "")
OWW_RES_DIR=""
if [ -n "$OWW_PKG_DIR" ]; then
    OWW_RES_DIR="$OWW_PKG_DIR/resources/models"
    mkdir -p "$OWW_RES_DIR"

    # Download feature models required by openwakeword
    for FEAT_MODEL in melspectrogram.tflite embedding_model.tflite; do
        if [ ! -f "$OWW_RES_DIR/$FEAT_MODEL" ] || [ "$(stat -c%s "$OWW_RES_DIR/$FEAT_MODEL" 2>/dev/null)" -lt 10000 ]; then
            info "Downloading $FEAT_MODEL..."
            wget -q -O "$OWW_RES_DIR/$FEAT_MODEL" "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/$FEAT_MODEL" || true
        fi
    done

    # Download the hey_jarvis wakeword model into the package dir too
    if [ ! -f "$OWW_RES_DIR/$MODEL_FILE" ] || [ "$(stat -c%s "$OWW_RES_DIR/$MODEL_FILE" 2>/dev/null)" -lt 10000 ]; then
        info "Downloading $MODEL_FILE to package dir..."
        wget -q -O "$OWW_RES_DIR/$MODEL_FILE" "$MODEL_URL" || true
    fi
fi

# Also download to project models dir as backup
if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    pass "Model already downloaded: $MODEL_FILE"
else
    info "Downloading $MODEL_FILE..."
    if wget -q -O "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL"; then
        pass "Model downloaded"
    else
        fail "Model download failed"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Verify model file size (should be > 100KB for tflite)
if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    SIZE=$(stat -c%s "$MODEL_DIR/$MODEL_FILE" 2>/dev/null || stat -f%z "$MODEL_DIR/$MODEL_FILE" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 100000 ]; then
        pass "Model file valid ($SIZE bytes)"
    else
        fail "Model file too small ($SIZE bytes), may be corrupted"
        rm -f "$MODEL_DIR/$MODEL_FILE"
        ERRORS=$((ERRORS + 1))
    fi
fi

# ==============================================================================
# Step 5: Configure .env
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 5: Configure .env"
echo "========================================="

ENV_FILE="$PROJECT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
    # Update AUDIO_INPUT_DEVICE if card was detected
    if [ -n "$CARD_NUM" ]; then
        if grep -q "AUDIO_INPUT_DEVICE" "$ENV_FILE"; then
            sed -i "s|AUDIO_INPUT_DEVICE=.*|AUDIO_INPUT_DEVICE=$AUDIO_DEVICE|" "$ENV_FILE"
        else
            echo "AUDIO_INPUT_DEVICE=$AUDIO_DEVICE" >> "$ENV_FILE"
        fi
        pass ".env updated with AUDIO_INPUT_DEVICE=$AUDIO_DEVICE"
    else
        warn ".env not updated (no card detected)"
    fi
else
    # Create .env from example
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
        if [ -n "$CARD_NUM" ]; then
            sed -i "s|AUDIO_INPUT_DEVICE=.*|AUDIO_INPUT_DEVICE=$AUDIO_DEVICE|" "$ENV_FILE"
        fi
        warn ".env created from .env.example — edit API keys before running!"
    else
        fail "No .env or .env.example found"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check that API keys are set (not placeholder)
if [ -f "$ENV_FILE" ]; then
    if grep -q "ANTHROPIC_API_KEY=sk-ant-xxx" "$ENV_FILE" 2>/dev/null; then
        warn "ANTHROPIC_API_KEY still has placeholder value — update it!"
    fi
    if grep -q "GROQ_API_KEY=gsk_xxx" "$ENV_FILE" 2>/dev/null; then
        warn "GROQ_API_KEY still has placeholder value — update it!"
    fi
fi

# ==============================================================================
# Step 6: Test microphone
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 6: Test microphone (2s recording)"
echo "========================================="

MIC_TEST="/tmp/diva_mic_test.wav"
if [ -n "$CARD_NUM" ]; then
    info "Recording 2 seconds from $AUDIO_DEVICE..."
    if timeout 5 arecord -D "$AUDIO_DEVICE" -f S16_LE -r 16000 -c 1 -d 2 "$MIC_TEST" 2>/dev/null; then
        SIZE=$(stat -c%s "$MIC_TEST" 2>/dev/null || stat -f%z "$MIC_TEST" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 10000 ]; then
            pass "Mic test passed ($SIZE bytes recorded)"
        else
            fail "Mic test: file too small ($SIZE bytes)"
            ERRORS=$((ERRORS + 1))
        fi
        rm -f "$MIC_TEST"
    else
        fail "arecord failed on $AUDIO_DEVICE"
        ERRORS=$((ERRORS + 1))
    fi
else
    warn "Skipping mic test (no card detected)"
fi

# ==============================================================================
# Step 7: Test Piper TTS
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 7: Test Piper TTS"
echo "========================================="

TTS_URL="${TTS_BASE_URL:-http://localhost:8880}"
if curl -s --connect-timeout 3 "$TTS_URL" >/dev/null 2>&1; then
    pass "Piper TTS reachable at $TTS_URL"
else
    warn "Piper TTS not reachable at $TTS_URL — make sure it's running"
fi

# ==============================================================================
# Step 8: Test wake word model load
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 8: Test wake word model load"
echo "========================================="

if python3 -c "
from openwakeword.model import Model
try:
    m = Model(wakeword_models=['$MODEL_DIR/$MODEL_FILE'], inference_framework='onnx')
except TypeError:
    m = Model(wakeword_models=['$MODEL_DIR/$MODEL_FILE'])
print('OK')
" 2>/dev/null | grep -q "OK"; then
    pass "Wake word model loads correctly"
else
    fail "Wake word model failed to load"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Step 9: npm install + build
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 9: npm install + build"
echo "========================================="

cd "$PROJECT_DIR"

if npm install --quiet 2>&1 | tail -3; then
    pass "npm install completed"
else
    fail "npm install failed"
    ERRORS=$((ERRORS + 1))
fi

if npm run build 2>&1 | tail -5; then
    pass "TypeScript build completed"
else
    fail "TypeScript build failed"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Step 10: Create systemd services
# ==============================================================================
echo ""
echo "========================================="
echo "  Step 10: Systemd services"
echo "========================================="

# Node.js service
cat > /etc/systemd/system/diva-node.service << NODEEOF
[Unit]
Description=Diva PROTO — Node.js API server
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$(which node) dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
NODEEOF

# Python wake word service
cat > /etc/systemd/system/diva-wake.service << WAKEEOF
[Unit]
Description=Diva PROTO — Python wake word + audio
After=diva-node.service
Requires=diva-node.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStartPre=/bin/sleep 2
ExecStart=$(which python3) python/wakeword_server.py
Restart=always
RestartSec=5
Environment=AUDIO_INPUT_DEVICE=$AUDIO_DEVICE
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
WAKEEOF

systemctl daemon-reload
systemctl enable diva-node.service diva-wake.service 2>/dev/null
pass "Systemd services created and enabled"

info "  Start with: systemctl start diva-node && systemctl start diva-wake"
info "  Logs:       journalctl -u diva-node -f"
info "              journalctl -u diva-wake -f"
info "  Stop:       systemctl stop diva-wake diva-node"

# ==============================================================================
# Summary
# ==============================================================================
echo ""
echo "========================================="
echo "  DEPLOYMENT SUMMARY"
echo "========================================="

if [ $ERRORS -eq 0 ]; then
    pass "All checks passed! Diva PROTO is ready."
    echo ""
    info "To start manually:"
    info "  Terminal 1: cd $PROJECT_DIR && npm start"
    info "  Terminal 2: cd $PROJECT_DIR && python3 python/wakeword_server.py"
    echo ""
    info "To start via systemd:"
    info "  systemctl start diva-node diva-wake"
else
    fail "$ERRORS error(s) found — fix them before running."
fi

echo ""
