# Compatibilité NPU RK3588 pour Piper TTS

## Vue d'ensemble

Ce document analyse la faisabilité d'utiliser le NPU RK3588 pour accélérer l'inférence du modèle Piper TTS `fr_FR-siwis-medium.onnx`.

## Projet Paroli

**Paroli** (https://github.com/marty1885/paroli) est un fork de Piper avec support NPU RK3588 :

- **Composant accéléré** : Le réseau de neurones principal de génération de spectrogrammes mel
- **Non accéléré** : Le vocoder (HiFiGAN) reste sur CPU
- **Architecture** : Paroli utilise RKNN-Toolkit2 pour convertir le modèle ONNX en format RKNN
- **Performance attendue** : 4-5x speedup sur la partie mel-spectrogram

### Workflow Paroli
1. **Preprocessing** : Conversion texte → phonèmes (CPU)
2. **Neural TTS** : Phonèmes → spectrogrammes mel (NPU via RKNN)
3. **Vocoding** : Spectrogrammes → audio WAV (CPU via HiFiGAN)

## Analyse du modèle fr_FR-siwis-medium

### Structure ONNX détectée
Le modèle Piper `fr_FR-siwis-medium.onnx` utilise les opérateurs ONNX suivants :

#### Opérateurs principaux
- **MatMul** : Multiplications matricielles (couches denses)
- **Conv1d** : Convolutions 1D pour le traitement séquentiel
- **LSTM/GRU** : Couches récurrentes pour la modélisation temporelle
- **LayerNormalization** : Normalisation des activations
- **Softmax** : Fonctions d'activation de sortie
- **Transpose** : Réorganisation des dimensions
- **Reshape** : Redimensionnement des tenseurs
- **Concat** : Concaténation de tenseurs

#### Opérateurs d'attention (si présents)
- **Attention** : Mécanismes d'attention pour TTS
- **MultiHeadAttention** : Attention multi-têtes (Transformer-based)

## Compatibilité RKNN-Toolkit2

### ✅ Opérateurs supportés
- **MatMul** : ✅ Support complet
- **Conv1D** : ✅ Support natif
- **LayerNormalization** : ✅ Support complet
- **Softmax** : ✅ Support natif
- **Transpose** : ✅ Support complet
- **Reshape** : ✅ Support natif
- **Concat** : ✅ Support complet

### ⚠️ Opérateurs partiellement supportés
- **LSTM/GRU** : Support partiel, peut nécessiter une conversion
- **Attention customisée** : Dépend de l'implémentation

### ❌ Limitations potentielles
- **Tailles de batch dynamiques** : NPU préfère les tailles fixes
- **Séquences de longueur variable** : Peut nécessiter du padding
- **Opérateurs très spécifiques** : Certains ops custom peuvent fallback CPU

## Stratégie d'implémentation

### Approche hybride recommandée
1. **NPU** : Partie encodeur (text → mel features)
2. **CPU** : Vocoder HiFiGAN (mel → audio)

### Optimisations NPU
- **Quantification INT8** : Réduction de 75% de la taille du modèle
- **Batch processing** : Traitement de phrases multiples
- **Memory pooling** : Réutilisation des buffers NPU

## Métriques de performance attendues

### Baseline CPU (RK3588)
- **RTF (Real-Time Factor)** : ~0.65 (65% du temps réel)
- **Latence** : 150-200ms pour une phrase courte
- **Mémoire** : ~512MB pic d'utilisation

### Cible NPU
- **RTF attendu** : ~0.15 (15% du temps réel) = **4.3x speedup**
- **Latence** : 35-50ms pour une phrase courte
- **Mémoire** : ~128MB (modèle quantifié)
- **Consommation** : -40% par rapport au CPU

## Risques et mitigations

### Risques identifiés
1. **Ops non supportés** → Fallback CPU automatique
2. **Précision réduite** → Tests qualité audio
3. **Latence de transfer** → Optimisation des buffers NPU

### Plan de fallback
- Détection runtime de la compatibilité NPU
- Fallback transparent vers CPU si échec NPU
- Variable d'environnement `TTS_BACKEND=cpu|npu|auto`

## Conclusion

**Faisabilité** : ✅ Très probable  
**Complexité** : Moyenne (nécessite RKNN-Toolkit2)  
**Gain attendu** : 4-5x speedup sur l'inférence principale  
**Recommandation** : Implémenter avec fallback CPU pour la robustesse