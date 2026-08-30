/**
 * Sokoni WhatsApp UX — unified message builders.
 * Layout: emoji + BOLD STATUS [OrderId] → • Key: Value bullets → short CTA.
 * No filler walls of text; locations must be pre-deduped by callers.
 */
import {
  generateOrderPrintLabelUrl,
  generateRiderScanUrl,
  sellerHubRestockUrl,
  dedupeLocationLine,
} from "./order-qr-links.js";

export function waHeader(emoji, status, orderId = "") {
  const id = orderId ? ` [${String(orderId).toUpperCase()}]` : "";
  return `${emoji} *${String(status || "").toUpperCase()}*${id}`;
}

export function waBullets(pairs = []) {
  return pairs
    .filter((p) => p && p[1] != null && String(p[1]).trim() !== "")
    .map(([k, v]) => `• *${k}:* ${v}`)
    .join("\n");
}

export function waCta(command) {
  return `Reply: *${command}*`;
}

export { dedupeLocationLine, generateOrderPrintLabelUrl, generateRiderScanUrl, sellerHubRestockUrl };

/** Buyer — order cancelled: seller missing shipping rates. */
export function msgBuyerShippingCancel(orderId, itemName) {
  return [
    waHeader("❌", "ORDER CANCELLED", orderId),
    "",
    waBullets([
      ["Item", itemName || "this item"],
      ["Reason", "Seller has not set delivery rates for your area"],
      ["Payment", "No funds deducted"],
    ]),
    "",
    "Reply *menu* to keep shopping.",
  ].join("\n");
}

/** Seller — order cancelled: missing shipping rates. */
export function msgSellerShippingCancel(orderId, itemName, region) {
  return [
    waHeader("🚨", "ORDER CANCELLED", orderId),
    "",
    waBullets([
      ["Item", itemName || "your item"],
      ["Reason", `Missing shipping fees${region ? ` for *${dedupeLocationLine(region)}*` : ""}`],
      ["Impact", "Lost sale — STK was never sent"],
    ]),
    "",
    "👉 Seller Hub → *Hub Drop-off & Shipping* — set fees for all regions.",
  ].join("\n");
}

/** Seller — 2h reminder to configure shipping. */
export function msgSellerShippingReminder() {
  return [
    waHeader("🟡", "ACTION REQUIRED", ""),
    "",
    "Set your shipping rates or buyer checkouts will be *cancelled* automatically.",
    "",
    waBullets([
      ["1", "Open sokonimall.com/suppliers/list.html"],
      ["2", "Hub Drop-off & Shipping tab"],
      ["3", "Select regions & enter fees"],
      ["4", "Save"],
    ]),
  ].join("\n");
}

/** Seller — new paid order (+ printable QR waybill). */
export function msgSellerNewPaidOrder({
  orderId,
  itemName,
  listingId,
  location,
  payoutKes,
  localRider = false,
  qrCodeUrl,
}) {
  const loc = dedupeLocationLine(location) || "—";
  const printUrl = qrCodeUrl || generateOrderPrintLabelUrl(orderId);
  const lines = [
    waHeader("🎉", "NEW PAID ORDER", orderId),
    "",
    waBullets([
      ["Item", listingId ? `${itemName || "Item"} (${listingId})` : itemName || "Item"],
      ["Drop-off area", loc],
      [
        "Your payout",
        payoutKes != null && Number.isFinite(Number(payoutKes))
          ? `KES ${Number(payoutKes).toLocaleString()}`
          : null,
      ],
    ]),
    "",
    "🖨️ *PRINTABLE QR WAYBILL:*",
    printUrl,
    "",
    `⚠️ Package the item and attach the printed QR (or write *${String(orderId || "").toUpperCase()}* on the box).`,
  ];
  if (localRider) {
    lines.push("", "Sokoni assigns the rider. Hand over *only* after verifying the pickup code at your door.");
  } else {
    lines.push("", waCta(`DISPATCH ${orderId}`), `(Upcountry: *WAYBILL ${orderId} Courier TRACKING*)`);
  }
  lines.push("", `Need help? Reply *HELP ${orderId}*`);
  return lines.join("\n");
}

/** Seller — low / zero stock. */
export function msgSellerLowStock({ itemName, remainingUnits, restockUrl, variantLines = "" }) {
  const left = Math.max(0, Math.round(Number(remainingUnits) || 0));
  const title = left === 0 ? "OUT OF STOCK" : "LOW STOCK ALERT";
  return [
    waHeader("⚠️", title, ""),
    "",
    waBullets([
      ["Item", itemName || "Item"],
      ["Remaining", `${left} unit${left === 1 ? "" : "s"}`],
    ]),
    variantLines ? `\n${variantLines}` : "",
    "",
    "👉 Restock on Seller Hub:",
    restockUrl || sellerHubRestockUrl(),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Rider — new job offer. */
export function msgRiderJobOffer({ orderId, pickup, dropoff, feeKes, offerLabel = "" }) {
  return [
    waHeader("🛵", "NEW DELIVERY OFFER", orderId),
    offerLabel ? `\n${offerLabel}` : "",
    "",
    waBullets([
      ["Pickup", dedupeLocationLine(pickup) || "—"],
      ["Drop-off", dedupeLocationLine(dropoff) || "—"],
      ["Delivery fee", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()}` : "—"],
    ]),
    "",
    "⏱️ Reply *ACCEPT " + String(orderId).toUpperCase() + "* within *45 seconds*.",
    `Busy? *DECLINE ${String(orderId).toUpperCase()}*`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Rider — after ACCEPT: seller pickup only (no buyer details) + scan link. */
export function msgRiderPickupStep({
  orderId,
  shopName,
  pickupAddr,
  sellerPhone,
  feeKes,
  lateMins = 15,
  scanUrl,
}) {
  const scan = scanUrl || generateRiderScanUrl(orderId);
  return [
    waHeader("🟢", "JOB CONFIRMED", orderId),
    "",
    "*STEP 1: PROCEED TO SELLER*",
    waBullets([
      ["Shop name", shopName || "Seller shop"],
      ["Address", dedupeLocationLine(pickupAddr) || "—"],
      ["Seller contact", sellerPhone || "—"],
      ["Delivery fee", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()} (held)` : "—"],
    ]),
    "",
    "📷 *SCAN PARCEL QR:*",
    scan,
    "",
    `🔐 Or request the 4-digit *Pickup Code* from the seller.`,
    `⏱ Enter within *${lateMins} minutes* or the job is released.`,
    "",
    waCta(`PICKUP ${orderId} <CODE>`),
  ].join("\n");
}

/** Buyer — rider assigned, still collecting from seller. */
export function msgBuyerRiderAssigned({ orderId, riderName, riderPhone, plate }) {
  return [
    waHeader("🛵", "RIDER ASSIGNED", orderId),
    "",
    "A vetted rider is collecting your parcel from the seller.",
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Vehicle", plate || "—"],
    ]),
    "",
    "You'll get another alert when it is *out for delivery*.",
  ].join("\n");
}

/** Seller — rider assigned + pickup OTP. */
export function msgSellerRiderAssigned({ orderId, riderName, riderPhone, plate, pickupAddr, pickupOtp }) {
  return [
    waHeader("🟢", "RIDER ASSIGNED", orderId),
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Vehicle", plate || "—"],
      ["Handoff at", dedupeLocationLine(pickupAddr) || "your shop"],
    ]),
    "",
    `🔐 *YOUR PICKUP CODE:* *${pickupOtp}*`,
    "_(Hand over the parcel ONLY after verifying this code with the rider at your door)._",
  ].join("\n");
}

/** Rider — after pickup OTP: buyer delivery details. */
export function msgRiderDeliveryStep({ orderId, buyerName, dropoffAddr, buyerPhone, feeKes }) {
  return [
    waHeader("📦", "PICKUP VERIFIED", orderId),
    "",
    "*STEP 2: DELIVER TO BUYER*",
    waBullets([
      ["Customer", buyerName || "Buyer"],
      ["Drop-off address", dedupeLocationLine(dropoffAddr) || "—"],
      ["Buyer contact", buyerPhone || "—"],
      ["Fee held", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()}` : "—"],
    ]),
    "",
    "🔐 Request the *Delivery Code* from the buyer at the door.",
    waCta(`CONFIRM ${orderId} <CODE>`),
  ].join("\n");
}

/** Buyer — payment confirmed. */
export function msgBuyerPaymentConfirmed({ orderId, itemName, totalKes, location }) {
  return [
    waHeader("✅", "PAYMENT CONFIRMED", orderId),
    "",
    waBullets([
      ["Item", itemName || "Item"],
      [
        "Total paid",
        totalKes != null && Number.isFinite(Number(totalKes))
          ? `KES ${Number(totalKes).toLocaleString()}`
          : null,
      ],
      ["Delivery to", dedupeLocationLine(location) || "—"],
    ]),
    "",
    "📦 What happens next: we assign a vetted rider (or the seller ships) to move your package.",
  ].join("\n");
}

/** Buyer — out for delivery after pickup. */
export function msgBuyerOutForDelivery({ orderId, riderName, riderPhone, plate, deliveryOtp }) {
  return [
    waHeader("🛵", "ORDER OUT FOR DELIVERY", orderId),
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Vehicle", plate || "—"],
      ["Delivery code", deliveryOtp ? `*${deliveryOtp}*` : "(sent separately)"],
    ]),
    "",
    "Share this 4-digit code with the rider *only when they deliver* your parcel. Stay near your phone.",
  ].join("\n");
}

/** Admin — package handed to rider. */
export function msgAdminPickupHandover({
  orderId,
  riderName,
  riderPhone,
  plate,
  sellerPhone,
  sellerName,
  buyerName,
  buyerPhone,
  escrowKes,
}) {
  return [
    waHeader("📦", "DISPATCH AUDIT", orderId),
    "",
    waBullets([
      ["Status", "IN_TRANSIT"],
      ["Seller", sellerName ? `${sellerName} (${sellerPhone || "—"})` : sellerPhone || "—"],
      ["Rider", riderName ? `${riderName} (${riderPhone || "—"})` : riderPhone || "—"],
      ["Vehicle", plate || "—"],
      ["Buyer", buyerName ? `${buyerName} (${buyerPhone || "—"})` : buyerPhone || "—"],
      [
        "Escrow held",
        escrowKes != null && Number.isFinite(Number(escrowKes))
          ? `KES ${Number(escrowKes).toLocaleString()}`
          : null,
      ],
    ]),
  ].join("\n");
}

/** Rider — bad pickup command format. */
export function msgPickupFormatHint(orderIdHint = "SKN-XXXX") {
  return [
    waHeader("❌", "INVALID FORMAT", ""),
    "",
    "Use this exact pattern:",
    waCta(`PICKUP ${orderIdHint} 1234`),
    "",
    `Example: *PICKUP SKN-1015 5972*`,
  ].join("\n");
}
