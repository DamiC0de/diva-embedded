/**
 * Caregiver Notification Service
 * Sends alerts via Ntfy (push notifications) — free, self-hostable
 */

const NTFY_URL = process.env.NTFY_URL ?? "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "diva-alerts";

export type AlertPriority = "urgent" | "high" | "default" | "low";

export async function sendCaregiverAlert(
  title: string,
  message: string,
  priority: AlertPriority = "default",
  tags: string[] = []
): Promise<boolean> {
  try {
    const ntfyPriority = priority === "urgent" ? "5" : priority === "high" ? "4" : priority === "low" ? "2" : "3";

    const res = await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        "Title": title,
        "Priority": ntfyPriority,
        "Tags": tags.join(","),
      },
      body: message,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      console.log(`[NOTIFY] Sent: "${title}" (${priority})`);
      return true;
    }
    console.warn(`[NOTIFY] Failed: HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.error(`[NOTIFY] Error:`, err);
    return false;
  }
}

export async function sendMedicationAlert(personName: string, medication: string): Promise<void> {
  await sendCaregiverAlert(
    `Medicament non pris - ${personName}`,
    `${personName} n'a pas confirme la prise de ${medication} apres 30 minutes.`,
    "urgent",
    ["pill", "warning"]
  );
}

export async function sendDistressAlert(personName: string, message: string): Promise<void> {
  await sendCaregiverAlert(
    `ALERTE URGENTE - ${personName}`,
    `${personName} a besoin d'aide: "${message}"`,
    "urgent",
    ["rotating_light", "sos"]
  );
}

export async function sendDailySummary(personName: string, summary: string): Promise<void> {
  await sendCaregiverAlert(
    `Resume quotidien - ${personName}`,
    summary,
    "low",
    ["clipboard", "memo"]
  );
}
