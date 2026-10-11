/**
 * Official WhatsApp Channel invites. Users must tap the link — WhatsApp
 * blocks force-adding people to Channels. Event-driven + ops tool.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { sendText, toChatId } from "./whatsapp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_PATH = path.join(DATA_DIR, "channel-invites.json");

export const CHANNEL_INVITE_URL =
  String(config.waha?.channelInviteUrl || "https://whatsapp.com/channel/0029VbE5SoTGJP8FzgHwmU2Q").trim();

const EVENT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const TOOL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_INVITE_REASONS = Object.freeze(["onboarding", "purchase", "lead", "tool"]);

const REASON_COPY = {
  onboarding:
    "Karibu Sokoni Mall. Join the official Channel for seller and rider updates plus today's picks:",
  purchase:
    "Thanks for shopping thrift. We post new items in the Channel first. Catch the next drop here:",
  lead: "Still browsing? We post new arrivals in the official Channel every day:",
  tool: "Join the official Sokoni Channel for new arrivals:",
};

function loadStore() {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function normalizeReason(raw) {
  const key = String(raw || "tool")
    .trim()
    .toLowerCase();
  if (key === "seller" || key === "rider") return "onboarding";
  if (key === "buyer" || key === "completed" || key === "escrow") return "purchase";
  if (key === "new-lead" || key === "hot-lead" || key === "crm") return "lead";
  return CHANNEL_INVITE_REASONS.includes(key) ? key : "tool";
}

export function channelInviteBody({ context, reason } = {}) {
  const intro = String(context || "").trim() || REASON_COPY[normalizeReason(reason)] || REASON_COPY.tool;
  return `${intro}\n${CHANNEL_INVITE_URL}`;
}

export function lastChannelInviteAt(phone, reason) {
  const digits = normalizeKenyaPhone(phone);
  if (!digits) return 0;
  const row = loadStore()[digits] || {};
  return Number(row[normalizeReason(reason)] || 0) || 0;
}

function cooldownMs(reason) {
  return normalizeReason(reason) === "tool" ? TOOL_COOLDOWN_MS : EVENT_COOLDOWN_MS;
}

export function shouldSendChannelInvite(phone, reason, now = Date.now()) {
  const last = lastChannelInviteAt(phone, reason);
  if (!last) return true;
  return now - last >= cooldownMs(reason);
}

function recordInvite(phone, reason, now) {
  const store = loadStore();
  const prev = store[phone] || {};
  store[phone] = { ...prev, [reason]: now };
  saveStore(store);
}

async function isOptedOut(phone) {
  try {
    const { getCrmContact } = await import("./whatsapp-crm.js");
    const contact = getCrmContact(`${phone}@c.us`) || getCrmContact(phone);
    const tags = Array.isArray(contact?.tags) ? contact.tags : [];
    return tags.includes("opt-out");
  } catch {
    return false;
  }
}

export async function sendChannelInvite(
  { phone_number, phone, context, reason } = {},
  extras = {}
) {
  const digits = normalizeKenyaPhone(phone_number || phone);
  const why = normalizeReason(reason);
  if (!digits) {
    return { ok: false, error: "invalid_phone", tool: "send_channel_invite", message: "Need a Kenya phone (254…)." };
  }
  if (await isOptedOut(digits)) {
    return { ok: false, error: "opted_out", tool: "send_channel_invite", phone: digits, skipped: true };
  }
  const now = extras.now || Date.now();
  if (extras.force !== true && !shouldSendChannelInvite(digits, why, now)) {
    return {
      ok: true,
      skipped: true,
      tool: "send_channel_invite",
      phone: digits,
      reason: why,
      message: "Invite already sent for this milestone.",
    };
  }
  const body = channelInviteBody({ context, reason: why });
  if (/\b(till|paybill|business\s*number)\b/i.test(body)) {
    return { ok: false, error: "no_till", tool: "send_channel_invite", message: "Do not send till or paybill numbers." };
  }
  if (extras.dryRun === true || !config.waha?.apiUrl) {
    if (extras.dryRun === true) recordInvite(digits, why, now);
    return {
      ok: true,
      dryRun: true,
      tool: "send_channel_invite",
      phone: digits,
      reason: why,
      text: body,
      inviteUrl: CHANNEL_INVITE_URL,
    };
  }
  const send = extras.sender || sendText;
  await send(toChatId(digits), body);
  recordInvite(digits, why, now);
  return {
    ok: true,
    tool: "send_channel_invite",
    phone: digits,
    reason: why,
    text: body,
    inviteUrl: CHANNEL_INVITE_URL,
  };
}

/** Fire-and-forget from onboarding / escrow / CRM. Never throws. */
export function queueChannelInvite(phone, reason, extras = {}) {
  void sendChannelInvite({ phone_number: phone, reason }, extras).catch((err) =>
    console.warn("[channel-invite]", reason, err?.message || err)
  );
}
