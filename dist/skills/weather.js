/**
 * Skill: Météo via recherche web optimisée
 */
export default {
    name: "weather",
    description: "Prévisions météo via recherche web optimisée",
    tools: [
        {
            name: "get_weather",
            description: "Get weather forecast for a location",
            schema: {
                type: "object",
                properties: {
                    location: { type: "string", description: "City or location name" },
                    type: { type: "string", description: "Type: current, today, week", default: "current" }
                },
                required: ["location"]
            }
        }
    ],

    async handler(toolName, input) {
        if (toolName === "get_weather") {
            return this.getWeather(input);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    },

    async getWeather(input) {
        const location = input.location ?? "";
        const type = input.type ?? "current";
        
        if (!location) return "Erreur: lieu non spécifié.";
        
        // Utiliser le skill web-search
        const webSearchSkill = await this.getWebSearchSkill();
        if (!webSearchSkill) {
            return "Erreur: impossible d'accéder à la recherche web.";
        }
        
        // Construire la requête météo optimisée
        const queries = this.buildWeatherQueries(location, type);
        
        let bestResult = "";
        for (const query of queries) {
            try {
                const result = await webSearchSkill.braveSearch({ query });
                if (result && !result.includes("Aucun résultat")) {
                    bestResult = result;
                    break;
                }
            } catch (err) {
                console.log(`[Weather] Query failed: ${query}`);
            }
        }
        
        return bestResult || `Impossible de trouver la météo pour ${location}.`;
    },

    buildWeatherQueries(location, type) {
        const base = `météo ${location}`;
        
        switch (type) {
            case "current":
                return [
                    `${base} maintenant température`,
                    `${base} aujourd'hui`,
                    `weather ${location} now`
                ];
            case "today":
                return [
                    `${base} aujourd'hui prévisions`,
                    `${base} journée`,
                    `weather forecast ${location} today`
                ];
            case "week":
                return [
                    `${base} semaine prévisions`,
                    `${base} 7 jours`,
                    `weather forecast ${location} week`
                ];
            default:
                return [`${base}`];
        }
    },

    // Helper pour récupérer le skill web-search
    async getWebSearchSkill() {
        // Import dynamique du skill manager
        try {
            const { skillManager } = await import("./skill-manager.js");
            return skillManager.getSkill("web-search");
        } catch (err) {
            console.error("[Weather] Cannot access skill manager:", err);
            return null;
        }
    }
};
