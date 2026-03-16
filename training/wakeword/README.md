# Diva Wake Word — Entraînement

Pipeline d'entraînement du wake word **"Diva"** pour openWakeWord / openWakeWord-RKNN.

## Quick Start — Enregistrer sa voix

Tu veux ajouter ta voix au modèle ? C'est simple :

```bash
# 1. Clone le repo
git clone https://github.com/DamiC0de/diva-embedded.git
cd diva-embedded/training/wakeword

# 2. Installe tout (Miniconda + Python 3.10 + dépendances)
bash setup_env.sh

# 3. Enregistre ta voix (50 clips de 2 secondes)
bash record.sh

# 4. Envoie tes enregistrements
#    → Les fichiers sont dans recordings/
#    → Envoie le dossier recordings/ à l'équipe
```

## Setup complet (pour entraîner le modèle)

```bash
# 1. Installer l'environnement
bash setup_env.sh

# 2. Télécharger les données d'entraînement (~17 Go)
make setup

# 3. (Optionnel) Enregistrer sa voix
make record

# 4. Générer les samples synthétiques
make generate

# 5. Augmenter les données
make augment

# 6. Entraîner
bash run_train.sh

# 7. Tester en temps réel
make test

# 8. Convertir pour le NPU RK3588
make convert
```

## Pipeline complète en une commande

```bash
bash setup_env.sh && make all-with-voice
```

## Structure

```
training/wakeword/
├── setup_env.sh              # Installation automatique (Miniconda + deps)
├── record.sh                 # Enregistrer sa voix (raccourci)
├── run_train.sh              # Lancer l'entraînement
├── Makefile                  # Commandes make
├── config/
│   └── training_config.yaml  # Configuration complète
├── scripts/
│   ├── setup_data.sh         # Télécharge voix Piper FR, ACAV100M, bruit
│   ├── generate_samples.py   # Génère samples TTS (Piper + eSpeak)
│   ├── augment_samples.py    # Augmentation audio
│   ├── record_samples.py     # Enregistre ta voix
│   ├── train.py              # Entraîne le classifieur
│   ├── convert_to_rknn.py    # Conversion RKNN pour NPU
│   ├── test_model.py         # Test temps réel
│   └── gpu_guard.py          # Protection surchauffe GPU
├── recordings/               # Tes enregistrements vocaux
├── data/                     # Données d'entraînement (généré)
├── models/                   # Modèles exportés (généré)
└── voices/                   # Voix Piper TTS (généré)
```

## Ajouter des enregistrements depuis un autre PC

1. Clone le repo sur le PC de ton ami
2. Lance `bash setup_env.sh` (installe tout automatiquement)
3. Lance `bash record.sh`
4. Dis **"Diva"** 50 fois (variations de ton, volume, distance)
5. Récupère le dossier `recordings/` et copie-le dans ton dossier d'entraînement principal
6. Réentraîne avec `bash run_train.sh`

## Prérequis

- Linux (Ubuntu 22.04+ / Debian 12+)
- Micro USB ou intégré
- ~20 Go d'espace disque (pour les données d'entraînement)
- GPU NVIDIA recommandé (mais pas obligatoire)
