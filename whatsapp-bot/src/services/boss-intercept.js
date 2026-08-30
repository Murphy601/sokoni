/**
 * Code-level Boss interceptor — runs BEFORE any LLM / RAG path.
 *
 * Founder Boss (757764009) only: "Yes, Boss" PING + full master palette.
 * Staff (ADMIN_PHONES): can run RBAC-gated master commands — no Boss salute.
 * Everyone else: admin-looking keywords → generic shopping reply (zero leak).
 */
import { config } from "../config.js";
import { checkIfBoss, isFounderBossPhone } from "../lib/phone-normalize.js";
import { isAdminSender, requireAdminSender, tryRegisterAdminFromMessage } from "./admin.js";

/** Generic shopper reply — never mention admin / Boss / override palette. */
export const PUBLIC_SHOP_REPLY =
  "Karibu Sokoni! Type *menu* to shop, *track* for your order, or ask about a product. WhatsApp support is here to help.";

/**
 * Keywords that must never reach the public LLM (zero information leak).
 */
export function looksLikeAdminProbe(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^\s*ping\s*$/i.test(t)) return true;
  if (/^\s*OVERRIDE\s*:/i.test(t)) return true;
  if (/^\s*![a-z][\w-]*/i.test(t)) return true;
  if (/^\s*FORCE(_|\s+)(RELEASE|PAYOUT|RETURN)\b/i.test(t)) return true;
  if (/^\s*RELEASE\s+PAYOUT\b/i.test(t)) return true;
  if (/^\s*REFUND\s+BUYER\b/i.test(t)) return true;
  if (/^\s*REFUND\s+DISPUTE\b/i.test(t)) return true;
  if (/^\s*SPLIT\s+ESCROW\b/i.test(t)) return true;
  if (/^\s*PAUSE\s+(SELLER|BUYER|BOT|PAYOUTS?|SHOP|RIDER)\b/i.test(t)) return true;
  if (/^\s*UNPAUSE\s+(SELLER|BUYER|SHOP|RIDER)\b/i.test(t)) return true;
  if (/^\s*DEACTIVATE\s+(SELLER|SHOP)\b/i.test(t)) return true;
  if (/^\s*ACTIVATE\s+(SELLER|SHOP)\b/i.test(t)) return true;
  if (/^\s*BROADCAST\s+(SELLERS?|RIDERS?|BUYERS?|CUSTOMERS?)\b/i.test(t)) return true;
  if (/^\s*MUTE\s+BUYER\b/i.test(t)) return true;
  if (/^\s*FREEZE\s+WALLET\b/i.test(t)) return true;
  if (/^\s*SYSTEM\s+(PAUSE|RESUME|LOCKDOWN)\b/i.test(t)) return true;
  if (/^\s*(SET|OVERRIDE)\s+RATINGS?\b/i.test(t)) return true;
  if (/^\s*PURGE\s+RATING\b/i.test(t)) return true;
  if (/^\s*PENALIZE\b/i.test(t)) return true;
  if (/^\s*VERIFY\s+(SHOP|STORE)\b/i.test(t)) return true;
  if (/^\s*SUSPEND\s+(SHOP|SELLER|RIDER)\b/i.test(t)) return true;
  if (/^\s*SET\s+COMMISSION\b/i.test(t)) return true;
  if (/^\s*UNBAN\b/i.test(t)) return true;
  if (/^\s*REASSIGN\s+RIDER\b/i.test(t)) return true;
  if (/^\s*CLEAR\s+SESSION\b/i.test(t)) return true;
  if (/^\s*SET\s+MODE\b/i.test(t)) return true;
  if (/^\s*(STATUS|BRIEFING|BRIEF)\s*$/i.test(t)) return true;
  if (/^\s*OVERRIDE\s+TEST\s*$/i.test(t)) return true;
  if (/^\s*admin\b/i.test(t)) return true;
  if (/^\s*#help\b/i.test(t)) return true;
  if (/\b(master\s+palette|admin(?:istrative)?\s+commands?|override\s+commands?|boss\s+commands?)\b/i.test(t)) {
    return true;
  }
  if (/\bwhat\s+(admin|administrative|override|boss)\b/i.test(t)) return true;
  return false;
}

/**
 * @param {{ phone?: string, customerKey?: string, text?: string, chatId?: string }} ctx
 * @returns {Promise<null | { handled: true, reply: string, action?: string }>}
 */
export async function tryBossIntercept(ctx = {}) {
  const phone = ctx.phone || "";
  const customerKey = ctx.customerKey || "";
  const text = String(ctx.text || "").trim();
  if (!text) return null;

  const founderBoss = isFounderBossPhone(phone || customerKey);
  // Only bootstrap @lid registration for the hardwired founder — never map random @lid → ADMIN_PHONES[0]
  if (founderBoss) {
    tryRegisterAdminFromMessage(customerKey, phone, text);
  }

  const isStaff =
    founderBoss || isAdminSender(customerKey, phone) || requireAdminSender(customerKey, phone);

  // ——— PING ———
  if (/^\s*ping\s*$/i.test(text)) {
    if (founderBoss) {
      console.log("[boss-intercept] PING founder", phone || customerKey);
      return {
        handled: true,
        action: "ping_boss",
        reply:
          "Yes, Boss. System online and awaiting your command.\n\nTry *!help* or *OVERRIDE: HELP* for the master palette.",
      };
    }
    // Staff get a quiet ack — no master palette leak
    if (isStaff) {
      return {
        handled: true,
        action: "ping_staff",
        reply: "Online. Use your staff short-codes when needed.",
      };
    }
    // Public / seller / buyer — shopping only, zero admin leak
    return {
      handled: true,
      action: "ping_public",
      reply: PUBLIC_SHOP_REPLY,
    };
  }

  // ——— Non-staff probing admin surface → shopping stub (never LLM) ———
  if (!isStaff && looksLikeAdminProbe(text)) {
    console.log(
      "[boss-intercept] blocked non-staff admin probe from",
      phone || customerKey,
      String(text).slice(0, 40)
    );
    return {
      handled: true,
      action: "admin_probe_blocked",
      reply: PUBLIC_SHOP_REPLY,
    };
  }

  if (!isStaff) return null;

  const {
    isMasterCommand,
    softMapSpokenToMasterCommand,
    executeMasterAdminCommand,
  } = await import("./admin-override.js");

  const mapped =
    softMapSpokenToMasterCommand(text) || (isMasterCommand(text) ? text : null);
  if (!mapped) return null;

  // Full help / palette: founder Boss only (staff can still run RBAC mutations)
  const isHelp =
    /^HELP\b/i.test(String(mapped).replace(/^\s*OVERRIDE\s*:/i, "").trim()) ||
    /^\s*!\s*help\b/i.test(text) ||
    /^\s*OVERRIDE\s*:\s*HELP\b/i.test(text);

  if (isHelp && !founderBoss) {
    return {
      handled: true,
      action: "help_staff_denied_palette",
      reply:
        "Staff short-codes only — full master palette is Boss-only. Ask the Boss if you need a FORCE RELEASE or shop suspend.",
    };
  }

  console.log("[boss-intercept] master command:", String(mapped).slice(0, 100));
  const result = await executeMasterAdminCommand(mapped, {
    adminLabel: phone || customerKey || "boss",
    actorPhone: phone || "",
    source: "boss-intercept.whatsapp",
    requireStaff: true,
    founderBoss,
  });

  if (result?.reply) {
    return { handled: true, action: result.action, reply: result.reply, data: result.data };
  }
  return null;
}

/** True when sender is the hardwired founder Boss line (last-9). */
export function isHardwiredBoss(phoneOrKey) {
  return checkIfBoss(phoneOrKey);
}
