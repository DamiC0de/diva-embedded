# NPU TTS Integration pour Diva Embedded

Cette branche contient l'implémentation de l'intégration du NPU RK3588 pour accélérer le TTS Piper.

## 🚀 Nouveautés

### Architecture NPU/CPU hybride
- Interface commune `TtsInterface` pour switcher entre backends
- Backend NPU utilisant RKNN-Lite2 sur Rock 5B+
- Fallback automatique CPU en cas d'indisponibilité NPU
- Variable d'environnement `TTS_BACKEND=auto|cpu|npu`

### Performances attendues
- **NPU**: RTF ~0.15 (4.3x plus rapide que CPU)
- **CPU**: RTF ~0.65 (baseline actuelle)
- **Latence**: 35-50ms NPU vs 150-200ms CPU
- **Mémoire**: -75% avec quantification INT8

## 📁 Fichiers ajoutés

### Documentation
- `docs/NPU-COMPATIBILITY.md` - Analyse de compatibilité Piper/RKNN
- `docs/NPU-INTEGRATION.md` - Guide d'intégration complète
- `NPU-README.md` - Ce fichier

### Code TypeScript
- `src/tts/tts-interface.ts` - Interface commune & factory pattern
- `src/tts/piper-npu.ts` - Backend NPU (communication Rock 5B+)
- `src/tts/piper.ts` - Backend CPU mis à jour (garde compatibilité)

### Scripts
- `scripts/convert-onnx-to-rknn.py` - Conversion ONNX → RKNN avec quantification
- `scripts/benchmark-tts.sh` - Benchmark complet CPU vs NPU

## 🛠️ Quick Start

### 1. Compilation TypeScript
```bash
npm run build
```

### 2. Configuration
```bash
# .env
TTS_BACKEND=auto
NPU_TTS_URL=http://10.66.66.2:8881
NPU_FALLBACK_CPU=true
```

### 3. Utilisation
```typescript
import { TtsEngine } from './src/tts/tts-interface.js';

const engine = new TtsEngine({
  voice: 'fr_FR-siwis-medium', 
  format: 'wav'
});

await engine.initialize(); // Auto-sélection NPU/CPU
const audio = await engine.synthesize("Hello NPU!");
console.log(`Backend: ${engine.getMetrics().backend}`);
```

### 4. Conversion du modèle (sur machine avec RKNN-Toolkit2)
```bash
python3 scripts/convert-onnx-to-rknn.py \
  --input /opt/piper/voices/fr_FR-siwis-medium.onnx \
  --output models/fr_FR-siwis-medium.rknn \
  --quantize \
  --test
```

### 5. Benchmark
```bash
# Test complet
./scripts/benchmark-tts.sh --full

# Test NPU uniquement
./scripts/benchmark-tts.sh --backend npu

# Vérifier disponibilité
./scripts/benchmark-tts.sh --check
```

## 🔧 Workflow de déploiement

1. **Convertir le modèle** (machine avec RKNN-Toolkit2)
2. **Transférer** le .rknn vers le Rock 5B+ 
3. **Configurer** les variables d'environnement
4. **Démarrer** le service NPU sur le Rock
5. **Tester** avec `TTS_BACKEND=auto`

## ⚠️ Prérequis

### Sur le VPS (Diva)
- Node.js + TypeScript compilé
- Connectivité WireGuard vers Rock 5B+ (10.66.66.2)
- Piper CPU en fallback (localhost:8880)

### Sur le Rock 5B+
- RKNN-Lite2 runtime
- Service HTTP NPU sur port 8881
- Modèle .rknn disponible

### Pour la conversion
- Python 3.8-3.10
- rknn-toolkit2 installé
- Modèle ONNX source

## 🎯 Métriques cibles

| Métrique | CPU (actuel) | NPU (cible) | Gain |
|----------|--------------|-------------|------|
| RTF | 0.65 | 0.15 | 4.3x |
| Latence | 150ms | 40ms | 3.7x |
| Mémoire | 512MB | 128MB | 75% |

## 🔄 Statut d'implémentation

- ✅ Architecture TypeScript NPU/CPU
- ✅ Documentation complète
- ✅ Scripts de conversion et benchmark
- ⏳ Tests sur hardware NPU (requiert Rock 5B+)
- ⏳ Service HTTP NPU sur Rock (à implémenter)
- ⏳ Validation performances réelles

## 📝 Notes techniques

- **Fallback intelligent** : Détection automatique NPU puis CPU si échec
- **Métriques temps réel** : RTF, latence, utilisation mémoire
- **Quantification INT8** : Réduction modèle 75% + accélération NPU
- **API rétrocompatible** : Anciens appels `synthesize()` fonctionnent toujours
- **Circuit breaker** : Évite la surcharge en cas d'échecs répétés NPU

---

**Branche créée par** : Agent Subagent Diva Embedded Team  
**Date** : Mars 2026  
**Contexte** : Intégration NPU RK3588 pour optimisation TTS Piper