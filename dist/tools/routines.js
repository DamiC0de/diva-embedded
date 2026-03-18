/**
 * Vocal Routines — named sequences of actions
 * "Diva, routine dodo" → sequence of actions
 * Config stored in JSON. Editable in dashboard.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { playRadio, stopRadio, setVolume } from "./radio.js";
import { startTimer } from "./timer-manager.js";
import { enableDND } from "./dnd-manager.js";
const ROUTINES_PATH = "/opt/diva-embedded/data/routines.json";
function loadRoutines() {
    try {
        if (existsSync(ROUTINES_PATH)) {
            return JSON.parse(readFileSync(ROUTINES_PATH, "utf-8"));
        }
    }
    catch { }
    // Create default routines
    const defaults = [
        {
            name: "dodo",
            triggerPhrases: ["routine dodo", "routine nuit", "routine bonne nuit"],
            description: "Routine du coucher : baisse volume, lance musique douce, active mode nuit",
            actions: [
                { type: "speak", params: { text: "Bonne nuit ! Je lance la routine dodo." } },
                { type: "volume", params: { level: "30" } },
                { type: "radio_play", params: { station: "classique" } },
                { type: "dnd", params: { durationMin: 480 } },
            ],
        },
        {
            name: "reveil",
            triggerPhrases: ["routine reveil", "routine matin", "routine bonjour"],
            description: "Routine du matin : desactive mode nuit, lance briefing",
            actions: [
                { type: "speak", params: { text: "Bonjour ! Je lance la routine reveil." } },
                { type: "radio_stop", params: {} },
                { type: "volume", params: { level: "60" } },
            ],
        },
        {
            name: "concentration",
            triggerPhrases: ["routine concentration", "routine travail", "routine focus"],
            description: "Mode concentration : musique douce, mode DND 2h",
            actions: [
                { type: "speak", params: { text: "Mode concentration active." } },
                { type: "volume", params: { level: "20" } },
                { type: "radio_play", params: { station: "jazz" } },
                { type: "dnd", params: { durationMin: 120 } },
            ],
        },
    ];
    writeFileSync(ROUTINES_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
}
export function findRoutine(text) {
    const routines = loadRoutines();
    const lower = text.toLowerCase();
    for (const routine of routines) {
        for (const trigger of routine.triggerPhrases) {
            if (lower.includes(trigger)) {
                return routine;
            }
        }
        // Also match by name
        if (lower.includes(`routine ${routine.name}`)) {
            return routine;
        }
    }
    return null;
}
export async function executeRoutine(routine) {
    const results = [];
    console.log(`[ROUTINE] Executing: ${routine.name} (${routine.actions.length} actions)`);
    for (const action of routine.actions) {
        try {
            switch (action.type) {
                case "speak":
                    results.push(String(action.params.text || ""));
                    break;
                case "radio_play":
                    results.push(playRadio(String(action.params.station || "")));
                    break;
                case "radio_stop":
                    results.push(stopRadio());
                    break;
                case "volume":
                    results.push(setVolume(`${action.params.level}%`));
                    break;
                case "timer":
                    startTimer(Number(action.params.durationMs || 60000), String(action.params.label || "routine"), String(action.params.message || ""));
                    results.push(`Minuteur lance.`);
                    break;
                case "dnd":
                    enableDND(Number(action.params.durationMin || 60) * 60 * 1000);
                    results.push("Mode ne pas deranger active.");
                    break;
                case "wait":
                    await new Promise((r) => setTimeout(r, Number(action.params.ms || 1000)));
                    break;
            }
        }
        catch (err) {
            console.error(`[ROUTINE] Action ${action.type} failed:`, err);
        }
    }
    return results;
}
export function listRoutines() {
    const routines = loadRoutines();
    if (routines.length === 0)
        return "Aucune routine configuree.";
    return `Routines disponibles : ${routines.map((r) => r.name).join(", ")}.`;
}
export function getRoutinesForDashboard() {
    return loadRoutines();
}
//# sourceMappingURL=routines.js.map