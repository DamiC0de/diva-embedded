/**
 * Medication Reminder Manager
 * - Recurring reminders with voice confirmation
 * - Escalation: re-remind at 15min, caregiver alert at 30min
 * - Compliance tracking for dashboard
 */
export interface MedicationConfig {
    id: string;
    personaId: string;
    name: string;
    schedule: string[];
    message: string;
    enabled: boolean;
}
export interface MedicationLogEntry {
    medicationId: string;
    scheduledTime: string;
    status: "taken" | "missed" | "pending";
    confirmedAt?: string;
    date: string;
}
export declare function startMedicationScheduler(): void;
export declare function stopMedicationScheduler(): void;
export declare function getMedicationLog(days?: number): MedicationLogEntry[];
export declare function getComplianceRate(days?: number): number;
//# sourceMappingURL=medication-manager.d.ts.map