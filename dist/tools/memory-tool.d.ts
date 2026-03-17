/**
 * Memory tool using Mem0 service (port 9002)
 * Replaces the old markdown-based MemoryManager
 */
interface MemoryEntry {
    memory: string;
    score?: number;
    id?: string;
}
/**
 * Set the current user for memory operations.
 * Called by speaker identification or manual switch.
 */
export declare function setCurrentUser(userId: string): void;
export declare function getCurrentUser(): string;
/**
 * Add a memory for the current user.
 */
export declare function addMemory(text: string): Promise<void>;
/**
 * Add a conversation exchange to memory.
 */
export declare function addConversation(userMessage: string, assistantMessage: string): Promise<void>;
/**
 * Search memories for the current user.
 */
export declare function searchMemory(query: string): Promise<MemoryEntry[]>;
/**
 * Get all memories for the current user.
 */
export declare function getAllMemories(): Promise<MemoryEntry[]>;
/**
 * Get memory summary for system prompt.
 */
export declare function getMemorySummary(): Promise<string>;
export declare function handleMemoryRead(input: Record<string, string>): Promise<string>;
export declare function handleMemoryWrite(input: Record<string, string>): Promise<string>;
export declare function identifySpeaker(audioB64: string): Promise<string>;
export {};
//# sourceMappingURL=memory-tool.d.ts.map