import { config } from "../config.js";
import { sendText, formatCustomerLabel } from "./whatsapp.js";
import {
  setHumanHandoff,
  getHumanHandoff,
  getCustomerMeta,
  setCustomerMeta,
} from "./session.js";

/** Simple admin ping when a customer wants a human — no relay / #reply flow. */
async function pingAdminSimple(title, customerKey, { chatId, displayName, phone, detail = "" }) {
  const label = formatCustomerLabel({ chatId, displayName, phone }, customerKey);
  const text =
    `${title}\n\n` +
    `Customer: *${displayName || "Unknown"}*\n` +
    `${phone ? `Phone: +${phone}\n` : ""}` +
    `Chat: \`${chatId || customerKey}\`\n` +
    (detail ? `${detail}\n\n` : "\n") +
    `Open their chat in WhatsApp to reply, or use:\n` +
    `*#SK-xxxx <message>* after an order alert · *#help* for commands`;

  console.log(`[handoff] ${label}`);

  if (!config.admin.primary) return;
  try {
    await sendText(config.admin.primary, text);
  } catch (err) {
    console.error("Failed to notify admin:", err.message);
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
          detail,
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
  await pingAdminSimple(
    "🙋 *Customer wants a human*",
    customerKey,
    {
      chatId,
      displayName,
      phone,
      detail: lastMessage ? `They said: _"${lastMessage.slice(0, 120)}"_` : "",
    }
  );
}

export async function handleCustomerWhileHandoff(customerKey) {
  const handoff = getHumanHandoff(customerKey);
  if (!handoff) return false;

  if (!handoff.ackSent) {
    setHumanHandoff(customerKey, { ...handoff, ackSent: true });
    await sendText(
      customerKey,
      "You're connected with our team 👋 We'll reply here shortly.\n\nType *menu* anytime to return to the shopping bot."
    );
  }
  return true;
}

export function buildOrderAdminSummary({ customerKey, pending, details, order }) {
  const meta = getCustomerMeta(customerKey);
  const label = formatCustomerLabel(meta, customerKey);
  const orderId = order?.id ? `  ·  *${order.id}*` : "";
  return (
    `🧾 *NEW COD ORDER*${orderId}\n` +
    `Product: ${pending.name}\n` +
    `Price: KES ${pending.priceKes} (pay on delivery)\n` +
    `Customer: ${label}\n` +
    `Name: ${details.name}\n` +
    `Location: ${details.location}\n` +
    `Phone: ${details.phone}\n\n` +
    `Update: ${order?.id ? `#status ${order.id} confirmed` : "#status <id> confirmed"}\n` +
    `Message them: #${order?.id || "SK-xxxx"} Your message here`
  );
}
