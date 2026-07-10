import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { getOrder, getOrdersForCustomer, updateOrderMeta, listRecentOrders } from "./orders.js";
import { getPickupPoint } from "./pickupPoints.js";
import { getSupplier } from "./suppliers.js";
import { paymentVerificationPrompt, paymentConfirmedMessage } from "./trust-copy.js";

export const CUSTOMER_PAYMENT_STATUSES = ["unpaid", "claimed", "confirmed"];

/** M-Pesa Lipa na M-Pesa till payment block for customers. */
export function formatMpesaTillBlock(amountKes = null) {
  return paymentVerificationPrompt(amountKes);
}

export function formatShortPaymentReminder(order) {
  if (!order || order.customerPaymentStatus === "confirmed") return null;
  const price = Number(order.priceKes);
  const priceLine = Number.isFinite(price) ? price.toLocaleString() : "—";
  return (
    `💳 *Payment reminder — ${order.id}*\n\n` +
    `On delivery, pay *KES ${priceLine}* to M-Pesa Till *${config.store.mpesaTill}* (${config.store.mpesaTillName}).\n\n` +
    `Do not pay riders or anyone else. Reply *paid* after you send payment.`
  );
}

export function resolveOrderStore(order) {
  if (!order) return null;
  if (order.pickupPointId) {
    const pp = getPickupPoint(order.pickupPointId);
    if (pp) {
      return {
        type: "pickup_point",
        id: pp.id,
        name: pp.shopName,
        phone: pp.phone,
        city: pp.city,
        county: pp.county,
      };
    }
  }
  if (order.supplierId) {
    const sup = getSupplier(order.supplierId);
    if (sup) {
      return {
        type: "supplier",
        id: sup.id,
        name: sup.businessName,
        phone: sup.phone,
        city: sup.city,
        county: sup.city,
      };
    }
  }
  if (order.fulfillmentStoreName || order.fulfillmentStorePhone) {
    return {
      type: "manual",
      id: order.fulfillmentStoreId || "manual",
      name: order.fulfillmentStoreName || "Store",
      phone: order.fulfillmentStorePhone || "",
      city: order.fulfillmentStoreCity || "",
      county: "",
    };
  }
  return null;
}

function orderMatchesCustomer(order, customerKey, phone = "") {
  if (!order) return false;
  if (order.customerKey === customerKey) return true;
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return false;
  const norm = (d) => {
    if (d.startsWith("254")) return d;
    if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
    if (d.length === 9) return `254${d}`;
    return d;
  };
  const want = norm(digits);
  const orderPhone = norm(String(order.phone || "").replace(/\D/g, ""));
  return orderPhone === want;
}

function pickOrderForPaidClaim(customerKey, text = "", phone = "") {
  const idMatch = text.match(/\bSK-?(\d{3,})\b/i);
  if (idMatch) {
    const order = getOrder(`SK-${idMatch[1]}`);
    if (orderMatchesCustomer(order, customerKey, phone)) return order;
  }

  const active = getOrdersForCustomer(customerKey, phone).filter(
    (o) =>
      o.customerPaymentStatus !== "confirmed" &&
      !["cancelled"].includes(o.status) &&
      ["confirmed", "packed", "out_for_delivery", "delivered"].includes(o.status)
  );
  if (active.length === 0) {
    return (
      getOrdersForCustomer(customerKey, phone).find((o) => o.customerPaymentStatus !== "confirmed" && o.status !== "cancelled") ||
      null
    );
  }
  const priority = ["out_for_delivery", "delivered", "packed", "confirmed"];
  for (const st of priority) {
    const hit = active.find((o) => o.status === st);
    if (hit) return hit;
  }
  return active[0];
}

export function buildAdminPaidClaimMessage(order) {
  const store = resolveOrderStore(order);
  const storeBlock = store
    ? `*Store / pickup point:* ${store.name}\n` +
      `*Store ID:* ${store.id}\n` +
      `*Store WhatsApp:* +${store.phone || "—"}\n` +
      (store.city ? `*Location:* ${store.city}${store.county ? `, ${store.county}` : ""}\n` : "")
    : `*Store:* Not assigned yet — use #pickup ${order.id} <pp-id>\n`;

  return (
    `💰 *Customer payment claim* — ${order.id}\n\n` +
    `*Customer:* ${order.customerName}\n` +
    `*Customer phone:* ${order.phone}\n` +
    `*Chat:* \`${order.customerKey}\`\n` +
    `*Amount:* KES ${order.priceKes.toLocaleString()}\n` +
    `*Order status:* ${order.status}\n\n` +
    storeBlock +
    `\n*Confirm:* #payconfirm ${order.id}\n` +
    `*Then notify store:* #notify-store ${order.id}`
  );
}

/** Customer replied "paid" — flag for admin review. */
export async function handleCustomerPaidClaim(customerKey, text, phone = "") {
  const order = pickOrderForPaidClaim(customerKey, text, phone);
  if (!order) {
    await sendText(
      customerKey,
      `I couldn't find an active order to mark as paid.\n\nType *track* or your order number (e.g. *SK-1042*), then reply *paid* again.`
    );
    return true;
  }

  if (order.customerPaymentStatus === "confirmed") {
    await sendText(customerKey, paymentConfirmedMessage({ orderId: order.id, amountKes: order.priceKes }));
    return true;
  }

  if (order.customerPaymentStatus === "claimed") {
    await sendText(
      customerKey,
      `We already received your *paid* notice for *${order.id}*. Our team is confirming with M-Pesa — we'll update you shortly 🙏`
    );
    return true;
  }

  updateOrderMeta(order.id, {
    customerPaymentStatus: "claimed",
    customerPaidClaimedAt: Date.now(),
  });

  await sendText(
    customerKey,
    `Asante! 🙏 We received your payment notice for *${order.id}* (KES ${order.priceKes.toLocaleString()}).\n\nOur team will verify your M-Pesa payment to Till *${config.store.mpesaTill}* and confirm shortly.`
  );

  if (config.admin.primary) {
    try {
      await sendText(config.admin.primary, buildAdminPaidClaimMessage(getOrder(order.id)));
    } catch (err) {
      console.error("[payment] admin notify failed:", err.message);
    }
  }

  return true;
}

export function listPendingPaymentClaims() {
  return listRecentOrders(50).filter((o) => o.customerPaymentStatus === "claimed");
}

export function filterPendingPaymentClaims(orders) {
  return orders.filter((o) => o.customerPaymentStatus === "claimed");
}

export async function notifyStorePaymentConfirmed(order) {
  const store = resolveOrderStore(order);
  if (!store?.phone) {
    return { error: "no_store", message: "No store/pickup point assigned. Use #pickup SK-xxxx <pp-id> first." };
  }

  const storeChat = `${String(store.phone).replace(/\D/g, "")}@c.us`;
  const msg =
    `✅ *Payment confirmed — ${order.id}*\n\n` +
    `Customer *${order.customerName}* (+${String(order.phone).replace(/\D/g, "")}) has paid *KES ${order.priceKes.toLocaleString()}* to Sokoni Till *${config.store.mpesaTill}*.\n\n` +
    `*Product:* ${order.productName}\n` +
    `Release the parcel to the customer after verifying their order ID.\n\n` +
    `_Sokoni admin_`;

  await sendText(storeChat, msg);
  updateOrderMeta(order.id, { storeNotifiedPaymentAt: Date.now() });
  return { ok: true, store };
}
