/**
 * One path from an agent to the admin.
 *
 * Live desk events go out on the /ops socket. Urgent items also go to the
 * admin WhatsApp, with a three-second cap. The approval itself stays a row
 * in pending_agent_actions until someone resolves it.
 */

import { config } from "../config.js";
import { getOrder } from "../services/orders.js";
import { orderBuyerTotal } from "../services/shipping-tiers.js";
import { platformState } from "./platform-state.js";
import { emitOpsEvent } from "./ops-desk.js";
import { sanitizeOutboundAgentText } from "./output-guard.js";

export const HIGH_VALUE_KES = 5000;
export const MEMORY_ALERT_GAP_MS = 20 * 60 * 1000;
export const SECURITY_ALERTS_PER_HOUR = 6;

let lastMemoryAt = 0;
let securityTimes = [];
const seenSecurity = new Set();

export function resetNotifierForTests() {
  lastMemoryAt = 0;
  securityTimes = [];
  seenSecurity.clear();
}

/** Amount on the order, never a figure an agent typed into the proposal. */
export function orderAmountKes(orderId) {
  try {
    const order = getOrder(orderId);
    if (!order) return null;
    const amount = Number(orderBuyerTotal(order));
    return Number.isFinite(amount) ? amount : null;
  } catch {
    return null;
  }
}

export async function sendAdminWhatsApp(text, { send = null, phone = config.admin.primary } = {}) {
  if (!text) return false;
  const dest = phone || (send ? "admin" : "");
  if (!dest) return false;
  const clean = sanitizeOutboundAgentText(String(text), { mpesaReceipts: [] });
  try {
    if (send) {
      await send(dest, clean);
      return true;
    }
    const { sendText } = await import("../services/whatsapp.js");
    await sendText(phone, clean, { timeoutMs: 3000 });
    return true;
  } catch (err) {
    console.warn("[admin-notifier] WhatsApp skipped:", err?.message || err);
    return false;
  }
}

export async function notifyProposedAction(action, { send = null, amountKes } = {}) {
  if (!action?.id) return { socket: false, whatsapp: false };
  const amount = amountKes !== undefined ? amountKes : orderAmountKes(action.orderId);
  const socket = emitOpsEvent("ACTION_REQUIRED", {
    actionId: action.id,
    actionType: action.actionType,
    orderId: action.orderId,
    amountKes: amount,
    urgencyReason: String(action.reason || "").slice(0, 280),
  });
  const snap = platformState.getSnapshot();
  emitOpsEvent("PLATFORM_PULSE", {
    metrics: snap,
    global: { heapUsedMB: snap.heapUsedMb },
  });
  if (!(amount >= HIGH_VALUE_KES)) return { socket, whatsapp: false };
  const kes = Math.round(amount).toLocaleString("en-KE");
  const text =
    `🚨 *HIGH-VALUE APPROVAL REQUIRED*\n` +
    `Type: ${action.actionType}\n` +
    `Order: ${action.orderId}\n` +
    `Amount: KES ${kes}\n` +
    `Reason: ${action.reason || "Needs a decision"}\n` +
    `Reply *A ${action.id}* to approve or *R ${action.id}* to reject.`;
  const whatsapp = await sendAdminWhatsApp(text, { send });
  return { socket, whatsapp };
}

export async function notifySecurityFlag(
  { flaggedId, violationType, senderUserId, snippet } = {},
  { send = null, now = () => Date.now() } = {}
) {
  const short = String(snippet || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const socket = emitOpsEvent("SECURITY_FLAG", {
    flaggedId: flaggedId ?? null,
    violationType: String(violationType || "UNKNOWN").slice(0, 40),
    senderUserId: senderUserId ?? null,
    snippet: short,
  });
  const id = flaggedId == null ? null : String(flaggedId);
  if (id && seenSecurity.has(id)) return { socket, whatsapp: false, reason: "duplicate" };
  const t = now();
  securityTimes = securityTimes.filter((ts) => t - ts < 60 * 60 * 1000);
  if (securityTimes.length >= SECURITY_ALERTS_PER_HOUR) {
    return { socket, whatsapp: false, reason: "rate_limited" };
  }
  if (id) {
    seenSecurity.add(id);
    if (seenSecurity.size > 200) seenSecurity.clear();
  }
  securityTimes.push(t);
  const text =
    `🛡️ *SECURITY VIOLATION DETECTED*\n` +
    `User #${senderUserId ?? "unknown"}\n` +
    `Type: ${violationType || "UNKNOWN"}\n` +
    (short ? `Content: "${short}"\n` : "") +
    `Flag #${flaggedId ?? "—"}.`;
  const whatsapp = await sendAdminWhatsApp(text, { send });
  return { socket, whatsapp };
}

export async function notifyMemorySpike(heapUsedMb, { send = null, now = () => Date.now() } = {}) {
  const mb = Number(heapUsedMb);
  const shown = Number.isFinite(mb) ? Math.round(mb) : null;
  const socket = emitOpsEvent("SYSTEM_HEALTH_ALERT", {
    level: "CRITICAL",
    heapUsedMB: shown,
    actionTaken: "Cleared expired media and ran garbage collection",
  });
  const snap = platformState.getSnapshot();
  emitOpsEvent("PLATFORM_PULSE", { metrics: snap, global: { heapUsedMB: snap.heapUsedMb } });
  const t = now();
  if (lastMemoryAt && t - lastMemoryAt < MEMORY_ALERT_GAP_MS) {
    return { socket, whatsapp: false, reason: "rate_limited" };
  }
  lastMemoryAt = t;
  const text = `⚠️ *SOKONI MEMORY SPIKE*: Heap used ${shown ?? "high"}MB / 450MB. Expired caches were cleared.`;
  const whatsapp = await sendAdminWhatsApp(text, { send });
  return { socket, whatsapp };
}
