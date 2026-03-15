import { MemoryManager } from "../memory/manager.js";
const memoryManager = new MemoryManager();
/**
 * Tool handler for memory_read — search user memory.
 */
export async function handleMemoryRead(input) {
    const query = input.query ?? "";
    const entries = await memoryManager.search(query);
    if (entries.length === 0) {
        return "Aucun souvenir trouvé pour cette recherche.";
    }
    return entries
        .map((e) => `[${e.category}] ${e.content}`)
        .join("\n");
}
/**
 * Tool handler for memory_write — save to user memory.
 */
export async function handleMemoryWrite(input) {
    const content = input.content ?? "";
    const category = input.category ?? "note";
    if (!content) {
        return "Erreur: contenu vide.";
    }
    await memoryManager.append("default", content, category);
    return "Information mémorisée avec succès.";
}
/**
 * Get memory summary for system prompt.
 */
export async function getMemorySummary() {
    return memoryManager.getSummary();
}
/** Get the shared MemoryManager instance. */
export function getMemoryManager() {
    return memoryManager;
}
//# sourceMappingURL=memory-tool.js.map