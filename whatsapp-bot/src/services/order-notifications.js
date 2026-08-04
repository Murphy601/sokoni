/**
 * Central WhatsApp notifications for order lifecycle events.
 * Called from shipment advances, hub scans, and payment automation.
 */
import { config } from "../config.js";
import { sendText, toChatId } from "./whatsapp.js";
import { getSupplier } from "./suppliers.js";
import { buildPublicTrackingPayload, renderShipmentTimelineText } from "./shipments.js";
import { orderBuyerTotal } from "./shipping-tiers.js";

/** Map internal state → spec-style lifecycle label. */
export function deriveLifecycleStatus(order) {
  if (!order) return "PRE_PAYMENT";
  if (order.status === "delivered" || order.shipmentStatus === "delivered") return "DELIVERED";
  if (order.shipmentStatus === "in_transit") return "IN_TRANSIT";
  if (order.customerPaymentStatus === "confirmed" && order.escrowStatus === "held") return "PAID_ESCROW";
  return "PRE_PAYMENT";
}

function trackUrl(orderId) {
  return `${config.publicSiteUrl}/track.html?order=${encodeURIComponent(orderId)}`;
}

/** Buyer + seller messages after payment confirmed (escrow held). */
export async function notifyOrderPaidEscrow(order, payment = {}) {
  const label = order.dropOffCode || order.id;
  const amt = payment.amount ?? orderBuyerTotal(order);
  const buyerMsg =
    `🎉 *ORDER CONFIRMED — SOKONI MALL*\n\n` +
    `Thank you! Payment of *KES ${Number(amt).toLocaleString()}* is safely held in escrow.\n\n` +
    `📦 *Tracking Code:* ${order.id}\n` +
    `Track live status:\n${trackUrl(order.id)}\n\n` +
    `Type *${order.id}* or *track* anytime for updates.`;

  if (order.customerKey) await sendText(order.customerKey, buyerMsg);

  if (order.supplierId) {
    const sup = getSupplier(order.supplierId);
    if (sup?.phone) {
      const sellerNet = order.sellerNetKes ?? order.sourcePriceKes ?? Math.round(orderBuyerTotal(order) * 0.9);
      const sellerMsg =
        `🛍️ *NEW SALE ON SOKONI MALL!*\n\n` +
        `Item: *${order.productName}*\n` +
        `Earnings: *KES ${Number(sellerNet).toLocaleString()}*\n` +
        `Tracking Code: *${order.id}*\n\n` +
        `👉 Drop package at your nearest hub using code *${label}*,\n` +
        `or reply *DISPATCH ${order.id}* when you send it.\n` +
        `Label: ${order.labelUrl || trackUrl(order.id)}\n\n` +
        `Buyer confirms with *YES ${order.id}*. Reply *balance* for your wallet.`;
      await sendText(toChatId(sup.phone), sellerMsg);
    }
  }
}

/** Notify buyer (and optionally seller) after a shipment status change. */
export async function notifyShipmentStatusChange(order, { prevStatus = null } = {}) {
  if (!order) return;
  const status = order.shipmentStatus;
  if (!status || status === prevStatus) return;

  const tracking = buildPublicTrackingPayload(order);
  let buyerMsg = "";

  if (status === "dropped_off") {
    buyerMsg =
      `📦 *${order.id}* — package dropped off${order.dropOffHub ? ` at *${order.dropOffHub}*` : ""}!\n` +
      `Your parcel is being processed for dispatch.\n\n` +
      `${renderShipmentTimelineText(order)}\n\n` +
      `Track: ${trackUrl(order.id)}`;
  } else if (status === "in_transit") {
    buyerMsg =
      `🚚 *${order.id}* is *in transit*!\n` +
      `${order.courierName ? `Courier: *${order.courierName}*\n` : ""}` +
      `${order.transitEta ? `ETA: *${order.transitEta}*\n` : ""}` +
      `\nWhen you receive it, reply:\n*YES ${order.id}*\n\n` +
      `${renderShipmentTimelineText(order)}\n\n` +
      `Track: ${trackUrl(order.id)}`;
  } else if (status === "at_pickup_point") {
    buyerMsg =
      `📍 *${order.id}* arrived at pickup point — ready for collection soon.\n\n` +
      `Track: ${trackUrl(order.id)}`;
  } else if (status === "delivered") {
    buyerMsg =
      `🎉 *${order.id} delivered!* Enjoy your *${order.productName}*.\n\n` +
      `Funds will be released to the seller after the escrow window.\n\n` +
      `Track: ${trackUrl(order.id)}`;
  } else if (status === "label_ready") {
    buyerMsg =
      `📦 *${order.id}* — prepaid label ready.\n` +
      `Seller will drop off at a Sokoni hub. We'll update you at each step.\n\n` +
      `Track: ${trackUrl(order.id)}`;
  }

  if (buyerMsg && order.customerKey) {
    await sendText(order.customerKey, buyerMsg);
  }

  if (order.supplierId && ["dropped_off", "in_transit", "delivered"].includes(status)) {
    const sup = getSupplier(order.supplierId);
    if (sup?.phone) {
      await sendText(
        toChatId(sup.phone),
        `📦 *${order.id}* shipment update: *${tracking.shipmentStatusLabel}*`
      );
    }
  }
}
