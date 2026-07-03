import axios from "axios";
import { config } from "../config.js";

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

async function callWhatsApp(payload) {
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    // Local dev / demo mode without real WhatsApp credentials configured yet.
    console.log("[whatsapp:dry-run]", JSON.stringify(payload, null, 2));
    return { dryRun: true };
  }
  const { data } = await axios.post(BASE_URL, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  return data;
}

export function sendText(to, body) {
  return callWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

/**
 * Sends an interactive list message (max 10 rows total across all sections).
 * `sections`: [{ title, rows: [{ id, title, description }] }]
 */
export function sendList(to, { header, body, footer, buttonText, sections }) {
  return callWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { button: buttonText, sections },
    },
  });
}

/**
 * Sends up to 3 quick-reply buttons.
 * `buttons`: [{ id, title }]
 */
export function sendButtons(to, { body, footer, buttons }) {
  return callWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        buttons: buttons.map((button) => ({
          type: "reply",
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  });
}

/**
 * Renders a single product as a text card + a button to open the affiliate
 * link. WhatsApp interactive buttons can't open arbitrary URLs directly in
 * every client the same way link previews do, so we combine a rich text
 * message (with the link inline, giving a native link preview) with a
 * follow-up quick-reply for "Ask AI about this" to keep the conversation open.
 */
export async function sendProductCard(to, product, affiliateUrl, sourceLabel) {
  const isInternational = product.scope === "international";
  const priceLine = product.priceKes
    ? `KES ${product.priceKes.toLocaleString()}` +
      (product.originalPriceKes ? ` (was KES ${product.originalPriceKes.toLocaleString()})` : "")
    : `$${product.priceUsd} (est. delivery ${product.estDeliveryDays || "10-20 days"})`;

  const dutiesNote = isInternational
    ? "\n_Heads up: Kenya import duty/VAT may apply on arrival, paid by you — not included in this price._\n"
    : "";

  const body =
    `*${product.name}*\n` +
    `${priceLine}\n` +
    `⭐ ${product.rating} (${product.reviews.toLocaleString()} reviews) · ${sourceLabel}\n` +
    `${dutiesNote}\n` +
    `🛒 Buy here: ${affiliateUrl}\n\n` +
    `_Sokoni may earn a small commission on this purchase — it never costs you extra 🙏_`;

  await sendText(to, body);

  return sendButtons(to, {
    body: `Want to know more about the ${product.name}?`,
    buttons: [
      { id: `ask_ai_${product.id}`, title: "🤖 Ask AI about it" },
      { id: "menu_main", title: "⬅ Main Menu" },
    ],
  });
}
