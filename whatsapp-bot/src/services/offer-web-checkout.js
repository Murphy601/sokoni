/**
 * On-site accepted-offer → prepaid order (web checkout).
 * Keeps bargaining on the site; WhatsApp stays notify-only.
 */
import { getAcceptedOfferForCheckout } from "../db/repositories/social.js";
import { getProductById } from "./catalog.js";
import { createOrder, registerContact } from "./orders.js";
import { normalizeKenyanPhone } from "./delivery-details.js";

function normalizeMpesaPhone(raw) {
  const local = normalizeKenyanPhone(raw);
  if (!local) return null;
  return `254${local.slice(1)}`;
}

/**
 * @param {{ offerId: number|string, buyerUserId: number|string, name: string, location: string, phone: string }} args
 */
export async function placeOrderFromAcceptedOffer({
  offerId,
  buyerUserId,
  name,
  location,
  phone,
} = {}) {
  const checkout = await getAcceptedOfferForCheckout({ offerId, buyerUserId });
  if (checkout.error) return checkout;

  const fullName = String(name || "").trim();
  const deliveryLocation = String(location || "").trim();
  const mpesaPhone = normalizeMpesaPhone(phone);

  if (fullName.length < 3 || fullName.split(/\s+/).length < 2) {
    return {
      error: "invalid_delivery_details",
      message: "Enter your full name (first and last name).",
    };
  }
  if (deliveryLocation.length < 4) {
    return {
      error: "invalid_delivery_details",
      message: "Enter a clearer delivery location (estate/town + landmark).",
    };
  }
  if (!mpesaPhone) {
    return {
      error: "invalid_delivery_details",
      message: "Enter a valid Kenyan phone number for M-Pesa / the rider.",
    };
  }

  const product = await getProductById(checkout.productId);
  if (!product) {
    return { error: "product_not_found", message: "Product is no longer available." };
  }

  const customerKey = `web:buyer:${Number(buyerUserId)}`;
  registerContact(customerKey, {
    chatId: customerKey,
    displayName: fullName,
    phone: mpesaPhone,
  });

  const order = createOrder({
    customerKey,
    chatId: customerKey,
    product: { ...product, productId: product.id },
    details: {
      name: fullName,
      location: deliveryLocation,
      phone: mpesaPhone,
    },
    offerId: checkout.offer.id,
    totalsOverride: {
      itemKes: checkout.breakdown.itemKes,
      shippingKes: checkout.breakdown.shippingKes,
      totalKes: checkout.breakdown.totalKes,
      platformFeeKes: checkout.breakdown.platformFeeKes,
      sellerNetKes: checkout.breakdown.sellerNetKes,
    },
  });

  return {
    ok: true,
    orderId: order.id,
    order,
    offer: checkout.offer,
    breakdown: checkout.breakdown,
    productName: product.name || checkout.offer?.product?.title || checkout.productId,
  };
}
