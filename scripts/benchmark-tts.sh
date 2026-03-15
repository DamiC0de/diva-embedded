#!/bin/bash

# Benchmark TTS - Comparaison CPU vs NPU
# Mesure les performances de synthèse vocale sur différents backends

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_ROOT/benchmark-results"
OUTPUT_DIR="$RESULTS_DIR/audio"
LOG_FILE="$RESULTS_DIR/benchmark-$(date +%Y%m%d_%H%M%S).log"

# Textes de test (différentes longueurs)
declare -a TEST_TEXTS=(
    "Bonjour."
    "Bonjour, comment allez-vous aujourd'hui ?"
    "Ceci est un test de performance du système de synthèse vocale utilisant le processeur neuronal RK3588 pour accélérer l'inférence du modèle Piper."
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur."
)

# Labels pour les textes
declare -a TEXT_LABELS=(
    "court"
    "moyen"
    "long"
    "tres_long"
)

# Backends à tester
declare -a BACKENDS=("cpu" "npu")

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
log() {
    echo -e "$(date '+%H:%M:%S') $1" | tee -a "$LOG_FILE"
}

error() {
    log "${RED}[ERROR]${NC} $1"
}

info() {
    log "${BLUE}[INFO]${NC} $1"
}

success() {
    log "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    log "${YELLOW}[WARNING]${NC} $1"
}

# Vérification des prérequis
check_prerequisites() {
    info "Vérification des prérequis..."
    
    # Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js non trouvé"
        exit 1
    fi
    
    # NPM packages
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        error "package.json non trouvé dans $PROJECT_ROOT"
        exit 1
    fi
    
    # TypeScript compilé
    if [[ ! -f "$PROJECT_ROOT/dist/tts/tts-interface.js" ]]; then
        warning "Code TypeScript non compilé, compilation..."
        cd "$PROJECT_ROOT" && npm run build
    fi
    
    # ffmpeg pour analyse audio
    if ! command -v ffmpeg &> /dev/null; then
        warning "ffmpeg non trouvé, analyse qualité audio désactivée"
        ANALYZE_AUDIO=false
    else
        ANALYZE_AUDIO=true
    fi
    
    success "Prérequis vérifiés"
}

# Créer l'environnement de test
setup_benchmark_env() {
    info "Préparation environnement de benchmark..."
    
    mkdir -p "$RESULTS_DIR" "$OUTPUT_DIR"
    
    # Copie du script Node.js de benchmark
    cat > "$RESULTS_DIR/benchmark.js" << 'EOF'
const { TtsEngine } = require('../dist/tts/tts-interface.js');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

async function benchmarkBackend(backend, text, label, outputDir) {
    const startMemory = process.memoryUsage();
    const startTime = performance.now();
    
    let engine;
    let success = false;
    let error = null;
    let audioPath = null;
    
    try {
        engine = new TtsEngine({
            voice: 'fr_FR-siwis-medium',
            format: 'wav'
        });
        
        // Force le backend spécifique
        await engine.initialize(backend);
        
        // Synthèse
        const synthesisStart = performance.now();
        const audioBuffer = await engine.synthesize(text);
        const synthesisEnd = performance.now();
        
        // Sauvegarde
        audioPath = path.join(outputDir, `${backend}_${label}_${Date.now()}.wav`);
        await fs.writeFile(audioPath, audioBuffer);
        
        const endMemory = process.memoryUsage();
        const endTime = performance.now();
        
        // Métriques
        const metrics = engine.getMetrics();
        
        const result = {
            backend,
            text_label: label,
            text_length: text.length,
            success: true,
            total_time_ms: endTime - startTime,
            synthesis_time_ms: synthesisEnd - synthesisStart,
            rtf: metrics.rtf,
            latency_ms: metrics.latencyMs,
            memory_used_mb: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024,
            audio_path: audioPath,
            timestamp: new Date().toISOString()
        };
        
        success = true;
        return result;
        
    } catch (err) {
        error = err.message;
        return {
            backend,
            text_label: label,
            text_length: text.length,
            success: false,
            error: error,
            timestamp: new Date().toISOString()
        };
    } finally {
        if (engine) {
            await engine.dispose();
        }
    }
}

// Export pour utilisation depuis le shell
module.exports = { benchmarkBackend };

// CLI usage
if (require.main === module) {
    const [,, backend, text, label, outputDir] = process.argv;
    
    benchmarkBackend(backend, text, label, outputDir)
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        })
        .catch(err => {
            console.error(JSON.stringify({
                success: false,
                error: err.message,
                timestamp: new Date().toISOString()
            }));
            process.exit(1);
        });
}
EOF
    
    success "Environnement préparé"
}

# Test de disponibilité des backends
test_backend_availability() {
    local backend=$1
    info "Test de disponibilité du backend $backend..."
    
    cd "$PROJECT_ROOT"
    local result=$(TTS_BACKEND="$backend" node -e "
        const { TtsEngine } = require('./dist/tts/tts-interface.js');
        (async () => {
            try {
                const engine = new TtsEngine({ voice: 'fr_FR-siwis-medium', format: 'wav' });
                await engine.initialize('$backend');
                console.log('available');
                await engine.dispose();
            } catch (err) {
                console.log('unavailable');
            }
        })();
    " 2>/dev/null || echo "unavailable")
    
    if [[ "$result" == "available" ]]; then
        success "Backend $backend disponible"
        return 0
    else
        warning "Backend $backend non disponible"
        return 1
    fi
}

# Exécution du benchmark pour un backend et un texte
run_single_benchmark() {
    local backend=$1
    local text=$2
    local label=$3
    
    info "Benchmark $backend - $label..."
    
    cd "$PROJECT_ROOT"
    local result=$(TTS_BACKEND="$backend" node "$RESULTS_DIR/benchmark.js" "$backend" "$text" "$label" "$OUTPUT_DIR" 2>&1)
    
    echo "$result" >> "$RESULTS_DIR/${backend}_${label}_raw.json"
    echo "$result"
}

# Analyse de la qualité audio avec ffmpeg
analyze_audio_quality() {
    local audio_file=$1
    
    if [[ ! "$ANALYZE_AUDIO" == "true" ]] || [[ ! -f "$audio_file" ]]; then
        echo "{\"analysis\": \"disabled\"}"
        return
    fi
    
    info "Analyse qualité audio: $(basename "$audio_file")"
    
    # Extraction des métriques audio
    local duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$audio_file" 2>/dev/null || echo "0")
    local bitrate=$(ffprobe -v quiet -show_entries format=bit_rate -of csv=p=0 "$audio_file" 2>/dev/null || echo "0")
    local sample_rate=$(ffprobe -v quiet -show_entries stream=sample_rate -of csv=p=0 "$audio_file" 2>/dev/null || echo "0")
    
    echo "{
        \"duration_s\": $duration,
        \"bitrate\": $bitrate,
        \"sample_rate\": $sample_rate,
        \"file_size_bytes\": $(stat -f%z "$audio_file" 2>/dev/null || stat -c%s "$audio_file" 2>/dev/null || echo "0")
    }"
}

# Benchmark complet
run_full_benchmark() {
    info "Début du benchmark complet TTS"
    
    # Fichier résultats consolidés
    local results_file="$RESULTS_DIR/benchmark_results.json"
    echo "[]" > "$results_file"
    
    # Variables pour statistiques globales
    local total_tests=0
    local successful_tests=0
    
    for backend in "${BACKENDS[@]}"; do
        if ! test_backend_availability "$backend"; then
            warning "Ignore backend $backend (non disponible)"
            continue
        fi
        
        for i in "${!TEST_TEXTS[@]}"; do
            local text="${TEST_TEXTS[$i]}"
            local label="${TEXT_LABELS[$i]}"
            
            total_tests=$((total_tests + 1))
            
            info "Test $backend / $label (${#text} caractères)..."
            
            # Exécution du benchmark
            local benchmark_result=$(run_single_benchmark "$backend" "$text" "$label")
            
            # Parsing du résultat
            local audio_path=$(echo "$benchmark_result" | jq -r '.audio_path // empty' 2>/dev/null || echo "")
            local success=$(echo "$benchmark_result" | jq -r '.success // false' 2>/dev/null || echo "false")
            
            if [[ "$success" == "true" ]]; then
                successful_tests=$((successful_tests + 1))
                
                # Analyse audio si fichier généré
                if [[ -n "$audio_path" && -f "$audio_path" ]]; then
                    local audio_analysis=$(analyze_audio_quality "$audio_path")
                    benchmark_result=$(echo "$benchmark_result" | jq --argjson audio "$audio_analysis" '. + {audio_analysis: $audio}' 2>/dev/null || echo "$benchmark_result")
                fi
                
                success "✓ $backend/$label - $(echo "$benchmark_result" | jq -r '.synthesis_time_ms // 0' 2>/dev/null || echo "?")ms"
            else
                error "✗ $backend/$label - $(echo "$benchmark_result" | jq -r '.error // "Erreur inconnue"' 2>/dev/null || echo "Erreur")"
            fi
            
            # Ajout au fichier de résultats
            echo "$benchmark_result" | jq -s ". as \$item | $(cat "$results_file") + \$item" > "$results_file.tmp" && mv "$results_file.tmp" "$results_file"
            
            # Pause entre les tests
            sleep 1
        done
    done
    
    info "Benchmark terminé: $successful_tests/$total_tests tests réussis"
}

# Génération du rapport de performance
generate_report() {
    local results_file="$RESULTS_DIR/benchmark_results.json"
    local report_file="$RESULTS_DIR/performance_report.md"
    
    if [[ ! -f "$results_file" ]]; then
        error "Fichier de résultats non trouvé: $results_file"
        return 1
    fi
    
    info "Génération du rapport de performance..."
    
    cat > "$report_file" << EOF
# Rapport de Performance TTS - $(date)

## Configuration de test

- **Hardware**: $(uname -m) / $(uname -s)
- **Node.js**: $(node --version)
- **Timestamp**: $(date -Iseconds)
- **Projet**: Diva Embedded NPU Integration

## Résultats par backend

EOF
    
    # Analyse des résultats par backend
    for backend in "${BACKENDS[@]}"; do
        local backend_results=$(cat "$results_file" | jq --arg backend "$backend" '[.[] | select(.backend == $backend and .success == true)]' 2>/dev/null || echo "[]")
        local count=$(echo "$backend_results" | jq 'length' 2>/dev/null || echo "0")
        
        if [[ "$count" -gt 0 ]]; then
            echo "### Backend: $backend ($count tests)" >> "$report_file"
            echo "" >> "$report_file"
            
            # Métriques moyennes
            local avg_latency=$(echo "$backend_results" | jq '[.[] | .synthesis_time_ms] | add / length' 2>/dev/null || echo "0")
            local avg_rtf=$(echo "$backend_results" | jq '[.[] | .rtf] | add / length' 2>/dev/null || echo "0")
            local avg_memory=$(echo "$backend_results" | jq '[.[] | .memory_used_mb] | add / length' 2>/dev/null || echo "0")
            
            echo "| Métrique | Valeur moyenne |" >> "$report_file"
            echo "|----------|----------------|" >> "$report_file"
            echo "| Latence | ${avg_latency} ms |" >> "$report_file"
            echo "| RTF | ${avg_rtf} |" >> "$report_file"
            echo "| Mémoire | ${avg_memory} MB |" >> "$report_file"
            echo "" >> "$report_file"
            
            # Détail par longueur de texte
            echo "#### Détail par longueur de texte" >> "$report_file"
            echo "" >> "$report_file"
            echo "| Label | Caractères | Latence (ms) | RTF | Mémoire (MB) |" >> "$report_file"
            echo "|-------|------------|--------------|-----|--------------|" >> "$report_file"
            
            for label in "${TEXT_LABELS[@]}"; do
                local label_result=$(echo "$backend_results" | jq --arg label "$label" '[.[] | select(.text_label == $label)][0]' 2>/dev/null)
                if [[ "$label_result" != "null" && -n "$label_result" ]]; then
                    local chars=$(echo "$label_result" | jq -r '.text_length // "N/A"')
                    local latency=$(echo "$label_result" | jq -r '.synthesis_time_ms // "N/A"')
                    local rtf=$(echo "$label_result" | jq -r '.rtf // "N/A"')
                    local memory=$(echo "$label_result" | jq -r '.memory_used_mb // "N/A"')
                    echo "| $label | $chars | $latency | $rtf | $memory |" >> "$report_file"
                fi
            done
            echo "" >> "$report_file"
        else
            echo "### Backend: $backend (non disponible)" >> "$report_file"
            echo "" >> "$report_file"
        fi
    done
    
    # Comparaison CPU vs NPU
    local cpu_avg=$(cat "$results_file" | jq '[.[] | select(.backend == "cpu" and .success == true) | .synthesis_time_ms] | if length > 0 then add / length else null end' 2>/dev/null)
    local npu_avg=$(cat "$results_file" | jq '[.[] | select(.backend == "npu" and .success == true) | .synthesis_time_ms] | if length > 0 then add / length else null end' 2>/dev/null)
    
    if [[ "$cpu_avg" != "null" && "$npu_avg" != "null" ]]; then
        local speedup=$(echo "$cpu_avg $npu_avg" | awk '{printf "%.1f", $1/$2}')
        
        cat >> "$report_file" << EOF
## Comparaison CPU vs NPU

| Métrique | CPU | NPU | Amélioration |
|----------|-----|-----|--------------|
| Latence moyenne | ${cpu_avg} ms | ${npu_avg} ms | ${speedup}x |

EOF
    fi
    
    # Erreurs rencontrées
    local errors=$(cat "$results_file" | jq '[.[] | select(.success == false)]' 2>/dev/null || echo "[]")
    local error_count=$(echo "$errors" | jq 'length' 2>/dev/null || echo "0")
    
    if [[ "$error_count" -gt 0 ]]; then
        echo "## Erreurs rencontrées ($error_count)" >> "$report_file"
        echo "" >> "$report_file"
        echo "$errors" | jq -r '.[] | "- **\(.backend)/\(.text_label)**: \(.error)"' >> "$report_file" 2>/dev/null || echo "Erreur dans l'analyse des erreurs" >> "$report_file"
        echo "" >> "$report_file"
    fi
    
    cat >> "$report_file" << EOF
## Fichiers générés

- **Résultats bruts**: \`$(basename "$results_file")\`
- **Audio de test**: \`$(basename "$OUTPUT_DIR")/\`
- **Logs**: \`$(basename "$LOG_FILE")\`

## Métriques de référence

- **RTF cible NPU**: < 0.20 (20% temps réel)
- **RTF baseline CPU**: ~ 0.65 (65% temps réel)
- **Speedup attendu**: 3-4x (NPU vs CPU)
- **Latence cible**: < 50ms (phrases courtes, NPU)

EOF
    
    success "Rapport généré: $report_file"
}

# Menu principal
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

OPTIONS:
    --full          Exécute le benchmark complet (tous backends, tous textes)
    --backend BACKEND   Teste un backend spécifique (cpu|npu)
    --text TEXT     Teste avec un texte spécifique
    --check         Vérifie la disponibilité des backends
    --report        Génère uniquement le rapport (si résultats existants)
    --clean         Nettoie les résultats précédents
    --help          Affiche cette aide

EXEMPLES:
    $0 --full                    # Benchmark complet
    $0 --backend npu            # Test NPU uniquement
    $0 --check                  # Vérification des backends
    $0 --report                 # Génération de rapport
    
ENVIRONNEMENT:
    TTS_BASE_URL         URL Piper CPU (défaut: http://localhost:8880)
    NPU_TTS_URL          URL service NPU (défaut: http://10.66.66.2:8881)
    BENCHMARK_ITERATIONS Nombre d'itérations par test (défaut: 1)

EOF
}

# Fonction de nettoyage
cleanup_results() {
    info "Nettoyage des résultats précédents..."
    rm -rf "$RESULTS_DIR"
    success "Résultats nettoyés"
}

# Vérification simple des backends
check_backends() {
    info "Vérification de la disponibilité des backends..."
    
    for backend in "${BACKENDS[@]}"; do
        if test_backend_availability "$backend"; then
            success "✓ $backend disponible"
        else
            warning "✗ $backend non disponible"
        fi
    done
}

# Script principal
main() {
    case "${1:-}" in
        --full)
            check_prerequisites
            setup_benchmark_env
            run_full_benchmark
            generate_report
            success "Benchmark complet terminé. Voir: $RESULTS_DIR/"
            ;;
        --backend)
            if [[ -z "${2:-}" ]]; then
                error "Backend requis: --backend cpu|npu"
                exit 1
            fi
            check_prerequisites
            setup_benchmark_env
            if test_backend_availability "$2"; then
                for i in "${!TEST_TEXTS[@]}"; do
                    run_single_benchmark "$2" "${TEST_TEXTS[$i]}" "${TEXT_LABELS[$i]}"
                done
            fi
            ;;
        --check)
            check_backends
            ;;
        --report)
            generate_report
            ;;
        --clean)
            cleanup_results
            ;;
        --help|"")
            show_usage
            ;;
        *)
            error "Option inconnue: $1"
            show_usage
            exit 1
            ;;
    esac
}

# Point d'entrée
main "$@"