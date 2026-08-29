import { config } from "../config.js";

/** All customer-facing offers are capped at 3% — no flat KES or free-delivery promos. */
export const OFFER_PERCENT = config.offers?.maxDiscountPercent ?? 3;
export const PROMO_CODE = config.offers?.promoCode ?? "SOKONI3";

export function formatPhoneDisplay() {
  return config.contact?.phoneDisplay || "+254 117 422 428";
}

export function formatSupportEmail() {
  return (
    config.contact?.email ||
    config.contact?.supportEmail ||
    process.env.SUPPORT_EMAIL ||
    "support@sokonimall.com"
  );
}

export function formatWhatsAppLink() {
  const n = config.store.businessNumber.replace(/\D/g, "");
  return `https://wa.me/${n}`;
}

/**
 * Deterministic contact card — never invent emails/phones.
 * Prefer this over LLM for "support email / customer care" queries.
 */
export function supportContactCard(channel = "whatsapp") {
  const email = formatSupportEmail();
  const phone = formatPhoneDisplay();
  const wa = formatWhatsAppLink();
  const hours = `${config.businessHours?.humanSupportStart || "07:30"}–${
    config.businessHours?.humanSupportEnd || "21:00"
  } EAT`;
  if (channel === "web") {
    return (
      `Sokoni support contacts:\n` +
      `• Email: ${email}\n` +
      `• WhatsApp / calls: ${phone}\n` +
      `• Chat: ${wa}\n` +
      `• Site: https://sokonimall.com\n` +
      `• Human support hours: ${hours}\n` +
      `For an order issue, include your SKN-####.`
    );
  }
  return (
    `📞 *Sokoni support*\n` +
    `• Email: *${email}*\n` +
    `• WhatsApp / calls: *${phone}*\n` +
    `• Link: ${wa}\n` +
    `• Site: sokonimall.com\n` +
    `• Humans: *${hours}*\n` +
    `Got an order? Send your *SKN-####* here too.`
  );
}

/** Customer-facing payment line — never expose till numbers or till account names. */
export function tillExplainLine() {
  return (
    `💳 *Pay:* M-Pesa STK on WhatsApp / sokonimall.com\n` +
    `📞 *WhatsApp / calls:* ${formatPhoneDisplay()}`
  );
}

export function paymentTrustDisclosure() {
  return (
    `Countrywide *100% prepaid* checkout — funds held in Sokoni escrow until delivery is confirmed.\n` +
    `Pay via *M-Pesa STK push* on WhatsApp or the website (PIN on your phone).\n\n` +
    `📞 Questions? WhatsApp ${formatPhoneDisplay()} anytime.\n` +
    `✅ *Verify:* call or WhatsApp us before paying to confirm your SKN-#### (or older SK-####) order number.\n` +
    `_No pay-on-delivery. No COD. Never pay riders or personal numbers._`
  );
}

export function founderLedSafetyBlock() {
  return (
    `🛡️ *Sokoni Mall* — Kenya prepaid marketplace\n` +
    `We're a young, growing Kenyan business onboarding our first customers.\n\n` +
    paymentTrustDisclosure()
  );
}

/** @deprecated use founderLedSafetyBlock */
export function betaSafetyBlock() {
  return founderLedSafetyBlock();
}

export function offerLine(extra = "") {
  const base = `🎫 Use code *${PROMO_CODE}* for *${OFFER_PERCENT}% off* eligible local orders`;
  return extra ? `${base} ${extra}` : base;
}

export function welcomeMessage() {
  return (
    `Habari! Welcome to *Sokoni Plug* 🤖🇰🇪\n` +
    `Your shopping assistant for Sokoni Mall — categories, deals, prepaid escrow & tracking.\n\n` +
    `${founderLedSafetyBlock()}\n\n` +
    `What are you shopping for today? (English, Kiswahili, or Sheng 👇)\n` +
    `Reply with a number from the menu below, or type what you need.`
  );
}

export function welcomeBackMessage(customerName = "") {
  const hi = customerName ? `Habari *${customerName}*!` : "Habari!";
  return (
    `${hi} Welcome back to *Sokoni Mall* 🎉🛍️\n` +
    `Great to see you again — our catalog has fresh local deals.\n\n` +
    `🛡️ *Your safety checklist:*\n` +
    `• 100% prepaid — escrow until delivery confirmed\n` +
    `• Official checkout: M-Pesa STK on WhatsApp / the site\n` +
    `• ${offerLine("this week")}\n\n` +
    `What can our AI find for you today?`
  );
}

export function broadcastReEngageMessage() {
  return (
    `Habari! It's the *Sokoni Mall* team 👋\n` +
    `We've upgraded our WhatsApp shopping assistant!\n\n` +
    `• 100% prepaid escrow — pay before dispatch\n` +
    `• Pay via M-Pesa STK only — never to personal numbers\n` +
    `• ${offerLine()}\n\n` +
    `Text us what you need in English, Kiswahili, or Sheng! 👇`
  );
}

export function prepaidOrderPlacedMessage({
  orderId,
  productName,
  amountKes,
  itemKes,
  shippingKes,
  customerName,
  location,
  phone,
}) {
  const total = Number(amountKes);
  const ship = Number(shippingKes);
  const priceLine = Number.isFinite(total) ? `KES ${total.toLocaleString()}` : "—";
  const shipBit = Number.isFinite(ship) && ship > 0 ? ` (incl. delivery KES ${ship.toLocaleString()})` : "";
  return (
    `✅ *${orderId}*\n` +
    `${productName}\n` +
    `*${priceLine}*${shipBit}\n` +
    `${customerName} · ${location}\n` +
    `${phone}`
  );
}

/** @deprecated use prepaidOrderPlacedMessage */
export function orderConfirmedMessage(args) {
  return prepaidOrderPlacedMessage(args);
}

export function howItWorksMessage(channel = "whatsapp") {
  if (channel === "web") {
    return (
      `How Sokoni works:\n\n` +
      `1. Browse sokonimall.com or ask on WhatsApp.\n` +
      `2. Order on WhatsApp (reply with the item number).\n` +
      `3. Pay M-Pesa STK — funds stay in prepaid escrow until delivery is confirmed.\n` +
      `4. Local delivery: seller gives a Pickup OTP; you confirm with a Delivery OTP (*CONFIRM SKN-#### ####*).\n` +
      `5. Track anytime with your SKN-####.\n\n` +
      `Support: support@sokonimall.com · ${formatPhoneDisplay()}`
    );
  }
  return (
    `🔒 *How Sokoni works*\n\n` +
    `1️⃣ Browse sokonimall.com or WhatsApp (*menu*), then order.\n\n` +
    `2️⃣ Pay *M-Pesa STK* — money stays in *escrow* until you confirm delivery.\n\n` +
    `3️⃣ Local orders: Sokoni pins a rider. Seller gives a *4-digit Pickup OTP*; rider replies *PICKUP SKN-#### ####*.\n\n` +
    `4️⃣ At delivery you give a *4-digit Delivery OTP*; rider replies *CONFIRM SKN-#### ####*.\n\n` +
    `5️⃣ Track anytime with your *SKN-####*.\n\n` +
    `_No COD. Never pay personal tills._ Type *menu* to shop.`
  );
}

export function paymentVerificationPrompt(amountKes = null) {
  const amt = amountKes != null && Number.isFinite(Number(amountKes)) ? Number(amountKes) : null;
  const amountLine = amt != null ? `Amount: *KES ${amt.toLocaleString()}*\n\n` : "";
  return (
    `Payment — prepaid escrow 🔑\n\n` +
    `Complete payment *before* we dispatch your order:\n\n` +
    amountLine +
    `💳 Complete *M-Pesa STK* (PIN on your phone) — funds stay in escrow until delivery.\n\n` +
    `✅ *Verify first:* WhatsApp ${formatPhoneDisplay()} to confirm your SKN-#### (or older SK-####) order number.\n` +
    `If STK fails, reply *pay* to retry, or *paid* with your M-Pesa code. 🧾`
  );
}

export function paymentConfirmedMessage({ orderId, amountKes }) {
  const amt = Number(amountKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "—";
  return `✅ Paid *${priceLine}* for *${orderId}*. We'll pack next.`;
}

export function outOfOfficeMessage() {
  return (
    `Habari! Thanks for reaching out to *Sokoni Mall* 🌙🤖\n` +
    `Our AI assistant is still active — browse the catalog or check order status right now.\n\n` +
    `🛑 *Human support & new dispatches:* our team rests overnight (9 PM–7:30 AM EAT). ` +
    `Human requests are prioritized from 7:30 AM.\n\n` +
    `⚠️ *Scam alert:* Sokoni will *never* ask for commitment or delivery fees upfront. ` +
    `Never pay riders or personal numbers — only M-Pesa STK through Sokoni.\n\n` +
    `Keep chatting with the AI — what can we look up for you? 👇`
  );
}

export function humanHandoffAck(isAfterHours = false) {
  const hours = isAfterHours
    ? "Our human team is offline until 7:30 AM EAT — we'll reply first thing in the morning."
    : "A real person from our team will reply here shortly (usually within a few hours, 7:30 AM–9 PM EAT).";
  return (
    `You're connected with our team 👋\n` +
    `${hours}\n\n` +
    `Not just a bot — we're here to verify orders, answer payment questions, or help you shop with confidence.\n` +
    `🛡️ Pay only via M-Pesa STK through Sokoni. Verify on ${formatPhoneDisplay()} before paying.\n` +
    `Type *menu* anytime to return to the shopping bot.`
  );
}

export function orderCancellationMessage({ orderId, productName }) {
  return (
    `Important Update on Order *${orderId}* ⚠️\n\n` +
    `Habari — quick update on *${productName}*.\n` +
    `Our supplier reports this item is out of stock. Order *${orderId}* has been safely cancelled.\n\n` +
    `🛡️ *Zero upfront deposit* — you were not charged anything.\n` +
    `🎁 Apology: ${offerLine("on your next order")}.\n\n` +
    `Reply with another item name (e.g. "show me another phone") and we'll find an alternative. 🙏`
  );
}

export function cartAbandonmentMessage({ productName }) {
  const name = productName || "your item";
  return (
    `Still interested in *${name}*? 🤔🛍️\n\n` +
    `Our AI noticed you were browsing but didn't finish ordering.\n\n` +
    `• No deposits upfront\n` +
    `• 100% prepaid escrow — M-Pesa STK before dispatch\n` +
    `• ${offerLine()}\n\n` +
    `Reply *Check Out* to continue, or *menu* to browse.`
  );
}

export function delayedDeliveryMessage({ orderId, productName, newWindow = "later today" }) {
  return (
    `Delivery Status Update: *${orderId}* 🛵⚠️\n\n` +
    `Habari — your order for *${productName}* is slightly delayed (${newWindow}).\n` +
    `We're tracking it actively.\n\n` +
    `🛡️ You still pay *nothing* until the item is in your hands. Reply *Human* for urgent help. 🙏`
  );
}

export function outForDeliveryMessage({ orderId, productName, customerName, riderName, riderPhone, timeWindow }) {
  return (
    `Your Sokoni Order is on the Way! 🛵💨\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""}! Order *${orderId}* for *${productName}* left our warehouse.\n\n` +
    (riderName ? `👤 Rider: ${riderName}\n` : "") +
    (riderPhone ? `📞 Rider phone: ${riderPhone}\n` : "") +
    (timeWindow ? `⏳ ETA: ${timeWindow}\n\n` : "\n") +
    `🛡️ Order is prepaid via M-Pesa STK — inspect on arrival. Contact us if anything is wrong.`
  );
}

export function damagedReturnMessage({ orderId, productName, reason = "damaged / wrong variant" }) {
  return (
    `Order Update: Return for *${orderId}* 🔄📦\n\n` +
    `Habari — we heard *${productName}* did not meet expectations (${reason}).\n` +
    `We're sorry and investigating with our supplier.\n\n` +
    `🛡️ Pay-on-delivery means you owe nothing. Hand the package back to the rider free of charge.\n\n` +
    `Reply *REPLACE* for a corrected item, or *CANCEL* to close the request.`
  );
}

/** Admin or automated reply when warehouse packed / rider delivered the wrong item. */
export function wrongOrderApologyMessage({
  orderId,
  productName,
  customerName,
  orderedItem,
  receivedItem,
}) {
  const ordered = orderedItem || productName || "your item";
  const received = receivedItem || "a different item";
  return (
    `Habari${customerName ? ` *${customerName}*` : ""} — pole sana 🙏\n\n` +
    `We got order *${orderId}* wrong. You ordered *${ordered}* but received *${received}*. That's on us, not you.\n\n` +
    `1️⃣ Keep the package sealed if you can\n` +
    `2️⃣ Reply *REPLACE* — we'll send the correct item\n` +
    `   OR reply *CANCEL* — we'll close it, no charge\n\n` +
    `🛡️ Pay-on-delivery: you owe nothing for the wrong item. Hand it back to the rider at no extra cost.\n\n` +
    `As a sorry: use code *${PROMO_CODE}* for ${OFFER_PERCENT}% off your next order.\n` +
    `Reply here or type *Human* if you need us faster. Asante for your patience. 🙏`
  );
}

export function mpesaTroubleshootMessage({ orderId, amountKes }) {
  const amt = Number(amountKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "your order total";
  return (
    `M-Pesa Transaction Error? Let's Fix It! 🛠️📱\n\n` +
    `Order *${orderId}* payment didn't go through — usually a quick network glitch.\n\n` +
    `1️⃣ Reply *pay* to resend the M-Pesa STK prompt\n` +
    `2️⃣ Ensure balance covers *${priceLine}* plus Safaricom fees\n` +
    `3️⃣ Stay on network until PIN confirms\n\n` +
    `Reply *paid* with your confirmation code if it went through another way. 🙏`
  );
}

export function aiSurveyMessage() {
  return (
    `Help Us Train Our Shopping AI! 🤖🇰🇪\n\n` +
    `How smart was our AI in your recent chat? Reply *1*, *2*, or *3*:\n` +
    `1️⃣ Excellent — understood immediately\n` +
    `2️⃣ Okay — had to rephrase a few times\n` +
    `3️⃣ Poor — needed a human agent\n\n` +
    `Add any suggestion after your number. Asante! 🚀`
  );
}

export function priceNegotiationMessage() {
  return (
    `Looking for a better deal? 🧐📉\n\n` +
    `Our AI already scans distributors for competitive wholesale pricing.\n\n` +
    `💡 Save more today:\n` +
    `• ${offerLine()}\n` +
    `• Order 2+ of the same item — ask us about bundle pricing on WhatsApp\n\n` +
    `🛡️ Pay only via M-Pesa STK through Sokoni — never to personal numbers.\n` +
    `Reply *YES* to apply *${PROMO_CODE}* (${OFFER_PERCENT}% off) to your order.`
  );
}

export function referralProgramMessage({ referralCode = "" }) {
  const code = referralCode || "your link";
  const site = config.publicSiteUrl || "https://sokonimall.com";
  return (
    `Share Sokoni & Save! 🎁🇰🇪\n\n` +
    `Invite friends to shop risk-free on Pay-on-Delivery:\n` +
    `1️⃣ Share: ${site}?ref=${code}\n` +
    `2️⃣ Friends get *${OFFER_PERCENT}% off* their first local order (code *${PROMO_CODE}*)\n` +
    `3️⃣ You earn *${OFFER_PERCENT}% credit* on your next order when they complete prepaid checkout\n\n` +
    `Let's build safer shopping together. 🚀`
  );
}

export function vendorOnboardingMessage() {
  return (
    `Partner with Sokoni Mall! 📈\n\n` +
    `Sell to thousands via our WhatsApp AI marketplace.\n\n` +
    `• Zero listing fees\n` +
    `• Customers order through Sokoni only\n` +
    `• Buyers pay prepaid escrow — we remit your payout after delivery\n\n` +
    `Reply with: *Company Name*, *Product Category*, and *Town/Location*.\n` +
    `Our vendor team responds within 24 hours. 🤝`
  );
}

export function proformaInvoiceMessage() {
  return (
    `Need a Corporate Pro-Forma Invoice? 📄💼\n\n` +
    `Reply with:\n` +
    `• Full company name\n` +
    `• Physical/postal address\n` +
    `• Attention (Procurement/Finance)\n` +
    `• Email for the PDF\n\n` +
    `Settlements reconcile via Sokoni prepaid escrow.\n` +
    `Our finance desk emails your invoice within 30 minutes. 🧾`
  );
}

export function giftWrapMessage() {
  return (
    `Sending a Gift or Surprise? 🎁💝\n\n` +
    `Yes — we can ship surprises countrywide with gift wrapping (KES 250 add-on).\n` +
    `Includes wrapping, ribbon, and a custom greeting card. Pricing hidden from recipient.\n\n` +
    `🛡️ Surprise orders paid by sender: complete M-Pesa STK before dispatch.\n` +
    `Recipient-paid surprises use standard Pay-on-Delivery.\n\n` +
    `Reply *WRAP* and your card message below! 👇`
  );
}

export function addressChangeMessage() {
  return (
    `Need to change your delivery location? 📍🛵\n\n` +
    `Reply in this format:\n` +
    `• New Town/Area: e.g. Kilimani, Nairobi\n` +
    `• Landmark: e.g. Opposite Yaya Centre, House 4\n\n` +
    `⏳ Different zones may reschedule to tomorrow morning.\n` +
    `🛡️ No rerouting fees. Prepaid escrow still applies.\n` +
    `Type your new details below! 👇`
  );
}

export function outOfZoneMessage() {
  return (
    `Outside Our Direct Delivery Zone? 📦🌍\n\n` +
    `We can still ship via countrywide courier partners (G4S, Fargo, etc.).\n` +
    `• Package to your nearest hub — 2–3 business days outside Nairobi\n\n` +
    `Reply *SHIPPING* and our ops desk will quote delivery cost and collection point.\n` +
    `Pay only via Sokoni M-Pesa STK. Never pay unverified personal lines.`
  );
}

export function postDeliveryDamageMessage({ orderId, productName, customerName }) {
  return (
    `We're So Sorry! Let's Make This Right 🛠️💔\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""} — sorry about the issue with *${productName}*.\n\n` +
    `1️⃣ Reply with a photo or short video of the problem\n` +
    `2️⃣ Confirm order *${orderId}*\n\n` +
    `We'll dispatch a replacement via priority rider. Hand the faulty item back at no extra cost. 🙏`
  );
}

export function weekendDeliveryMessage({ orderId }) {
  return (
    `Weekend Delivery Confirmation 🛵☀️\n\n` +
    `Order *${orderId}* received — it's the weekend!\n` +
    `Reply *1* for weekend delivery (today/tomorrow)\n` +
    `Reply *2* for Monday office-hours delivery\n\n` +
    `🛡️ Prepaid via M-Pesa STK either way — escrow until delivery.`
  );
}

export function pickupReadyMessage({ orderId, stationName, hours, customerName }) {
  return (
    `Package Ready at Pick-Up Station! 📦🏢\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""}! Order *${orderId}* is ready.\n\n` +
    `📍 *${stationName || "Partner hub"}*\n` +
    `⏰ ${hours || "8:00 AM – 6:30 PM"}\n` +
    `⏳ Collect within 48 hours.\n\n` +
    `🛡️ Prepaid via M-Pesa STK — inspect on pickup. No storage fees to agents.`
  );
}

export function corporateBulkMessage() {
  return (
    `Planning a Corporate Bulk Order? 🏢🎁\n\n` +
    `We support volume purchasing with tiered pricing up to *${OFFER_PERCENT}% off* for qualifying bulk orders.\n` +
    `• Pro-forma invoices & delivery notes\n` +
    `• Split deliveries to multiple offices\n\n` +
    `Reply: *Company Name*, *Item*, *Quantity* for a quote within 30 minutes.\n` +
    `Payments via Sokoni M-Pesa STK (escrow).`
  );
}

export function accountDeletionMessage() {
  return (
    `Account Deletion Request 🔒⚠️\n\n` +
    `We received your request to delete your Sokoni profile and chat logs.\n\n` +
    `Within 24 hours we purge your phone number, addresses, and transcripts.\n` +
    `Active referral balances are forfeited.\n\n` +
    `Reply *DELETE* to confirm permanent erasure, or *menu* to stay.`
  );
}

export function broadcastOptOutAck() {
  return (
    `You've been unsubscribed from Sokoni promotional broadcasts ✅\n` +
    `You'll still get order updates and can shop anytime — type *menu*.\n` +
    `Reply *START* to re-subscribe to deals (${OFFER_PERCENT}% off alerts).`
  );
}

export function broadcastOptInAck() {
  return `Welcome back to Sokoni deal alerts! ${offerLine()}. Type *menu* to shop.`;
}

export function holidayHoursMessage() {
  return (
    `Sokoni Mall Holiday Hours 🎉🇰🇪\n\n` +
    `Our AI stays active 24/7 to browse and place orders.\n` +
    `🛵 Deliveries: 8:00 AM – 2:00 PM on the holiday; after 2 PM → next morning.\n` +
    `👥 Human desk: closed on the holiday.\n\n` +
    `🛡️ Prepaid via M-Pesa STK only — never pay personal numbers. Happy shopping! 🚀`
  );
}

export function weatherAdvisoryMessage({ orderId }) {
  return (
    `Weather Advisory 🌧️🛵\n\n` +
    `Order *${orderId}* may be delayed due to heavy rain / poor roads in your area.\n` +
    `Rider safety first — your package is on the way carefully.\n\n` +
    `🛡️ Prepaid escrow still holds — never pay riders or personal numbers. 🙏`
  );
}

export function offlineTrackingMessage() {
  return (
    `Tracking Under Maintenance 🛠️📊\n\n` +
    `Our tracking database is briefly upgrading. Your package is safe and moving.\n\n` +
    `Reply *HUMAN* for a manual status lookup.\n` +
    `🛡️ Prepaid via M-Pesa STK — never pay outside Sokoni checkout.`
  );
}

export function scamWarningMessage() {
  return (
    `🛡️ *Sokoni Anti-Scam Reminder*\n\n` +
    `• Official WhatsApp: *${formatPhoneDisplay()}*\n` +
    `• Email: ${config.contact?.email || "support@sokonimall.com"}\n\n` +
    `We *never* ask for commitment fees, delivery deposits, or payment to personal numbers.\n` +
    `Pay only via M-Pesa STK through Sokoni. Stay safe! 🇰🇪`
  );
}

export function reviewRequestMessage() {
  return (
    `Delivery Confirmed! Thank you for shopping with Sokoni Mall 🎉🛍️\n\n` +
    `Because we're a young, growing business, your feedback means everything.\n` +
    `How was the AI? Delivery speed? Rider professionalism?\n\n` +
    `Leave a public review: ${config.publicSiteUrl || "https://sokonimall.com"}#reviews 🌟\n` +
    `${offerLine("on your next order")}. Asante! 🙏`
  );
}

export function locationValidationMessage({ orderId, area, street, landmark }) {
  return (
    `Let's Double-Check Your Delivery Address! 📍🗺️\n\n` +
    `Order *${orderId || "pending"}* — reply *YES* if this is correct:\n` +
    `• Area: ${area || "—"}\n` +
    `• Street: ${street || "—"}\n` +
    `• Landmark: ${landmark || "—"}\n\n` +
    `Or type your corrected address below.\n` +
    `🛡️ Verification is free — no commitment fees. Pay only via Sokoni M-Pesa STK.`
  );
}

export function sizeExchangeMessage({ orderId }) {
  return (
    `Need a Different Size or Color? 🔄👕\n\n` +
    `Order *${orderId || "—"}* — reply with the new size/color you need.\n` +
    `Our rider brings the replacement; hand back the original in clean packaging.\n\n` +
    `🛡️ Exchanges are free of extra product cost — settle only through Sokoni checkout.`
  );
}

export function backInStockMessage({ productName, customerName }) {
  return (
    `Good News — Back in Stock! 🎉📱\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""}! *${productName}* is back on our shelves.\n\n` +
    `🛡️ 100% prepaid via M-Pesa STK. Reply *BUY NOW* to order. 🚀`
  );
}

export function internationalCustomsMessage({ orderId, productName, newDate }) {
  return (
    `International Order: Customs Processing ✈️🛃\n\n` +
    `Order *${orderId}* for *${productName}* is at Nairobi customs (routine, 2–4 business days).\n` +
    `Updated ETA: ${newDate || "we'll message you"}.\n\n` +
    `⚠️ We will *never* ask for personal M-Pesa to "release customs." Stay safe!`
  );
}

export function broadcastFooter() {
  return `\n\n_Type *menu* to shop — 100% prepaid 🔒 · ${offerLine()} · Reply *STOP* to opt out_`;
}
