/**
 * Intent Router v3 — calls local keyword classifier on port 8882
 * Routes simple queries locally, complex ones to Claude
 *
 * v3.1: Added joke handler, reminder support, DND mode
 */
import { startTimer, listTimers, cancelAllTimers, restoreTimers } from "../tools/timer-manager.js";
import { getRandomJoke, getRandomRiddle, getRandomFact } from "../tools/jokes.js";
import { enableDND, disableDND } from "../tools/dnd-manager.js";
import { handleShoppingCommand } from "../tools/shopping-list.js";
import { playRadio, stopRadio, setVolume, listStations } from "../tools/radio.js";
import { generateBriefing } from "../tools/morning-briefing.js";
import { findRoutine, executeRoutine, listRoutines } from "../tools/routines.js";
import { handleHomeCommand } from "../smarthome/ha-connector.js";
import { getCurrentPersona } from "../persona/engine.js";
import { getAllMemories, getCurrentUser } from "../tools/memory-tool.js";
const INTENT_URL = process.env.INTENT_URL ?? "http://localhost:8882";
// Restore timers on module load
restoreTimers().catch((err) => console.error("[Router] Timer restore failed:", err));
export async function classifyIntent(text) {
    try {
        const res = await fetch(`${INTENT_URL}/v1/classify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return (await res.json());
    }
    catch (err) {
        console.warn(`[Router] Intent classifier unavailable: ${err}`);
        return { intent: "complex", category: "fallback", confidence: 0, latency_ms: 0 };
    }
}
async function fetchWeather(text) {
    let city = "Bouclans";
    const cityMatch = text.match(/m[eé]t[eé]o\s+(?:de\s+|[aà]\s+)?([A-Z][a-z]+)/i) || text.match(/(?:[aà]|de)\s+([A-Z][a-zé]+)\s*\??$/i);
    if (cityMatch)
        city = cityMatch[1];
    try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t&lang=fr`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const weather = (await res.text()).trim();
        return `A ${city} il fait ${weather}.`;
    }
    catch {
        return "";
    }
}
function parseReminderMessage(text) {
    // Extract custom message from reminder text
    // "rappelle-moi dans 30 min de sortir le gâteau" → "sortir le gâteau"
    // "dans 10 minutes, vérifie le four" → "vérifie le four"
    const patterns = [
        /(?:rappelle[- ]?moi|rappel)\s+(?:dans\s+\d+\s*\w+\s+)?(?:de\s+|d'|que\s+)(.+)/i,
        /(?:dans\s+\d+\s*\w+)\s*[,.]?\s*(.+)/i,
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1] && m[1].trim().length > 3) {
            return m[1].trim();
        }
    }
    return "";
}
export async function handleLocalIntent(category, text) {
    switch (category) {
        case "time": {
            const now = new Date();
            const timeStr = now.toLocaleTimeString("fr-FR", {
                hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris"
            });
            const dateStr = now.toLocaleDateString("fr-FR", {
                weekday: "long", day: "numeric", month: "long", year: "numeric",
                timeZone: "Europe/Paris"
            });
            const wantTime = /heure/i.test(text);
            const wantDate = /jour|date/i.test(text);
            if (wantTime && wantDate)
                return { handled: true, response: `Il est ${timeStr}, et on est le ${dateStr}.` };
            if (wantTime)
                return { handled: true, response: `Il est ${timeStr}.` };
            if (wantDate)
                return { handled: true, response: `On est le ${dateStr}.` };
            return { handled: true, response: `Il est ${timeStr}, on est le ${dateStr}.` };
        }
        case "weather": {
            const weather = await fetchWeather(text);
            if (weather)
                return { handled: true, response: weather };
            return { handled: false };
        }
        case "greeting": {
            const hour = new Date().toLocaleString("fr-FR", {
                hour: "numeric", timeZone: "Europe/Paris"
            });
            const h = parseInt(hour);
            let timeGreet;
            if (h >= 5 && h < 12)
                timeGreet = "Bonjour";
            else if (h >= 12 && h < 18)
                timeGreet = "Salut";
            else if (h >= 18 && h < 22)
                timeGreet = "Bonsoir";
            else
                timeGreet = "Coucou";
            const replies = [
                `${timeGreet} ! Dis-moi ce que tu veux.`,
                `${timeGreet} ! Je t'ecoute.`,
                `${timeGreet} ! Quoi de neuf ?`,
            ];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "goodbye": {
            const hour = new Date().toLocaleString("fr-FR", {
                hour: "numeric", timeZone: "Europe/Paris"
            });
            const h = parseInt(hour);
            if (h >= 20 || h < 5) {
                return { handled: true, response: "Bonne nuit ! Dors bien." };
            }
            const replies = ["À plus tard !", "Ciao !", "À bientôt !"];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "identity": {
            const replies = [
                "Je suis Diva, ton compagnon IA !",
                "Moi c.est Diva, ton compagnon IA.",
                "Je m.appelle Diva. Je suis la pour toi !",
            ];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "baby": {
            return { handled: true, response: "Pour le suivi de Jean, ouvre BabySync sur ton telephone. Tu veux que je te rappelle quelque chose ?" };
        }
        case "conversational": {
            const t = text.toLowerCase();
            if (/comment.*(vas?|va|allez)/i.test(t) || /[çc]a va/i.test(t)) {
                const r = ["Ça va bien, merci !", "Nickel!", "Tout roule !"];
                return { handled: true, response: r[Math.floor(Math.random() * r.length)] };
            }
            if (/merci/i.test(t)) {
                const r = ["De rien !", "Pas de quoi !", "À ton service !"];
                return { handled: true, response: r[Math.floor(Math.random() * r.length)] };
            }
            if (/super|genial|cool|parfait/i.test(t)) {
                return { handled: true, response: "Content que ça te plaise !" };
            }
            if (/oui|ok|d.accord|exactement/i.test(t)) {
                return { handled: true, response: "OK!" };
            }
            if (/non|pas|rien/i.test(t)) {
                return { handled: true, response: "D'accord, pas de souci." };
            }
            if (/c.est (tout|bon)/i.test(t)) {
                return { handled: true, response: "OK, je reste la si besoin!" };
            }
            return { handled: false };
        }
        case "shutdown": {
            const replies = ["OK, je me tais.", "D'accord, silence.", "Compris."];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "calculator": {
            const m = text.match(/(\d+[\.,]?\d*)\s*(plus|\+|fois|x|\*|moins|-|divis[eé]e?\s*par|\/|pourcent|percent)\s*(\d+[\.,]?\d*)/i);
            if (m) {
                const a = parseFloat(m[1].replace(",", "."));
                const op = m[2].toLowerCase();
                const b = parseFloat(m[3].replace(",", "."));
                let r;
                let opStr;
                if (op === "plus" || op === "+") {
                    r = a + b;
                    opStr = "plus";
                }
                else if (op.startsWith("fois") || op === "x" || op === "*") {
                    r = a * b;
                    opStr = "fois";
                }
                else if (op === "moins" || op === "-") {
                    r = a - b;
                    opStr = "moins";
                }
                else if (op.startsWith("divis") || op === "/") {
                    r = b !== 0 ? Math.round((a / b) * 100) / 100 : 0;
                    opStr = "divise par";
                }
                else if (op.includes("pourcent") || op.includes("percent")) {
                    r = Math.round((a * b) / 100 * 100) / 100;
                    opStr = "pourcent de";
                }
                else {
                    r = a + b;
                    opStr = "?";
                }
                const rStr = Number.isInteger(r) ? r.toString() : r.toFixed(2);
                return { handled: true, response: `${a} ${opStr} ${b} egale ${rStr}.` };
            }
            return { handled: false };
        }
        case "joke": {
            const t = text.toLowerCase();
            if (/devinette|charade|enigme|[eé]nigme/i.test(t)) {
                const riddle = getRandomRiddle();
                if (riddle) {
                    return { handled: true, response: `${riddle.question} ... ${riddle.answer}` };
                }
            }
            if (/fait.*(jour|amusant|int[eé]ressant|marrant)|anecdote|savais/i.test(t)) {
                const fact = getRandomFact();
                if (fact) {
                    return { handled: true, response: `Le savais-tu ? ${fact.text}` };
                }
            }
            // Default: joke
            const joke = getRandomJoke();
            if (joke) {
                return { handled: true, response: joke.text };
            }
            return { handled: false };
        }
        case "dnd": {
            const t = text.toLowerCase();
            // Check if disabling
            if (/d[eé]sactive|arr[eê]te|remet|r[eé]active|mode\s+normal/i.test(t)) {
                disableDND();
                return { handled: true, response: "Mode normal réactivé. Je suis de retour !" };
            }
            // Enable DND
            // Try to extract duration: "mode nuit pendant 8 heures" or schedule
            const durMatch = t.match(/(\d+)\s*(heure|h|minute|min)/i);
            if (durMatch) {
                const val = parseInt(durMatch[1]);
                const unit = durMatch[2].toLowerCase();
                let ms;
                let unitStr;
                if (unit.startsWith("h")) {
                    ms = val * 60 * 60 * 1000;
                    unitStr = val > 1 ? "heures" : "heure";
                }
                else {
                    ms = val * 60 * 1000;
                    unitStr = val > 1 ? "minutes" : "minute";
                }
                enableDND(ms);
                return { handled: true, response: `Mode ne pas déranger activé pour ${val} ${unitStr}. Dis "Diva, mode normal" pour me réactiver.` };
            }
            // Default: 8 hours
            enableDND(8 * 60 * 60 * 1000);
            return { handled: true, response: "Mode nuit activé pour 8 heures. Bonne nuit !" };
        }
        case "timer": {
            const t = text.toLowerCase();
            // Cancel all timers
            if (/annul|supprime|arr[eê]te.*minuteur|stop.*timer/i.test(t)) {
                const count = cancelAllTimers();
                if (count === 0)
                    return { handled: true, response: "Il n'y a aucun minuteur en cours." };
                return { handled: true, response: `${count} minuteur${count > 1 ? "s" : ""} annulé${count > 1 ? "s" : ""}.` };
            }
            // List timers
            if (/combien|liste|quels?.*minuteur|en cours/i.test(t)) {
                const timers = listTimers();
                if (timers.length === 0)
                    return { handled: true, response: "Aucun minuteur en cours." };
                const desc = timers.map((tm) => {
                    const min = Math.floor(tm.remainingS / 60);
                    const sec = tm.remainingS % 60;
                    const timeStr = min > 0 ? `${min} minute${min > 1 ? "s" : ""} et ${sec} seconde${sec > 1 ? "s" : ""}` : `${sec} seconde${sec > 1 ? "s" : ""}`;
                    return `${tm.label || "Minuteur"}: ${timeStr} restantes`;
                }).join(". ");
                return { handled: true, response: `${timers.length} minuteur${timers.length > 1 ? "s" : ""} en cours. ${desc}.` };
            }
            // Start a new timer (with optional reminder message)
            const dm = text.match(/(\d+)\s*(minute|min|seconde|sec|heure|h)\b/i);
            if (dm) {
                const val = parseInt(dm[1]);
                const unit = dm[2].toLowerCase();
                let unitStr;
                let durationMs;
                if (unit.startsWith("min")) {
                    unitStr = val > 1 ? "minutes" : "minute";
                    durationMs = val * 60 * 1000;
                }
                else if (unit.startsWith("sec")) {
                    unitStr = val > 1 ? "secondes" : "seconde";
                    durationMs = val * 1000;
                }
                else {
                    unitStr = val > 1 ? "heures" : "heure";
                    durationMs = val * 60 * 60 * 1000;
                }
                const label = `${val} ${unitStr}`;
                const message = parseReminderMessage(text);
                startTimer(durationMs, label, message);
                if (message) {
                    return { handled: true, response: `C'est noté ! Je te rappellerai dans ${label} : ${message}.` };
                }
                return { handled: true, response: `Minuteur de ${label}, c'est parti !` };
            }
            return { handled: false };
        }
        case "shopping": {
            const result = handleShoppingCommand(text, "default");
            if (result.handled)
                return result;
            return { handled: false };
        }
        case "radio": {
            const t = text.toLowerCase();
            if (/arr[eê]te|coupe|stop/i.test(t)) {
                return { handled: true, response: stopRadio() };
            }
            if (/quelles?s+radio|disponible/i.test(t)) {
                return { handled: true, response: listStations() };
            }
            if (/volume|pluss+fort|moinss+fort|baisse|monte|muet|mute/i.test(t)) {
                return { handled: true, response: setVolume(text) };
            }
            return { handled: true, response: playRadio(text) };
        }
        case "about_me": {
            const persona = getCurrentPersona();
            const userId = getCurrentUser();
            const memories = await getAllMemories();
            const parts = [];
            if (persona.greetingName && persona.id !== "guest") {
                parts.push("Tu t'appelles " + persona.greetingName + ".");
            }
            if (memories.length > 0) {
                const memTexts = memories.slice(0, 3).map(m => m.memory);
                parts.push("Je sais aussi que : " + memTexts.join(". ") + ".");
            }
            else if (parts.length > 0) {
                parts.push("Pour le reste, on n'a pas encore beaucoup discuté, mais ça viendra !");
            }
            else {
                return { handled: true, response: "Je ne te connais pas encore. Dis-moi des choses sur toi et je m'en souviendrai !" };
            }
            return { handled: true, response: parts.join(" ") };
        }
        case "home_control": {
            const result = await handleHomeCommand(text);
            return result;
        }
        case "routine": {
            const routine = findRoutine(text);
            if (routine) {
                const results = await executeRoutine(routine);
                const speechParts = results.filter(r => r.length > 0);
                return { handled: true, response: speechParts[0] || "Routine lancee." };
            }
            return { handled: true, response: listRoutines() };
        }
        case "briefing": {
            const briefing = await generateBriefing();
            return { handled: true, response: briefing };
        }
        default:
            return { handled: false };
    }
}
//# sourceMappingURL=intent-router.js.map