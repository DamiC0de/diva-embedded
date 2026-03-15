import { EventEmitter } from "node:events";
export declare enum State {
    IDLE = "IDLE",
    LISTENING = "LISTENING",
    PROCESSING = "PROCESSING",
    SPEAKING = "SPEAKING"
}
export type StateTransition = {
    from: State;
    to: State;
    reason: string;
};
/**
 * Voice assistant state machine.
 * Manages transitions: IDLE -> LISTENING -> PROCESSING -> SPEAKING -> (back)
 * Supports barge-in: SPEAKING can go back to LISTENING or IDLE.
 */
export declare class StateMachine extends EventEmitter {
    private _state;
    get state(): State;
    /**
     * Transition to a new state.
     * @param to - Target state
     * @param reason - Reason for the transition (for logging)
     * @throws Error if transition is invalid
     */
    transition(to: State, reason: string): void;
    /** Check if currently in a specific state. */
    is(state: State): boolean;
    /** Force reset to IDLE (for error recovery). */
    reset(reason?: string): void;
}
//# sourceMappingURL=machine.d.ts.map