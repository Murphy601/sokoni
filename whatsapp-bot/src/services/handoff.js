import { config } from "../config.js";
import { getSupplier } from "./suppliers.js";
import { orderBuyerTotal, formatBuyerTotalLine } from "./shipping-tiers.js";
import { sendText, formatCustomerLabel } from "./whatsapp.js";
import { formatAdminFulfillmentBlock } from "./fulfillment.js";
import { humanHandoffAck } from "./trust-copy.js";
import { isAfterHumanHours } from "./customer-automations.js";
import {
  setHumanHandoff,
  getHumanHandoff,
  getCustomerMeta,
  setCustomerMeta,
} from "./session.js";
import {
  openGeneralSupportTicket,
  appendGeneralSupportCustomerMessage,
  supportInboxSiteHint,
} from "./support-inbox.js";

/** Admin ping when a customer wants a human — also opens dashboard inbox ticket. */
async function pingAdminSimple(title, customerKey, { chatId, displayName, phone, detail = "", ticketId = "" }) {
  const label = formatCustomerLabel({ chatId, displayName, phone }, customerKey);
  const inbox = supportInboxSiteHint();
  const text =
    `${title}\n\n` +
    `Customer: *${displayName || "Unknown"}*\n` +
    `${phone ? `Phone: +${phone}\n` : ""}` +
    `Chat: \`${chatId || customerKey}\`\n` +
    (ticketId ? `Inbox: *${ticketId}*\n` : "") +
    (detail ? `${detail}\n\n` : "\n") +
    `Reply from the support inbox:\n${inbox}\n` +
    `_Or open their WhatsApp chat directly._`;

  console.log(`[handoff] ${label}${ticketId ? ` ${ticketId}` : ""}`);

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
          ticketId,
          inboxUrl: inbox,
        }),
      });
    } catch (err) {
      console.error("Failed to notify admin webhook:", err.message);
    }
  }
}

export async function startHumanHandoff(
  customerKey,
  { chatId, displayName, phone, lastMessage, priority = "normal", escalationReason = "" } = {}
) {
  setCustomerMeta(customerKey, { chatId, displayName, phone });

  const opened = openGeneralSupportTicket({
    customerKey,
    chatId,
    displayName,
    phone,
    lastMessage,
    priority,
    escalationReason,
  });

  const high = priority === "high" || priority === "urgent";
  await pingAdminSimple(
    high ? "🚨 *HIGH PRIORITY — human needed*" : "🙋 *Customer wants a human*",
    customerKey,
    {
      chatId,
      displayName,
      phone,
      detail: lastMessage ? `They said: _"${String(lastMessage).slice(0, 120)}"_` : "",
      ticketId: opened?.ticket?.id || "",
    }
  );

  return opened;
}

export async function handleCustomerWhileHandoff(customerKey, text = "") {
  const handoff = getHumanHandoff(customerKey);
  if (!handoff) return false;

  const body = String(text || "").trim();
  if (body) {
    appendGeneralSupportCustomerMessage(customerKey, body);
  }

  if (!handoff.ackSent) {
    setHumanHandoff(customerKey, { ...handoff, ackSent: true });
    await sendText(customerKey, humanHandoffAck(isAfterHumanHours()));
  }
  return true;
}

export function buildOrderAdminSummary({ customerKey, pending, details, order }) {
  const meta = getCustomerMeta(customerKey);
  const label = formatCustomerLabel(meta, customerKey);
  const orderId = order?.id ? `  ·  *${order.id}*` : "";

  let supplierBlock = "";
  if (order?.supplierId) {
    const sup = getSupplier(order.supplierId);
    supplierBlock =
      `\n*Supplier:* ${sup?.businessName || order.supplierId}\n` +
      `Supply: KES ${(order.sourcePriceKes || 0).toLocaleString()} · ` +
      `Margin: KES ${(order.marginKes || 0).toLocaleString()}\n` +
      (sup?.delivers
        ? `Delivers: yes (${sup.deliveryAreas || "countrywide"})\n`
        : `Delivers: no — arrange pickup/hub\n`) +
      (sup?.phone ? `Supplier WA: +${sup.phone}\n` : "");
  }

  return (
    `🧾 *NEW PREPAID ORDER*${orderId}\n` +
    `Product: ${pending.name}\n` +
    `Total: ${formatBuyerTotalLine(pending)} (customer pays upfront — escrow)\n` +
    supplierBlock +
    `Customer: ${label}\n` +
    `Name: ${details.name}\n` +
    `Location: ${details.location}\n` +
    `Phone: ${details.phone}\n\n` +
    `${formatAdminFulfillmentBlock(order, details.location)}\n\n` +
    `*Next steps:*\n` +
    `${order?.id ? `#fulfill ${order.id}` : "#fulfill SKN-xxxx"} — ping supplier (no customer contact)\n` +
    `${order?.id ? `#fulfill ${order.id} share` : "#fulfill SKN-xxxx share"} — supplier delivers (includes address)\n` +
    `#status ${order?.id || "<id>"} confirmed\n` +
    `#pickup ${order?.id || "SKN-xxxx"} <pp-id> — assign pickup point\n` +
    `Till: *${config.store.mpesaTill}* (${config.store.mpesaTillName})\n` +
    `#payconfirm ${order?.id || "SKN-xxxx"} — after M-Pesa verified\n` +
    `#${order?.id || "SKN-xxxx"} Message to customer`
  );
}
