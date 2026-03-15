import { EventEmitter } from "node:events";
export var State;
(function (State) {
    State["IDLE"] = "IDLE";
    State["LISTENING"] = "LISTENING";
    State["PROCESSING"] = "PROCESSING";
    State["SPEAKING"] = "SPEAKING";
})(State || (State = {}));
const VALID_TRANSITIONS = {
    [State.IDLE]: [State.LISTENING],
    [State.LISTENING]: [State.PROCESSING, State.IDLE],
    [State.PROCESSING]: [State.SPEAKING, State.IDLE],
    [State.SPEAKING]: [State.IDLE, State.LISTENING],
};
/**
 * Voice assistant state machine.
 * Manages transitions: IDLE -> LISTENING -> PROCESSING -> SPEAKING -> (back)
 * Supports barge-in: SPEAKING can go back to LISTENING or IDLE.
 */
export class StateMachine extends EventEmitter {
    _state = State.IDLE;
    get state() {
        return this._state;
    }
    /**
     * Transition to a new state.
     * @param to - Target state
     * @param reason - Reason for the transition (for logging)
     * @throws Error if transition is invalid
     */
    transition(to, reason) {
        const from = this._state;
        const valid = VALID_TRANSITIONS[from];
        if (!valid.includes(to)) {
            throw new Error(`Invalid transition: ${from} -> ${to} (reason: ${reason})`);
        }
        this._state = to;
        const transition = { from, to, reason };
        console.log(`[State] ${from} -> ${to} (${reason})`);
        this.emit("transition", transition);
        this.emit(to, transition);
    }
    /** Check if currently in a specific state. */
    is(state) {
        return this._state === state;
    }
    /** Force reset to IDLE (for error recovery). */
    reset(reason = "reset") {
        const from = this._state;
        this._state = State.IDLE;
        console.log(`[State] ${from} -> IDLE (forced: ${reason})`);
        this.emit("transition", { from, to: State.IDLE, reason: `forced: ${reason}` });
        this.emit(State.IDLE, { from, to: State.IDLE, reason: `forced: ${reason}` });
    }
}
//# sourceMappingURL=machine.js.map