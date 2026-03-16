/**
 * Intent Router v2 — calls local keyword classifier on port 8882
 * Routes simple queries locally, complex ones to Claude
 */
const INTENT_URL = process.env.INTENT_URL ?? "http://localhost:8882";
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
    // Extract city from text or default to Bouclans
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
            return { handled: false }; // fallback to Claude
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
            const replies = ["A plus tard !", "Ciao !", "A bientot !"];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "identity": {
            const replies = [
                "Je suis Diva, ton assistante vocale. Je tourne sur le Rock 5B+ ici meme !",
                "Moi c'est Diva ! Je suis la pour t'aider au quotidien.",
                "Je m'appelle Diva, assistante vocale de la famille.",
            ];
            return { handled: true, response: replies[Math.floor(Math.random() * replies.length)] };
        }
        case "baby": {
            return { handled: true, response: "Pour le suivi de Jean, ouvre BabySync sur ton telephone. Tu veux que je te rappelle quelque chose ?" };
        }
        case "conversational": {
            const t = text.toLowerCase();
            if (/comment.*(vas?|va|allez)/i.test(t) || /[çc]a va/i.test(t)) {
                const r = ["Ca va bien merci!", "Nickel!", "Tout roule!"];
                return { handled: true, response: r[Math.floor(Math.random() * r.length)] };
            }
            if (/merci/i.test(t)) {
                const r = ["De rien!", "Pas de quoi!", "A ton service!"];
                return { handled: true, response: r[Math.floor(Math.random() * r.length)] };
            }
            if (/super|genial|cool|parfait/i.test(t)) {
                return { handled: true, response: "Content que ca te plaise!" };
            }
            if (/oui|ok|d.accord|exactement/i.test(t)) {
                return { handled: true, response: "OK!" };
            }
            if (/non|pas|rien/i.test(t)) {
                return { handled: true, response: "D accord, pas de souci." };
            }
            if (/c.est (tout|bon)/i.test(t)) {
                return { handled: true, response: "OK, je reste la si besoin!" };
            }
            return { handled: false }; // fallback to Claude
        }
        case "speaker_register": {
            // Signal to Python to start the registration flow
            return { handled: true, response: "__SPEAKER_REGISTER__", special: "speaker_register" };
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
                // Format result nicely
                const rStr = Number.isInteger(r) ? r.toString() : r.toFixed(2);
                return { handled: true, response: `${a} ${opStr} ${b} egale ${rStr}.` };
            }
            return { handled: false }; // can't parse, let Claude handle
        }
        case "timer": {
            // Extract duration
            const dm = text.match(/(\d+)\s*(minute|min|seconde|sec|heure|h)\b/i);
            if (dm) {
                const val = parseInt(dm[1]);
                const unit = dm[2].toLowerCase();
                let unitStr;
                if (unit.startsWith("min"))
                    unitStr = val > 1 ? "minutes" : "minute";
                else if (unit.startsWith("sec"))
                    unitStr = val > 1 ? "secondes" : "seconde";
                else
                    unitStr = val > 1 ? "heures" : "heure";
                // TODO: actually start a timer process
                return { handled: true, response: `Timer de ${val} ${unitStr}, c'est parti !` };
            }
            return { handled: false };
        }
        default:
            return { handled: false };
    }
}
//# sourceMappingURL=intent-router.js.map