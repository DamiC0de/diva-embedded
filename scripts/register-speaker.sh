#!/bin/bash
# Script d'enregistrement d'un nouveau membre de la famille pour Diva

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIVA_ROOT="$(dirname "$SCRIPT_DIR")"
SPEAKER_DATA_DIR="$DIVA_ROOT/data/speakers"

echo "=== Enregistrement d'un nouveau locuteur ==="

# Vérifier les dépendances
if ! command -v python3 &> /dev/null; then
    echo "Erreur: Python3 non trouvé"
    exit 1
fi

# Vérifier si le service Diva tourne
if systemctl is-active --quiet diva-embedded.service; then
    echo "⚠️  Le service Diva est actif. Arrêt temporaire..."
    sudo systemctl stop diva-embedded.service
    SERVICE_WAS_RUNNING=1
else
    SERVICE_WAS_RUNNING=0
fi

# Demander le nom
read -p "Nom du locuteur (ex: nicolas, natacha, enfant1): " SPEAKER_NAME

if [ -z "$SPEAKER_NAME" ]; then
    echo "Erreur: Nom requis"
    exit 1
fi

# Nettoyer le nom (minuscules, sans espaces)
SPEAKER_NAME=$(echo "$SPEAKER_NAME" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

echo "Enregistrement de '$SPEAKER_NAME'..."
echo ""
echo "📋 Vous allez enregistrer 3 échantillons vocaux."
echo "   Parlez clairement pendant 3-5 secondes à chaque fois."
echo "   Exemples: 'Bonjour Diva', 'Comment ça va', 'Il fait beau aujourd'hui'"
echo ""

# Créer le répertoire si nécessaire
mkdir -p "$SPEAKER_DATA_DIR"

# Enregistrer 3 échantillons
for i in {1..3}; do
    echo "=== Échantillon $i/3 ==="
    read -p "Appuyez sur Entrée pour commencer l'enregistrement..." -r
    
    TEMP_FILE="/tmp/speaker_sample_${i}.wav"
    echo "🎤 Enregistrement... (5 secondes)"
    
    # Enregistrer 5 secondes avec le micro de Diva
    timeout 5 arecord -D plughw:5 -f S16_LE -r 16000 -c 1 "$TEMP_FILE" > /dev/null 2>&1 || true
    
    echo "✅ Échantillon $i enregistré"
    
    # Jouer l'échantillon pour vérification
    read -p "Voulez-vous écouter l'échantillon ? (o/N): " -r
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        aplay "$TEMP_FILE" > /dev/null 2>&1 || echo "Impossible de lire l'audio"
    fi
    
    echo ""
done

echo "🔧 Traitement des échantillons..."

# Créer le script Python pour traiter l'enregistrement
cat > "/tmp/register_speaker.py" << PYTHON_EOF
#!/usr/bin/env python3
import sys
import os
sys.path.append('$DIVA_ROOT/python')

try:
    from speaker_identification import SpeakerIdentifier
    import librosa
    import numpy as np
    
    identifier = SpeakerIdentifier()
    
    # Charger les 3 échantillons
    samples = []
    for i in range(1, 4):
        file_path = f"/tmp/speaker_sample_{i}.wav"
        if os.path.exists(file_path):
            audio, sr = librosa.load(file_path, sr=16000)
            if len(audio) > 0:
                samples.append(audio)
    
    if len(samples) >= 2:  # Au moins 2 échantillons valides
        success = identifier.register_speaker("$SPEAKER_NAME", samples)
        if success:
            print(f"✅ Locuteur '$SPEAKER_NAME' enregistré avec succès!")
            print(f"Locuteurs disponibles: {', '.join(identifier.list_speakers())}")
        else:
            print("❌ Erreur lors de l'enregistrement")
            sys.exit(1)
    else:
        print("❌ Pas assez d'échantillons valides")
        sys.exit(1)

except ImportError as e:
    print(f"❌ Erreur import: {e}")
    print("Les dépendances Python ne sont pas installées. Utilisez:")
    print("pip install --break-system-packages scikit-learn librosa")
    sys.exit(1)
except Exception as e:
    print(f"❌ Erreur: {e}")
    sys.exit(1)
PYTHON_EOF

# Exécuter l'enregistrement
python3 "/tmp/register_speaker.py"

# Nettoyer les fichiers temporaires
rm -f /tmp/speaker_sample_*.wav /tmp/register_speaker.py

# Redémarrer le service si nécessaire
if [ $SERVICE_WAS_RUNNING -eq 1 ]; then
    echo "🔄 Redémarrage du service Diva..."
    sudo systemctl start diva-embedded.service
    sleep 2
    
    if systemctl is-active --quiet diva-embedded.service; then
        echo "✅ Service Diva redémarré"
    else
        echo "❌ Erreur redémarrage service"
        sudo systemctl status diva-embedded.service
    fi
fi

echo ""
echo "🎉 Enregistrement terminé !"
echo "Le locuteur '$SPEAKER_NAME' peut maintenant être identifié par Diva."
