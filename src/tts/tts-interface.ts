/**
 * Interface commune pour les backends TTS (CPU/NPU).
 * Permet de switcher entre les implémentations selon l'environnement.
 */

export interface TtsConfig {
  /** URL du serveur TTS (pour backend HTTP) */
  baseUrl?: string;
  /** Modèle/voix à utiliser */
  voice: string;
  /** Format de sortie audio */
  format: 'wav' | 'mp3' | 'ogg';
  /** Paramètres optionnels spécifiques au backend */
  backendOptions?: Record<string, any>;
}

export interface TtsBackend {
  /**
   * Initialise le backend TTS.
   * @param config Configuration du TTS
   */
  initialize(config: TtsConfig): Promise<void>;

  /**
   * Synthétise du texte en audio.
   * @param text Texte à synthétiser
   * @returns Buffer audio brut
   */
  synthesize(text: string): Promise<Buffer>;

  /**
   * Synthétise du texte et sauvegarde dans un fichier.
   * @param text Texte à synthétiser
   * @param outputPath Chemin de sortie
   */
  synthesizeToFile(text: string, outputPath: string): Promise<void>;

  /**
   * Vérifie si le backend est disponible et fonctionnel.
   * @returns true si le backend peut être utilisé
   */
  isAvailable(): Promise<boolean>;

  /**
   * Retourne des métriques de performance (optionnel).
   * @returns Objet avec des métriques ou undefined
   */
  getMetrics?(): Promise<TtsMetrics | undefined>;

  /**
   * Nettoie les ressources du backend.
   */
  dispose(): Promise<void>;
}

export interface TtsMetrics {
  /** Real-Time Factor (temps_génération / durée_audio) */
  rtf: number;
  /** Latence moyenne en ms */
  latencyMs: number;
  /** Utilisation mémoire en MB */
  memoryUsageMb: number;
  /** Nombre de synthèses effectuées */
  synthesisCount: number;
  /** Backend utilisé */
  backend: 'cpu' | 'npu' | 'hybrid';
}

export type TtsBackendType = 'cpu' | 'npu' | 'auto';

/**
 * Factory pour créer le backend TTS approprié selon la configuration.
 */
export class TtsFactory {
  /**
   * Crée une instance du backend TTS selon le type demandé.
   * @param type Type de backend demandé
   * @param config Configuration TTS
   * @returns Instance du backend TTS
   */
  static async createBackend(
    type: TtsBackendType,
    config: TtsConfig
  ): Promise<TtsBackend> {
    // Import dynamique pour éviter les dépendances circulaires
    const { PiperCpuBackend } = await import('./piper.js');
    const { PiperNpuBackend } = await import('./piper-npu.js');

    switch (type) {
      case 'cpu':
        return new PiperCpuBackend();

      case 'npu':
        const npuBackend = new PiperNpuBackend();
        if (!(await npuBackend.isAvailable())) {
          throw new Error('NPU backend not available, fallback to CPU required');
        }
        return npuBackend;

      case 'auto':
        // Tentative NPU en premier, fallback CPU
        const autoNpuBackend = new PiperNpuBackend();
        if (await autoNpuBackend.isAvailable()) {
          return autoNpuBackend;
        }
        console.warn('NPU not available, falling back to CPU backend');
        return new PiperCpuBackend();

      default:
        throw new Error(`Unknown TTS backend type: ${type}`);
    }
  }

  /**
   * Détecte automatiquement le meilleur backend disponible.
   * @returns Type de backend recommandé
   */
  static async detectBestBackend(): Promise<TtsBackendType> {
    try {
      const { PiperNpuBackend } = await import('./piper-npu.js');
      const npuBackend = new PiperNpuBackend();
      
      if (await npuBackend.isAvailable()) {
        await npuBackend.dispose(); // Nettoyage
        return 'npu';
      }
    } catch (error) {
      console.debug('NPU detection failed:', error);
    }
    
    return 'cpu';
  }
}

/**
 * Classe principale pour l'utilisation du TTS avec sélection automatique du backend.
 */
export class TtsEngine {
  private backend?: TtsBackend;
  private config: TtsConfig;
  private metrics: TtsMetrics = {
    rtf: 0,
    latencyMs: 0,
    memoryUsageMb: 0,
    synthesisCount: 0,
    backend: 'cpu'
  };

  constructor(config: TtsConfig) {
    this.config = config;
  }

  /**
   * Initialise le moteur TTS avec le backend approprié.
   * @param backendType Type de backend forcé (optionnel)
   */
  async initialize(backendType?: TtsBackendType): Promise<void> {
    const type = backendType ?? (process.env.TTS_BACKEND as TtsBackendType) ?? 'auto';
    
    this.backend = await TtsFactory.createBackend(type, this.config);
    await this.backend.initialize(this.config);
    
    // Mise à jour des métriques backend
    const backendMetrics = await this.backend.getMetrics?.();
    if (backendMetrics) {
      this.metrics.backend = backendMetrics.backend;
    }
  }

  /**
   * Synthétise du texte en mesurant les performances.
   */
  async synthesize(text: string): Promise<Buffer> {
    if (!this.backend) {
      throw new Error('TTS engine not initialized');
    }

    const startTime = performance.now();
    const result = await this.backend.synthesize(text);
    const endTime = performance.now();

    // Mise à jour des métriques
    this.metrics.latencyMs = endTime - startTime;
    this.metrics.synthesisCount++;

    // Estimation RTF (approximatif, nécessiterait la durée audio réelle)
    const estimatedDurationMs = text.length * 50; // ~50ms par caractère (estimation)
    this.metrics.rtf = this.metrics.latencyMs / estimatedDurationMs;

    return result;
  }

  async synthesizeToFile(text: string, outputPath: string): Promise<void> {
    if (!this.backend) {
      throw new Error('TTS engine not initialized');
    }
    
    return this.backend.synthesizeToFile(text, outputPath);
  }

  /**
   * Retourne les métriques de performance actuelles.
   */
  getMetrics(): TtsMetrics {
    return { ...this.metrics };
  }

  /**
   * Nettoie les ressources.
   */
  async dispose(): Promise<void> {
    if (this.backend) {
      await this.backend.dispose();
      this.backend = undefined;
    }
  }
}