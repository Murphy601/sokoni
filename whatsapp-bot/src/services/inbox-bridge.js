/**
 * WhatsApp replies into the web inbox.
 *
 * The web side already pings a seller on WhatsApp when a buyer messages them,
 * but replying meant opening the site. A seller on a matatu will not do that,
 * so the buyer waits and the sale cools. This closes the loop: reply on
 * WhatsApp and it lands in the web thread.
 *
 * The hard part is not writing the row. It is not stealing messages from the
 * rest of the bot -- orders, rider and seller signup, menus, the agent all
 * read plain text too. Two rules keep this safe:
 *
 *  1. An explicit `R <text>` always routes to the thread, and collides with
 *     nothing.
 *  2. A bare reply only routes when we pinged this person moments ago, the
 *     window is still open, and every other handler has already declined the
 *     message. This module runs last for exactly that reason.
 */

import { getCustomerMeta, setCustomerMeta } from "./session.js";

/**
 * How long a bare reply keeps going to the thread.
 *
 * Long enough to cover reading a notification and typing an answer, short
 * enough that tomorrow's "menu" is never mistaken for a reply to yesterday's
 * buyer.
 */
export const REPLY_WINDOW_MS = 15 * 60 * 1000;

/** `R hi` / `REPLY hi` / `r: hi` -- explicit, and nothing else in the bot uses it. */
const EXPLICIT = /^\s*(?:r|reply)\s*[:\-]?\s+(.+)$/is;

/**
 * Remember which web thread this WhatsApp chat was last pinged about.
 * Called when the notification goes out, not when a reply arrives.
 *
 * @param {string} customerKey WhatsApp chat id
 * @param {{viewerUserId:number, peerUserId:number, peerLabel?:string}} thread
 */
export function rememberInboxPing(customerKey, thread) {
  if (!customerKey || !thread?.viewerUserId || !thread?.peerUserId) return;
  setCustomerMeta(customerKey, {
    inboxReply: {
      viewerUserId: Number(thread.viewerUserId),
      peerUserId: Number(thread.peerUserId),
      peerLabel: String(thread.peerLabel || "").slice(0, 60),
      at: Date.now(),
    },
  });
}

/** The remembered thread, or null when there is none or it has gone stale. */
export function activeInboxThread(customerKey) {
  const ctx = getCustomerMeta(customerKey)?.inboxReply;
  if (!ctx?.viewerUserId || !ctx?.peerUserId) return null;
  if (!ctx.at || Date.now() - ctx.at > REPLY_WINDOW_MS) return null;
  return ctx;
}

export function clearInboxThread(customerKey) {
  setCustomerMeta(customerKey, { inboxReply: null });
}

/**
 * Pull the reply text out of a message, or null if this is not a reply.
 *
 * `explicit` is returned separately because an explicit reply works even with
 * no remembered thread having been pinged recently -- it is unambiguous, so
 * the window does not apply to it.
 *
 * @returns {{text:string, explicit:boolean}|null}
 */
export function parseReply(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  // The prefix on its own is someone who meant to reply and forgot the words.
  // Not a reply, so it falls through and the agent can respond.
  if (/^(?:r|reply)\s*[:\-]?$/i.test(s)) return null;
  const m = s.match(EXPLICIT);
  if (m) {
    const text = String(m[1] || "").trim();
    return text ? { text, explicit: true } : null;
  }
  return { text: s, explicit: false };
}

/**
 * Text that must never be treated as a bare reply.
 *
 * Belt and braces. This module already runs after every other handler, so in
 * principle nothing here should reach it -- but "menu" silently landing in a
 * buyer's chat instead of opening the menu is the kind of bug that erodes
 * trust in the whole bridge, so it is checked twice.
 */
const NEVER_A_REPLY =
  /^\s*(menu|help|start|stop|cancel|track|status|sell|ride|rider|boda|hi|hey|hello|niaje|sasa|mambo|\d{1,2}|yes|no|ok|okay|done|next|back|more)\s*$/i;

/** Commands the fleet and support layers own. Never a chat reply. */
const LOOKS_LIKE_COMMAND =
  /^\s*(accept|decline|pickup|confirm|delivered|dispute|help|problem|waybill|set\s+zone|available|offline|no_show|verify_return|linkseller|#\w+)\b/i;

export function isBareReplyAllowed(text) {
  const s = String(text || "").trim();
  if (!s || s.length < 2) return false;
  if (NEVER_A_REPLY.test(s)) return false;
  if (LOOKS_LIKE_COMMAND.test(s)) return false;
  // An order reference means they are talking about an order, not chatting.
  if (/\bSKN?-\d/i.test(s)) return false;
  return true;
}

/**
 * Route a WhatsApp message into the web inbox thread.
 *
 * @param {string} customerKey
 * @param {string} rawText
 * @param {{phone?:string}} ctx
 * @returns {Promise<boolean>} true when the message was consumed
 */
export async function tryHandleInboxReply(customerKey, rawText, { phone = "" } = {}) {
  const parsed = parseReply(rawText);
  if (!parsed) return false;

  const thread = activeInboxThread(customerKey);
  if (!thread) {
    if (!parsed.explicit) return false;
    // They typed R but we have nothing to attach it to. Say so rather than
    // dropping it silently -- a reply that vanishes is worse than no bridge.
    const { sendText } = await import("./whatsapp.js");
    await sendText(
      customerKey,
      "I don't have a recent Sokoni chat to reply to. Open your inbox on the site to pick up the conversation."
    );
    return true;
  }

  if (!parsed.explicit && !isBareReplyAllowed(parsed.text)) return false;

  try {
    const { sendDirectMessage } = await import("../db/repositories/social.js");
    const result = await sendDirectMessage({
      senderUserId: thread.viewerUserId,
      receiverUserId: thread.peerUserId,
      content: parsed.text.slice(0, 2000),
    });

    const { sendText } = await import("./whatsapp.js");
    if (result?.error) {
      // Blocked messages are the moderation rules doing their job; say which.
      await sendText(
        customerKey,
        result.error === "message_blocked"
          ? `Not sent. ${result.message}`
          : `Couldn't send that to your Sokoni chat. Try again, or open your inbox on the site.`
      );
      return true;
    }

    // Keep the window open: a conversation is usually more than one line.
    rememberInboxPing(customerKey, thread);
    const who = thread.peerLabel ? ` to ${thread.peerLabel}` : "";
    await sendText(customerKey, `Sent${who}. ✓ Reply again here, or open the chat on the site.`);
    return true;
  } catch (err) {
    console.warn("[inbox-bridge] reply failed:", err.message);
    return false;
  }
}

/**
 * Route a WhatsApp voice note into the web inbox thread.
 *
 * Stores a reference -- the WAHA media URL, the mimetype, how long it runs --
 * and never the audio itself. The bytes stay where WAHA already put them and
 * are streamed on demand when someone presses play, so a thread with a
 * hundred voice notes costs this process nothing.
 *
 * Voice is treated exactly like a bare text reply: it only lands in a thread
 * we pinged this chat about in the last few minutes. A seller sending the bot
 * a voice note out of the blue still reaches the normal transcription path.
 *
 * @returns {Promise<boolean>} true when the note was consumed
 */
export async function tryHandleInboxVoiceNote(customerKey, { mediaUrl, mimetype, durationMs } = {}) {
  if (!mediaUrl) return false;
  const thread = activeInboxThread(customerKey);
  if (!thread) return false;

  try {
    const { sendDirectMessage } = await import("../db/repositories/social.js");
    const { MESSAGE_KINDS } = await import("../lib/message-kinds.js");
    const result = await sendDirectMessage({
      senderUserId: thread.viewerUserId,
      receiverUserId: thread.peerUserId,
      content: "",
      kind: MESSAGE_KINDS.VOICE,
      payload: {
        // A pointer, not the audio. See streamWahaMedia.
        mediaUrl: String(mediaUrl),
        mimetype: String(mimetype || "audio/ogg"),
        ...(Number(durationMs) > 0 ? { durationMs: Math.round(Number(durationMs)) } : {}),
        source: "whatsapp",
      },
    });

    const { sendText } = await import("./whatsapp.js");
    if (result?.error) {
      await sendText(customerKey, "Couldn't add that voice note to your Sokoni chat. Try again?");
      return true;
    }
    rememberInboxPing(customerKey, thread);
    const who = thread.peerLabel ? ` to ${thread.peerLabel}` : "";
    await sendText(customerKey, `Voice note sent${who}. ✓`);
    return true;
  } catch (err) {
    console.warn("[inbox-bridge] voice note failed:", err.message);
    return false;
  }
}
