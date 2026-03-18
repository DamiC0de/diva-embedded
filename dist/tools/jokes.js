/**
 * Jokes / Riddles / Fun Facts — local database with rotation
 * Zero latency, no Claude needed
 */
import { readFileSync, existsSync } from "node:fs";
const JOKES_PATH = "/opt/diva-embedded/data/jokes.json";
let db = { jokes: [], riddles: [], facts: [] };
const usedJokes = new Set();
const usedRiddles = new Set();
const usedFacts = new Set();
function loadDB() {
    try {
        if (!existsSync(JOKES_PATH)) {
            console.warn("[JOKES] Database not found at", JOKES_PATH);
            return;
        }
        const raw = readFileSync(JOKES_PATH, "utf-8");
        db = JSON.parse(raw);
        console.log(`[JOKES] Loaded: ${db.jokes.length} jokes, ${db.riddles.length} riddles, ${db.facts.length} facts`);
    }
    catch (err) {
        console.error("[JOKES] Load error:", err);
    }
}
function pickRandom(items, used) {
    if (items.length === 0)
        return null;
    // Reset if all used
    const available = items.filter((i) => !used.has(i.id));
    if (available.length === 0) {
        used.clear();
        return items[Math.floor(Math.random() * items.length)];
    }
    const pick = available[Math.floor(Math.random() * available.length)];
    used.add(pick.id);
    return pick;
}
export function getRandomJoke(category) {
    const filtered = category ? db.jokes.filter((j) => j.category === category || j.category === "all") : db.jokes;
    return pickRandom(filtered, usedJokes);
}
export function getRandomRiddle(category) {
    const filtered = category ? db.riddles.filter((r) => r.category === category || r.category === "all") : db.riddles;
    return pickRandom(filtered, usedRiddles);
}
export function getRandomFact(category) {
    const filtered = category ? db.facts.filter((f) => f.category === category || f.category === "all") : db.facts;
    return pickRandom(filtered, usedFacts);
}
// Load on import
loadDB();
//# sourceMappingURL=jokes.js.map