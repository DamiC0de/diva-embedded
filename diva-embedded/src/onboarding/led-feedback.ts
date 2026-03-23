/**
 * LED & Vibration Feedback — Story 23.1 / FR158, FR159
 * Controls the LED ring and vibration motor on the Rock 5B+ hardware
 * to communicate state without voice or screen.
 *
 * LED patterns (FR158):
 *   - Blue pulsing: waiting for connection
 *   - Green blinking: phone detected
 *   - Green solid: WiFi connected
 *   - Rainbow: setup complete and ready
 *   - Red pulsing: error
 *
 * Vibration patterns (FR159):
 *   - 1 short buzz: action required
 *   - 2 short buzzes: step succeeded
 *   - 1 long buzz: error
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { log } from "../monitoring/logger.js";

/** GPIO paths for Rock 5B+ — configurable via env */
const LED_GPIO_PATH = process.env.DIVA_LED_GPIO || "/sys/class/leds/diva-ring";
const VIBRATION_GPIO = process.env.DIVA_VIBRATION_GPIO || "/sys/class/gpio/gpio150";

/** Check hardware availability once at startup to avoid log spam */
const LED_AVAILABLE = existsSync(LED_GPIO_PATH);
const VIBRATION_AVAILABLE = existsSync(VIBRATION_GPIO);

export type LEDColor = "blue" | "green" | "red" | "white" | "purple" | "off";
export type LEDPattern = "solid" | "pulsing" | "blinking" | "rainbow";

export type OnboardingLEDState =
  | "waiting_connection"  // blue pulsing
  | "phone_detected"      // green blinking
  | "wifi_connected"      // green solid
  | "setup_complete"      // rainbow
  | "error"               // red pulsing
  | "processing"          // white pulsing
  | "off";

interface LEDCommand {
  color: LEDColor;
  pattern: LEDPattern;
  brightness: number; // 0-255
  periodMs: number;   // for pulsing/blinking
}

const STATE_MAP: Record<OnboardingLEDState, LEDCommand> = {
  waiting_connection: { color: "blue", pattern: "pulsing", brightness: 200, periodMs: 2000 },
  phone_detected: { color: "green", pattern: "blinking", brightness: 255, periodMs: 500 },
  wifi_connected: { color: "green", pattern: "solid", brightness: 255, periodMs: 0 },
  setup_complete: { color: "white", pattern: "rainbow", brightness: 255, periodMs: 3000 },
  error: { color: "red", pattern: "pulsing", brightness: 255, periodMs: 800 },
  processing: { color: "white", pattern: "pulsing", brightness: 180, periodMs: 1500 },
  off: { color: "off", pattern: "solid", brightness: 0, periodMs: 0 },
};

let currentState: OnboardingLEDState = "off";
let animationInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Sets the LED ring to an onboarding state (FR158).
 */
export function setLEDState(state: OnboardingLEDState): void {
  if (state === currentState) return;
  currentState = state;

  const cmd = STATE_MAP[state];
  stopAnimation();

  if (cmd.pattern === "solid") {
    writeLED(cmd.color, cmd.brightness);
  } else if (cmd.pattern === "pulsing") {
    startPulsingAnimation(cmd.color, cmd.brightness, cmd.periodMs);
  } else if (cmd.pattern === "blinking") {
    startBlinkingAnimation(cmd.color, cmd.brightness, cmd.periodMs);
  } else if (cmd.pattern === "rainbow") {
    startRainbowAnimation(cmd.periodMs);
  }

  log.info("LED state changed", { state });
}

/**
 * Gets the current LED state.
 */
export function getLEDState(): OnboardingLEDState {
  return currentState;
}

/**
 * Emits a vibration pattern (FR159).
 */
export function vibrate(pattern: "action_required" | "step_success" | "error"): void {
  switch (pattern) {
    case "action_required":
      // 1 short buzz (100ms)
      pulseVibration(100);
      break;
    case "step_success":
      // 2 short buzzes (100ms each, 100ms gap)
      pulseVibration(100);
      setTimeout(() => pulseVibration(100), 200);
      break;
    case "error":
      // 1 long buzz (500ms)
      pulseVibration(500);
      break;
  }
}

/**
 * Combined LED + vibration feedback for onboarding events.
 */
export function onboardingFeedback(event: OnboardingLEDState): void {
  setLEDState(event);

  switch (event) {
    case "phone_detected":
      vibrate("step_success");
      break;
    case "wifi_connected":
    case "setup_complete":
      vibrate("step_success");
      break;
    case "error":
      vibrate("error");
      break;
    case "waiting_connection":
      vibrate("action_required");
      break;
  }
}

/**
 * Turns off all feedback (cleanup).
 */
export function allOff(): void {
  stopAnimation();
  writeLED("off", 0);
  currentState = "off";
}

// ─── Hardware abstraction ─────────────────────────────────

function writeLED(color: LEDColor, brightness: number): void {
  if (!LED_AVAILABLE) return;
  try {
    const colors: Record<LEDColor, [number, number, number]> = {
      blue: [0, 0, brightness],
      green: [0, brightness, 0],
      red: [brightness, 0, 0],
      white: [brightness, brightness, brightness],
      purple: [brightness, 0, brightness],
      off: [0, 0, 0],
    };

    const [r, g, b] = colors[color] || [0, 0, 0];

    execSync(`echo ${r} > ${LED_GPIO_PATH}/red/brightness`, { timeout: 500, stdio: "ignore" });
    execSync(`echo ${g} > ${LED_GPIO_PATH}/green/brightness`, { timeout: 500, stdio: "ignore" });
    execSync(`echo ${b} > ${LED_GPIO_PATH}/blue/brightness`, { timeout: 500, stdio: "ignore" });
  } catch {
    // Non-critical
  }
}

function pulseVibration(durationMs: number): void {
  if (!VIBRATION_AVAILABLE) return;
  try {
    execSync(`echo 1 > ${VIBRATION_GPIO}/value`, { timeout: 500, stdio: "ignore" });
    setTimeout(() => {
      try {
        execSync(`echo 0 > ${VIBRATION_GPIO}/value`, { timeout: 500, stdio: "ignore" });
      } catch { /* ignore */ }
    }, durationMs);
  } catch {
    // Non-critical
  }
}

function stopAnimation(): void {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
}

function startPulsingAnimation(color: LEDColor, maxBrightness: number, periodMs: number): void {
  let phase = 0;
  const step = (2 * Math.PI) / (periodMs / 50);

  animationInterval = setInterval(() => {
    const brightness = Math.round((Math.sin(phase) + 1) / 2 * maxBrightness);
    writeLED(color, brightness);
    phase += step;
  }, 50);
}

function startBlinkingAnimation(color: LEDColor, brightness: number, periodMs: number): void {
  let on = true;
  animationInterval = setInterval(() => {
    writeLED(on ? color : "off", on ? brightness : 0);
    on = !on;
  }, periodMs);
}

function startRainbowAnimation(periodMs: number): void {
  const colors: LEDColor[] = ["red", "purple", "blue", "green", "white"];
  let index = 0;
  animationInterval = setInterval(() => {
    writeLED(colors[index % colors.length], 200);
    index++;
  }, periodMs / colors.length);
}
