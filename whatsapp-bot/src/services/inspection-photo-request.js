/**
 * A buyer can report a problem during the 2-hour inspection.
 * Support is not paged until a photo of the item is saved.
 */

import { updateOrderMeta } from "./orders.js";
import { buyerWhatsAppDestination } from "./buyer-whatsapp.js";

export function inspectionPhotoAskText(order) {
  return (
    `I see a problem reported on *${order.id}* during the 2-hour inspection.\n\n` +
    `Reply to this chat with a photo of the item. The seller payout stays held once that photo is saved. ` +
    `Support is not paged before the photo.`
  );
}

export async function askBuyerForInspectionPhoto(order, {
  send = null,
  destination = null,
  markOrder = null,
  markAwaiting = null,
} = {}) {
  if (!order?.id) return { asked: false, reason: "no_order" };
  const stamp = markOrder || ((id, patch) => updateOrderMeta(id, patch));
  stamp(order.id, { inspectionPhotoRequestedAt: Date.now() });

  const resolveTo = destination || buyerWhatsAppDestination;
  const to = await resolveTo(order);
  if (!to || String(to).startsWith("web:")) return { asked: false, reason: "no_destination" };

  const deliver = send || (async (chatId, text) => {
    const { sendText } = await import("./whatsapp.js");
    return sendText(chatId, text);
  });
  await deliver(to, inspectionPhotoAskText(order));

  const remember = markAwaiting || (async (chatId, orderId) => {
    const { markAwaitingDisputeEvidence } = await import("./dispute-protocol.js");
    markAwaitingDisputeEvidence(chatId, { orderId, phone: chatId });
  });
  await remember(to, order.id);
  return { asked: true, to };
}
