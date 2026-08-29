/**
 * Numbered dispute action cards for admin WhatsApp (text menus — no WAHA buttons).
 */
import { setMenuState, getMenuState, clearMenuState } from "./session.js";
import { getOrder } from "./orders.js";
import { releaseEscrowOrder, refundEscrowOrder } from "./platform-command.js";
import { resolveStaffRole, staffCan } from "./staff-roles.js";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function sessionKeyFromPhone(phoneOrChat) {
  const raw = String(phoneOrChat || "").trim();
  if (raw.includes("@")) return raw;
  const d = digitsOnly(raw);
  return d ? `${d}@c.us` : "";
}

export function formatDisputeActionCard({
  orderId,
  disputeId = null,
  buyerPhone = "",
  sellerPhone = "",
  amountKes = 0,
  issueType = "dispute",
} = {}) {
  const amount = Math.round(Number(amountKes) || 0);
  return (
    `🚨 *DISPUTE ALERT: ${orderId || "—"}*\n` +
    (disputeId ? `• Ticket: #${disputeId}\n` : "") +
    `• Buyer: ${buyerPhone || "—"}${issueType ? ` (${issueType})` : ""}\n` +
    `• Seller: ${sellerPhone || "—"}\n` +
    `• Value: KES ${amount.toLocaleString()} held in Escrow\n\n` +
    `Tap an action below to override:\n` +
    `*1* Refund Buyer\n` +
    `*2* Release to Seller\n` +
    `*3* Split 50/50 (ops note — complete in portal)\n` +
    `*4* Open portal only\n\n` +
    `_Reply with 1, 2, 3, or 4._`
  );
}

/** Persist pending action menu on the admin chat. */
export function armDisputeAdminMenu(adminChatId, payload = {}) {
  const key = sessionKeyFromPhone(adminChatId);
  if (!key) return;
  setMenuState(key, {
    type: "dispute_admin_actions",
    orderId: payload.orderId || null,
    disputeId: payload.disputeId || null,
    amountKes: Number(payload.amountKes) || 0,
    at: Date.now(),
  });
}

/**
 * Handle admin reply 1–4 for armed dispute card.
 * @returns {Promise<{ handled: boolean, reply?: string }>}
 */
export async function tryHandleDisputeAdminChoice(adminChatId, text, { phone = "" } = {}) {
  const key = sessionKeyFromPhone(adminChatId);
  const menu = getMenuState(key);
  if (!menu || menu.type !== "dispute_admin_actions") return { handled: false };

  const choice = String(text || "").trim();
  if (!/^[1-4]$/.test(choice)) return { handled: false };

  const staff = await resolveStaffRole(phone || digitsOnly(adminChatId));
  const amountKes = Number(menu.amountKes) || 0;
  if (!staff || !staffCan("dispute_action", staff, { amountKes })) {
    return {
      handled: true,
      reply:
        "⛔ This dispute action needs DISPUTE_MANAGER (within cap) or SUPER_ADMIN.\n" +
        "Escalate to the Boss if you're Support/Logistics.",
    };
  }

  const orderId = menu.orderId;
  clearMenuState(key);

  if (choice === "4") {
    return {
      handled: true,
      reply: `🖥️ Open Disputes: https://sokonimall.com/admin-disputes.html\nOrder *${orderId || "—"}*`,
    };
  }

  if (choice === "3") {
    return {
      handled: true,
      reply:
        `📝 Split 50/50 noted for *${orderId}*.\n` +
        `Complete the split refund/release in the Admin Portal (no auto half-B2C yet).`,
    };
  }

  if (choice === "1") {
    const result = refundEscrowOrder(orderId, {
      reason: "Admin dispute card: Refund Buyer",
      adminLabel: phone || "dispute-card",
    });
    if (result?.error) {
      return { handled: true, reply: `Could not refund *${orderId}*: ${result.message || result.error}` };
    }
    return {
      handled: true,
      reply: `🫡 Refund path marked for *${orderId}*.\n${result.message || "Buyer refund workflow started."}`,
    };
  }

  if (choice === "2") {
    const result = releaseEscrowOrder(orderId, {
      reason: "Admin dispute card: Release to Seller",
      adminLabel: phone || "dispute-card",
    });
    if (result?.error) {
      return { handled: true, reply: `Could not release *${orderId}*: ${result.message || result.error}` };
    }
    return {
      handled: true,
      reply: `🫡 Released escrow for *${orderId}* toward seller.\n${result.message || "Payout rail unlocked."}`,
    };
  }

  return { handled: false };
}

/** Append action card + arm menu for each admin after base alert. */
export async function sendDisputeActionCardsToAdmins(admins, cardPayload) {
  const { sendTextReliable } = await import("./whatsapp.js");
  const card = formatDisputeActionCard(cardPayload);
  for (const admin of admins) {
    try {
      await sendTextReliable(admin, card, { label: "DisputeActionCard" });
      armDisputeAdminMenu(admin, cardPayload);
    } catch (err) {
      console.warn("[dispute-actions] card send failed:", err.message);
    }
  }
}
