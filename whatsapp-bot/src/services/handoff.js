import { config } from "../config.js";
import { sendText, formatCustomerLabel, customerKeyFromChatId } from "./whatsapp.js";
import {
  setHumanHandoff,
  getHumanHandoff,
  clearHumanHandoff,
  getCustomerMeta,
  setCustomerMeta,
} from "./session.js";

const CHAT_MARKER = /\[chat:([^\]]+)\]/;

/** Global handoff registry (also used when swipe-reply only captures part of the alert). */
let latestHandoff = null;
const handoffsByChatId = new Map();

export function chatMarker(chatId) {
  return `[chat:${chatId}]`;
}

export function parseChatIdFromQuoted(text) {
  const match = text?.match(CHAT_MARKER);
  return match ? match[1] : null;
}

function registerHandoffForAdmin(customerKey, { chatId, displayName }) {
  const entry = {
    customerKey,
    chatId: chatId || customerKey,
    displayName,
    at: Date.now(),
  };
  latestHandoff = entry;
  handoffsByChatId.set(entry.chatId, customerKey);
  handoffsByChatId.set(customerKey, customerKey);
}

export function resolveCustomerForAdminReply(quotedText, replyText) {
  const combined = `${quotedText || ""}\n${replyText || ""}`;

  const marked = parseChatIdFromQuoted(combined);
  if (marked) return customerKeyFromChatId(marked);

  const backtick = combined.match(/Chat:\s*`([^`]+)`/i);
  if (backtick) return customerKeyFromChatId(backtick[1]);

  if (/human help requested|new cod order/i.test(quotedText || "") && latestHandoff) {
    return latestHandoff.customerKey;
  }

  const trimmed = (replyText || "").trim();
  if (/^#\s+.+/s.test(trimmed) && latestHandoff) {
    return latestHandoff.customerKey;
  }

  const specific = trimmed.match(/^#(\S+@\S+)\s+.+/s);
  if (specific) return customerKeyFromChatId(specific[1]);

  return null;
}

export function extractAdminReplyText(replyText) {
  const t = (replyText || "").trim();
  const hash = t.match(/^#\s+([\s\S]+)/);
  if (hash) return hash[1].trim();
  const specific = t.match(/^#\S+@\S+\s+([\s\S]+)/);
  if (specific) return specific[1].trim();
  return t;
}

export async function notifyAdminHandoff(customerKey, { chatId, displayName, phone, lastMessage }) {
  registerHandoffForAdmin(customerKey, { chatId, displayName });

  const marker = chatMarker(chatId || customerKey);

  const notifyText =
    `🙋 *Human help requested*\n\n` +
    `Customer: *${displayName || "Unknown name"}*\n` +
    `${phone ? `Phone: +${phone}\n` : ""}` +
    `Chat: \`${chatId || customerKey}\`\n` +
    (lastMessage ? `They said: _"${lastMessage.slice(0, 120)}"_\n\n` : "\n") +
    `*Reply to the customer (pick one):*\n\n` +
    `✅ *Easiest:* type\n` +
    `# Hello, how can I help you?\n\n` +
    `↩️ *Or* swipe right on *this* message → type your reply\n` +
    `_(WhatsApp "Reply" — not the number 1)_\n\n` +
    `💬 *Or* open their chat in WhatsApp and reply there\n\n` +
    marker;

  console.log(`[handoff] ${formatCustomerLabel({ chatId, displayName, phone }, customerKey)}`);

  try {
    await sendText(config.admin.primary, notifyText);
  } catch (err) {
    console.error("Failed to notify business of handoff:", err.message);
  }

  if (config.adminNotifyUrl) {
    try {
      await fetch(config.adminNotifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "human_handoff",
          customerKey,
          chatId,
          displayName,
          phone,
          lastMessage,
        }),
      });
    } catch (err) {
      console.error("Failed to notify admin webhook:", err.message);
    }
  }
}

export async function startHumanHandoff(customerKey, { chatId, displayName, phone, lastMessage }) {
  setCustomerMeta(customerKey, { chatId, displayName, phone });
  setHumanHandoff(customerKey, { startedAt: Date.now() });
  await notifyAdminHandoff(customerKey, { chatId, displayName, phone, lastMessage });
}

/** Forward store-owner text to the customer. */
export async function relayAdminMessage({ quotedText, replyText, adminChatId }) {
  const message = extractAdminReplyText(replyText);
  if (!message || /^(\d{1,2})$/i.test(message)) {
    await sendText(
      adminChatId || config.admin.primary,
      `⚠️ Not sent.\n\nType:\n# Hello, how can I help?\n\nOr swipe right on the handoff alert → type your reply.`
    );
    return true;
  }

  const customerKey = resolveCustomerForAdminReply(quotedText, replyText);
  if (!customerKey) {
    await sendText(
      adminChatId || config.admin.primary,
      `⚠️ Couldn't find which customer.\n\nAfter a handoff alert, type:\n# Hello, how can I help?`
    );
    return true;
  }

  await sendText(customerKey, message);
  setHumanHandoff(customerKey, { adminDirect: true, startedAt: Date.now(), ackSent: true });

  const meta = getCustomerMeta(customerKey);
  await sendText(
    adminChatId || config.admin.primary,
    `✅ Sent to *${meta?.displayName || "customer"}*.\n\nThe bot is paused for them until they type *menu*.`
  );
  return true;
}

export async function handleCustomerWhileHandoff(customerKey) {
  const handoff = getHumanHandoff(customerKey);
  if (!handoff) return false;

  if (!handoff.ackSent) {
    setHumanHandoff(customerKey, { ...handoff, ackSent: true });
    await sendText(
      customerKey,
      "You're connected with our team now 👋 They'll reply here shortly.\n\nType *menu* anytime to go back to the shopping bot."
    );
  }
  return true;
}

export function buildOrderAdminSummary({ customerKey, pending, details, order }) {
  registerHandoffForAdmin(customerKey, {
    chatId: getCustomerMeta(customerKey)?.chatId || customerKey,
    displayName: details.name,
  });

  const meta = getCustomerMeta(customerKey);
  const label = formatCustomerLabel(meta, customerKey);
  const orderId = order?.id ? `  ·  *${order.id}*` : "";
  return (
    `🧾 *NEW COD ORDER*${orderId}\n` +
    `Product: ${pending.name}\n` +
    `Price: KES ${pending.priceKes} (pay on delivery)\n` +
    `Customer: ${label}\n` +
    `Customer name: ${details.name}\n` +
    `Delivery location: ${details.location}\n` +
    `Phone: ${details.phone}\n` +
    `Raw message: ${details.raw}\n\n` +
    `*Update status:* ${order?.id ? `#status ${order.id} confirmed` : "#status <id> confirmed"}\n` +
    `*Message customer:* # Your message here\n\n` +
    `${chatMarker(meta?.chatId || customerKey)}`
  );
}
