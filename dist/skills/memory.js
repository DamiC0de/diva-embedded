import { SQLiteMemoryManager } from "../memory/sqlite-manager.js";

const memoryManager = new SQLiteMemoryManager();

/**
 * Skill: Gestion de la mémoire SQLite
 */
export default {
    name: "memory",
    description: "Gestion de la mémoire utilisateur avec SQLite (lecture/écriture)",
    tools: [
        {
            name: "memory_read",
            description: "Search saved memories about the user.",
            schema: {
                type: "object",
                properties: { query: { type: "string", description: "Search term" } },
                required: ["query"]
            }
        },
        {
            name: "memory_write",
            description: "Save personal information about the user for later recall.",
            schema: {
                type: "object",
                properties: {
                    content: { type: "string", description: "Information to remember" },
                    category: { type: "string", description: "Category: preference, fact, person, location, routine" }
                },
                required: ["content"]
            }
        }
    ],

    async handler(toolName, input) {
        if (toolName === "memory_read") {
            return this.handleMemoryRead(input);
        } else if (toolName === "memory_write") {
            return this.handleMemoryWrite(input);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    },

    async handleMemoryRead(input) {
        const query = input.query ?? "";
        try {
            const entries = await memoryManager.search(query);
            if (entries.length === 0) {
                return "Aucun souvenir trouvé pour cette recherche.";
            }
            return entries
                .map((e) => `[${e.category}] ${e.content}`)
                .join("\\n");
        } catch (err) {
            console.error("[Memory] Search failed:", err);
            return "Erreur lors de la recherche en mémoire.";
        }
    },

    async handleMemoryWrite(input) {
        const content = input.content ?? "";
        const category = input.category ?? "fact";
        if (!content || content.trim().length < 3) {
            return "Erreur: contenu trop court.";
        }
        
        try {
            await memoryManager.append("default", content.trim(), category);
            return "Information mémorisée avec succès.";
        } catch (err) {
            console.error("[Memory] Write failed:", err);
            return "Erreur lors de la sauvegarde en mémoire.";
        }
    },

    /**
     * Get memory summary for system prompt.
     */
    async getMemorySummary() {
        try {
            return await memoryManager.getSummary();
        } catch (err) {
            console.error("[Memory] Summary failed:", err);
            return null;
        }
    },

    /** Get the shared MemoryManager instance. */
    getMemoryManager() {
        return memoryManager;
    },

    /**
     * Migration depuis markdown (à exécuter une seule fois)
     */
    async migrate() {
        try {
            await memoryManager.migrateFromMarkdown();
            return true;
        } catch (err) {
            console.error("[Memory] Migration failed:", err);
            return false;
        }
    },

    /**
     * Statistiques de la mémoire
     */
    async getStats() {
        try {
            return memoryManager.getStats();
        } catch (err) {
            console.error("[Memory] Stats failed:", err);
            return [];
        }
    }
};

// Export functions pour compatibilité avec l'ancien code
export async function getMemorySummary() {
    try {
        return await memoryManager.getSummary();
    } catch (err) {
        console.error("[Memory] Summary failed:", err);
        return null;
    }
}

export function getMemoryManager() {
    return memoryManager;
}

// Auto-migration au chargement du module
(async () => {
    try {
        await memoryManager.migrateFromMarkdown();
    } catch (err) {
        console.log("[Memory] Auto-migration skipped:", err.message);
    }
})();
