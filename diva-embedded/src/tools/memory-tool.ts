/**
 * Memory tool using Mem0 service (port 9002)
 * Replaces the old markdown-based MemoryManager
 */

const MEM0_URL = "http://localhost:9002";

interface MemoryEntry {
  memory: string;
  score?: number;
  id?: string;
}

// Current user (will be set by speaker identification)
let currentUserId = "default";

/**
 * Set the current user for memory operations.
 * Called by speaker identification or manual switch.
 */
export function setCurrentUser(userId: string): void {
  currentUserId = userId;
  console.log(`[Memory] Switched to user: ${userId}`);
}

export function getCurrentUser(): string {
  return currentUserId;
}

/**
 * Add a memory for the current user.
 */
export async function addMemory(text: string): Promise<void> {
  try {
    const res = await fetch(`${MEM0_URL}/memory/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUserId, text }),
    });
    if (!res.ok) {
      console.warn(`[Memory] Add failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[Memory] Add error: ${e}`);
  }
}

/**
 * Add a conversation exchange to memory.
 */
export async function addConversation(
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  try {
    const messages = [
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage },
    ];
    const res = await fetch(`${MEM0_URL}/memory/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUserId, messages }),
    });
    if (!res.ok) {
      console.warn(`[Memory] AddConversation failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[Memory] AddConversation error: ${e}`);
  }
}

/**
 * Search memories for the current user.
 */
export async function searchMemory(query: string): Promise<MemoryEntry[]> {
  try {
    const res = await fetch(`${MEM0_URL}/memory/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUserId, query }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.memories || [];
  } catch (e) {
    console.warn(`[Memory] Search error: ${e}`);
    return [];
  }
}

/**
 * Get all memories for the current user.
 */
export async function getAllMemories(): Promise<MemoryEntry[]> {
  try {
    const res = await fetch(`${MEM0_URL}/memory/all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUserId }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.memories || [];
  } catch (e) {
    console.warn(`[Memory] GetAll error: ${e}`);
    return [];
  }
}

/**
 * Get memory summary for system prompt.
 */
export async function getMemorySummary(): Promise<string> {
  const memories = await getAllMemories();
  if (memories.length === 0) return "";
  return memories
    .slice(-10)
    .map((m) => m.memory)
    .join("\n");
}

// --- Tool handlers for Claude ---

export async function handleMemoryRead(
  input: Record<string, string>
): Promise<string> {
  const query = input.query ?? "";
  const entries = await searchMemory(query);

  if (entries.length === 0) {
    return "Aucun souvenir trouvé pour cette recherche.";
  }

  return entries.map((e) => e.memory).join("\n");
}

export async function handleMemoryWrite(
  input: Record<string, string>
): Promise<string> {
  const content = input.content ?? "";

  if (!content) {
    return "Erreur: contenu vide.";
  }

  await addMemory(content);
  return "Information mémorisée avec succès.";
}

// --- Speaker identification integration ---

export async function identifySpeaker(audioB64: string): Promise<string> {
  try {
    const res = await fetch(`${MEM0_URL}/speaker/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: audioB64 }),
    });
    if (!res.ok) return "unknown";
    const data = await res.json();
    const speaker = data.speaker || "unknown";
    const confidence = data.confidence || 0;
    
    console.log(`[Memory] Speaker identified: ${speaker} (confidence: ${confidence})`);
    
    // Auto-switch user if confident
    // Auto-switch threshold is now managed by Python speaker-tuning.json
    if (speaker !== "unknown" && confidence > 0) {
      setCurrentUser(speaker);
    }
    
    return speaker;
  } catch (e) {
    console.warn(`[Memory] Speaker ID error: ${e}`);
    return "unknown";
  }
}
