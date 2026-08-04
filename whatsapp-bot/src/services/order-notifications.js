/**
 * Central WhatsApp notifications for order lifecycle events.
 * Paid / DISPATCH / YES copy lives in communication-hub templates.
 */
import { config } from "../config.js";
import { toChatId } from "./whatsapp.js";
import { getSupplier } from "./suppliers.js";
import { buildPublicTrackingPayload, renderShipmentTimelineText } from "./shipments.js";
import { orderBuyerTotal } from "./shipping-tiers.js";
import {
  dispatchMessages,
  msgBuyerDispatched,
  msgBuyerPaid,
  msgSellerPaid,
  dropOffLine,
  sellerNotifyTargets,
} from "./communication-hub.js";
import { updateOrderMeta } from "./orders.js";

/** Map internal state → lifecycle label. */
export function deriveLifecycleStatus(order) {
  if (!order) return "PRE_PAYMENT";
  if (order.status === "delivered" || order.shipmentStatus === "delivered") return "DELIVERED";
  if (order.shipmentStatus === "in_transit" || order.sellerDispatchedAt) return "IN_TRANSIT";
  if (order.customerPaymentStatus === "confirmed" && order.escrowStatus === "held") return "PAID_ESCROW";
  return "PRE_PAYMENT";
}

function trackUrl(orderId) {
  return `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(orderId)}`;
}

/** Buyer + seller messages after payment confirmed (escrow held). */
export async function notifyOrderPaidEscrow(order, payment = {}) {
  const amt = payment.amount ?? orderBuyerTotal(order);
  const jobs = [];
  if (order.customerKey) {
    jobs.push({
      to: order.customerKey,
      message:
        `Receipt: *${payment.mpesaReceiptNumber || "—"}* · KES ${Number(amt).toLocaleString()}\n\n` +
        msgBuyerPaid(order),
    });
  }
  if (order.supplierId) {
    const sup = getSupplier(order.supplierId);
    if (sup?.phone) {
      const targets = sellerNotifyTargets(sup.phone);
      updateOrderMeta(order.id, { sellerNotifyChatIds: targets });
      for (const to of targets) {
        jobs.push({ to, message: msgSellerPaid(order) });
      }
    }
  }
  await dispatchMessages(jobs);
}

/** Notify buyer (and optionally seller) after a shipment status change. */
export async function notifyShipmentStatusChange(order, { prevStatus = null, meta = {} } = {}) {
  if (!order) return;
  const status = order.shipmentStatus;
  if (!status || status === prevStatus) return;
  if (meta.skipBuyerNotify || meta.skipNotify) return;

  const tracking = buildPublicTrackingPayload(order);
  let buyerMsg = "";

  if (status === "dropped_off") {
    buyerMsg =
      `📦 *${order.id}* — dropped off${order.dropOffHub ? ` at *${order.dropOffHub}*` : ""}.\n` +
      `Heading to: *${dropOffLine(order)}*\n\n` +
      `When you receive it, reply:\nYES ${order.id}\n\n` +
      `${renderShipmentTimelineText(order)}\n\n` +
      `Problem? HELP ${order.id}\nTrack: ${trackUrl(order.id)}`;
  } else if (status === "in_transit") {
    buyerMsg = msgBuyerDispatched(order);
  } else if (status === "at_pickup_point") {
    buyerMsg =
      `📍 *${order.id}* is at the pickup point.\n` +
      `Collect at: *${dropOffLine(order)}*\n\n` +
      `When you have it, reply:\nYES ${order.id}\n\n` +
      `Problem? HELP ${order.id}\nTrack: ${trackUrl(order.id)}`;
  } else if (status === "delivered") {
    buyerMsg =
      `🎉 *DELIVERED — ${order.id}*\n\n` +
      `Enjoy *${order.productName || "your order"}*.\n` +
      `Seller payout follows the escrow hold.\n\n` +
      `Track: ${trackUrl(order.id)}`;
  } else if (status === "label_ready") {
    buyerMsg =
      `📦 *${order.id}* — prepaid label ready.\n` +
      `Seller will send your item to *${dropOffLine(order)}*.\n\n` +
      `You'll get a DISPATCH update next.\n` +
      `Track: ${trackUrl(order.id)}`;
  }

  const jobs = [];
  if (buyerMsg && order.customerKey) {
    jobs.push({ to: order.customerKey, message: buyerMsg });
  }

  if (order.supplierId && ["dropped_off", "in_transit", "delivered"].includes(status)) {
    const sup = getSupplier(order.supplierId);
    if (sup?.phone) {
      jobs.push({
        to: toChatId(sup.phone),
        message: `📦 *${order.id}* update: *${tracking.shipmentStatusLabel}*\nBuyer confirms with: YES ${order.id}`,
      });
    }
  }

  await dispatchMessages(jobs);
}
