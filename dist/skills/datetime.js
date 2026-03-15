/**
 * Skill: Date, heure, timers et alarmes
 */
export default {
    name: "datetime",
    description: "Gestion du temps, date/heure, timers et alarmes",
    tools: [
        {
            name: "get_datetime",
            description: "Get current date and time in French format",
            schema: {
                type: "object",
                properties: {},
                required: []
            }
        },
        {
            name: "set_timer",
            description: "Set a timer for a specified duration",
            schema: {
                type: "object",
                properties: {
                    duration: { type: "string", description: "Duration (e.g. 5 minutes, 2 heures, 30 secondes)" },
                    label: { type: "string", description: "Optional timer label" }
                },
                required: ["duration"]
            }
        }
    ],

    async handler(toolName, input) {
        if (toolName === "get_datetime") {
            return this.getCurrentDateTime();
        } else if (toolName === "set_timer") {
            return this.setTimer(input);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    },

    getCurrentDateTime() {
        const now = new Date();
        const french = now.toLocaleString("fr-FR", { 
            timeZone: "Europe/Paris", 
            dateStyle: "full", 
            timeStyle: "medium" 
        });
        return `Nous sommes le ${french} (heure de Paris).`;
    },

    async setTimer(input) {
        const duration = input.duration ?? "";
        const label = input.label ?? "Timer";
        
        if (!duration) return "Erreur: durée non spécifiée.";
        
        // Parser la durée (basique)
        const seconds = this.parseDuration(duration);
        if (seconds <= 0) return "Erreur: impossible de comprendre la durée.";
        
        // Programmer le timer (simulation pour l'instant)
        console.log(`[Timer] Set timer "${label}" for ${seconds} seconds`);
        
        // TODO: Implémenter vraiment le système de timer/alarme
        // avec stockage et notification
        
        return `Timer "${label}" programmé pour ${this.formatDuration(seconds)}.`;
    },

    parseDuration(duration) {
        const lower = duration.toLowerCase().trim();
        
        // Patterns basiques
        const patterns = [
            { regex: /(\d+)\s*(?:secondes?|sec|s)/, multiplier: 1 },
            { regex: /(\d+)\s*(?:minutes?|min|m)/, multiplier: 60 },
            { regex: /(\d+)\s*(?:heures?|heure|h)/, multiplier: 3600 },
        ];
        
        for (const pattern of patterns) {
            const match = lower.match(pattern.regex);
            if (match) {
                return parseInt(match[1]) * pattern.multiplier;
            }
        }
        
        return 0;
    },

    formatDuration(seconds) {
        if (seconds < 60) return `${seconds} secondes`;
        if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
        return `${Math.round(seconds / 3600)} heures`;
    }
};
