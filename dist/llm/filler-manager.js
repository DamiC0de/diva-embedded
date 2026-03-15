import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Filler Manager - Contextual audio fillers adapted from iOS version
 */
export class FillerManager {
    constructor(baseDir = "/opt/diva-embedded/assets/fillers") {
        this.baseDir = baseDir;
        this.fillerCategories = new Map();
        this.lastFillerIndex = new Map(); // userId -> last filler key (avoid repeats)
        this.loadFillerAudios();
    }

    /**
     * Load pre-generated contextual filler phrases into memory
     */
    loadFillerAudios() {
        try {
            const categories = ['emotional', 'factual', 'action', 'casual'];
            let total = 0;
            
            for (const cat of categories) {
                const catDir = join(this.baseDir, cat);
                try {
                    if (!existsSync(catDir)) continue;
                    const files = readdirSync(catDir).filter(f => f.endsWith('.mp3')).sort();
                    const audios = [];
                    for (const file of files) {
                        const buffer = readFileSync(join(catDir, file));
                        if (buffer.length > 0) {
                            audios.push(buffer.toString('base64'));
                        }
                    }
                    if (audios.length > 0) {
                        this.fillerCategories.set(cat, audios);
                        total += audios.length;
                    }
                } catch { /* category dir missing — skip */ }
            }
            
            // Fallback: load flat fillers as 'casual' if no categories found
            if (total === 0) {
                const files = readdirSync(this.baseDir).filter(f => f.endsWith('.mp3')).sort();
                const audios = [];
                for (const file of files) {
                    const buffer = readFileSync(join(this.baseDir, file));
                    if (buffer.length > 0) audios.push(buffer.toString('base64'));
                }
                if (audios.length > 0) this.fillerCategories.set('casual', audios);
                total = audios.length;
            }
            
            console.log(`[Filler] Loaded ${total} filler audios, categories: ${[...this.fillerCategories.keys()].join(', ')}`);
        } catch (e) {
            console.warn(`[Filler] Could not load filler audios: ${String(e)}`);
        }
    }

    /**
     * Classify user message tone (instant — regex only, no LLM)
     * Adapted from iOS orchestrator.ts
     */
    classifyTone(text) {
        const lower = text.toLowerCase();
        
        // Emotional: distress, sadness, crisis, personal struggles
        if (/\b(suicid|mourir|mort|déprim|dépression|pleurer|pleure|triste|seul|solitude|anxié|panique|peur|mal\s+(de\s+vivre|à\s+vivre)|désespoir|ça\s+va\s+pas|j'en\s+peux\s+plus|aide[rz]?\s*moi|besoin\s+d'aide|difficile|douleur|souffr|inqui[eè]t|perdu|crise|stress[ée]?)\b/i.test(lower)) {
            return 'emotional';
        }
        
        // Factual: questions, search, info requests
        if (/\b(c'est quoi|qu'est[- ]ce que|comment|pourquoi|combien|quand|qui est|explique|raconte|résume|cherche|trouve|article|info|nouvelle|actu|news|glucose|wikipedia)\b/i.test(lower) ||
            lower.includes('?')) {
            return 'factual';
        }
        
        // Action: commands, tasks
        if (/\b(mets|mettez|lance|ouvre|envoie|rappelle|crée|fais|active|désactive|change|configure|ajoute|supprime|éteins|allume)\b/i.test(lower)) {
            return 'action';
        }
        
        return 'casual';
    }

    /**
     * Pick a contextual filler audio based on message tone
     */
    pickFiller(userId, text) {
        const tone = this.classifyTone(text);
        const audios = this.fillerCategories.get(tone) || this.fillerCategories.get('casual');
        if (!audios || audios.length === 0) return null;
        
        const lastKey = this.lastFillerIndex.get(userId) ?? '';
        let idx;
        let key;
        do {
            idx = Math.floor(Math.random() * audios.length);
            key = `${tone}-${idx}`;
        } while (key === lastKey && audios.length > 1);
        
        this.lastFillerIndex.set(userId, key);
        console.log(`[Filler] Selected: tone=${tone}, idx=${idx}`);
        return audios[idx];
    }
}

// Export singleton
export const fillerManager = new FillerManager();