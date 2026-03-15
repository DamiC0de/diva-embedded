# Intégration NPU RK3588 pour Piper TTS

## Vue d'ensemble

Cette documentation décrit l'architecture d'intégration du NPU RK3588 avec Piper TTS dans le projet Diva Embedded. L'implémentation permet de switcher entre backends CPU et NPU selon la disponibilité et les performances.

## Architecture

### Composants principaux

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   TtsEngine     │◄──►│  TtsInterface    │◄──►│  Backend Impl   │
│   (Facade)      │    │  (Contract)      │    │  CPU / NPU      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌───────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
        │ PiperCpuBackend │ │ PiperNpuBackend │ │ TtsFactory │
        │ (HTTP local)    │ │ (RKNN via Rock) │ │ (Builder)  │
        └─────────────────┘ └─────────────────┘ └────────────┘
```

### Flux de données NPU

```
┌─────────┐   HTTP   ┌─────────────┐   RKNN   ┌─────────────┐   Audio   ┌────────┐
│ Client  │ ────────►│   VPS       │ ────────►│  Rock 5B+   │ ◄─────── │  NPU   │
│ (Diva)  │          │ TtsEngine   │  WireGrd │ RKNN-Lite2  │          │ RK3588 │
└─────────┘          └─────────────┘          └─────────────┘          └────────┘
                           │                        │
                           │ Fallback               │ Modèle RKNN
                           ▼                        │ fr_FR-siwis.rknn
                    ┌─────────────┐                 │
                    │ Piper CPU   │                 │
                    │ (localhost) │◄────────────────┘
                    └─────────────┘     Si échec NPU
```

## Configuration

### Variables d'environnement

```bash
# Backend TTS à utiliser
TTS_BACKEND=auto|cpu|npu

# URLs des services
TTS_BASE_URL=http://localhost:8880        # Piper CPU
NPU_TTS_URL=http://10.66.66.2:8881      # Service NPU sur Rock

# Fallback automatique CPU si NPU échoue
NPU_FALLBACK_CPU=true|false
```

### Sélection automatique

- `TTS_BACKEND=auto` : Détection automatique NPU → CPU si indisponible
- `TTS_BACKEND=npu` : Force NPU, erreur si indisponible
- `TTS_BACKEND=cpu` : Force CPU uniquement

## Utilisation

### API moderne (recommandée)

```typescript
import { TtsEngine } from './tts/tts-interface.js';

// Configuration
const engine = new TtsEngine({
  voice: 'fr_FR-siwis-medium',
  format: 'wav'
});

// Initialisation avec détection automatique
await engine.initialize(); // Utilise TTS_BACKEND

// Ou force un backend spécifique
await engine.initialize('npu');

// Synthèse
const audioBuffer = await engine.synthesize("Bonjour depuis le NPU!");
const metrics = engine.getMetrics();
console.log(`RTF: ${metrics.rtf}, Backend: ${metrics.backend}`);

// Nettoyage
await engine.dispose();
```

### API backend direct

```typescript
import { PiperNpuBackend } from './tts/piper-npu.js';
import { PiperCpuBackend } from './tts/piper.js';

// Backend NPU explicite
const npuBackend = new PiperNpuBackend();
if (await npuBackend.isAvailable()) {
  await npuBackend.initialize({ voice: 'fr_FR-siwis-medium', format: 'wav' });
  const audio = await npuBackend.synthesize("Test NPU");
  await npuBackend.dispose();
}

// Backend CPU explicite
const cpuBackend = new PiperCpuBackend();
await cpuBackend.initialize({ voice: 'fr_FR-siwis-medium', format: 'wav' });
const audio = await cpuBackend.synthesize("Test CPU");
await cpuBackend.dispose();
```

### Factory pattern

```typescript
import { TtsFactory } from './tts/tts-interface.js';

const config = { voice: 'fr_FR-siwis-medium', format: 'wav' };

// Auto-détection du meilleur backend
const bestType = await TtsFactory.detectBestBackend();
console.log(`Best backend: ${bestType}`);

// Création du backend
const backend = await TtsFactory.createBackend('auto', config);
await backend.initialize(config);
```

## Service NPU sur Rock 5B+

### Architecture du service

Le Rock 5B+ expose un service HTTP qui encapsule RKNN-Lite2 :

```
Rock 5B+ (10.66.66.2:8881)
├── /health                 # Status NPU
├── /v1/npu/info           # Infos hardware NPU
├── /v1/npu/models         # Liste des modèles
├── /v1/npu/configure      # Configuration modèle
├── /v1/npu/speech         # Synthèse TTS
└── /v1/npu/reload         # Rechargement modèle
```

### Endpoints NPU

#### Health Check
```http
GET /health
Response: {
  "status": "ok",
  "npu_available": true,
  "model_loaded": true,
  "model_name": "fr_FR-siwis-medium.rknn"
}
```

#### Synthèse TTS
```http
POST /v1/npu/speech
Content-Type: application/json
{
  "input": "Texte à synthétiser",
  "voice": "fr_FR-siwis-medium",
  "response_format": "wav",
  "backend": "npu"
}

Response: Binary WAV data
```

#### Configuration modèle
```http
POST /v1/npu/configure
Content-Type: application/json
{
  "model": "fr_FR-siwis-medium",
  "backend": "rknn",
  "quantization": "int8"
}
```

## Déploiement

### 1. Conversion du modèle

```bash
# Sur le VPS, convertir ONNX → RKNN
cd /tmp/diva-npu
python3 scripts/convert-onnx-to-rknn.py \
  --input /opt/piper/voices/fr_FR-siwis-medium.onnx \
  --output models/fr_FR-siwis-medium.rknn \
  --quantize \
  --test
```

### 2. Transfer vers Rock

```bash
# Copie via WireGuard
scp models/fr_FR-siwis-medium.rknn root@10.66.66.2:/opt/rknn-models/
```

### 3. Configuration Diva

```bash
# Dans .env
TTS_BACKEND=auto
NPU_TTS_URL=http://10.66.66.2:8881
NPU_FALLBACK_CPU=true
```

### 4. Test d'intégration

```typescript
// Test du workflow complet
import { TtsEngine } from './src/tts/tts-interface.js';

const engine = new TtsEngine({
  voice: 'fr_FR-siwis-medium',
  format: 'wav'
});

await engine.initialize('auto');
const audio = await engine.synthesize("Test intégration NPU/CPU");
const metrics = engine.getMetrics();

console.log(`Backend utilisé: ${metrics.backend}`);
console.log(`RTF: ${metrics.rtf.toFixed(3)}`);
console.log(`Latence: ${metrics.latencyMs.toFixed(1)}ms`);
```

## Performances attendues

### Métriques cibles

| Métrique | CPU (RK3588) | NPU (RK3588) | Amélioration |
|----------|--------------|--------------|--------------|
| RTF | 0.65 | 0.15 | **4.3x** |
| Latence | 150-200ms | 35-50ms | **3-4x** |
| Mémoire | 512MB | 128MB | **75%** |
| CPU usage | 80-90% | 15-25% | **70%** |

### Conditions de test
- **Texte** : Phrase française 10-15 mots
- **Modèle** : fr_FR-siwis-medium (INT8 quantifié)
- **Hardware** : Rock 5B+ RK3588, 8GB RAM

## Fallback et récupération d'erreur

### Stratégies de fallback

1. **Détection d'indisponibilité NPU**
   ```typescript
   if (!(await npuBackend.isAvailable())) {
     console.warn("NPU unavailable, using CPU backend");
     return new PiperCpuBackend();
   }
   ```

2. **Fallback runtime**
   ```typescript
   try {
     return await npuBackend.synthesize(text);
   } catch (error) {
     if (process.env.NPU_FALLBACK_CPU === "true") {
       console.warn("NPU failed, falling back to CPU");
       return await cpuBackend.synthesize(text);
     }
     throw error;
   }
   ```

3. **Circuit breaker** (optionnel)
   - Après N échecs NPU consécutifs, utiliser CPU temporairement
   - Test périodique de récupération NPU

### Gestion des erreurs courantes

| Erreur | Cause | Solution |
|--------|-------|----------|
| 503 Service Unavailable | NPU occupé | Retry avec backoff |
| Timeout | Surcharge NPU | Fallback CPU |
| Network error | WireGuard down | Fallback CPU |
| Model not loaded | Configuration NPU | Reload model |

## Monitoring et métriques

### Métriques collectées

```typescript
interface TtsMetrics {
  rtf: number;              // Real-Time Factor
  latencyMs: number;        // Latence totale
  memoryUsageMb: number;    // Utilisation mémoire
  synthesisCount: number;   // Nombre de synthèses
  backend: 'cpu'|'npu';     // Backend utilisé
}
```

### Logs de performance

```typescript
// Example de monitoring
const metrics = await engine.getMetrics();
console.log(`[TTS] Backend=${metrics.backend} RTF=${metrics.rtf.toFixed(3)} Latency=${metrics.latencyMs}ms Count=${metrics.synthesisCount}`);
```

### Alertes recommandées

- RTF > 0.5 sur NPU (performance dégradée)
- Taux d'échec NPU > 20% (problème hardware)
- Latence > 100ms sur NPU (surcharge)

## Migration et compatibilité

### Migration depuis l'API legacy

```typescript
// AVANT (legacy)
import { synthesize } from './tts/piper.js';
const audio = await synthesize("Hello");

// APRÈS (moderne)
import { TtsEngine } from './tts/tts-interface.js';
const engine = new TtsEngine({ voice: 'fr_FR-siwis-medium', format: 'wav' });
await engine.initialize();
const audio = await engine.synthesize("Hello");
await engine.dispose();
```

### Tests de compatibilité

```bash
# Tester CPU uniquement
TTS_BACKEND=cpu npm test

# Tester NPU si disponible
TTS_BACKEND=npu npm test

# Tester fallback automatique
TTS_BACKEND=auto npm test
```

L'API legacy reste disponible pour compatibilité ascendante mais affiche des warnings de dépréciation.