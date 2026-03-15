import { writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { TtsBackend, TtsConfig, TtsMetrics } from "./tts-interface.js";

const execAsync = promisify(exec);

/**
 * Backend Piper NPU utilisant RKNN-Lite2 sur RK3588.
 * Communique avec un service NPU dédié tournant sur le Rock 5B+.
 */
export class PiperNpuBackend implements TtsBackend {
  private config?: TtsConfig;
  private npuServiceUrl: string;
  private isInitialized = false;
  private metrics: TtsMetrics = {
    rtf: 0,
    latencyMs: 0,
    memoryUsageMb: 0,
    synthesisCount: 0,
    backend: 'npu'
  };

  constructor() {
    // URL du service NPU sur le Rock 5B+ via WireGuard
    this.npuServiceUrl = process.env.NPU_TTS_URL || "http://10.66.66.2:8881";
  }

  async initialize(config: TtsConfig): Promise<void> {
    this.config = config;
    
    // Vérification de la disponibilité du service NPU
    const available = await this.isAvailable();
    if (!available) {
      throw new Error("NPU service not available at " + this.npuServiceUrl);
    }
    
    // Configuration initiale du modèle NPU
    await this.configureNpuModel();
    
    this.isInitialized = true;
    console.log(`✅ NPU backend initialized with model: ${config.voice}`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.isInitialized || !this.config) {
      throw new Error("NPU backend not initialized");
    }

    const startTime = performance.now();

    try {
      // Appel au service NPU sur le Rock
      const response = await fetch(`${this.npuServiceUrl}/v1/npu/speech`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Backend": "rknn-npu"
        },
        body: JSON.stringify({
          input: text,
          voice: this.config.voice,
          response_format: this.config.format || "wav",
          backend: "npu"
        }),
        // Timeout pour éviter les blocages
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        // En cas d'erreur NPU, possibilité de fallback
        if (response.status === 503) {
          throw new Error("NPU service temporarily unavailable");
        }
        throw new Error(
          `NPU TTS error: ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const result = Buffer.from(arrayBuffer);

      // Mise à jour des métriques
      const endTime = performance.now();
      this.metrics.latencyMs = endTime - startTime;
      this.metrics.synthesisCount++;
      
      // RTF calculation (estimation basée sur la longueur du texte)
      const estimatedAudioDurationMs = text.length * 50; // ~50ms par caractère
      this.metrics.rtf = this.metrics.latencyMs / estimatedAudioDurationMs;

      return result;

    } catch (error) {
      console.error("NPU synthesis error:", error);
      
      // Possibilité d'implémenter un fallback automatique vers CPU
      if (process.env.NPU_FALLBACK_CPU === "true") {
        console.warn("Falling back to CPU backend...");
        const { PiperCpuBackend } = await import('./piper.js');
        const cpuBackend = new PiperCpuBackend();
        await cpuBackend.initialize(this.config);
        const result = await cpuBackend.synthesize(text);
        await cpuBackend.dispose();
        return result;
      }
      
      throw error;
    }
  }

  async synthesizeToFile(text: string, outputPath: string): Promise<void> {
    const wav = await this.synthesize(text);
    await writeFile(outputPath, wav);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test 1: Vérifier la connectivité réseau vers le Rock
      const healthResponse = await fetch(`${this.npuServiceUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!healthResponse.ok) {
        return false;
      }

      const health = await healthResponse.json();
      
      // Test 2: Vérifier que le NPU est opérationnel
      return health.npu_available === true && health.model_loaded === true;

    } catch (error) {
      console.debug("NPU availability check failed:", error);
      return false;
    }
  }

  async getMetrics(): Promise<TtsMetrics> {
    return { ...this.metrics };
  }

  async dispose(): Promise<void> {
    this.isInitialized = false;
    // Cleanup éventuel des ressources NPU
  }

  /**
   * Configure le modèle NPU sur le Rock 5B+.
   * Envoie le modèle RKNN si nécessaire.
   */
  private async configureNpuModel(): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(`${this.npuServiceUrl}/v1/npu/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.voice,
          backend: "rknn",
          quantization: "int8" // Par défaut, quantification INT8
        })
      });

      if (!response.ok) {
        throw new Error(`NPU model configuration failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("NPU model configured:", result);

    } catch (error) {
      console.warn("NPU model configuration warning:", error);
      // Non-bloquant, le modèle peut déjà être configuré
    }
  }

  /**
   * Vérifie et retourne les informations du NPU.
   */
  async getNpuInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.npuServiceUrl}/v1/npu/info`);
      return await response.json();
    } catch (error) {
      console.error("Failed to get NPU info:", error);
      return null;
    }
  }

  /**
   * Force le rechargement du modèle NPU.
   * Utile après une mise à jour du modèle RKNN.
   */
  async reloadModel(): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(`${this.npuServiceUrl}/v1/npu/reload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.voice
        })
      });

      if (!response.ok) {
        throw new Error(`NPU model reload failed: ${response.statusText}`);
      }

      console.log("NPU model reloaded successfully");
    } catch (error) {
      throw new Error(`Failed to reload NPU model: ${error}`);
    }
  }
}

/**
 * Utilitaire pour gérer la communication avec le service NPU.
 * Peut être étendu pour inclure la gestion automatique du transfert de modèles.
 */
export class NpuServiceManager {
  private serviceUrl: string;

  constructor(serviceUrl?: string) {
    this.serviceUrl = serviceUrl || process.env.NPU_TTS_URL || "http://10.66.66.2:8881";
  }

  /**
   * Upload un modèle RKNN vers le Rock 5B+.
   * @param modelPath Chemin local vers le modèle .rknn
   * @param modelName Nom du modèle pour référence
   */
  async uploadModel(modelPath: string, modelName: string): Promise<boolean> {
    if (!existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    // Note: Implémentation simplifiée
    // Dans un vrai cas, utiliser FormData pour upload de fichier
    console.warn("Model upload not implemented in this demo");
    console.log(`Would upload ${modelPath} as ${modelName} to ${this.serviceUrl}`);
    
    return true; // Placeholder
  }

  /**
   * Liste les modèles disponibles sur le NPU.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.serviceUrl}/v1/npu/models`);
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error("Failed to list NPU models:", error);
      return [];
    }
  }
}