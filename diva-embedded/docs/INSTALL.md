# Guide d'installation - Diva Embedded

Guide complet pour installer Diva Embedded sur un Rock 5B+ neuf avec Armbian Bookworm.

## 📋 Prérequis Hardware

### Rock 5B+
- **SoC:** Rockchip RK3588 (ARM64)
- **RAM:** 16GB recommandé (minimum 8GB)
- **Storage:** eMMC 64GB ou carte microSD Classe 10 (minimum 32GB)
- **Alimentation:** 12V/2A minimum (adaptateur officiel recommandé)

### Audio - ReSpeaker Lite 2-Mic USB
- **Modèle:** Seeed Studio ReSpeaker USB Mic Array v2.0
- **Connexion:** USB 2.0/3.0
- **Détection:** Auto-détectée comme `card X` dans ALSA

**Note:** D'autres micros USB peuvent fonctionner, mais le script d'installation est optimisé pour ReSpeaker.

### Accessoires recommandés
- **Écran HDMI** (pour l'installation initiale)
- **Clavier/souris USB** (pour la configuration)
- **Ethernet ou Wi-Fi** (connexion Internet requise)
- **Haut-parleur USB ou jack 3.5mm** (pour la sortie audio)

## 💿 Prérequis Logiciel

### OS: Armbian Bookworm
- **Version:** Armbian 24.x avec Debian Bookworm (kernel 6.x)
- **Architecture:** ARM64/aarch64
- **Image:** [Armbian officielle pour Rock 5B](https://www.armbian.com/rock-5b/)

### Installation d'Armbian
1. Téléchargez l'image Armbian Bookworm CLI pour Rock 5B
2. Flashez sur eMMC ou microSD avec [balenaEtcher](https://etcher.balena.io/)
3. Premier boot: configuration utilisateur root + connexion réseau
4. Mise à jour du système:
   ```bash
   apt update && apt upgrade -y
   ```

## 🚀 Installation Automatique

### Méthode recommandée: Script one-shot

```bash
# Cloner le repository
git clone https://github.com/DamiC0de/diva-embedded.git
cd diva-embedded

# Lancer l'installation (en tant que root)
sudo scripts/install.sh
```

Le script effectue automatiquement:
1. ✅ Vérification de l'architecture ARM64
2. ✅ Installation des dépendances système
3. ✅ Installation de Node.js 22 via NodeSource
4. ✅ Installation des dépendances Python (OpenWakeWord, onnxruntime)
5. ✅ Téléchargement et installation de Piper TTS (ARM64)
6. ✅ Configuration du serveur HTTP Piper
7. ✅ Auto-détection de la carte ReSpeaker
8. ✅ Génération des fichiers audio d'acknowledgment
9. ✅ Configuration des services systemd
10. ✅ Tests de tous les composants

### Durée d'installation
- **Connexion rapide (100 Mbps):** ~10-15 minutes
- **Connexion lente (10 Mbps):** ~30-45 minutes

## ⚙️ Configuration Post-Installation

### 1. Configuration des clés API

Éditez le fichier `/opt/diva-embedded/.env`:

```bash
sudo nano /opt/diva-embedded/.env
```

Remplacez les placeholders par vos vraies clés:

```env
# Claude API (requis)
ANTHROPIC_API_KEY=sk-ant-votre_cle_anthropic

# Groq STT (requis)
GROQ_API_KEY=gsk_votre_cle_groq

# Brave Search (optionnel)
BRAVE_API_KEY=BSA_votre_cle_brave

# Piper TTS (configuré automatiquement)
TTS_BASE_URL=http://localhost:8880

# Audio device (configuré automatiquement)
AUDIO_INPUT_DEVICE=plughw:5

# Memory
MEMORY_DIR=data/memory
```

#### Obtenir les clés API

**Anthropic Claude:**
1. Allez sur [console.anthropic.com](https://console.anthropic.com)
2. Créez un compte et ajoutez des crédits
3. Créez une nouvelle clé API dans la section "API Keys"

**Groq (STT):**
1. Allez sur [console.groq.com](https://console.groq.com)
2. Créez un compte gratuit
3. Générez une clé API (quota gratuit: 50 requêtes/jour)

**Brave Search (optionnel):**
1. Allez sur [brave.com/search/api](https://brave.com/search/api)
2. Inscrivez-vous pour l'API gratuite
3. Récupérez votre clé API

### 2. Démarrage des services

```bash
# Démarrer les services
sudo systemctl start piper-tts diva-embedded

# Vérifier le statut
sudo systemctl status piper-tts diva-embedded

# Activer le démarrage automatique
sudo systemctl enable piper-tts diva-embedded
```

### 3. Vérification du fonctionnement

```bash
# Logs en temps réel
sudo journalctl -fu diva-embedded

# Test API Piper
curl -X POST http://localhost:8880/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Bonjour, test de synthèse vocale"}'

# Test détection audio
arecord -l | grep -i respeaker
```

## 🧪 Tests des Composants

### Test 1: Microphone
```bash
# Enregistrer 3 secondes
arecord -D plughw:5 -f S16_LE -r 16000 -c 1 -d 3 test_mic.wav

# Vérifier la taille du fichier
ls -lh test_mic.wav
# Attendu: ~96KB pour 3s à 16kHz mono 16-bit
```

### Test 2: Synthèse vocale
```bash
# Test direct Piper
echo "Test de synthèse vocale" | /opt/piper/piper/piper \
  --model /opt/piper/voices/fr_FR-siwis-medium.onnx \
  --output_file test_tts.wav

# Écouter le résultat
aplay test_tts.wav
```

### Test 3: Wake word
```bash
# Test modèle OpenWakeWord
python3 -c "
from openwakeword.model import Model
model = Model(inference_framework='onnx')
print('Modèles chargés:', list(model.prediction_buffer.keys()))
"
```

### Test 4: Communication complète
```bash
# Démarrer manuellement pour test
cd /opt/diva-embedded

# Terminal 1: Node.js
npm start

# Terminal 2: Python wake word
python3 python/wakeword_server.py
```

**Test vocal:**
1. Dire "Hey Jarvis" près du microphone
2. Attendre le son "Oui ?" 
3. Poser une question
4. Écouter la réponse synthétisée

## 🔧 Installation Manuelle (si le script échoue)

### 1. Dépendances système
```bash
# Packages de base
apt update
apt install -y curl wget git build-essential python3 python3-pip \
  ffmpeg alsa-utils portaudio19-dev systemd nodejs npm

# Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

### 2. Dépendances Python
```bash
# Installation avec break-system-packages sur Bookworm
python3 -m pip install --break-system-packages \
  numpy openwakeword onnxruntime flask requests
```

### 3. Piper TTS manuel
```bash
# Créer les répertoires
mkdir -p /opt/piper/{piper,voices}

# Télécharger binaire ARM64
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz
tar -xzf piper_linux_aarch64.tar.gz -C /opt/piper

# Télécharger modèle français
cd /opt/piper/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json
```

### 4. Code source
```bash
# Cloner et builder
git clone https://github.com/DamiC0de/diva-embedded.git /opt/diva-embedded
cd /opt/diva-embedded
npm install
npm run build
```

### 5. Services systemd
Copier les services depuis le script d'installation ou créer manuellement.

## 🐛 Troubleshooting

### Problème: "ReSpeaker non trouvé"
```bash
# Lister les cartes audio
arecord -l

# Si ReSpeaker absente, vérifier USB
lsusb | grep -i seed
# Attendu: "Seeed Technology Co., Ltd ReSpeaker 4 Mic Array (16k)"

# Reconnecter le ReSpeaker ou utiliser un autre port USB
```

### Problème: "Module OpenWakeWord failed to load"
```bash
# Réinstaller avec onnxruntime
python3 -m pip install --break-system-packages --force-reinstall \
  openwakeword onnxruntime

# Test minimal
python3 -c "import openwakeword; print('OK')"
```

### Problème: "Piper TTS timeout"
```bash
# Vérifier le service
systemctl status piper-tts

# Relancer manuellement
/opt/piper/piper_http_server.py

# Test API
curl http://localhost:8880/health
```

### Problème: "Node.js build failed"
```bash
# Vérifier version Node.js
node --version
# Attendu: v22.x.x

# Nettoyer et reinstaller
cd /opt/diva-embedded
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Problème: "Audio device busy"
```bash
# Tuer processus utilisant l'audio
sudo fuser -k /dev/snd/*

# Vérifier processus audio
sudo lsof /dev/snd/*

# Redémarrer ALSA
sudo systemctl restart alsa-state
```

### Problème: "Services ne démarrent pas"
```bash
# Vérifier logs
journalctl -u diva-embedded -f
journalctl -u piper-tts -f

# Permissions
chown -R root:root /opt/diva-embedded /opt/piper
chmod +x /opt/piper/piper_http_server.py
```

## 🔧 Configuration Avancée

### WireGuard (accès distant)
Le système peut être configuré avec WireGuard pour un accès distant sécurisé:

```bash
# Installer WireGuard
apt install wireguard

# Configuration à adapter selon votre VPS
# Fichier: /etc/wireguard/wg0.conf
```

### Optimisations performances
```bash
# Ajuster nice priority pour l'audio
systemctl edit diva-embedded
# Ajouter:
# [Service]
# Nice=-10
# IOSchedulingClass=1
# IOSchedulingPriority=4
```

### Monitoring
```bash
# Surveillance des logs
tail -f /var/log/syslog | grep -i diva

# Monitoring ressources
htop
iotop
```

## 📁 Structure des Fichiers

```
/opt/diva-embedded/           # Code source principal
├── src/                      # Code TypeScript
├── dist/                     # Code compilé
├── python/                   # Server Python wake word
├── assets/audio/             # Fichiers audio (acknowledgment)
├── .env                      # Configuration (clés API)
└── package.json              # Dépendances Node.js

/opt/piper/                   # Piper TTS
├── piper/piper               # Binaire ARM64
├── voices/                   # Modèles vocaux
└── piper_http_server.py      # Serveur HTTP

/etc/systemd/system/          # Services
├── diva-embedded.service     # Service principal
└── piper-tts.service         # Service TTS
```

## 🆘 Support

En cas de problème:

1. **Vérifier les logs:** `journalctl -u diva-embedded -f`
2. **Relancer l'installation:** `sudo scripts/install.sh` (idempotent)
3. **Tester les composants** individuellement (voir section Tests)
4. **Vérifier les prérequis** hardware et logiciel

Le script d'installation est idempotent et peut être relancé en cas d'échec partiel.