import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
const MEMORY_DIR = process.env.MEMORY_DIR ?? "data/memory";
const CONVERSATIONS_DIR = join(MEMORY_DIR, "conversations");
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
/**
 * Memory manager for persistent user memory and conversation history.
 */
export class MemoryManager {
    lastActivity = Date.now();
    conversationMessages = [];
    maxContextMessages = 20;
    constructor() {
        this.ensureDirs();
    }
    /** Create required directories if they don't exist. */
    async ensureDirs() {
        if (!existsSync(MEMORY_DIR)) {
            await mkdir(MEMORY_DIR, { recursive: true });
        }
        if (!existsSync(CONVERSATIONS_DIR)) {
            await mkdir(CONVERSATIONS_DIR, { recursive: true });
        }
    }
    /**
     * Read all memory entries for a user.
     * @param userId - User identifier (default: "default")
     */
    async read(userId = "default") {
        const filePath = join(MEMORY_DIR, `${userId}.md`);
        if (!existsSync(filePath))
            return [];
        const content = await readFile(filePath, "utf-8");
        return this.parseMemoryFile(content);
    }
    /**
     * Append a new memory entry for a user.
     * @param userId - User identifier
     * @param entry - Content to memorize
     * @param category - Category of the memory
     */
    async append(userId = "default", entry, category = "note") {
        await this.ensureDirs();
        const filePath = join(MEMORY_DIR, `${userId}.md`);
        const timestamp = new Date().toISOString();
        const line = `\n## [${category}] ${timestamp}\n${entry}\n`;
        if (!existsSync(filePath)) {
            await writeFile(filePath, `# Mémoire de ${userId}\n${line}`);
        }
        else {
            await appendFile(filePath, line);
        }
    }
    /**
     * Search memory entries matching a query.
     * @param query - Search term
     * @param userId - User identifier
     */
    async search(query, userId = "default") {
        const entries = await this.read(userId);
        const lower = query.toLowerCase();
        return entries.filter((e) => e.content.toLowerCase().includes(lower) ||
            e.category.toLowerCase().includes(lower));
    }
    /**
     * Get a summary of memory for the system prompt.
     * @param userId - User identifier
     */
    async getSummary(userId = "default") {
        const entries = await this.read(userId);
        if (entries.length === 0)
            return "";
        const recent = entries.slice(-10);
        return recent.map((e) => `[${e.category}] ${e.content}`).join("\n");
    }
    /** Parse a markdown memory file into entries. */
    parseMemoryFile(content) {
        const entries = [];
        const sections = content.split(/^## /m).slice(1);
        for (const section of sections) {
            const firstLine = section.split("\n")[0] ?? "";
            const match = firstLine.match(/^\[(.+?)\]\s+(.+)/);
            if (match) {
                const category = match[1];
                const timestamp = match[2];
                const body = section.split("\n").slice(1).join("\n").trim();
                entries.push({ timestamp, category, content: body });
            }
        }
        return entries;
    }
    // --- Conversation History (US-RB-008) ---
    /**
     * Add a message to conversation history.
     * Auto-resets if inactive for 30 minutes.
     */
    async addMessage(role, content) {
        const now = Date.now();
        // Auto-reset after inactivity
        if (now - this.lastActivity > INACTIVITY_TIMEOUT_MS) {
            console.log("[Memory] Conversation reset due to inactivity");
            this.conversationMessages = [];
        }
        this.lastActivity = now;
        const entry = {
            timestamp: new Date().toISOString(),
            role,
            content,
        };
        this.conversationMessages.push(entry);
        // Maintain rolling window
        if (this.conversationMessages.length > this.maxContextMessages) {
            this.conversationMessages = this.conversationMessages.slice(-this.maxContextMessages);
        }
        // Persist to daily JSONL file
        await this.persistMessage(entry);
    }
    /** Get recent conversation messages for context. */
    getRecentMessages() {
        const now = Date.now();
        if (now - this.lastActivity > INACTIVITY_TIMEOUT_MS) {
            this.conversationMessages = [];
        }
        return [...this.conversationMessages];
    }
    /** Persist a conversation entry to the daily JSONL file. */
    async persistMessage(entry) {
        await this.ensureDirs();
        const dateStr = new Date().toISOString().split("T")[0];
        const filePath = join(CONVERSATIONS_DIR, `${dateStr}.jsonl`);
        await appendFile(filePath, JSON.stringify(entry) + "\n");
    }
    /** Reset conversation history. */
    resetConversation() {
        this.conversationMessages = [];
        this.lastActivity = Date.now();
        console.log("[Memory] Conversation history cleared");
    }
}
//# sourceMappingURL=manager.js.map