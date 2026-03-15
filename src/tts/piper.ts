import { writeFile } from "node:fs/promises";
import type { TtsBackend, TtsConfig, TtsMetrics } from "./tts-interface.js";

const TTS_BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:8880";

/**
 * Backend Piper CPU - Version originale utilisant le serveur HTTP Piper.
 * Implémente l'interface TtsBackend pour compatibilité avec le système NPU/CPU.
 */
export class PiperCpuBackend implements TtsBackend {
  private config?: TtsConfig;
  private isInitialized = false;
  private metrics: TtsMetrics = {
    rtf: 0,
    latencyMs: 0,
    memoryUsageMb: 0,
    synthesisCount: 0,
    backend: 'cpu'
  };

  async initialize(config: TtsConfig): Promise<void> {
    this.config = config;
    
    // Test de connectivité au serveur Piper
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(`Piper CPU service not available at ${this.getBaseUrl()}`);
    }
    
    this.isInitialized = true;
    console.log(`✅ CPU backend initialized with voice: ${config.voice}`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.isInitialized || !this.config) {
      throw new Error("CPU backend not initialized");
    }

    const startTime = performance.now();

    const response = await fetch(`${this.getBaseUrl()}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: this.config.voice,
        response_format: this.config.format || "wav",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Piper TTS error: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const result = Buffer.from(arrayBuffer);

    // Mise à jour des métriques
    const endTime = performance.now();
    this.metrics.latencyMs = endTime - startTime;
    this.metrics.synthesisCount++;
    
    // Estimation RTF
    const estimatedAudioDurationMs = text.length * 50; // ~50ms par caractère
    this.metrics.rtf = this.metrics.latencyMs / estimatedAudioDurationMs;

    return result;
  }

  async synthesizeToFile(text: string, outputPath: string): Promise<void> {
    const wav = await this.synthesize(text);
    await writeFile(outputPath, wav);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      console.debug("CPU TTS availability check failed:", error);
      return false;
    }
  }

  async getMetrics(): Promise<TtsMetrics> {
    return { ...this.metrics };
  }

  async dispose(): Promise<void> {
    this.isInitialized = false;
    // Aucun cleanup nécessaire pour le backend HTTP
  }

  private getBaseUrl(): string {
    return this.config?.baseUrl || TTS_BASE_URL;
  }
}

// LEGACY API - Maintenue pour compatibilité ascendante
/**
 * Synthesize text to WAV via Piper TTS HTTP server.
 * Returns the raw WAV buffer.
 * 
 * @deprecated Utilisez PiperCpuBackend ou TtsEngine à la place
 */
export async function synthesize(text: string): Promise<Buffer> {
  console.warn("synthesize() is deprecated, use PiperCpuBackend or TtsEngine instead");
  
  const backend = new PiperCpuBackend();
  await backend.initialize({
    baseUrl: TTS_BASE_URL,
    voice: "fr_FR-siwis-medium",
    format: "wav"
  });
  
  const result = await backend.synthesize(text);
  await backend.dispose();
  
  return result;
}

/**
 * Synthesize text and save as WAV file.
 * @param text - Text to speak
 * @param outputPath - Path to save WAV file
 * 
 * @deprecated Utilisez PiperCpuBackend ou TtsEngine à la place
 */
export async function synthesizeToFile(
  text: string,
  outputPath: string
): Promise<void> {
  console.warn("synthesizeToFile() is deprecated, use PiperCpuBackend or TtsEngine instead");
  
  const wav = await synthesize(text);
  await writeFile(outputPath, wav);
}
