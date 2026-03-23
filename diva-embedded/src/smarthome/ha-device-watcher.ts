/**
 * HA Device Watcher — Story 13.2 (Task 5)
 * Polls HA API periodically to detect new discovery flows.
 * Announces new devices proactively, respecting attention budget.
 */

import { callHA, isHAAvailable } from "./ha-connector.js";
import { createLogger } from "../monitoring/logger.js";
import { type DiscoveredDevice, type DeviceType, DOMAIN_TO_TYPE, TYPE_LABELS_FR } from "./ha-discovery.js";

const logger = createLogger("smarthome");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REMINDER_PER_DAY = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingDevice {
  flowId: string;
  handler: string;
  detectedAt: number;
  announced: boolean;
  declined: boolean;
  lastReminderDate?: string; // ISO date (YYYY-MM-DD)
}

export interface WatcherEvent {
  type: "new_device";
  flowId: string;
  handler: string;
  detectedAt: number;
}

// ---------------------------------------------------------------------------
// HADeviceWatcher class
// ---------------------------------------------------------------------------

export class HADeviceWatcher {
  private knownFlowIds = new Set<string>();
  private pendingDevices = new Map<string, PendingDevice>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onNewDevice: ((event: WatcherEvent) => void) | null = null;

  /**
   * Set callback for new device detection.
   */
  setNewDeviceCallback(cb: (event: WatcherEvent) => void): void {
    this.onNewDevice = cb;
  }

  /**
   * Start polling HA for new discovery flows.
   */
  start(intervalMs: number = POLL_INTERVAL_MS): void {
    if (this.pollTimer) return; // Already running

    logger.info("Device watcher started", { intervalMs: String(intervalMs) });

    // Initial poll
    this.poll().catch(err => {
      logger.warn("Initial device watcher poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    this.pollTimer = setInterval(() => {
      this.poll().catch(err => {
        logger.warn("Device watcher poll failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);

    // Don't prevent Node.js from exiting
    this.pollTimer.unref();
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info("Device watcher stopped");
    }
  }

  /**
   * Poll HA for discovery flows and detect new ones.
   */
  async poll(): Promise<WatcherEvent[]> {
    if (!isHAAvailable()) {
      logger.debug("HA not available, skipping device watcher poll");
      return [];
    }

    const events: WatcherEvent[] = [];

    try {
      // HA REST API uses /config/config_entries/flow/progress for listing active flows
      const flows = await callHA("config/config_entries/flow/progress", "GET") as Array<{
        flow_id: string;
        handler: string;
        context?: Record<string, unknown>;
      }>;

      for (const flow of flows) {
        if (!this.knownFlowIds.has(flow.flow_id)) {
          this.knownFlowIds.add(flow.flow_id);

          const event: WatcherEvent = {
            type: "new_device",
            flowId: flow.flow_id,
            handler: flow.handler,
            detectedAt: Date.now(),
          };

          this.pendingDevices.set(flow.flow_id, {
            flowId: flow.flow_id,
            handler: flow.handler,
            detectedAt: Date.now(),
            announced: false,
            declined: false,
          });

          events.push(event);

          logger.info("New discovery flow detected", {
            flowId: flow.flow_id,
            handler: flow.handler,
          });

          // Notify callback
          if (this.onNewDevice) {
            this.onNewDevice(event);
          }
        }
      }
    } catch (err) {
      // Silently ignore 404/405 — endpoint may not exist in this HA version
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404") && !msg.includes("405")) {
        logger.warn("Device watcher poll error", { error: msg });
      }
    }

    return events;
  }

  /**
   * Get unconfigured devices list (pending devices not yet configured).
   */
  getUnconfiguredDevices(): PendingDevice[] {
    return Array.from(this.pendingDevices.values()).filter(d => !d.declined);
  }

  /**
   * Mark a device as announced (proactive message sent).
   */
  markAnnounced(flowId: string): void {
    const device = this.pendingDevices.get(flowId);
    if (device) {
      device.announced = true;
    }
  }

  /**
   * Mark a device as declined by the user.
   */
  markDeclined(flowId: string): void {
    const device = this.pendingDevices.get(flowId);
    if (device) {
      device.declined = true;
    }
  }

  /**
   * Check if a reminder should be sent for a pending device.
   * AC6: max 1 reminder per day.
   */
  shouldRemind(flowId: string): boolean {
    const device = this.pendingDevices.get(flowId);
    if (!device || device.declined) return false;

    const today = new Date().toISOString().slice(0, 10);
    if (device.lastReminderDate === today) return false;

    return true;
  }

  /**
   * Record that a reminder was sent.
   */
  recordReminder(flowId: string): void {
    const device = this.pendingDevices.get(flowId);
    if (device) {
      device.lastReminderDate = new Date().toISOString().slice(0, 10);
    }
  }

  /**
   * Remove a flow from pending (configured successfully).
   */
  removeFromPending(flowId: string): void {
    this.pendingDevices.delete(flowId);
  }

  /**
   * Get count of known flows (for testing).
   */
  getKnownFlowCount(): number {
    return this.knownFlowIds.size;
  }

  /**
   * Reset state (for testing).
   */
  reset(): void {
    this.stop();
    this.knownFlowIds.clear();
    this.pendingDevices.clear();
    this.onNewDevice = null;
  }
}
