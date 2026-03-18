/**
 * Audio Lock — prevents proactive features from using audio
 * while the main loop is in wake word wait or conversation.
 * 
 * The main loop sets busy=true during wakeword listening + conversation,
 * proactive scheduler checks before attempting any audio output.
 */

let busy = false;

export function setAudioBusy(value: boolean): void {
  busy = value;
}

export function isAudioBusy(): boolean {
  return busy;
}
