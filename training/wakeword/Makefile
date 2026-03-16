.PHONY: help check-gpu setup generate augment record train convert test test-rknn all clean

SHELL := /bin/bash
CONDA_ACTIVATE = eval "$$($(HOME)/miniconda3/bin/conda shell.bash hook)" && conda activate diva

WAKE_WORD ?= diva
PLATFORM ?= rk3588
THRESHOLD ?= 0.7
RECORD_COUNT ?= 30
CONFIG ?= config/training_config.yaml

help: ## Affiche cette aide
	@echo ""
	@echo "  Pipeline d'entraînement wake word '$(WAKE_WORD)'"
	@echo "  ================================================"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Pipeline complète : make all"
	@echo "  Pipeline + voix   : make all-with-voice"
	@echo ""

# === Vérifications ===

check-gpu: ## Vérifie le setup CUDA / RTX 4090
	@echo "=== Vérification GPU ==="
	nvidia-smi
	@$(CONDA_ACTIVATE) && python -c "import torch; print(f'PyTorch CUDA: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"
	@$(CONDA_ACTIVATE) && python -c "import onnxruntime as ort; print(f'ONNX Providers: {ort.get_available_providers()}')"

# === Setup ===

setup: ## Télécharge les données d'entraînement (voix, features, bruit)
	$(CONDA_ACTIVATE) && bash scripts/setup_data.sh

install: ## Installe les dépendances Python dans conda env diva
	$(CONDA_ACTIVATE) && pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
	$(CONDA_ACTIVATE) && pip install -r requirements.txt

# === Pipeline d'entraînement ===

generate: ## Génère les échantillons audio synthétiques (Piper + eSpeak)
	$(CONDA_ACTIVATE) && python scripts/generate_samples.py --config $(CONFIG)

augment: ## Augmente les échantillons (bruit, pitch, vitesse...)
	$(CONDA_ACTIVATE) && python scripts/augment_samples.py --config $(CONFIG)

record: ## Enregistre ta voix (20-50 clips recommandés)
	$(CONDA_ACTIVATE) && python scripts/record_samples.py --count $(RECORD_COUNT) --wake-word $(WAKE_WORD)

train: ## Entraîne le modèle classifieur
	$(CONDA_ACTIVATE) && python scripts/train.py --config $(CONFIG)

convert: ## Convertit le modèle en RKNN pour le NPU
	$(CONDA_ACTIVATE) && python scripts/convert_to_rknn.py --config $(CONFIG) --platform $(PLATFORM)

convert-all: ## Convertit classifieur + embedding en RKNN
	$(CONDA_ACTIVATE) && python scripts/convert_to_rknn.py --config $(CONFIG) --platform $(PLATFORM) --convert-embedding

test: ## Teste le modèle en temps réel (micro)
	$(CONDA_ACTIVATE) && python scripts/test_model.py --model models/diva_fr/diva_fr.onnx --threshold $(THRESHOLD)

test-rknn: ## Teste le modèle RKNN (sur RK3588 uniquement)
	$(CONDA_ACTIVATE) && python scripts/test_model.py --rknn --model models/diva_fr/rknn/ --threshold $(THRESHOLD)

# === Raccourcis ===

all: setup generate augment train ## Pipeline complète sans enregistrements vocaux
	@echo ""
	@echo "=== Pipeline terminée ==="
	@echo "Teste avec : make test"

all-with-voice: setup record generate augment train ## Pipeline complète avec enregistrements
	@echo ""
	@echo "=== Pipeline terminée ==="

# === Docker ===

docker-build: ## Build le container Docker
	docker compose build trainer

docker-train: docker-build ## Entraîne via Docker (GPU)
	docker compose run --rm --gpus all trainer bash -c \
		"bash scripts/setup_data.sh && \
		 python3 scripts/generate_samples.py && \
		 python3 scripts/augment_samples.py && \
		 python3 scripts/train.py"

# === Nettoyage ===

clean: ## Supprime les données générées (garde les downloads et recordings)
	rm -rf data/positive data/negative data/augmented models/diva_fr/checkpoints
	@echo "Nettoyé. Downloads et recordings conservés."

clean-all: ## Supprime TOUT
	rm -rf data/ models/ voices/ deps/
	@echo "Tout supprimé."
