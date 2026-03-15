import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const MEMORY_DIR = process.env.MEMORY_DIR ?? "data/memory";
const CONVERSATIONS_DIR = join(MEMORY_DIR, "conversations");
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Enhanced memory manager with proactive recall and simple text similarity.
 * Adapted from iOS memoryRetriever.ts without embeddings.
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
     * Search memory entries matching a query using simple text similarity.
     * Enhanced version with scoring based on relevance and recency.
     * @param query - Search term
     * @param userId - User identifier
     */
    async search(query, userId = "default") {
        const entries = await this.read(userId);
        const lower = query.toLowerCase();
        
        // Calculate similarity score for each entry
        const scored = entries.map(entry => {
            const contentLower = entry.content.toLowerCase();
            const categoryLower = entry.category.toLowerCase();
            
            // Text similarity: count matching words
            const queryWords = lower.split(/\s+/).filter(w => w.length > 2);
            const contentWords = contentLower.split(/\s+/);
            const categoryWords = categoryLower.split(/\s+/);
            
            let matches = 0;
            for (const qword of queryWords) {
                // Exact matches in content
                if (contentWords.some(cword => cword.includes(qword))) matches += 2;
                // Exact matches in category
                if (categoryWords.some(cword => cword.includes(qword))) matches += 1;
                // Substring matches in content
                if (contentLower.includes(qword)) matches += 1;
            }
            
            const textSimilarity = queryWords.length > 0 ? matches / queryWords.length : 0;
            
            // Recency boost: newer entries get higher score
            const ageMs = Date.now() - new Date(entry.timestamp).getTime();
            const ageDays = ageMs / (24 * 60 * 60 * 1000);
            const recencyBoost = Math.max(0, 1 - ageDays / 30); // Decay over 30 days
            
            const finalScore = 0.8 * textSimilarity + 0.2 * recencyBoost;
            
            return { ...entry, score: finalScore };
        });
        
        // Filter and sort by score
        return scored
            .filter(e => e.score > 0.1) // Minimum relevance threshold
            .sort((a, b) => b.score - a.score)
            .slice(0, 10); // Top 10 results
    }
    
    /**
     * Retrieve proactive memories (events, goals, routines) for contextual injection.
     * Similar to iOS memoryRetriever.retrieveProactive()
     * @param userId - User identifier
     */
    async retrieveProactive(userId = "default") {
        try {
            const entries = await this.read(userId);
            
            // Filter for time-sensitive categories from last 7 days
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const proactiveCategories = ['event', 'goal', 'routine', 'health'];
            
            const recent = entries.filter(entry => {
                const entryDate = new Date(entry.timestamp);
                return entryDate > sevenDaysAgo && 
                       proactiveCategories.includes(entry.category.toLowerCase());
            });
            
            // Sort by relevance (more recent = more relevant)
            return recent
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, 5); // Max 5 proactive memories
        } catch {
            return [];
        }
    }
    
    /**
     * Get enhanced summary for system prompt with query-based retrieval.
     * Combines general recent memories with proactive recalls.
     * @param userId - User identifier
     * @param query - Optional query to find relevant memories
     */
    async getSummary(userId = "default", query = "") {
        try {
            const allEntries = await this.read(userId);
            if (allEntries.length === 0) return "";
            
            let relevantMemories = [];
            
            // If query provided, use search-based retrieval
            if (query.trim()) {
                const searchResults = await this.search(query, userId);
                relevantMemories.push(...searchResults.slice(0, 5));
            } else {
                // Default: recent memories
                relevantMemories.push(...allEntries.slice(-5));
            }
            
            // Always add proactive memories
            const proactiveMemories = await this.retrieveProactive(userId);
            relevantMemories.push(...proactiveMemories);
            
            // Remove duplicates and format
            const uniqueMemories = new Map();
            for (const memory of relevantMemories) {
                const key = `${memory.category}-${memory.content}`;
                if (!uniqueMemories.has(key)) {
                    uniqueMemories.set(key, memory);
                }
            }
            
            const formatted = Array.from(uniqueMemories.values())
                .map(e => `- [${e.category}] ${e.content}`)
                .join('\n');
            
            return formatted;
        } catch (error) {
            console.error("[Memory] getSummary error:", error);
            return "";
        }
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