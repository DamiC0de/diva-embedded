/**
 * Message Sender — Email (SMTP) + SMS (Free Mobile API)
 * Features: #7 (messagerie sortante), #16 (résumé parental)
 */

import { getNetworkStatus } from "../resilience/network-detector.js";
import { enqueueAction } from "../resilience/offline-queue.js";
import { log } from "../monitoring/logger.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CONFIG_PATH = "/opt/diva-embedded/data/messaging/config.json";

interface Contact {
  name: string;
  email?: string;
  phone?: string;      // for SMS
  relation?: string;   // "fils", "fille", "aidant", etc.
}

interface MessagingConfig {
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  freeSms?: {
    user: string;      // Free Mobile user ID
    pass: string;      // Free Mobile API key
  };
  contacts: Contact[];
}

function loadConfig(): MessagingConfig | null {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {}
  return null;
}

export function saveConfig(config: MessagingConfig): void {
  const dir = "/opt/diva-embedded/data/messaging";
  if (!existsSync(dir)) {
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function isConfigured(): boolean { return loadConfig() !== null; }

export function getContacts(): Contact[] {
  return loadConfig()?.contacts || [];
}

function findContact(nameOrRelation: string): Contact | null {
  const config = loadConfig();
  if (!config) return null;
  const lower = nameOrRelation.toLowerCase();
  return config.contacts.find(c =>
    c.name.toLowerCase().includes(lower) ||
    (c.relation && c.relation.toLowerCase().includes(lower))
  ) || null;
}

// =====================================================================
// Email via SMTP
// =====================================================================

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const config = loadConfig();
  if (!config?.smtp) return false;

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });

    await transporter.sendMail({
      from: `"Diva" <${config.smtp.from || config.smtp.user}>`,
      to,
      subject,
      text: body,
    });
    console.log(`[MSG] Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error("[MSG] Email error:", err);
    return false;
  }
}

// =====================================================================
// SMS via Free Mobile API
// =====================================================================

async function sendFreeSms(message: string): Promise<boolean> {
  const config = loadConfig();
  if (!config?.freeSms) return false;

  try {
    const params = new URLSearchParams({
      user: config.freeSms.user,
      pass: config.freeSms.pass,
      msg: message,
    });
    const res = await fetch(`https://smsapi.free-mobile.fr/sendmsg?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[MSG] SMS sent: ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[MSG] SMS error:", err);
    return false;
  }
}

// =====================================================================
// Claude tool handler
// =====================================================================

export async function handleMessageTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "send").toLowerCase();
  const to = input.to || "";
  const message = input.message || "";
  const method = (input.method || "auto").toLowerCase();

  // Story 10.7: Queue messages when offline
  if (action === "send" && !getNetworkStatus()) {
    enqueueAction("send_message", { to, message, method }, "");
    log.info("Message queued for offline replay", { to });
    return "C'est note, je l'enverrai des que j'aurai internet.";
  }

  if (action === "contacts" || action === "list") {
    const contacts = getContacts();
    if (contacts.length === 0) return "Aucun contact configure. Configure-les dans le dashboard.";
    return "Contacts : " + contacts.map(c => `${c.name}${c.relation ? ` (${c.relation})` : ""}`).join(", ") + ".";
  }

  if (!to || !message) return "Il me faut un destinataire et un message.";

  const contact = findContact(to);
  if (!contact) return `Je ne trouve pas de contact "${to}". Configure les contacts dans le dashboard.`;

  // Choose method
  if (method === "email" || (method === "auto" && contact.email)) {
    if (!contact.email) return `Pas d'email pour ${contact.name}.`;
    const ok = await sendEmail(contact.email, `Message de Diva`, `${message}\n\n— Envoyé par Diva`);
    return ok ? `Message envoye par email a ${contact.name}.` : `Erreur d'envoi a ${contact.name}.`;
  }

  if (method === "sms" || (method === "auto" && !contact.email)) {
    const ok = await sendFreeSms(`[Diva] Pour ${contact.name}: ${message}`);
    return ok ? `SMS envoye.` : `Erreur d'envoi SMS.`;
  }

  return `Impossible d'envoyer le message a ${contact.name}. Verifie la configuration.`;
}
