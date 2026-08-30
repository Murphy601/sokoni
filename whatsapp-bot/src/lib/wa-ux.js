/**
 * Sokoni WhatsApp UX — unified message builders.
 * Layout: emoji + BOLD STATUS [OrderId] → • Key: Value bullets → CTA in *code* form.
 */
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

/** Buyer — order cancelled: seller missing shipping rates. */
export function msgBuyerShippingCancel(orderId, itemName) {
  return [
    waHeader("❌", "ORDER CANCELLED", orderId),
    "",
    `We couldn't process your request for *"${itemName || "this item"}"*.`,
    "",
    waBullets([
      ["Reason", "Seller has not set delivery rates for your area"],
      ["Refund status", "No funds deducted"],
    ]),
    "",
    "We apologize for the inconvenience. Reply *menu* to keep shopping.",
  ].join("\n");
}

/** Seller — order cancelled: missing shipping rates. */
export function msgSellerShippingCancel(orderId, itemName, region) {
  return [
    waHeader("🚨", "ORDER CANCELLED", orderId),
    "",
    `An order for *"${itemName || "your item"}"* was automatically cancelled.`,
    "",
    waBullets([
      ["Reason", `Missing shipping fees${region ? ` for *${region}*` : ""}`],
      ["Impact", "Lost sale — STK was never sent"],
    ]),
    "",
    "👉 Open your Seller Hub → *Hub Drop-off & Shipping* and set fees for all regions.",
  ].join("\n");
}

/** Seller — 2h reminder to configure shipping. */
export function msgSellerShippingReminder() {
  return [
    waHeader("🟡", "ACTION REQUIRED", ""),
    "",
    "*Set your shipping rates!*",
    "",
    "Orders will be *automatically cancelled* if buyers check out before you configure delivery fees.",
    "",
    "*How to set rates (4 steps):*",
    "1️⃣ Log in at sokonimall.com/suppliers/list.html (or Seller Hub)",
    "2️⃣ Open the *Hub Drop-off & Shipping* tab",
    "3️⃣ Select delivery *regions & locations*",
    "4️⃣ Enter the fixed fee per area and tap *Save* 💾",
    "",
    "Configure this now so you don't lose orders.",
  ].join("\n");
}

/** Rider — new job offer. */
export function msgRiderJobOffer({ orderId, pickup, dropoff, feeKes, offerLabel = "" }) {
  return [
    waHeader("🛵", "NEW DELIVERY OFFER", orderId),
    offerLabel ? `\n${offerLabel}` : "",
    "",
    waBullets([
      ["Pickup", pickup || "—"],
      ["Drop-off", dropoff || "—"],
      ["Earning", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()}` : "—"],
    ]),
    "",
    "⏱️ Claim within *45 seconds*.",
    waCta(`ACCEPT ${orderId}`),
    `Busy? *DECLINE ${orderId}*`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Rider — after ACCEPT: seller pickup only (no buyer details). */
export function msgRiderPickupStep({
  orderId,
  shopName,
  pickupAddr,
  sellerPhone,
  feeKes,
  lateMins = 15,
}) {
  return [
    waHeader("🟢", "JOB CONFIRMED", orderId),
    "",
    "*STEP 1: PROCEED TO SELLER*",
    waBullets([
      ["Shop", shopName || "Seller shop"],
      ["Location", pickupAddr || "—"],
      ["Seller contact", sellerPhone || "—"],
      ["Earning", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()} (held)` : "—"],
    ]),
    "",
    `🔐 Ask the seller for the *Pickup Code* at the shop.`,
    `⏱ Enter it within *${lateMins} minutes* or the job is released.`,
    "",
    waCta(`PICKUP ${orderId} <CODE>`),
  ].join("\n");
}

/** Buyer — rider assigned, still collecting from seller. */
export function msgBuyerRiderAssigned({ orderId, riderName, riderPhone, plate }) {
  return [
    waHeader("🛵", "RIDER ASSIGNED", orderId),
    "",
    "A vetted Sokoni rider is heading to the seller to collect your parcel.",
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Plate", plate || "—"],
    ]),
    "",
    "You'll get another alert when the package is *out for delivery*.",
  ].join("\n");
}

/** Seller — rider assigned + pickup OTP. */
export function msgSellerRiderAssigned({ orderId, riderName, riderPhone, plate, pickupAddr, pickupOtp }) {
  return [
    waHeader("🟢", "BODA ASSIGNED", orderId),
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Plate", plate || "—"],
      ["Handoff at", pickupAddr || "your shop"],
    ]),
    "",
    `📦 *PICKUP CODE (speak at handoff only):* *${pickupOtp}*`,
    "Do not share this code on chat — say it when the rider is at your door.",
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
      ["Drop-off", dropoffAddr || "—"],
      ["Contact", buyerPhone || "—"],
      ["Fee held", feeKes > 0 ? `KES ${Number(feeKes).toLocaleString()}` : "—"],
    ]),
    "",
    "🔐 At the door: share *live WhatsApp location*, then ask for the delivery OTP.",
    waCta(`CONFIRM ${orderId} <CODE>`),
    "(3 wrong tries locks your account)",
  ].join("\n");
}

/** Buyer — out for delivery after pickup. */
export function msgBuyerOutForDelivery({ orderId, riderName, riderPhone, plate, deliveryOtp }) {
  return [
    waHeader("🛵", "OUT FOR DELIVERY", orderId),
    "",
    "Your parcel has left the seller and is on the way.",
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Phone", riderPhone || "—"],
      ["Plate", plate || "—"],
      ["Delivery OTP", deliveryOtp ? `*${deliveryOtp}*` : "(sent separately)"],
    ]),
    "",
    "📞 *Please stay near your phone.*",
    "Give the 4-digit code to this rider *only after* you receive and check the package.",
  ].join("\n");
}

/** Admin — package handed to rider. */
export function msgAdminPickupHandover({ orderId, riderName, riderPhone, plate, sellerPhone }) {
  return [
    waHeader("📦", "DISPATCH AUDIT", orderId),
    "",
    "Package handed to rider — status *IN_TRANSIT*.",
    "",
    waBullets([
      ["Rider", riderName || "—"],
      ["Rider phone", riderPhone || "—"],
      ["Plate", plate || "—"],
      ["Seller phone", sellerPhone || "—"],
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
    "Example: *PICKUP SKN-1015 5972*",
  ].join("\n");
}
