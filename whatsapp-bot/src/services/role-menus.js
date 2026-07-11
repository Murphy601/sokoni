import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { setMenuState } from "./session.js";
import { requireAdminSender } from "./admin.js";
import { findSupplierByPhone } from "./suppliers.js";
import { sendWelcome, formatNumberedMenu } from "./menu.js";
import { startSupplierOnboarding } from "./supplier-onboarding.js";
import { startPickupOnboarding } from "./pickup-point-onboarding.js";
import { OFFER_PERCENT, PROMO_CODE } from "./trust-copy.js";

function normalize(text) {
  return String(text || "").trim().toLowerCase();
}

export function isCustomerMenuIntent(text) {
  const t = normalize(text);
  return (
    t === "menu" ||
    t === "customer menu" ||
    t === "#menu" ||
    t === "main menu" ||
    t === "shop menu" ||
    /^customer\s+menu$/i.test(t)
  );
}

export function isPickupMenuIntent(text) {
  const t = normalize(text).replace(/^#/, "");
  return (
    t === "pickup" ||
    t === "pickup menu" ||
    t === "pickup point" ||
    t === "pickup points" ||
    t === "pickup point menu" ||
    /^#(?:pickup|pickuppoint|pickup-point)\b/i.test(String(text || "").trim())
  );
}

export function isVendorMenuIntent(text) {
  const t = normalize(text).replace(/^#/, "");
  return (
    t === "vendor" ||
    t === "vendors" ||
    t === "vendor menu" ||
    t === "supplier menu" ||
    t === "supplier" ||
    t === "suppliers" ||
    /^#(?:vendor|vendors|supplier|suppliers)\b/i.test(String(text || "").trim())
  );
}

export function isAdminMenuIntent(text) {
  const t = String(text || "").trim();
  return /^admin\b/i.test(t) || /^#help\b/i.test(t);
}

function sendNumberedMenu(to, title, options) {
  setMenuState(to, { type: "role_menu", options });
  return sendText(to, formatNumberedMenu(title, options));
}

export async function sendPickupApplyPrompt(customerKey) {
  await sendText(
    customerKey,
    `📦 *Become a Sokoni pickup point*\n\n` +
      `Earn commission for every parcel you receive and hand to customers.\n` +
      `Same step-by-step flow as sokonimall.com/pickup-points.\n\n` +
      `Reply *1* to start your application now, or *menu* for customer shopping.`
  );
  setMenuState(customerKey, {
    type: "pickup_apply_gate",
    options: [
      { id: "pickup_start_apply", label: "Start pickup point application" },
      { id: "shop_all", label: "Customer shopping menu" },
    ],
  });
  return true;
}

/** Registered supplier portal — vendors only. */
export async function sendVendorMenu(customerKey, supplier) {
  const options = [
    { id: "vendor_status", label: "📋 My application / products" },
    { id: "vendor_payouts", label: "💰 Payouts & delivery policy" },
    { id: "vendor_add_product", label: "➕ Add another product (chat)" },
    { id: "vendor_contact", label: "📞 Contact Sokoni ops" },
    { id: "customer_menu", label: "🛍️ Switch to customer shopping" },
  ];
  return sendNumberedMenu(
    customerKey,
    `🏪 *Vendor menu* — ${supplier.businessName}\n_ID: ${supplier.id}_`,
    options
  );
}

export async function sendVendorApplyPrompt(customerKey) {
  await sendText(
    customerKey,
    `🏪 *Sell on Sokoni Mall*\n\n` +
      `This menu is for approved suppliers. You can apply here step by step (same as sokonimall.com/suppliers).\n\n` +
      `• Zero listing fees\n` +
      `• WhatsApp orders + pay-on-delivery via Till *${config.store.mpesaTill}*\n` +
      `• We set retail from your supply price\n\n` +
      `Reply *1* to start your application now, or *menu* for customer shopping.`
  );
  setMenuState(customerKey, {
    type: "vendor_apply_gate",
    options: [
      { id: "vendor_start_apply", label: "Start supplier application" },
      { id: "shop_all", label: "Customer shopping menu" },
    ],
  });
  return true;
}

/** Route explicit role menu keywords. Returns true if handled. */
export async function tryRoleMenu(customerKey, text, { phone = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

  if (isAdminMenuIntent(trimmed)) {
    if (!requireAdminSender(customerKey, phone)) {
      await sendText(
        customerKey,
        "Karibu Sokoni! 🛒\n\nType *menu* to browse and order (pay on delivery).\nNeed a person? *menu* → *Talk to a Human*."
      );
      return true;
    }
    return false;
  }

  if (isPickupMenuIntent(trimmed)) {
    return sendPickupApplyPrompt(customerKey);
  }

  if (isVendorMenuIntent(trimmed)) {
    const supplier = findSupplierByPhone(phone);
    if (supplier) {
      await sendVendorMenu(customerKey, supplier);
      return true;
    }
    return sendVendorApplyPrompt(customerKey);
  }

  if (/^vendor\s+contact$/i.test(trimmed)) {
    const supplier = findSupplierByPhone(phone);
    if (supplier) return handleVendorMenuAction(customerKey, "vendor_contact", { phone });
    return sendVendorApplyPrompt(customerKey);
  }
  if (/^vendor\s+status$/i.test(trimmed)) {
    const supplier = findSupplierByPhone(phone);
    if (supplier) return handleVendorMenuAction(customerKey, "vendor_status", { phone });
    return sendVendorApplyPrompt(customerKey);
  }

  if (isCustomerMenuIntent(trimmed)) {
    return sendWelcome(customerKey);
  }

  return false;
}

export async function handlePickupMenuAction(customerKey, actionId, { phone = "" } = {}) {
  switch (actionId) {
    case "pickup_start_apply":
      return startPickupOnboarding(customerKey, { phone });
    case "customer_menu":
    case "shop_all":
      return sendWelcome(customerKey);
    default:
      return false;
  }
}

export async function handleVendorMenuAction(customerKey, actionId, { phone = "" } = {}) {
  const supplier = findSupplierByPhone(phone);
  if (!supplier && actionId !== "vendor_start_apply" && actionId !== "customer_menu" && actionId !== "shop_all") {
    return sendVendorApplyPrompt(customerKey);
  }

  switch (actionId) {
    case "vendor_start_apply":
      return startSupplierOnboarding(customerKey, { phone });
    case "vendor_status":
      await sendText(
        customerKey,
        `📋 *${supplier.businessName}*\n` +
          `Supplier ID: \`${supplier.id}\`\n` +
          `Products live: *${supplier.productIds?.length || 0}*\n` +
          `Delivers: ${supplier.delivers ? "yes" : "hub/pickup"}\n` +
          `City: ${supplier.city || "—"}\n\n` +
          `_Need changes? Reply *vendor contact* or WhatsApp ${config.contact?.phoneDisplay || "+254 117 422 428"}._`
      );
      return true;
    case "vendor_payouts":
      await sendText(
        customerKey,
        `💰 *Supplier payouts*\n\n` +
          `• Customer pays on delivery to Till *${config.store.mpesaTill}* (${config.store.mpesaTillName})\n` +
          `• Sokoni remits your *supply price* after successful delivery\n` +
          `• Delivery: ${supplier.delivers ? supplier.deliveryAreas || "your areas" : "hub / pickup coordination"}\n\n` +
          `Questions? Reply *vendor contact*.`
      );
      return true;
    case "vendor_add_product":
      await sendText(
        customerKey,
        `➕ *Add a product*\n\n` +
          `Reply with one message:\n` +
          `*Product name | category | supply price*\n\n` +
          `_Example: Bluetooth speaker | computing | 3500_\n\n` +
          `Optional: send a product photo in the next message.\n` +
          `Our team will review and list it.`
      );
      setMenuState(customerKey, { type: "vendor_add_product", supplierId: supplier.id });
      return true;
    case "vendor_contact":
      await sendText(
        customerKey,
        `📞 *Sokoni vendor support*\n` +
          `WhatsApp: ${config.contact?.phoneDisplay || "+254 117 422 428"}\n` +
          `Email: ${config.contact?.supportEmail || "support@sokonimall.com"}\n\n` +
          `Mention your supplier ID: \`${supplier.id}\``
      );
      return true;
    case "customer_menu":
    case "shop_all":
      return sendWelcome(customerKey);
    default:
      return false;
  }
}

export function customerHelpMenuText() {
  return (
    `🛍️ *Customer shortcuts*\n\n` +
    `• *menu* — browse & order (pay on delivery)\n` +
    `• *track* — order status\n` +
    `• *discount* — ${OFFER_PERCENT}% off code *${PROMO_CODE}*\n` +
    `• *referral* · *gift wrap* · *scam* — trust & extras\n` +
    `• *menu* → *Talk to a Human* for support`
  );
}
