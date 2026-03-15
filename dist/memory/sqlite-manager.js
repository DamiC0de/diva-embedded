import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export class SQLiteMemoryManager {
    db = null;
    conversationLog = [];

    constructor(dbPath = "/opt/diva-embedded/data/memory.db") {
        this.db = new Database(dbPath);
        this.initDatabase();
        console.log("[Memory] SQLite database initialized");
    }

    initDatabase() {
        // Create memories table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'default',
                category TEXT NOT NULL DEFAULT 'note',
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
        `);

        // Create FTS5 virtual table for full-text search
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content, category, user_id, content='memories', content_rowid='id'
            );
        `);

        // Triggers to keep FTS5 in sync
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, content, category, user_id) 
                VALUES (new.id, new.content, new.category, new.user_id);
            END;
        `);

        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category, user_id) 
                VALUES ('delete', old.id, old.content, old.category, old.user_id);
            END;
        `);

        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category, user_id) 
                VALUES ('delete', old.id, old.content, old.category, old.user_id);
                INSERT INTO memories_fts(rowid, content, category, user_id) 
                VALUES (new.id, new.content, new.category, new.user_id);
            END;
        `);

        // Create indexes
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_memories_user_category 
            ON memories(user_id, category);
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_memories_created 
            ON memories(created_at);
        `);
    }

    /**
     * Migration des données markdown existantes
     */
    async migrateFromMarkdown() {
        const markdownPath = "/opt/diva-embedded/data/memory/default.md";
        if (!existsSync(markdownPath)) {
            console.log("[Memory] No markdown file to migrate");
            return;
        }

        const content = readFileSync(markdownPath, "utf-8");
        const lines = content.split("\\n").filter(l => l.trim());
        
        let migrated = 0;
        const insertStmt = this.db.prepare(`
            INSERT INTO memories (user_id, category, content) 
            VALUES (?, ?, ?)
        `);

        for (const line of lines) {
            if (line.startsWith("-") || line.startsWith("*")) {
                const text = line.replace(/^[-*]\\s*/, "").trim();
                if (text && text.length > 10) {
                    // Essayer de détecter la catégorie
                    let category = "fact";
                    if (text.match(/aime|préfère|déteste|adore/i)) category = "preference";
                    else if (text.match(/habitude|routine|toujours|jamais/i)) category = "routine";
                    else if (text.match(/nom|appelé|surnom/i)) category = "person";
                    else if (text.match(/habite|vit|adresse|ville/i)) category = "location";
                    
                    try {
                        insertStmt.run("default", category, text);
                        migrated++;
                    } catch (err) {
                        console.log(`[Memory] Skip duplicate: ${text.substring(0, 50)}`);
                    }
                }
            }
        }

        console.log(`[Memory] Migrated ${migrated} entries from markdown`);
        
        // Backup the markdown file
        try {
            const backupPath = markdownPath + ".backup." + Date.now();
            require("fs").renameSync(markdownPath, backupPath);
            console.log(`[Memory] Backed up markdown to ${backupPath}`);
        } catch (err) {
            console.log("[Memory] Could not backup markdown file");
        }
    }

    /**
     * Ajouter une nouvelle mémoire avec dédoublonnage
     */
    async append(userId = "default", content, category = "fact") {
        if (!content || content.trim().length < 3) return;
        
        const cleanContent = content.trim();
        
        // Vérifier les doublons via recherche de similarité
        const existing = await this.search(cleanContent, userId);
        for (const entry of existing) {
            const similarity = this.computeSimilarity(cleanContent.toLowerCase(), entry.content.toLowerCase());
            if (similarity > 0.7) {
                console.log("[Memory] Skipping duplicate:", cleanContent.substring(0, 50));
                return;
            }
        }

        // Insérer la nouvelle mémoire
        const insertStmt = this.db.prepare(`
            INSERT INTO memories (user_id, category, content) 
            VALUES (?, ?, ?)
        `);
        
        try {
            insertStmt.run(userId, category, cleanContent);
            console.log(`[Memory] Added: [${category}] ${cleanContent.substring(0, 50)}`);
        } catch (err) {
            console.error("[Memory] Insert failed:", err.message);
        }
    }

    /**
     * Rechercher dans les mémoires (FTS5 + similarité)
     */
    async search(query, userId = "default", limit = 10) {
        if (!query || query.trim().length < 2) return [];
        
        const cleanQuery = query.trim().toLowerCase();
        
        // Recherche FTS5 d'abord
        const ftsStmt = this.db.prepare(`
            SELECT m.*, rank 
            FROM memories_fts 
            JOIN memories m ON memories_fts.rowid = m.id
            WHERE memories_fts MATCH ? AND m.user_id = ?
            ORDER BY rank
            LIMIT ?
        `);
        
        const ftsResults = ftsStmt.all(cleanQuery, userId, limit);
        
        // Si pas assez de résultats FTS, recherche par similarité
        if (ftsResults.length < 3) {
            const allStmt = this.db.prepare(`
                SELECT * FROM memories 
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `);
            
            const allResults = allStmt.all(userId);
            const similarResults = allResults
                .map(entry => ({
                    ...entry,
                    similarity: this.computeSimilarity(cleanQuery, entry.content.toLowerCase())
                }))
                .filter(entry => entry.similarity > 0.3)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, Math.max(5, limit - ftsResults.length));
            
            // Combiner et dédoublonner
            const combined = [...ftsResults];
            for (const similar of similarResults) {
                if (!combined.find(existing => existing.id === similar.id)) {
                    combined.push(similar);
                }
            }
            
            return combined.slice(0, limit);
        }
        
        return ftsResults;
    }

    /**
     * Obtenir un résumé des mémoires pour le system prompt
     */
    async getSummary(userId = "default") {
        const stmt = this.db.prepare(`
            SELECT category, content, created_at
            FROM memories 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 20
        `);
        
        const entries = stmt.all(userId);
        if (entries.length === 0) return null;
        
        // Grouper par catégorie
        const byCategory = {};
        for (const entry of entries) {
            if (!byCategory[entry.category]) {
                byCategory[entry.category] = [];
            }
            byCategory[entry.category].push(entry.content);
        }
        
        // Formater pour le prompt
        let summary = "";
        for (const [category, items] of Object.entries(byCategory)) {
            const categoryName = {
                person: "Personnes",
                preference: "Préférences", 
                routine: "Habitudes",
                location: "Lieux",
                fact: "Informations",
                health: "Santé"
            }[category] || category;
            
            summary += `\\n${categoryName}:\\n`;
            items.slice(0, 5).forEach(item => {
                summary += `- ${item}\\n`;
            });
        }
        
        return summary.trim();
    }

    /**
     * Ajouter un message à l'historique de conversation
     */
    async addMessage(role, content) {
        this.conversationLog.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // Garder seulement les 50 derniers messages
        if (this.conversationLog.length > 50) {
            this.conversationLog = this.conversationLog.slice(-50);
        }
    }

    /**
     * Obtenir les messages récents pour extraction de mémoires
     */
    getRecentMessages(limit = 20) {
        return this.conversationLog.slice(-limit);
    }

    /**
     * Calculer la similarité entre deux textes
     */
    computeSimilarity(a, b) {
        const wordsA = new Set(a.split(/\\s+/).filter(w => w.length > 2));
        const wordsB = new Set(b.split(/\\s+/).filter(w => w.length > 2));
        if (wordsA.size === 0 || wordsB.size === 0) return 0;
        
        let common = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) common++;
        }
        
        return common / Math.max(wordsA.size, wordsB.size);
    }

    /**
     * Statistiques de la base
     */
    getStats(userId = "default") {
        const countStmt = this.db.prepare(`
            SELECT category, COUNT(*) as count 
            FROM memories 
            WHERE user_id = ?
            GROUP BY category
            ORDER BY count DESC
        `);
        
        return countStmt.all(userId);
    }

    /**
     * Fermer la base de données
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
