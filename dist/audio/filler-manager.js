import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, '../../assets/cached-responses');
const fillerCache = new Map();

export function loadFillers() {
    if (!fs.existsSync(CACHE_DIR)) {
        console.warn('[FILLERS] Cache dir not found:', CACHE_DIR);
        return;
    }
    
    const categories = fs.readdirSync(CACHE_DIR)
        .filter(d => d.endsWith('-fillers'))
        .filter(d => fs.statSync(path.join(CACHE_DIR, d)).isDirectory());

    for (const cat of categories) {
        const dir = path.join(CACHE_DIR, cat);
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.wav'))
            .map(f => path.join(dir, f));
        fillerCache.set(cat, files);
    }

    console.log(`[FILLERS] Loaded ${fillerCache.size} categories`);
}

export function getRandomFiller(category) {
    const files = fillerCache.get(category);
    if (!files || files.length === 0) return null;
    return files[Math.floor(Math.random() * files.length)];
}

function isNightMode() {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 6;
}

export function chooseFiller(intent, text) {
    if (isNightMode()) {
        return { primary: getRandomFiller('micro-fillers'), secondary: null };
    }

    const lower = text.toLowerCase();

    if (/\b(recette|cuisiner|préparer|ingrédients|gâteau|plat|soupe|poulet|pâtes|tarte|gratin)\b/i.test(lower)) {
        return { primary: getRandomFiller('recipe-fillers'), secondary: getRandomFiller('wait-fillers') };
    }
    if (/\b(tradui|comment on dit|en anglais|en espagnol|traduction|translate)\b/i.test(lower)) {
        return { primary: getRandomFiller('translation-fillers'), secondary: null };
    }
    if (/\b(bébé|jean|biberon|couche|dort|sieste|pleure|poids|taille)\b/i.test(lower)) {
        return { primary: getRandomFiller('baby-fillers'), secondary: getRandomFiller('wait-fillers') };
    }
    if (/\b(calcul|combien fait|pourcentage|racine|puissance)\b/i.test(lower)) {
        return { primary: getRandomFiller('calc-fillers'), secondary: null };
    }
    if (/\b(musique|chanson|podcast|film|série|playlist)\b/i.test(lower) || /\b(joue|mets)\s*(moi|une?|la|du|de la)\b/i.test(lower)) {
        return { primary: getRandomFiller('media-fillers'), secondary: null };
    }
    if (/\b(allume|éteins|lumière|chauffage|volet|salon|cuisine|chambre)\b/i.test(lower)) {
        return { primary: getRandomFiller('home-fillers'), secondary: null };
    }

    switch (intent) {
        case 'search':
            return { primary: getRandomFiller('search-fillers'), secondary: getRandomFiller('wait-fillers') };
        case 'news':
            return { primary: getRandomFiller('news-fillers'), secondary: getRandomFiller('wait-fillers') };
        case 'weather':
            return { primary: getRandomFiller('weather-fillers'), secondary: getRandomFiller('wait-fillers') };
        case 'complex':
        case 'conversational':
            if (/\b(qui est|c'est quoi|qu'est-ce)\b/i.test(lower)) {
                return { primary: getRandomFiller('knowledge-fillers'), secondary: getRandomFiller('wait-fillers') };
            }
            if (/\b(comment|conseil|aide|idée|recommand|suggèr)\b/i.test(lower)) {
                return { primary: getRandomFiller('advice-fillers'), secondary: getRandomFiller('wait-fillers') };
            }
            return { primary: getRandomFiller('thinking-fillers'), secondary: getRandomFiller('wait-fillers') };
        default:
            return { primary: getRandomFiller('micro-fillers'), secondary: null };
    }
}
