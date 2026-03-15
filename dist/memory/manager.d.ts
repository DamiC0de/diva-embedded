interface MemoryEntry {
    timestamp: string;
    category: string;
    content: string;
}
interface ConversationEntry {
    timestamp: string;
    role: "user" | "assistant";
    content: string;
}
/**
 * Memory manager for persistent user memory and conversation history.
 */
export declare class MemoryManager {
    private lastActivity;
    private conversationMessages;
    private maxContextMessages;
    constructor();
    /** Create required directories if they don't exist. */
    private ensureDirs;
    /**
     * Read all memory entries for a user.
     * @param userId - User identifier (default: "default")
     */
    read(userId?: string): Promise<MemoryEntry[]>;
    /**
     * Append a new memory entry for a user.
     * @param userId - User identifier
     * @param entry - Content to memorize
     * @param category - Category of the memory
     */
    append(userId: string | undefined, entry: string, category?: string): Promise<void>;
    /**
     * Search memory entries matching a query.
     * @param query - Search term
     * @param userId - User identifier
     */
    search(query: string, userId?: string): Promise<MemoryEntry[]>;
    /**
     * Get a summary of memory for the system prompt.
     * @param userId - User identifier
     */
    getSummary(userId?: string): Promise<string>;
    /** Parse a markdown memory file into entries. */
    private parseMemoryFile;
    /**
     * Add a message to conversation history.
     * Auto-resets if inactive for 30 minutes.
     */
    addMessage(role: "user" | "assistant", content: string): Promise<void>;
    /** Get recent conversation messages for context. */
    getRecentMessages(): ConversationEntry[];
    /** Persist a conversation entry to the daily JSONL file. */
    private persistMessage;
    /** Reset conversation history. */
    resetConversation(): void;
}
export {};
//# sourceMappingURL=manager.d.ts.map