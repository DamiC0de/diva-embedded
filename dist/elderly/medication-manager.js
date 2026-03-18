/**
 * Medication Reminder Manager
 * - Recurring reminders with voice confirmation
 * - Escalation: re-remind at 15min, caregiver alert at 30min
 * - Compliance tracking for dashboard
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { playAudioFile, playAudioBytes, recordAudio } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { sendMedicationAlert } from "./notifications.js";
import { isAudioBusy } from "../audio/audio-lock.js";
const ASSETS_DIR = "/opt/diva-embedded/assets";
const MED_CONFIG_PATH = "/opt/diva-embedded/data/medications.json";
const MED_LOG_PATH = "/opt/diva-embedded/data/medication-log.json";
const pendingReminders = new Map();
let checkInterval = null;
function loadConfig() {
    try {
        if (existsSync(MED_CONFIG_PATH)) {
            return JSON.parse(readFileSync(MED_CONFIG_PATH, "utf-8"));
        }
    }
    catch { }
    return [];
}
function loadLog() {
    try {
        if (existsSync(MED_LOG_PATH)) {
            return JSON.parse(readFileSync(MED_LOG_PATH, "utf-8"));
        }
    }
    catch { }
    return [];
}
function saveLog(entries) {
    // Keep last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const filtered = entries.filter((e) => new Date(e.date) >= cutoff);
    writeFileSync(MED_LOG_PATH, JSON.stringify(filtered, null, 2));
}
function logMedication(medicationId, scheduledTime, status, confirmedAt) {
    const log = loadLog();
    log.push({
        medicationId,
        scheduledTime,
        status,
        confirmedAt,
        date: new Date().toISOString().slice(0, 10),
    });
    saveLog(log);
}
async function speakProactive(text) {
    try {
        await playAudioFile(`${ASSETS_DIR}/oui.wav`);
        const wav = await synthesize(text);
        await playAudioBytes(wav.toString("base64"));
    }
    catch (err) {
        console.error("[MED] TTS error:", err);
    }
}
async function listenForConfirmation() {
    try {
        const recorded = await recordAudio({ maxDurationS: 5, silenceTimeoutS: 2 });
        if (!recorded.has_speech || !recorded.wav_base64)
            return false;
        const wav = Buffer.from(recorded.wav_base64, "base64");
        const text = await transcribeLocal(wav);
        const lower = text.toLowerCase();
        // Confirmation patterns
        return /oui|ok|c.est fait|pris|j.ai pris|fait|d.accord|confirm/i.test(lower);
    }
    catch {
        return false;
    }
}
async function deliverReminder(reminder) {
    if (isAudioBusy()) {
        console.log("[MED] Audio busy, will retry next tick");
        return;
    }
    const config = reminder.config;
    const name = config.name;
    const message = config.message || `C'est l'heure de prendre votre ${name}.`;
    console.log(`[MED] Delivering reminder: ${name}`);
    await speakProactive(message);
    // Wait for confirmation
    await speakProactive("Dites oui quand c'est fait.");
    const confirmed = await listenForConfirmation();
    if (confirmed) {
        console.log(`[MED] Confirmed: ${name}`);
        await speakProactive("Tres bien, c'est note !");
        logMedication(config.id, reminder.scheduledTime, "taken", new Date().toISOString());
        pendingReminders.delete(config.id);
    }
    else {
        console.log(`[MED] No confirmation for ${name}`);
        // Will be re-checked by the interval
    }
}
function getCurrentTimeHHMM() {
    return new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris", hour12: false,
    });
}
async function checkReminders() {
    const configs = loadConfig();
    const now = getCurrentTimeHHMM();
    // Check for new reminders to trigger
    for (const config of configs) {
        if (!config.enabled)
            continue;
        for (const schedTime of config.schedule) {
            if (schedTime === now && !pendingReminders.has(config.id)) {
                // Time to remind!
                const reminder = {
                    config,
                    scheduledTime: schedTime,
                    firstReminderAt: Date.now(),
                    reReminderSent: false,
                    alertSent: false,
                };
                pendingReminders.set(config.id, reminder);
                await deliverReminder(reminder);
            }
        }
    }
    // Check pending reminders for escalation
    for (const [id, reminder] of pendingReminders) {
        const elapsedMin = (Date.now() - reminder.firstReminderAt) / 60000;
        if (elapsedMin >= 30 && !reminder.alertSent) {
            // 30min: alert caregiver
            console.log(`[MED] 30min passed — alerting caregiver for ${reminder.config.name}`);
            await sendMedicationAlert(reminder.config.personaId, reminder.config.name);
            logMedication(reminder.config.id, reminder.scheduledTime, "missed");
            reminder.alertSent = true;
            pendingReminders.delete(id);
        }
        else if (elapsedMin >= 15 && !reminder.reReminderSent) {
            // 15min: re-remind
            console.log(`[MED] 15min passed — re-reminding for ${reminder.config.name}`);
            await speakProactive(`Petit rappel : n'oubliez pas votre ${reminder.config.name}.`);
            const confirmed = await listenForConfirmation();
            if (confirmed) {
                await speakProactive("Parfait, c'est note !");
                logMedication(reminder.config.id, reminder.scheduledTime, "taken", new Date().toISOString());
                pendingReminders.delete(id);
            }
            reminder.reReminderSent = true;
        }
    }
}
export function startMedicationScheduler() {
    const configs = loadConfig();
    if (configs.length === 0) {
        console.log("[MED] No medications configured");
        return;
    }
    console.log(`[MED] Scheduler started with ${configs.length} medication(s)`);
    // Check every minute
    checkInterval = setInterval(() => {
        checkReminders().catch((err) => console.error("[MED] Check error:", err));
    }, 60000);
    checkInterval.unref();
}
export function stopMedicationScheduler() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}
export function getMedicationLog(days = 7) {
    const log = loadLog();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return log.filter((e) => new Date(e.date) >= cutoff);
}
export function getComplianceRate(days = 7) {
    const log = getMedicationLog(days);
    if (log.length === 0)
        return 100;
    const taken = log.filter((e) => e.status === "taken").length;
    return Math.round((taken / log.length) * 100);
}
//# sourceMappingURL=medication-manager.js.map