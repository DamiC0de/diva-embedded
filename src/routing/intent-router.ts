/**
 * Intent Router v2 — calls local keyword classifier on port 8882
 * Routes simple queries locally, complex ones to Claude
 */

const INTENT_URL = process.env.INTENT_URL ?? "http://localhost:8882";

interface IntentResult {
  intent: "local_simple" | "home_control" | "complex";
  category: string;
  confidence: number;
  latency_ms: number;
}

interface LocalResponse {
  handled: boolean;
  response?: string;
}

export async function classifyIntent(text: string): Promise<IntentResult> {
  try {
    const res = await fetch(`${INTENT_URL}/v1/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as IntentResult;
  } catch (err) {
    console.warn(`[Router] Intent classifier unavailable: ${err}`);
    return { intent: "complex", category: "fallback", confidence: 0, latency_ms: 0 };
  }
}

async function fetchWeather(): Promise<string> {
  try {
    const res = await fetch("https://wttr.in/Paris?format=%C+%t&lang=fr", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const weather = (await res.text()).trim();
    return `A Paris il fait ${weather}.`;
  } catch {
    return "";
  }
}

export async function handleLocalIntent(category: string, text: string): Promise<LocalResponse> {
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
      if (/heure/i.test(text)) return { handled: true, response: `Il est ${timeStr}.` };
      if (/jour|date/i.test(text)) return { handled: true, response: `On est le ${dateStr}.` };
      return { handled: true, response: `Il est ${timeStr}, on est le ${dateStr}.` };
    }

    case "weather": {
      const weather = await fetchWeather();
      if (weather) return { handled: true, response: weather };
      return { handled: false }; // fallback to Claude
    }

    case "greeting": {
      const hour = new Date().toLocaleString("fr-FR", {
        hour: "numeric", timeZone: "Europe/Paris"
      });
      const h = parseInt(hour);
      let timeGreet: string;
      if (h >= 5 && h < 12) timeGreet = "Bonjour";
      else if (h >= 12 && h < 18) timeGreet = "Hey";
      else if (h >= 18 && h < 22) timeGreet = "Bonsoir";
      else timeGreet = "Coucou";

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
        let r: number;
        let opStr: string;
        if (op === "plus" || op === "+") { r = a + b; opStr = "plus"; }
        else if (op.startsWith("fois") || op === "x" || op === "*") { r = a * b; opStr = "fois"; }
        else if (op === "moins" || op === "-") { r = a - b; opStr = "moins"; }
        else if (op.startsWith("divis") || op === "/") { r = b !== 0 ? Math.round((a / b) * 100) / 100 : 0; opStr = "divise par"; }
        else if (op.includes("pourcent") || op.includes("percent")) { r = Math.round((a * b) / 100 * 100) / 100; opStr = "pourcent de"; }
        else { r = a + b; opStr = "?"; }
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
        let unitStr: string;
        if (unit.startsWith("min")) unitStr = val > 1 ? "minutes" : "minute";
        else if (unit.startsWith("sec")) unitStr = val > 1 ? "secondes" : "seconde";
        else unitStr = val > 1 ? "heures" : "heure";
        // TODO: actually start a timer process
        return { handled: true, response: `Timer de ${val} ${unitStr}, c'est parti !` };
      }
      return { handled: false };
    }

    default:
      return { handled: false };
  }
}
