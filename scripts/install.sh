#!/usr/bin/env bash
# ==============================================================================
# Diva Embedded — Script d'installation one-shot pour Rock 5B+ (Armbian Bookworm)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="/opt/diva-embedded"
PIPER_DIR="/opt/piper"
PIPER_VOICES_DIR="$PIPER_DIR/voices"
PIPER_BIN="$PIPER_DIR/piper/piper"
PIPER_MODEL="fr_FR-siwis-medium.onnx"
REPO_URL="https://github.com/DamiC0de/diva-embedded.git"

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
step() { echo -e "\n${BLUE}=========================================${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}=========================================${NC}"; }

ERRORS=0

# ==============================================================================
# Vérification des prérequis
# ==============================================================================

step "Vérification des prérequis"

# Vérifier que nous sommes sur ARM64/aarch64
if [ "$(uname -m)" != "aarch64" ]; then
    fail "Ce script est conçu pour ARM64/aarch64. Architecture détectée: $(uname -m)"
fi
pass "Architecture ARM64/aarch64 confirmée"

# Vérifier que nous sommes sur Armbian Bookworm (ou Debian/Ubuntu compatible)
if [ ! -f /etc/os-release ]; then
    fail "Impossible de détecter l'OS (/etc/os-release manquant)"
fi

source /etc/os-release
if [[ ! "$ID" =~ ^(armbian|debian|ubuntu)$ ]]; then
    warn "OS non testé: $ID $VERSION_CODENAME. Le script peut ne pas fonctionner."
fi
pass "OS compatible détecté: $ID $VERSION_CODENAME"

# Vérifier les permissions root
if [ "$EUID" -ne 0 ]; then
    fail "Ce script doit être exécuté en tant que root (sudo)"
fi
pass "Permissions root confirmées"

# ==============================================================================
# Installation des dépendances système
# ==============================================================================

step "Installation des dépendances système"

apt-get update -qq

# Dépendances de base
PACKAGES=(
    curl wget git build-essential
    python3 python3-pip python3-venv python3-dev
    ffmpeg alsa-utils portaudio19-dev
    systemd
)

info "Installation des packages de base..."
apt-get install -y "${PACKAGES[@]}"
pass "Packages de base installés"

# ==============================================================================
# Installation de Node.js 22
# ==============================================================================

step "Installation de Node.js 22"

if command -v node &>/dev/null && [[ "$(node -v)" =~ ^v2[2-9]\. ]]; then
    pass "Node.js $(node -v) déjà installé"
else
    info "Installation de Node.js 22 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    pass "Node.js $(node -v) installé"
fi

# ==============================================================================
# Clone/update du repo
# ==============================================================================

step "Récupération du code source"

if [ -d "$PROJECT_ROOT" ]; then
    info "Répertoire existant trouvé, mise à jour..."
    cd "$PROJECT_ROOT"
    git pull origin main || git pull origin master || true
    pass "Code source mis à jour"
else
    info "Clonage du repository..."
    git clone "$REPO_URL" "$PROJECT_ROOT"
    cd "$PROJECT_ROOT"
    pass "Code source cloné dans $PROJECT_ROOT"
fi

# ==============================================================================
# Installation des dépendances Node.js
# ==============================================================================

step "Installation des dépendances Node.js"

cd "$PROJECT_ROOT"
npm install
npm run build
pass "Dépendances Node.js installées et code compilé"

# ==============================================================================
# Configuration du swap
# ==============================================================================

step "Configuration du swap (2GB)"

if [ -f /swapfile ]; then
    warn "Fichier de swap existant détecté"
    SWAP_SIZE_KB=$(stat -c%s /swapfile 2>/dev/null || echo 0)
    SWAP_SIZE_MB=$((SWAP_SIZE_KB / 1024 / 1024))
    if [ $SWAP_SIZE_MB -ge 1800 ]; then
        pass "Swap suffisant déjà configuré (${SWAP_SIZE_MB}MB)"
    else
        info "Recréation du swap (taille actuelle: ${SWAP_SIZE_MB}MB)..."
        swapoff /swapfile 2>/dev/null || true
        rm -f /swapfile
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        pass "Swap 2GB configuré"
    fi
else
    info "Création du swap 2GB..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    pass "Swap 2GB créé et activé"
fi

# S'assurer que le swap est permanent
if ! grep -q "/swapfile" /etc/fstab 2>/dev/null; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
    pass "Swap ajouté à /etc/fstab"
fi

# ==============================================================================
# Installation des dépendances Python
# ==============================================================================

step "Installation des dépendances Python"

# Installer pip avec break-system-packages si nécessaire
python3 -m pip install --break-system-packages --upgrade pip setuptools wheel || \
python3 -m pip install --upgrade pip setuptools wheel

# Dépendances Python pour OpenWakeWord et audio
PYTHON_PACKAGES=(
    numpy
    openwakeword
    onnxruntime
    flask
    requests
)

for package in "${PYTHON_PACKAGES[@]}"; do
    info "Installation de $package..."
    python3 -m pip install --break-system-packages "$package" 2>/dev/null || \
    python3 -m pip install "$package" 2>/dev/null || {
        warn "Échec d'installation de $package"
        ERRORS=$((ERRORS + 1))
    }
done

# Vérifier les imports critiques
if python3 -c "import openwakeword, numpy, onnxruntime" 2>/dev/null; then
    pass "Dépendances Python installées et fonctionnelles"
else
    fail "Échec de vérification des dépendances Python"
fi

# ==============================================================================
# Téléchargement et installation de Piper TTS
# ==============================================================================

step "Installation de Piper TTS"

mkdir -p "$PIPER_DIR/piper" "$PIPER_VOICES_DIR"

# Télécharger Piper binaire ARM64 si absent
if [ ! -f "$PIPER_BIN" ]; then
    info "Téléchargement de Piper TTS (ARM64)..."
    PIPER_VERSION="2023.11.14-2"
    PIPER_ARCHIVE="piper_linux_aarch64.tar.gz"
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${PIPER_ARCHIVE}"
    
    cd /tmp
    wget -q "$PIPER_URL" -O "$PIPER_ARCHIVE"
    tar -xzf "$PIPER_ARCHIVE" -C "$PIPER_DIR"
    chmod +x "$PIPER_BIN"
    rm -f "$PIPER_ARCHIVE"
    pass "Piper TTS binaire installé"
else
    pass "Piper TTS binaire déjà présent"
fi

# Télécharger le modèle français si absent
if [ ! -f "$PIPER_VOICES_DIR/$PIPER_MODEL" ]; then
    info "Téléchargement du modèle TTS français..."
    VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"
    wget -q "$VOICE_URL" -O "$PIPER_VOICES_DIR/$PIPER_MODEL"
    
    # Télécharger aussi le fichier de config JSON
    CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json"
    wget -q "$CONFIG_URL" -O "$PIPER_VOICES_DIR/$PIPER_MODEL.json"
    pass "Modèle TTS français téléchargé"
else
    pass "Modèle TTS français déjà présent"
fi

# Tester Piper
if echo "Test de synthèse vocale" | "$PIPER_BIN" --model "$PIPER_VOICES_DIR/$PIPER_MODEL" --output_file /tmp/test_piper.wav 2>/dev/null; then
    pass "Test Piper TTS réussi"
    rm -f /tmp/test_piper.wav
else
    warn "Échec du test Piper TTS"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Création du serveur HTTP Piper
# ==============================================================================

step "Configuration du serveur HTTP Piper"

cat > "$PIPER_DIR/piper_http_server.py" << 'PIPER_EOF'
#!/usr/bin/env python3
"""
Serveur HTTP Flask pour Piper TTS
Port 8880, endpoint POST /synthesize
"""

import os
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

PIPER_BIN = "/opt/piper/piper/piper"
MODEL_PATH = "/opt/piper/voices/fr_FR-siwis-medium.onnx"
OUTPUT_DIR = "/tmp/piper_audio"

# Créer le répertoire de sortie
os.makedirs(OUTPUT_DIR, exist_ok=True)

@app.route('/synthesize', methods=['POST'])
def synthesize():
    """Synthétise du texte en audio WAV via Piper"""
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'Missing text parameter'}), 400
        
        text = data['text'].strip()
        if not text:
            return jsonify({'error': 'Empty text'}), 400
        
        # Générer un nom de fichier unique
        filename = f"{uuid.uuid4().hex}.wav"
        output_path = os.path.join(OUTPUT_DIR, filename)
        
        # Appeler Piper
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as tmp:
            tmp.write(text)
            tmp.flush()
            
            result = subprocess.run([
                PIPER_BIN,
                '--model', MODEL_PATH,
                '--output_file', output_path
            ], stdin=open(tmp.name, 'r'), capture_output=True, text=True, timeout=10)
            
            os.unlink(tmp.name)
        
        if result.returncode != 0:
            return jsonify({'error': f'Piper failed: {result.stderr}'}), 500
        
        if not os.path.exists(output_path):
            return jsonify({'error': 'Audio file not generated'}), 500
        
        return jsonify({'audio_file': filename})
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'TTS timeout'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/audio/<filename>')
def get_audio(filename):
    """Sert un fichier audio généré"""
    file_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404
    return send_file(file_path, mimetype='audio/wav')

@app.route('/health')
def health():
    """Health check"""
    return jsonify({'status': 'ok', 'model': MODEL_PATH})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8880, debug=False)
PIPER_EOF

chmod +x "$PIPER_DIR/piper_http_server.py"
pass "Serveur HTTP Piper créé"

# ==============================================================================
# Génération du WAV "Oui?" pour l'acknowledgment
# ==============================================================================

step "Génération de l'audio d'acknowledgment"

ACKNOWLEDGMENT_DIR="$PROJECT_ROOT/assets/audio"
mkdir -p "$ACKNOWLEDGMENT_DIR"

if [ ! -f "$ACKNOWLEDGMENT_DIR/acknowledgment.wav" ]; then
    info "Génération de l'audio 'Oui?'..."
    echo "Oui ?" | "$PIPER_BIN" --model "$PIPER_VOICES_DIR/$PIPER_MODEL" --output_file "$ACKNOWLEDGMENT_DIR/acknowledgment.wav" 2>/dev/null || {
        warn "Échec de génération de l'audio d'acknowledgment"
        ERRORS=$((ERRORS + 1))
    }
    pass "Audio d'acknowledgment généré"
else
    pass "Audio d'acknowledgment déjà présent"
fi

# ==============================================================================
# Configuration .env
# ==============================================================================

step "Configuration du fichier .env"

ENV_FILE="$PROJECT_ROOT/.env"

# Auto-détection de la carte audio ReSpeaker
CARD_NUM=""
if command -v arecord &>/dev/null; then
    CARD_LINE=$(arecord -l 2>/dev/null | grep -i respeaker | head -1 || true)
    if [ -n "$CARD_LINE" ]; then
        CARD_NUM=$(echo "$CARD_LINE" | sed 's/card \([0-9]*\):.*/\1/')
        info "ReSpeaker détecté sur la carte $CARD_NUM"
    else
        warn "ReSpeaker non trouvé, utilisation de la valeur par défaut"
        CARD_NUM="5"
    fi
else
    warn "arecord non disponible"
    CARD_NUM="5"
fi

AUDIO_DEVICE="plughw:$CARD_NUM"

# Créer ou mettre à jour le .env
if [ -f "$ENV_FILE" ]; then
    # Mise à jour du device audio
    if grep -q "AUDIO_INPUT_DEVICE" "$ENV_FILE"; then
        sed -i "s|AUDIO_INPUT_DEVICE=.*|AUDIO_INPUT_DEVICE=$AUDIO_DEVICE|" "$ENV_FILE"
    else
        echo "AUDIO_INPUT_DEVICE=$AUDIO_DEVICE" >> "$ENV_FILE"
    fi
    pass ".env mis à jour"
else
    # Création depuis l'exemple
    if [ -f "$PROJECT_ROOT/.env.example" ]; then
        cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
        sed -i "s|AUDIO_INPUT_DEVICE=.*|AUDIO_INPUT_DEVICE=$AUDIO_DEVICE|" "$ENV_FILE"
    else
        # Créer un .env minimal
        cat > "$ENV_FILE" << ENV_EOF
# Claude API
ANTHROPIC_API_KEY=sk-ant-xxx

# Groq (STT)
GROQ_API_KEY=gsk_xxx

# Brave Search
BRAVE_API_KEY=BSA_xxx

# Piper TTS
TTS_BASE_URL=http://localhost:8880

# Audio device (auto-detected)
AUDIO_INPUT_DEVICE=$AUDIO_DEVICE

# Memory
MEMORY_DIR=data/memory
ENV_EOF
    fi
    pass ".env créé"
fi

warn "⚠️  IMPORTANT: Éditez $ENV_FILE et remplacez les clés API par vos vraies clés!"

# ==============================================================================
# Création des services systemd
# ==============================================================================

step "Configuration des services systemd"

# Service Piper HTTP
cat > /etc/systemd/system/piper-tts.service << PIPER_SERVICE_EOF
[Unit]
Description=Piper TTS HTTP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$PIPER_DIR
ExecStart=/usr/bin/python3 $PIPER_DIR/piper_http_server.py
Restart=always
RestartSec=5
User=root
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
PIPER_SERVICE_EOF

# Service principal Diva
cat > /etc/systemd/system/diva-embedded.service << DIVA_SERVICE_EOF
[Unit]
Description=Diva Embedded Voice Assistant
After=network.target piper-tts.service
Wants=piper-tts.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_ROOT
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
User=root
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE

# Logs
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
DIVA_SERVICE_EOF

systemctl daemon-reload
systemctl enable piper-tts.service diva-embedded.service
pass "Services systemd créés et activés"

# ==============================================================================
# Tests des composants
# ==============================================================================

step "Tests des composants"

# Test 1: Microphone
if [ -n "$CARD_NUM" ]; then
    info "Test du microphone (enregistrement 1s)..."
    if timeout 3 arecord -D "$AUDIO_DEVICE" -f S16_LE -r 16000 -c 1 -d 1 /tmp/mic_test.wav 2>/dev/null; then
        SIZE=$(stat -c%s /tmp/mic_test.wav 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 5000 ]; then
            pass "Test microphone réussi (${SIZE} bytes)"
        else
            warn "Test microphone: fichier trop petit (${SIZE} bytes)"
            ERRORS=$((ERRORS + 1))
        fi
        rm -f /tmp/mic_test.wav
    else
        warn "Échec du test microphone"
        ERRORS=$((ERRORS + 1))
    fi
else
    warn "Test microphone ignoré (carte non détectée)"
fi

# Test 2: Piper TTS (déjà fait plus haut)

# Test 3: OpenWakeWord
info "Test du modèle OpenWakeWord..."
if python3 -c "
from openwakeword.model import Model
try:
    model = Model(inference_framework='onnx')
    print('OpenWakeWord OK')
except:
    model = Model()
    print('OpenWakeWord OK (tflite)')
" 2>/dev/null | grep -q "OpenWakeWord OK"; then
    pass "Test OpenWakeWord réussi"
else
    warn "Échec du test OpenWakeWord"
    ERRORS=$((ERRORS + 1))
fi

# Test 4: Build Node.js
info "Test de la compilation Node.js..."
cd "$PROJECT_ROOT"
if [ -f "dist/index.js" ]; then
    pass "Build Node.js OK"
else
    warn "Fichier dist/index.js manquant"
    ERRORS=$((ERRORS + 1))
fi

# ==============================================================================
# Démarrage des services
# ==============================================================================

step "Démarrage des services"

info "Démarrage du service Piper TTS..."
systemctl start piper-tts.service
sleep 3

if systemctl is-active --quiet piper-tts.service; then
    pass "Service Piper TTS démarré"
    
    # Test HTTP
    if curl -s http://localhost:8880/health >/dev/null 2>&1; then
        pass "API Piper TTS accessible"
    else
        warn "API Piper TTS non accessible"
        ERRORS=$((ERRORS + 1))
    fi
else
    warn "Service Piper TTS non démarré"
    ERRORS=$((ERRORS + 1))
fi

info "Le service diva-embedded peut être démarré avec: systemctl start diva-embedded"

# ==============================================================================
# Résumé final
# ==============================================================================

step "RÉSUMÉ DE L'INSTALLATION"

echo ""
if [ $ERRORS -eq 0 ]; then
    pass "🎉 Installation terminée avec succès!"
else
    warn "⚠️  Installation terminée avec $ERRORS avertissement(s)"
fi

echo ""
info "📍 EMPLACEMENTS:"
info "  • Code source:     $PROJECT_ROOT"
info "  • Piper TTS:       $PIPER_DIR"
info "  • Configuration:   $ENV_FILE"
info "  • Audio device:    $AUDIO_DEVICE"

echo ""
info "🔧 CONFIGURATION REQUISE:"
if grep -q "sk-ant-xxx\|gsk_xxx\|BSA_xxx" "$ENV_FILE" 2>/dev/null; then
    warn "  • Éditez $ENV_FILE avec vos vraies clés API!"
else
    pass "  • Clés API configurées"
fi

echo ""
info "🚀 COMMANDES:"
info "  • Démarrer:       systemctl start diva-embedded"
info "  • Arrêter:        systemctl stop diva-embedded piper-tts"
info "  • Logs:           journalctl -fu diva-embedded"
info "  • Statut:         systemctl status diva-embedded piper-tts"

echo ""
info "🔊 PORTS UTILISÉS:"
info "  • 8880:           Piper TTS HTTP"
info "  • 9001:           Communication Python ↔ Node.js"

echo ""
if [ $ERRORS -eq 0 ]; then
    info "✨ Diva Embedded est prêt à utiliser!"
    info "   Dites 'Hey Jarvis' pour activer l'assistant vocal."
else
    warn "🔧 Corrigez les avertissements ci-dessus avant utilisation."
fi

echo ""