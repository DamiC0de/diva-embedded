/**
 * Repetition Tracker — detects repeated questions for cognitive monitoring
 * Uses simple similarity comparison with recent questions
 * Tracks count in dashboard for caregiver
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const TRACKER_PATH = "/opt/diva-embedded/data/repetition-log.json";
const recentQuestions = [];
const MAX_RECENT = 50;
function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[^a-zàâéèêëïîôùûüÿç\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function wordOverlap(a, b) {
    const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
    const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0)
        return 0;
    let common = 0;
    for (const w of wordsA) {
        if (wordsB.has(w))
            common++;
    }
    return common / Math.max(wordsA.size, wordsB.size);
}
/**
 * Check if a question has been asked recently.
 * Returns { isRepetition, count } where count = how many times this session
 */
export function checkRepetition(text) {
    const normalized = normalizeText(text);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    // Check against recent questions
    let matchCount = 0;
    for (const recent of recentQuestions) {
        if (recent.timestamp < oneHourAgo)
            continue;
        const similarity = wordOverlap(normalized, normalizeText(recent.text));
        if (similarity > 0.7) {
            matchCount++;
        }
    }
    // Add to recent
    recentQuestions.push({ text, timestamp: now });
    if (recentQuestions.length > MAX_RECENT) {
        recentQuestions.shift();
    }
    if (matchCount > 0) {
        logRepetition(text);
        return { isRepetition: true, count: matchCount + 1 };
    }
    return { isRepetition: false, count: 1 };
}
function logRepetition(text) {
    try {
        const log = existsSync(TRACKER_PATH)
            ? JSON.parse(readFileSync(TRACKER_PATH, "utf-8"))
            : [];
        const today = new Date().toISOString().slice(0, 10);
        const normalized = normalizeText(text);
        // Find existing entry for today
        const existing = log.find((e) => e.date === today && wordOverlap(normalizeText(e.question), normalized) > 0.7);
        if (existing) {
            existing.count++;
            existing.timestamps.push(new Date().toISOString());
        }
        else {
            log.push({
                date: today,
                question: text,
                count: 1,
                timestamps: [new Date().toISOString()],
            });
        }
        // Keep last 30 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const filtered = log.filter((e) => new Date(e.date) >= cutoff);
        writeFileSync(TRACKER_PATH, JSON.stringify(filtered, null, 2));
    }
    catch (err) {
        console.error("[REPETITION] Log error:", err);
    }
}
export function getRepetitionStats(days = 7) {
    try {
        if (!existsSync(TRACKER_PATH))
            return { totalRepetitions: 0, uniqueQuestions: 0, entries: [] };
        const log = JSON.parse(readFileSync(TRACKER_PATH, "utf-8"));
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const recent = log.filter((e) => new Date(e.date) >= cutoff);
        return {
            totalRepetitions: recent.reduce((sum, e) => sum + e.count, 0),
            uniqueQuestions: recent.length,
            entries: recent,
        };
    }
    catch {
        return { totalRepetitions: 0, uniqueQuestions: 0, entries: [] };
    }
}
//# sourceMappingURL=repetition-tracker.js.map