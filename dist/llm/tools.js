/**
 * Tool definitions for Claude Haiku — PROTO mode (no web_scrape).
 */
export const toolDefinitions = [
    {
        name: "brave_search",
        description: "Recherche sur le web via Brave Search. Utilise cet outil quand l'utilisateur pose une question nécessitant des informations récentes ou factuelles.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "La requête de recherche",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "memory_read",
        description: "Lire les souvenirs sauvegardés pour un utilisateur. Utilise pour retrouver des informations passées.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Terme de recherche dans la mémoire",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "memory_write",
        description: "Sauvegarder une information importante en mémoire pour s'en souvenir plus tard.",
        input_schema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "Le contenu à mémoriser",
                },
                category: {
                    type: "string",
                    description: "Catégorie du souvenir (preference, fact, todo, note)",
                },
            },
            required: ["content"],
        },
    },
];
//# sourceMappingURL=tools.js.map