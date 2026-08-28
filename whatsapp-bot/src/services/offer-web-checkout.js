/**
 * On-site accepted-offer → prepaid order (web checkout).
 * Keeps bargaining on the site; WhatsApp stays notify-only.
 */
import { getAcceptedOfferForCheckout } from "../db/repositories/social.js";
import { getProductById } from "./catalog.js";
import { createOrder, registerContact } from "./orders.js";
import { normalizeKenyanPhone } from "./delivery-details.js";
import { resolveLandmarkSelection } from "../lib/landmark-hubs.js";

function normalizeMpesaPhone(raw) {
  const local = normalizeKenyanPhone(raw);
  if (!local) return null;
  return `254${local.slice(1)}`;
}

/**
 * @param {{
 *   offerId: number|string,
 *   buyerUserId: number|string,
 *   name: string,
 *   location?: string,
 *   phone: string,
 *   deliveryType?: string,
 *   landmarkTown?: string,
 *   landmarkSpot?: string,
 *   landmarkId?: string,
 *   landmarkInstructions?: string,
 * }} args
 */
export async function placeOrderFromAcceptedOffer({
  offerId,
  buyerUserId,
  name,
  location,
  phone,
  deliveryType,
  landmarkTown,
  landmarkSpot,
  landmarkId,
  landmarkInstructions,
} = {}) {
  const checkout = await getAcceptedOfferForCheckout({ offerId, buyerUserId });
  if (checkout.error) return checkout;

  const fullName = String(name || "").trim();
  const mpesaPhone = normalizeMpesaPhone(phone);

  if (fullName.length < 3 || fullName.split(/\s+/).length < 2) {
    return {
      error: "invalid_delivery_details",
      message: "Enter your full name (first and last name).",
    };
  }
  if (!mpesaPhone) {
    return {
      error: "invalid_delivery_details",
      message: "Enter a valid Kenyan phone number for M-Pesa / the rider.",
    };
  }

  const landmark = resolveLandmarkSelection({
    deliveryType,
    town: landmarkTown,
    spotName: landmarkSpot,
    landmarkId,
    instructions: landmarkInstructions,
    locationText: location,
  });
  if (landmark.error) {
    return { error: landmark.error, message: landmark.message };
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

  let order;
  try {
    order = createOrder({
      customerKey,
      chatId: customerKey,
      product: { ...product, productId: product.id },
      details: {
        name: fullName,
        location: landmark.location,
        phone: mpesaPhone,
        deliveryType: landmark.deliveryType,
        landmarkTown: landmark.landmarkTown,
        landmarkSpot: landmark.landmarkSpot,
        landmarkInstructions: landmark.landmarkInstructions,
        landmarkId: landmark.landmarkId,
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
  } catch (err) {
    return {
      ok: false,
      error: err.code || "create_order_failed",
      message: err.message || "Could not create order.",
      onHand: err.onHand,
    };
  }

  return {
    ok: true,
    orderId: order.id,
    order,
    offer: checkout.offer,
    breakdown: checkout.breakdown,
    productName: product.name || checkout.offer?.product?.title || checkout.productId,
  };
}
