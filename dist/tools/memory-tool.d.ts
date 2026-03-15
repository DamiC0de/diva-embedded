import { MemoryManager } from "../memory/manager.js";
/**
 * Tool handler for memory_read — search user memory.
 */
export declare function handleMemoryRead(input: Record<string, string>): Promise<string>;
/**
 * Tool handler for memory_write — save to user memory.
 */
export declare function handleMemoryWrite(input: Record<string, string>): Promise<string>;
/**
 * Get memory summary for system prompt.
 */
export declare function getMemorySummary(): Promise<string>;
/** Get the shared MemoryManager instance. */
export declare function getMemoryManager(): MemoryManager;
//# sourceMappingURL=memory-tool.d.ts.map