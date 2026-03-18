/**
 * Dashboard HTTP Server — Admin panel for Diva on port 3002
 *
 * Endpoints:
 * - GET  /                    → Dashboard HTML
 * - GET  /api/status          → Service health + system metrics
 * - GET  /api/metrics         → CPU/RAM/NPU/temp real-time
 * - GET  /api/logs            → Recent interaction logs
 * - GET  /api/timers          → Active timers
 * - GET  /api/sounds          → List configurable sounds
 * - POST /api/sounds/upload   → Upload custom sound
 * - GET  /api/dnd             → DND status
 * - POST /api/dnd             → Toggle DND
 */
interface LogEntry {
    timestamp: string;
    speaker: string;
    transcription: string;
    intent: string;
    category: string;
    response: string;
    latencyMs: number;
}
export declare function logInteraction(entry: LogEntry): void;
export declare function startDashboard(): void;
export {};
//# sourceMappingURL=server.d.ts.map