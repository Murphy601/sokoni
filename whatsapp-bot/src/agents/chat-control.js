/**
 * Chat control on the existing bus.
 *
 * The screener in chat-screening.js decides what is blocked. This agent does
 * not run a second, looser pattern — words like "mpesa" and "number" are
 * normal on Sokoni. It records the refusal, publishes one enriched event, and
 * reports upward so the main agent's hourly cap still applies.
 *
 * It does not push an STK, release escrow, or send its own WhatsApp. Those
 * stay on the payment and admin paths that already check them.
 */

import { agentBus, AGENT_EVENTS, SEVERITY } from "./event-bus.js";
import { reportToMainAgent } from "./main-agent.js";
import { publishEnriched } from "./enrich.js";
import { recordFlaggedMessage } from "./flagged-store.js";

let stop = null;

function onFlagged(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : event || {};
  const violation = String(data.violationType || "UNKNOWN").slice(0, 40);
  const senderId = data.senderUserId ?? "unknown";
  const flaggedId = data.flaggedId ?? "—";
  reportToMainAgent({
    type: "CHAT_CONTROL",
    severity: SEVERITY.HIGH,
    summary: `Blocked a chat message (${violation}) from user ${senderId}. Flag #${flaggedId}.`,
    data: {
      flaggedId: data.flaggedId ?? null,
      violationType: violation,
      senderUserId: data.senderUserId ?? null,
      receiverUserId: data.receiverUserId ?? null,
    },
  });
}

/** Start listening. A second call does not add a second listener. */
export function startChatControlAgent() {
  if (stop) return;
  stop = agentBus.subscribe("ChatControlAgent", AGENT_EVENTS.FLAGGED_MESSAGE, onFlagged);
}

export function stopChatControlAgent() {
  if (stop) stop();
  stop = null;
}

/**
 * Persist a blocked message and tell every listener.
 * The insert is awaited by the caller. The enriched publish is not.
 */
export async function recordBlockedChat({
  senderUserId,
  receiverUserId,
  content,
  violationType,
} = {}) {
  const row = await recordFlaggedMessage({
    senderUserId,
    receiverUserId,
    content,
    violationType,
  });
  publishEnriched(AGENT_EVENTS.FLAGGED_MESSAGE, {
    flaggedId: row?.id ?? null,
    senderUserId,
    receiverUserId,
    violationType,
  });
  return row;
}

/** A message that was allowed. Text is capped; contact numbers are not added. */
export function publishChatMessage({ senderUserId, receiverUserId, messageId, kind, text } = {}) {
  publishEnriched(AGENT_EVENTS.CHAT_MESSAGE_CREATED, {
    senderUserId,
    receiverUserId,
    messageId,
    kind,
    text,
  });
}
