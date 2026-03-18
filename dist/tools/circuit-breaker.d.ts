/**
 * Circuit Breaker — protects against cascading failures
 * States: CLOSED (normal) → OPEN (failing, use fallback) → HALF_OPEN (testing)
 */
type CircuitState = "closed" | "open" | "half_open";
interface CircuitConfig {
    failureThreshold: number;
    resetTimeoutMs: number;
    name: string;
}
export declare function recordSuccess(name: string): void;
export declare function recordFailure(name: string): void;
export declare function isOpen(name: string): boolean;
/**
 * Execute with circuit breaker protection.
 * If circuit is open, immediately returns fallback result.
 */
export declare function withCircuitBreaker<T>(name: string, primary: () => Promise<T>, fallback: () => Promise<T>, config?: Partial<CircuitConfig>): Promise<T>;
export declare function getCircuitStatus(): Record<string, {
    state: CircuitState;
    failures: number;
}>;
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map