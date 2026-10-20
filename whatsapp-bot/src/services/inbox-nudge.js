/**
 * Nudge: a buzz to someone who has left an offer sitting.
 *
 * The whole feature is the rate limit. Without one this is a harassment tool
 * with a retro skin -- a buyer could shake a seller's screen every second,
 * and the first thing either of them would do is stop opening the inbox.
 *
 * One nudge per hour per conversation, counted on the server. A client-side
 * cooldown is a suggestion; anyone with the network tab can ignore it.
 */

import { sendDirectMessage } from "../db/repositories/social.js";
import { MESSAGE_KINDS } from "../lib/message-kinds.js";
import { isDbEnabled, query } from "../db/pool.js";

/** How long between nudges in one direction of one conversation. */
export const NUDGE_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * When this pair may next be nudged, or null if now.
 * @returns {Promise<{blocked:boolean, minutesLeft:number}>}
 */
export async function nudgeCooldown(senderUserId, receiverUserId) {
  try {
    const { rows } = await query(
      `SELECT created_at FROM messages
        WHERE kind = $1 AND sender_user_id = $2 AND receiver_user_id = $3
        ORDER BY created_at DESC LIMIT 1`,
      [MESSAGE_KINDS.NUDGE, Number(senderUserId), Number(receiverUserId)]
    );
    if (!rows[0]) return { blocked: false, minutesLeft: 0 };
    const elapsed = Date.now() - new Date(rows[0].created_at).getTime();
    if (elapsed >= NUDGE_COOLDOWN_MS) return { blocked: false, minutesLeft: 0 };
    return {
      blocked: true,
      minutesLeft: Math.max(1, Math.ceil((NUDGE_COOLDOWN_MS - elapsed) / 60000)),
    };
  } catch (err) {
    // If the check itself fails, block rather than allow. A missed nudge is
    // nothing; an unmetered one is the failure mode this exists to prevent.
    console.warn("[nudge] cooldown check failed, blocking:", err.message);
    return { blocked: true, minutesLeft: 60 };
  }
}

/**
 * Send a nudge.
 * @returns {Promise<{success:true, message:object}|{error:string,message:string}>}
 */
export async function sendNudge({ senderUserId, receiverUserId } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const from = Number(senderUserId);
  const to = Number(receiverUserId);
  if (!from || !to || from === to) {
    return { error: "invalid_nudge", message: "Pick someone to nudge." };
  }

  const cooldown = await nudgeCooldown(from, to);
  if (cooldown.blocked) {
    return {
      error: "nudge_cooldown",
      message:
        cooldown.minutesLeft >= 60
          ? "You can nudge again in an hour."
          : `You can nudge again in ${cooldown.minutesLeft} min.`,
    };
  }

  const result = await sendDirectMessage({
    senderUserId: from,
    receiverUserId: to,
    content: "👋 Nudge",
    kind: MESSAGE_KINDS.NUDGE,
    payload: { at: new Date().toISOString() },
  });
  if (result.error) return result;
  return { success: true, message: result.message };
}
