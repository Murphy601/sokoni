import { config } from "../config.js";

/** All customer-facing offers are capped at 3% — no flat KES or free-delivery promos. */
export const OFFER_PERCENT = config.offers?.maxDiscountPercent ?? 3;
export const PROMO_CODE = config.offers?.promoCode ?? "SOKONI3";

export function formatPhoneDisplay() {
  return config.contact?.phoneDisplay || "+254 117 422 428";
}

export function formatWhatsAppLink() {
  const n = config.store.businessNumber.replace(/\D/g, "");
  return `https://wa.me/${n}`;
}

function till() {
  return config.store.mpesaTill;
}

function tillName() {
  return config.store.mpesaTillName;
}

export function tillExplainLine() {
  return (
    `🏢 *M-Pesa Till:* ${till()} — registered to Sokoni Mall founder *${tillName()}* (named, accountable checkout)\n` +
    `📞 *WhatsApp / calls:* ${formatPhoneDisplay()}`
  );
}

export function paymentTrustDisclosure() {
  return (
    `Countrywide pay-on-delivery, zero upfront deposits. Inspect your order first, then pay via M-Pesa Till *${till()}*.\n\n` +
    `During our founder-led launch phase, this till is registered directly to Sokoni Mall's founder, *${tillName()}* — ` +
    `so you're paying a named, accountable individual, not an anonymous account. Business till transition in progress.\n\n` +
    `📞 Questions? WhatsApp ${formatPhoneDisplay()} anytime.\n` +
    `✅ *Verify:* call or WhatsApp us before paying to confirm your order number.`
  );
}

export function founderLedSafetyBlock() {
  return (
    `🛡️ *Sokoni Mall* — founded by *${tillName()}*\n` +
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
    `Habari! Welcome to *Sokoni Mall AI* 🤖🇰🇪\n` +
    `Your smart shopping assistant for local deals across Kenya.\n\n` +
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
    `• Strict Pay on Delivery — no deposits upfront\n` +
    `• Official checkout: Till *${till()}* (*${tillName()}*)\n` +
    `• ${offerLine("this week")}\n\n` +
    `What can our AI find for you today?`
  );
}

export function broadcastReEngageMessage() {
  return (
    `Habari! It's the *Sokoni Mall* team 👋\n` +
    `We've upgraded our WhatsApp shopping assistant!\n\n` +
    `• Pay on Delivery — inspect first, pay after\n` +
    `• Till *${till()}* — founder *${tillName()}* (named, accountable checkout)\n` +
    `• ${offerLine()}\n\n` +
    `Text us what you need in English, Kiswahili, or Sheng! 👇`
  );
}

export function orderConfirmedMessage({ orderId, productName, amountKes, customerName, location, phone }) {
  const amt = Number(amountKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "—";
  return (
    `Order Confirmed! 🎉\n` +
    `Your order number is *${orderId}*.\n\n` +
    `🛍️ *${productName}*\n` +
    `💰 *${priceLine}* — pay strictly on delivery\n` +
    `📍 ${customerName} — ${location}\n` +
    `📞 ${phone}\n\n` +
    `⚠️ *Payment security reminder:*\n` +
    `We will *NEVER* ask for a commitment fee, delivery deposit, or upfront payment.\n` +
    `When your package arrives, inspect it first, then pay to Buy Goods Till *${till()}* (founder *${tillName()}* — named, accountable checkout).\n` +
    `✅ Verify on ${formatPhoneDisplay()} before paying if you want to confirm this order.\n` +
    `Do not pay cash to the rider. Reply *paid* here once done.\n\n` +
    `Track anytime: type *track* or *${orderId}*. Thank you for shopping with Sokoni! 🙏`
  );
}

export function howItWorksMessage() {
  return (
    `*How Sokoni Mall works* 🛍️\n\n` +
    `1️⃣ Chat us on WhatsApp (${formatPhoneDisplay()}) or browse sokonimall.com.\n` +
    `2️⃣ Our AI finds products from our *pay-on-delivery* local catalog.\n` +
    `3️⃣ Reply *1* to order — send name, location & phone in one message.\n` +
    `4️⃣ *Safe Pay on Delivery:* inspect first, then pay Till *${till()}* (founder *${tillName()}*). Verify on ${formatPhoneDisplay()} before paying.\n` +
    `5️⃣ Track with your *SK-####* order number anytime.\n\n` +
    `*International?* *menu* → *Shop International* — partner stores (AliExpress, Temu, Amazon). Customs may apply; no pay-on-delivery.\n\n` +
    `${config.store.deliveryNote}\n\n` +
    `Type *menu* anytime to start again.`
  );
}

export function paymentVerificationPrompt(amountKes = null) {
  const amt = amountKes != null && Number.isFinite(Number(amountKes)) ? Number(amountKes) : null;
  const amountLine = amt != null ? `Amount: *KES ${amt.toLocaleString()}*\n\n` : "";
  return (
    `Payment Verification 🔑\n\n` +
    `Once you're satisfied with your delivery:\n\n` +
    amountLine +
    `🏢 *Buy Goods Till:* ${till()}\n` +
    `👤 *Registered to:* ${tillName()} (Sokoni Mall founder — named, accountable checkout)\n\n` +
    `✅ *Verify first:* WhatsApp ${formatPhoneDisplay()} to confirm your order number before paying.\n` +
    `After paying, paste your M-Pesa confirmation or reply with the transaction code. 🧾`
  );
}

export function paymentConfirmedMessage({ orderId, amountKes }) {
  const amt = Number(amountKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "—";
  return (
    `✅ *Payment Confirmed!*\n` +
    `We received your payment of *${priceLine}* for order *${orderId}*.\n` +
    `Thank you for shopping with Sokoni Mall! Enjoy your purchase! 🎉`
  );
}

export function outOfOfficeMessage() {
  return (
    `Habari! Thanks for reaching out to *Sokoni Mall* 🌙🤖\n` +
    `Our AI assistant is still active — browse the catalog or check order status right now.\n\n` +
    `🛑 *Human support & new dispatches:* our team rests overnight (9 PM–7:30 AM EAT). ` +
    `Human requests are prioritized from 7:30 AM.\n\n` +
    `⚠️ *Scam alert:* Sokoni will *never* ask for commitment or delivery fees upfront. ` +
    `Only pay Till *${till()}* (*${tillName()}*) after you hold and inspect your item.\n\n` +
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
    `🛡️ Till *${till()}* (${tillName()}). Verify on ${formatPhoneDisplay()} before paying.\n` +
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
    `• Pay on delivery to Till *${till()}* (*${tillName()}*)\n` +
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
    `🛡️ Inspect first, then pay Till *${till()}* (*${tillName()}*). No upfront fees!`
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

export function mpesaTroubleshootMessage({ orderId, amountKes }) {
  const amt = Number(amountKes);
  const priceLine = Number.isFinite(amt) ? `KES ${amt.toLocaleString()}` : "your order total";
  return (
    `M-Pesa Transaction Error? Let's Fix It! 🛠️📱\n\n` +
    `Order *${orderId}* payment didn't go through — usually a quick network glitch.\n\n` +
    `1️⃣ Confirm Till *${till()}* (name: *${tillName()}*)\n` +
    `2️⃣ Try SIM Tool Kit: Lipa Na M-Pesa → Buy Goods → Till ${till()}\n` +
    `3️⃣ Ensure balance covers *${priceLine}* plus Safaricom fees\n` +
    `4️⃣ Show the rider any error message on screen\n\n` +
    `Reply *paid* with your confirmation code once it goes through. 🙏`
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
    `🛡️ Zero deposits upfront. Pay Till *${till()}* only after inspection.\n` +
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
    `3️⃣ You earn *${OFFER_PERCENT}% credit* on your next order when they pay via Till *${till()}*\n\n` +
    `Let's build safer shopping together. 🚀`
  );
}

export function vendorOnboardingMessage() {
  return (
    `Partner with Sokoni Mall! 📈\n\n` +
    `Sell to thousands via our WhatsApp AI marketplace.\n\n` +
    `• Zero listing fees\n` +
    `• Customers order through Sokoni only\n` +
    `• Pay-on-Delivery via Till *${till()}* — we remit your payout after delivery\n\n` +
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
    `Settlements reconcile via Till *${till()}* (*${tillName()}*).\n` +
    `Our finance desk emails your invoice within 30 minutes. 🧾`
  );
}

export function giftWrapMessage() {
  return (
    `Sending a Gift or Surprise? 🎁💝\n\n` +
    `Yes — we can ship surprises countrywide with gift wrapping (KES 250 add-on).\n` +
    `Includes wrapping, ribbon, and a custom greeting card. Pricing hidden from recipient.\n\n` +
    `🛡️ Surprise orders paid by sender: pay Till *${till()}* before dispatch.\n` +
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
    `🛡️ No rerouting fees. Pay only on delivery to Till *${till()}*.\n` +
    `Type your new details below! 👇`
  );
}

export function outOfZoneMessage() {
  return (
    `Outside Our Direct Delivery Zone? 📦🌍\n\n` +
    `We can still ship via countrywide courier partners (G4S, Fargo, etc.).\n` +
    `• Package to your nearest hub — 2–3 business days outside Nairobi\n\n` +
    `Reply *SHIPPING* and our ops desk will quote delivery cost and collection point.\n` +
    `Official Till remains *${till()}* (*${tillName()}*). Never pay unverified personal lines.`
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
    `🛡️ Pay on delivery to Till *${till()}* either way. No upfront fees!`
  );
}

export function pickupReadyMessage({ orderId, stationName, hours, customerName }) {
  return (
    `Package Ready at Pick-Up Station! 📦🏢\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""}! Order *${orderId}* is ready.\n\n` +
    `📍 *${stationName || "Partner hub"}*\n` +
    `⏰ ${hours || "8:00 AM – 6:30 PM"}\n` +
    `⏳ Collect within 48 hours.\n\n` +
    `🛡️ Inspect first, then pay Till *${till()}* (*${tillName()}*). No storage fees to agents.`
  );
}

export function corporateBulkMessage() {
  return (
    `Planning a Corporate Bulk Order? 🏢🎁\n\n` +
    `We support volume purchasing with tiered pricing up to *${OFFER_PERCENT}% off* for qualifying bulk orders.\n` +
    `• Pro-forma invoices & delivery notes\n` +
    `• Split deliveries to multiple offices\n\n` +
    `Reply: *Company Name*, *Item*, *Quantity* for a quote within 30 minutes.\n` +
    `Payments via Till *${till()}* (*${tillName()}*).`
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
    `🛡️ Zero deposits upfront. Pay Till *${till()}* after inspection. Happy shopping! 🚀`
  );
}

export function weatherAdvisoryMessage({ orderId }) {
  return (
    `Weather Advisory 🌧️🛵\n\n` +
    `Order *${orderId}* may be delayed due to heavy rain / poor roads in your area.\n` +
    `Rider safety first — your package is on the way carefully.\n\n` +
    `🛡️ No upfront deposits regardless of weather. Pay Till *${till()}* after inspection. 🙏`
  );
}

export function offlineTrackingMessage() {
  return (
    `Tracking Under Maintenance 🛠️📊\n\n` +
    `Our tracking database is briefly upgrading. Your package is safe and moving.\n\n` +
    `Reply *HUMAN* for a manual status lookup.\n` +
    `🛡️ Zero deposits upfront — pay Till *${till()}* only on delivery.`
  );
}

export function scamWarningMessage() {
  return (
    `🛡️ *Sokoni Anti-Scam Reminder*\n\n` +
    `• Official WhatsApp: *${formatPhoneDisplay()}*\n` +
    `• Official Till: *${till()}* (*${tillName()}*)\n` +
    `• Email: ${config.contact?.email || "support@sokonimall.com"}\n\n` +
    `We *never* ask for commitment fees, delivery deposits, or payment to personal numbers.\n` +
    `Inspect your item first, then pay Till *${till()}* yourself. Stay safe! 🇰🇪`
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
    `🛡️ Verification is free — no commitment fees. Pay Till *${till()}* on delivery only.`
  );
}

export function sizeExchangeMessage({ orderId }) {
  return (
    `Need a Different Size or Color? 🔄👕\n\n` +
    `Order *${orderId || "—"}* — reply with the new size/color you need.\n` +
    `Our rider brings the replacement; hand back the original in clean packaging.\n\n` +
    `🛡️ Exchanges are free of extra product cost. Any rider fee paid to Till *${till()}* at the door only.`
  );
}

export function backInStockMessage({ productName, customerName }) {
  return (
    `Good News — Back in Stock! 🎉📱\n\n` +
    `Habari${customerName ? ` *${customerName}*` : ""}! *${productName}* is back on our shelves.\n\n` +
    `🛡️ Pay on delivery to Till *${till()}*. Reply *BUY NOW* to order. 🚀`
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
  return `\n\n_Type *menu* to shop — pay on delivery 💵 · ${offerLine()} · Reply *STOP* to opt out_`;
}
