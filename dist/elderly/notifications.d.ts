/**
 * Caregiver Notification Service
 * Sends alerts via Ntfy (push notifications) — free, self-hostable
 */
export type AlertPriority = "urgent" | "high" | "default" | "low";
export declare function sendCaregiverAlert(title: string, message: string, priority?: AlertPriority, tags?: string[]): Promise<boolean>;
export declare function sendMedicationAlert(personName: string, medication: string): Promise<void>;
export declare function sendDistressAlert(personName: string, message: string): Promise<void>;
export declare function sendDailySummary(personName: string, summary: string): Promise<void>;
//# sourceMappingURL=notifications.d.ts.map