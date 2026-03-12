import type Anthropic from "@anthropic-ai/sdk";

export type ToolName = "brave_search" | "web_scrape" | "memory_read" | "memory_write";

/**
 * Tool definitions for Claude Haiku tool use.
 */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "brave_search",
    description:
      "Recherche sur le web via Brave Search. Utilise cet outil quand l'utilisateur pose une question nécessitant des informations récentes ou factuelles.",
    input_schema: {
      type: "object" as const,
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
    name: "web_scrape",
    description:
      "Extraire le contenu texte d'une page web. Utilise cet outil pour lire le contenu détaillé d'une URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "L'URL de la page à scraper",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "memory_read",
    description:
      "Lire les souvenirs sauvegardés pour un utilisateur. Utilise pour retrouver des informations passées.",
    input_schema: {
      type: "object" as const,
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
    description:
      "Sauvegarder une information importante en mémoire pour s'en souvenir plus tard.",
    input_schema: {
      type: "object" as const,
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

/**
 * Parse tool input from Claude's response.
 */
export function parseToolInput(name: ToolName, input: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = String(value);
  }
  return result;
}
