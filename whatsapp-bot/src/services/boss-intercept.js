/**
 * Code-level Boss interceptor — runs BEFORE any LLM / RAG path.
 * Hardwired last-9 match (757764009) via checkIfBoss; mutations never depend on model obedience.
 */
import { config } from "../config.js";
import { checkIfBoss } from "../lib/phone-normalize.js";
import { isAdminSender, requireAdminSender, tryRegisterAdminFromMessage } from "./admin.js";
/**
 * @param {{ phone?: string, customerKey?: string, text?: string, chatId?: string }} ctx
 * @returns {Promise<null | { handled: true, reply: string, action?: string }>}
 */
export async function tryBossIntercept(ctx = {}) {
  const phone = ctx.phone || "";
  const customerKey = ctx.customerKey || "";
  const text = String(ctx.text || "").trim();
  if (!text) return null;

  const bossHit = checkIfBoss(phone || customerKey, config.admin?.phones || []);
  const isStaff =
    bossHit || isAdminSender(customerKey, phone) || requireAdminSender(customerKey, phone);

  // PING — connectivity only
  if (/^\s*ping\s*$/i.test(text)) {
    const registered = tryRegisterAdminFromMessage(customerKey, phone, text);
    if (bossHit || registered || isAdminSender(customerKey, phone)) {
      console.log("[boss-intercept] PING", phone || customerKey);
      return {
        handled: true,
        action: "ping",
        reply:
          "Yes, Boss. System online and awaiting your command.\n\nTry *!help* or *OVERRIDE: HELP* for the master palette.",
      };
    }
    return {
      handled: true,
      action: "ping_public",
      reply: "pong — Sokoni bot is online. Type *menu* to shop.",
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

  console.log("[boss-intercept] master command:", String(mapped).slice(0, 100));
  const result = await executeMasterAdminCommand(mapped, {
    adminLabel: phone || customerKey || "boss",
    actorPhone: phone || "",
    source: "boss-intercept.whatsapp",
  });

  if (result?.reply) {
    return { handled: true, action: result.action, reply: result.reply, data: result.data };
  }
  return null;
}

/** True when sender is the hardwired Boss line (last-9). */
export function isHardwiredBoss(phoneOrKey) {
  return checkIfBoss(phoneOrKey, config.admin?.phones || []);
}
