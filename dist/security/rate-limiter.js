/**
 * Rate limiter simple pour les API calls
 */
export class RateLimiter {
    limits = new Map(); // service -> { calls: [], maxPerMin: number }

    constructor() {
        // Configuration par défaut
        this.limits.set("brave_search", { calls: [], maxPerMin: 60 });
        this.limits.set("groq_stt", { calls: [], maxPerMin: 100 });
        this.limits.set("claude_api", { calls: [], maxPerMin: 50 });
    }

    /**
     * Vérifier si on peut faire un appel pour ce service
     */
    canMakeCall(service) {
        const limit = this.limits.get(service);
        if (!limit) return true; // Pas de limite configurée
        
        const now = Date.now();
        const oneMinuteAgo = now - 60 * 1000;
        
        // Nettoyer les anciens appels
        limit.calls = limit.calls.filter(timestamp => timestamp > oneMinuteAgo);
        
        return limit.calls.length < limit.maxPerMin;
    }

    /**
     * Enregistrer un appel
     */
    recordCall(service) {
        const limit = this.limits.get(service);
        if (limit) {
            limit.calls.push(Date.now());
        }
    }

    /**
     * Attendre avant le prochain appel autorisé
     */
    async waitIfNeeded(service) {
        const limit = this.limits.get(service);
        if (!limit) return;
        
        while (!this.canMakeCall(service)) {
            console.log(`[RateLimit] Waiting for ${service} rate limit...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        this.recordCall(service);
    }

    /**
     * Obtenir les statistiques actuelles
     */
    getStats() {
        const stats = {};
        const now = Date.now();
        const oneMinuteAgo = now - 60 * 1000;
        
        for (const [service, limit] of this.limits) {
            const recentCalls = limit.calls.filter(timestamp => timestamp > oneMinuteAgo);
            stats[service] = {
                callsLastMinute: recentCalls.length,
                maxPerMinute: limit.maxPerMin,
                remaining: limit.maxPerMin - recentCalls.length
            };
        }
        
        return stats;
    }
}

export const rateLimiter = new RateLimiter();
