/**
 * Audio Lock — prevents proactive features from using audio
 * while the main loop is in wake word wait or conversation.
 *
 * The main loop sets busy=true during wakeword listening + conversation,
 * proactive scheduler checks before attempting any audio output.
 */
let busy = false;
export function setAudioBusy(value) {
    busy = value;
}
export function isAudioBusy() {
    return busy;
}
//# sourceMappingURL=audio-lock.js.map