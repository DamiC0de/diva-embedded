/**
 * Circuit Breaker — protects against cascading failures
 * States: CLOSED (normal) → OPEN (failing, use fallback) → HALF_OPEN (testing)
 */
const circuits = new Map();
function getCircuit(name, config) {
    if (!circuits.has(name)) {
        circuits.set(name, {
            state: "closed",
            failures: 0,
            lastFailure: 0,
            config: {
                name,
                failureThreshold: config?.failureThreshold ?? 3,
                resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
            },
        });
    }
    return circuits.get(name);
}
export function recordSuccess(name) {
    const circuit = getCircuit(name);
    circuit.state = "closed";
    circuit.failures = 0;
}
export function recordFailure(name) {
    const circuit = getCircuit(name);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= circuit.config.failureThreshold) {
        circuit.state = "open";
        console.warn(`[CIRCUIT] ${name}: OPEN (${circuit.failures} failures)`);
    }
}
export function isOpen(name) {
    const circuit = getCircuit(name);
    if (circuit.state === "open") {
        // Check if enough time passed to try half-open
        if (Date.now() - circuit.lastFailure > circuit.config.resetTimeoutMs) {
            circuit.state = "half_open";
            console.log(`[CIRCUIT] ${name}: HALF_OPEN (testing)`);
            return false; // Allow one try
        }
        return true; // Still open
    }
    return false;
}
/**
 * Execute with circuit breaker protection.
 * If circuit is open, immediately returns fallback result.
 */
export async function withCircuitBreaker(name, primary, fallback, config) {
    getCircuit(name, config); // Ensure circuit exists
    if (isOpen(name)) {
        console.log(`[CIRCUIT] ${name}: using fallback`);
        return fallback();
    }
    try {
        const result = await primary();
        recordSuccess(name);
        return result;
    }
    catch (err) {
        recordFailure(name);
        console.warn(`[CIRCUIT] ${name}: failure (${err}), trying fallback`);
        return fallback();
    }
}
export function getCircuitStatus() {
    const status = {};
    for (const [name, circuit] of circuits) {
        status[name] = { state: circuit.state, failures: circuit.failures };
    }
    return status;
}
//# sourceMappingURL=circuit-breaker.js.map