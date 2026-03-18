/**
 * Audio Lock — prevents proactive features from using audio
 * while the main loop is in wake word wait or conversation.
 *
 * The main loop sets busy=true during wakeword listening + conversation,
 * proactive scheduler checks before attempting any audio output.
 */
export declare function setAudioBusy(value: boolean): void;
export declare function isAudioBusy(): boolean;
//# sourceMappingURL=audio-lock.d.ts.map