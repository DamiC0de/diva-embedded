/**
 * Intent Router — calls local keyword classifier on port 8882
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
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as IntentResult;
  } catch (err) {
    console.warn(`[Router] Intent classifier unavailable: ${err}`);
    return { intent: "complex", category: "fallback", confidence: 0, latency_ms: 0 };
  }
}

export function handleLocalIntent(category: string, text: string): LocalResponse {
  switch (category) {
    case "time": {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris"
      });
      const dateStr = now.toLocaleDateString("fr-FR", {
        weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris"
      });
      if (/heure/i.test(text)) return { handled: true, response: `Il est ${timeStr}.` };
      if (/jour|date/i.test(text)) return { handled: true, response: `On est ${dateStr}.` };
      return { handled: true, response: `Il est ${timeStr}, on est ${dateStr}.` };
    }
    case "greeting": {
      const g = ["Salut! Dis-moi.", "Hey! Je t ecoute.", "Coucou!"];
      return { handled: true, response: g[Math.floor(Math.random() * g.length)] };
    }
    case "goodbye": {
      const b = ["Bonne nuit!", "A plus!", "Ciao!"];
      return { handled: true, response: b[Math.floor(Math.random() * b.length)] };
    }
    case "calculator": {
      const m = text.match(/(\d+)\s*(plus|\+|fois|x|\*|moins|-)\s*(\d+)/i);
      if (m) {
        const a = parseInt(m[1]), op = m[2].toLowerCase(), b = parseInt(m[3]);
        let r: number;
        if (op === "plus" || op === "+") r = a + b;
        else if (op.startsWith("fois") || op === "x" || op === "*") r = a * b;
        else r = a - b;
        return { handled: true, response: `${r}` };
      }
      return { handled: false };
    }
    default:
      return { handled: false };
  }
}
