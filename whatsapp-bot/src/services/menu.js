import { config } from "../config.js";
import { sendText, sendProductCard, sendProductImage } from "./whatsapp.js";
import { searchProducts, getProductById, findProductFromMessage, listCategoryProducts, listBrowseProducts, getPerfumeVariantsForFamily, listPerfumeScentFamilies } from "./catalog.js";
import { buildBrowseSubmenus, priceTierMaxKes } from "./browse-menu.js";
import { isCatalogPubliclyDisabled } from "./catalog-guard.js";
import { formatListNumber, formatKes, CATALOG_PAGE_SIZE } from "./list-format.js";
import { buildAffiliateLink, SOURCE_LABELS } from "./affiliate.js";
import {
  setPendingOrder,
  getPendingOrder,
  clearPendingOrder,
  setPendingCart,
  getPendingCart,
  clearPendingCart,
  setMenuState,
  getMenuState,
  clearMenuState,
  setProductContext,
  clearHumanHandoff,
  getCustomerMeta,
  setCustomerMeta,
} from "./session.js";
import { isMultiSellerCartEnabled } from "./platform-flags.js";
import {
  createCartOrder,
  parseCartHandoffMessage,
  computeCartLineFees,
  computeCartParentTotals,
  getCartChildren,
  CART_PARENT_KIND,
} from "./cart-orders.js";
import { startHumanHandoff, buildOrderAdminSummary } from "./handoff.js";
import {
  createOrder,
  getOrdersForCustomer,
  statusLabel,
  getOrder,
} from "./orders.js";
import { getFeaturedProductIds } from "./tiktok.js";
import { siteUrlLine } from "./reviews.js";
import {
  formatPrepaidCheckoutPrompt,
  initiateMpesaCheckout,
  isPrepaidOnly,
  prepaidPaymentLine,
  checkoutUrlForOrder,
} from "./prepaid-checkout.js";
import { ensureHybridShippingBeforePayment } from "./apply-order-shipping.js";
import {
  renderShipmentTimelineText,
  getEffectiveShipmentStatus,
  shipmentStatusLabel,
} from "./shipments.js";
import { formatShortPaymentReminder } from "./payment.js";
import { planFulfillment, applyFulfillmentPlan, formatFulfillmentConfirmBlock, formatFulfillmentLine } from "./fulfillment.js";
import {
  welcomeMessage,
  howItWorksMessage,
  prepaidOrderPlacedMessage,
} from "./trust-copy.js";
import { welcomeMessageForCustomer } from "./customer-automations.js";
import { computeProductTotals, orderBuyerTotal, formatBuyerTotalLine, formatProductListPrice } from "./shipping-tiers.js";
import {
  parseDeliveryDetails,
  isOrderCorrectionMessage,
  deliveryDetailsHint,
  looksLikeDeliveryDetails,
} from "./delivery-details.js";

export function formatNumberedMenu(title, options) {
  const lines = options.map((o, i) => `${i + 1}. ${o.label}`);
  return `${title}\n\n${lines.join("\n")}\n\n_Reply with the number (e.g. 1)_`;
}

function sendNumberedMenu(to, title, options) {
  setMenuState(to, { type: "numbered_menu", options });
  return sendText(to, formatNumberedMenu(title, options));
}

function parseMenuChoice(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

/**
 * Route a numbered reply (1, 2, 3…) to the active menu. Returns true if handled.
 * Must run before human-handoff silence and before free-text product/AI routing.
 */
export async function tryNumberedMenuReply(customerKey, text, { phone = "" } = {}) {
  const choice = parseMenuChoice(text);
  if (!choice) return false;

  const menuState = getMenuState(customerKey);
  if (!menuState?.options?.length || choice > menuState.options.length) return false;

  if (menuState.type === "product_list" || menuState.type === "product_list_paged") {
    if (menuState.productIds?.[choice - 1]) {
      return showProductActions(customerKey, menuState.productIds[choice - 1]);
    }
    return false;
  }

  const option = menuState.options[choice - 1];
  if (!option?.id) return false;

  clearHumanHandoff(customerKey);

  if (menuState.type === "vendor_apply_gate" || menuState.type === "role_menu") {
    const { handleVendorMenuAction } = await import("./role-menus.js");
    return handleVendorMenuAction(customerKey, option.id, { phone });
  }
  if (menuState.type === "pickup_apply_gate") {
    const { handlePickupMenuAction } = await import("./role-menus.js");
    return handlePickupMenuAction(customerKey, option.id, { phone });
  }
  if (option.id === "human_handoff") {
    const meta = getCustomerMeta(customerKey) || {};
    return sendHumanHandoff(customerKey, { ...meta, phone, lastMessage: text });
  }

  try {
    return await handleMenuAction(customerKey, option.id);
  } catch (err) {
    console.error("[menu] numbered reply failed:", err.message);
    await sendText(customerKey, "Sorry, something went wrong. Type *menu* to try again.");
    return true;
  }
}

export async function sendWelcome(to) {
  const meta = getCustomerMeta(to) || {};
  const phone = meta.phone || "";
  const back = welcomeMessageForCustomer(to, phone, meta.displayName);
  await sendText(to, back || welcomeMessage());
  return sendMainMenu(to);
}

export function sendMainMenu(to) {
  const options = [
    { id: "shop_all", label: "👗 Browse Shop" },
    { id: "deals_today", label: "🔥 Today's Picks" },
    { id: "track_order", label: "🧾 Track My Order" },
    { id: "visit_site", label: "🌐 Visit Website" },
    { id: "human_handoff", label: "🙋 Talk to a Human" },
    { id: "how_it_works", label: "❓ How Sokoni Works" },
  ];
  return sendNumberedMenu(to, "Karibu Sokoni Mall! 100% prepaid · escrow protected 🔒", options);
}

const SUBCATEGORY_LABELS = {
  smartphones: "Smartphones",
  tablets: "Tablets",
  "power-banks": "Power Banks",
  "phone-accessories": "Phone Accessories",
  televisions: "Televisions",
  headphones: "Headphones & Earbuds",
  speakers: "Speakers",
  "home-theatre": "Home Theatre",
  "kitchen-appliances": "Kitchen Appliances",
  kettles: "Kettles",
  blenders: "Blenders",
  irons: "Irons",
  "washing-machines": "Washing Machines",
  skincare: "Skincare",
  haircare: "Hair Care",
  makeup: "Makeup",
  "personal-care": "Personal Care",
  fragrances: "Fragrances",
  "perfume-oils": "Perfume Oils",
  "kitchen-dining": "Kitchen & Dining",
  bedding: "Bedding",
  cleaning: "Cleaning",
  "home-decor": "Home Decor",
  stationery: "Stationery",
  "mens-fashion": "Men's Fashion",
  "womens-fashion": "Women's Fashion",
  shoes: "Shoes",
  bags: "Bags",
  watches: "Watches",
  laptops: "Laptops",
  printers: "Printers",
  storage: "Storage",
  "computer-accessories": "Accessories",
  consoles: "Consoles",
  controllers: "Controllers",
  "gaming-accessories": "Gaming Accessories",
  "food-cupboard": "Food Cupboard",
  drinks: "Drinks",
  "household-supplies": "Household Supplies",
  diapering: "Diapering",
  feeding: "Feeding",
  toys: "Toys",
  "baby-gear": "Baby Gear",
};

/** @type {Record<string, { browseCategory: string, label: string, rows: Array<Record<string, string>> }> | null} */
let browseSubmenusCache = null;

async function getBrowseSubmenus() {
  if (!browseSubmenusCache) {
    browseSubmenusCache = await buildBrowseSubmenus();
  }
  return browseSubmenusCache;
}

const CATALOG_REBUILD_MSG =
  "We're rebuilding Sokoni Mall with a fresh catalog — nothing to browse yet.\n\n" +
  "Tell me what you're looking for and we'll help you find it. Or tap *Talk to a Human* on the menu.\n\n" +
  "_Type *menu* anytime._";

async function sendCatalogRebuildNotice(to) {
  return sendText(to, CATALOG_REBUILD_MSG);
}

export async function sendCategoryList(to) {
  if (await isCatalogPubliclyDisabled()) {
    return sendCatalogRebuildNotice(to);
  }
  const submenus = await getBrowseSubmenus();
  const options = Object.entries(submenus).map(([id, menu]) => ({
    id,
    label: menu.label,
  }));
  options.push({ id: "menu_main", label: "⬅ Main menu" });
  return sendNumberedMenu(to, "Browse the shop — Women, Men, Kids, Sale & more 💵", options);
}

export async function isCategoryMenuId(id) {
  const submenus = await getBrowseSubmenus();
  return Object.prototype.hasOwnProperty.call(submenus, id);
}

export async function sendCategorySubmenu(to, categoryMenuId) {
  if (await isCatalogPubliclyDisabled()) {
    return sendCatalogRebuildNotice(to);
  }
  const submenus = await getBrowseSubmenus();
  const menu = submenus[categoryMenuId];
  if (!menu) return sendMainMenu(to);
  const options = [
    ...menu.rows.map((row) => ({ id: row.id, label: row.title })),
    { id: "menu_main", label: "⬅ Main menu" },
  ];
  return sendNumberedMenu(to, `${menu.label} — pick a section:`, options);
}

async function findSubcategoryRow(rowId) {
  const submenus = await getBrowseSubmenus();
  for (const menu of Object.values(submenus)) {
    const row = menu.rows.find((r) => r.id === rowId);
    if (row) {
      return {
        browseCategory: row.browseCategory || menu.browseCategory,
        browseSubCategory: row.browseSubCategory || null,
        priceTier: row.priceTier || null,
        legacyCategory: row.legacyCategory || null,
        legacySubcategory: row.legacySubcategory || null,
        label: row.title,
      };
    }
  }
  return null;
}

export async function isSubcategoryRowId(id) {
  return Boolean(await findSubcategoryRow(id));
}

export async function sendProductsForSubcategory(to, rowId, page = 0) {
  if (await isCatalogPubliclyDisabled()) {
    return sendCatalogRebuildNotice(to);
  }
  const target = await findSubcategoryRow(rowId);
  if (!target) return sendMainMenu(to);
  if (target.legacySubcategory === "perfume-oils") {
    return sendPerfumeScentList(to, { page, rowId });
  }

  const maxPriceKes = target.priceTier ? priceTierMaxKes(target.priceTier) : null;
  let products;
  if (target.priceTier) {
    products = await listBrowseProducts({
      maxPriceKes: maxPriceKes ?? undefined,
      scope: "local",
      fulfillment: "store",
    });
  } else if (target.legacySubcategory) {
    products = await listBrowseProducts({
      legacyCategory: target.legacyCategory || undefined,
      legacySubcategory: target.legacySubcategory,
      scope: "local",
      fulfillment: "store",
    });
  } else {
    products = await listBrowseProducts({
      browseCategory: target.browseCategory,
      browseSubCategory: target.browseSubCategory || undefined,
      scope: "local",
      fulfillment: "store",
    });
  }

  if (products.length === 0) {
    await sendText(to, "I don't have picks here yet — reply *1* on the main menu to browse.");
    return sendMainMenu(to);
  }

  const label = target.label || target.browseSubCategory || "Items";
  return sendPaginatedProductList(to, products, {
    title: `*${label}* — full catalog (${products.length} items)`,
    page,
    rowId,
  });
}

/** Step 1: scent names only (no size) — paginated. */
export async function sendPerfumeScentList(to, { page = 0, rowId = "sub_women_perfume-oils" } = {}) {
  if (await isCatalogPubliclyDisabled()) {
    return sendCatalogRebuildNotice(to);
  }
  const allFamilies = await listPerfumeScentFamilies();
  const total = allFamilies.length;
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CATALOG_PAGE_SIZE;
  const pageFamilies = allFamilies.slice(start, start + CATALOG_PAGE_SIZE);

  const lines = pageFamilies.map((name, i) => `${formatListNumber(i + 1)} *${name}*`);

  let navFooter = "";
  if (totalPages > 1) {
    navFooter = `\n\n📄 Page ${safePage + 1} of ${totalPages} · ${total} scents`;
    if (safePage + 1 < totalPages) navFooter += `\nReply *next* for more.`;
    if (safePage > 0) navFooter += `\nReply *prev* for previous page.`;
  }

  setMenuState(to, {
    type: "scent_list_paged",
    scentFamilies: allFamilies,
    pageFamilies,
    page: safePage,
    pageSize: CATALOG_PAGE_SIZE,
    rowId,
  });

  return sendText(
    to,
    `*Perfume Oils* — pick a scent (${total} available)\n\n${lines.join("\n")}\n\n` +
      `*Reply with the number* (e.g. 1) or type the scent name (e.g. *BRUT*).${navFooter}\n` +
      `_Type *menu* anytime._`
  );
}

/** Step 2: sizes + images for one scent. */
export async function sendPerfumeSizePicker(to, scentFamily) {
  const variants = await getPerfumeVariantsForFamily(scentFamily);
  if (variants.length === 0) {
    return sendText(to, `Sorry, *${scentFamily}* isn't available right now. Type *menu* to browse.`);
  }

  const lines = variants.map((p, i) => {
    const label = p.volumeMl === 1000 ? "1 Litre" : `${p.volumeMl}ml`;
    return `${formatListNumber(i + 1)} *${label}* — ${formatProductListPrice(p)} · 100% prepaid`;
  });

  setMenuState(to, {
    type: "size_pick",
    scentFamily,
    productIds: variants.map((p) => p.id),
  });

  await sendText(
    to,
    `You chose: *${scentFamily}*\n\n*Pick your size:*\n\n${lines.join("\n\n")}\n\n` +
      `*Reply with the number* to order that size.\n_Type *menu* anytime._`
  );

  for (const product of variants) {
    await sendProductCard(to, product, null, SOURCE_LABELS[product.source], { setActions: false });
  }
  return true;
}

/** Paginated product list — reply *next* / *prev* to browse large categories. */
export async function sendPaginatedProductList(
  to,
  allProducts,
  { title = "Pick an item", page = 0, footer = "", rowId = null } = {}
) {
  const total = allProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CATALOG_PAGE_SIZE;
  const pageProducts = allProducts.slice(start, start + CATALOG_PAGE_SIZE);

  const lines = pageProducts.map(
    (p, i) =>
      `${formatListNumber(i + 1)} *${p.name}*\n   ${formatProductListPrice(p)} · ⭐ ${p.rating} · 100% prepaid`
  );

  let navFooter = "";
  if (totalPages > 1) {
    navFooter = `\n\n📄 Page ${safePage + 1} of ${totalPages}`;
    if (safePage + 1 < totalPages) navFooter += `\nReply *next* for more items.`;
    if (safePage > 0) navFooter += `\nReply *prev* for previous page.`;
  }

  setMenuState(to, {
    type: "product_list_paged",
    allProductIds: allProducts.map((p) => p.id),
    page: safePage,
    pageSize: CATALOG_PAGE_SIZE,
    productIds: pageProducts.map((p) => p.id),
    rowId,
  });

  await sendText(
    to,
    `${title}\n\n${lines.join("\n\n")}\n\n` +
      `*Reply with the number* (e.g. 1) to order that item.${navFooter}${footer}\n` +
      `_Type *menu* anytime._`
  );

  if (total <= 6) {
    for (const product of pageProducts) {
      await sendProductCard(to, product, null, SOURCE_LABELS[product.source], { setActions: false });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function sendDealsOfTheDay(to) {
  if (await isCatalogPubliclyDisabled()) {
    return sendCatalogRebuildNotice(to);
  }
  const deals = await searchProducts({
    scope: "local",
    fulfillment: "store",
    limit: 5,
  });
  return sendNumberedProductList(to, deals, { title: "🔥 Today's Picks — 100% prepaid 💵" });
}

/** Show a numbered list — customer replies 1, 2, 3 to pick an item. */
export async function sendNumberedProductList(to, products, { title = "Pick an item", footer = "" } = {}) {
  if (!products?.length) {
    return sendCatalogRebuildNotice(to);
  }
  const lines = products.map(
    (p, i) =>
      `${formatListNumber(i + 1)} *${p.name}*\n   ${formatProductListPrice(p)} · ⭐ ${p.rating} · 100% prepaid`
  );

  const options = products.map((p) => ({
    id: `pick_${p.id}`,
    label: `${p.name} — ${formatProductListPrice(p)}`,
  }));
  options.push({ id: "menu_main", label: "⬅ Main menu" });

  setMenuState(to, {
    type: "product_list",
    productIds: products.map((p) => p.id),
    options,
  });

  await sendText(
    to,
    `${title}\n\n${lines.join("\n\n")}\n\n` +
      `*Reply with the number* (e.g. 1) to order that item.\n` +
      `Or swipe-reply on a product line and type *1* to order it.\n` +
      `_Type *menu* anytime._${footer}`
  );

  for (const product of products) {
    await sendProductCard(to, product, null, SOURCE_LABELS[product.source], { setActions: false });
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** After customer picks a number — show order / ask AI options. */
export async function showProductActions(to, productId) {
  const product = await getProductById(productId);
  if (!product) return sendMainMenu(to);
  setProductContext(to, product);
  const affiliateUrl =
    product.fulfillment === "store" ? null : buildAffiliateLink(product, to);
  return sendProductCard(to, product, affiliateUrl, SOURCE_LABELS[product.source], { setActions: true });
}

export async function sendInternationalMenu(to) {
  await sendText(
    to,
    "🌍 *Before we go international* — a quick heads-up:\n" +
      "• AliExpress/Temu/Amazon ship *from overseas* (not Kenya), typically 1-4 weeks depending on the item.\n" +
      "• Kenya charges import duty + VAT + other fees on arrival, paid by *you*, on top of the item price.\n" +
      "• Not every item ships to Kenya — I'll always double-check before sending you a link.\n\n" +
      "Still keen? Reply with a number 👇"
  );
  return sendNumberedMenu(to, "International shopping", [
    { id: "intl_trending", label: "🔥 Trending Picks" },
    { id: "intl_custom", label: "🔍 I know what I want" },
    { id: "menu_main", label: "⬅ Main menu" },
  ]);
}

export async function sendInternationalTrending(to) {
  const products = await searchProducts({ scope: "international", limit: 3 });
  await sendText(to, "Here's what's trending internationally right now 👇");
  for (const product of products) {
    const affiliateUrl = buildAffiliateLink(product, to);
    await sendProductCard(to, product, affiliateUrl, SOURCE_LABELS[product.source]);
  }
}

const STATUS_STEPS = ["awaiting_payment", "confirmed", "packed", "out_for_delivery", "delivered"];

function timelineStatus(order) {
  if (!order) return "received";
  if (order.status === "received" && order.paymentModel === "prepaid") return "awaiting_payment";
  return order.status;
}

function formatOrderKes(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function paymentLineForOrder(order) {
  if (isPrepaidOnly() || order.paymentModel === "prepaid") return prepaidPaymentLine(order);
  if (order.customerPaymentStatus === "confirmed") return "✅ Payment confirmed";
  if (order.customerPaymentStatus === "claimed") return "⏳ Payment pending verification";
  return "100% prepaid";
}

async function sendPaymentReminderSafe(to, order) {
  if (!order) return;
  try {
    const reminder = formatShortPaymentReminder(order);
    if (reminder) await sendText(to, reminder);
  } catch (err) {
    console.error("[payment] reminder failed:", err.message);
  }
}

async function sendPrepaidCheckoutSafe(to, order) {
  if (!order) return;
  try {
    const fresh = getOrder(order.id) || order;
    const meta = getCustomerMeta(to) || {};
    const phone = fresh.phone || meta.phone;
    const result = await initiateMpesaCheckout(fresh, { phone });
    const updated = getOrder(order.id) || fresh;

    if (result.alreadyPaid) return;

    if (result.ok) {
      await sendText(to, formatPrepaidCheckoutPrompt(updated));
      return;
    }

    await sendText(
      to,
      `⚠️ Couldn't start M-Pesa payment${result.message ? `: ${result.message}` : ""}.\n\n` +
        `Reply *pay* to retry STK push.\n\n` +
        formatPrepaidCheckoutPrompt(updated)
    );
  } catch (err) {
    console.error("[checkout] prepaid prompt failed:", err.message);
    await sendText(to, formatPrepaidCheckoutPrompt(order));
  }
}

function pickPaymentReminderOrder(orders) {
  const eligible = orders.filter(
    (o) => o.customerPaymentStatus !== "confirmed" && o.status !== "cancelled"
  );
  const priority = ["awaiting_payment", "out_for_delivery", "packed", "confirmed", "received"];
  for (const st of priority) {
    const hit = eligible.find((o) => o.status === st);
    if (hit) return hit;
  }
  return eligible[0] || null;
}

function orderBelongsToCustomer(order, customerKey, phone = "") {
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

function renderStatusTimeline(order) {
  const currentStatus = timelineStatus(order);
  if (currentStatus === "cancelled") return "❌ This order was cancelled.";

  if (order.customerPaymentStatus === "confirmed" || getEffectiveShipmentStatus(order) !== "pending") {
    const shipLine = shipmentStatusLabel(getEffectiveShipmentStatus(order));
    return `*Shipment*\n${renderShipmentTimelineText(order)}\n_Current: ${shipLine}_`;
  }

  const idx = STATUS_STEPS.indexOf(currentStatus);
  const safeIdx = idx >= 0 ? idx : 0;
  return STATUS_STEPS.map((s, i) => {
    const mark = i < safeIdx ? "✅" : i === safeIdx ? "🔵" : "⚪";
    return `${mark} ${statusLabel(s)}`;
  }).join("\n");
}

function renderOrderCard(order) {
  const courierLine =
    order.courierName || order.courierTrackingRef
      ? `🚚 Courier: ${order.courierName || "—"}${order.courierTrackingRef ? ` · Ref *${order.courierTrackingRef}*` : ""}\n`
      : "";
  return (
    `📦 *${order.id}*\n` +
    `🛍️ ${order.productName}\n` +
    `💰 ${formatBuyerTotalLine(order)} — ${paymentLineForOrder(order)}\n` +
    `📍 ${order.location}\n` +
    `🚚 ${formatFulfillmentLine(order)}\n` +
    courierLine +
    `\n${renderStatusTimeline(order)}`
  );
}

/** Show a specific order by ID (customer typed e.g. SKN-1002-1). */
export async function sendOrderStatus(to, orderId, phone = "") {
  const order = getOrder(orderId);
  if (!orderBelongsToCustomer(order, to, phone)) {
    return sendText(to, `I couldn't find order *${orderId}* on this number. Type *track* to see your orders.`);
  }
  try {
    if (order.kind === CART_PARENT_KIND) {
      const children = getCartChildren(order.id);
      const lines = children
        .map(
          (c) =>
            `• *${c.id}* — ${c.productName}\n  ${statusLabel(c.status)} · ${c.shipmentStatus || "pending"} · escrow ${c.escrowStatus || "—"}`
        )
        .join("\n");
      await sendText(
        to,
        `🛒 *Cart ${order.id}*\n` +
          `Pay status: ${order.customerPaymentStatus === "confirmed" ? "✅ Paid" : "💳 Awaiting payment"}\n` +
          `Total: KES ${orderBuyerTotal(order).toLocaleString()}\n` +
          `Parent status: ${order.status}\n\n` +
          `*Items:*\n${lines}\n\n` +
          `_Track a child ID (e.g. ${children[0]?.id || "SKN-…-1"}) for shipment detail._`
      );
      if (order.customerPaymentStatus !== "confirmed") await sendPaymentReminderSafe(to, order);
      return true;
    }
    await sendText(to, renderOrderCard(order) + `\n\n_Need help? type *menu* → Talk to a Human._`);
    await sendPaymentReminderSafe(to, order);
    return true;
  } catch (err) {
    console.error("[track] sendOrderStatus failed:", err.message);
    return sendText(to, "Sorry, could not load that order. Type *track* to try again.");
  }
}

export async function sendTrackOrderMenu(to, phone = "") {
  try {
    const orders = getOrdersForCustomer(to, phone);
    const pending = getPendingOrder(to);

    if (orders.length === 0 && !pending) {
      return sendText(
        to,
        `📦 *Track your Sokoni order*\n\n` +
          `You don't have any orders yet.\n\n` +
          `Type *menu* → browse → reply *1* on an item to order. All orders are *100% prepaid* 💵`
      );
    }

    const blocks = [];
    if (pending) {
      blocks.push(
        `⏳ *Order not finished*\n` +
          `${pending.name} — ${formatBuyerTotalLine(pending)}\n` +
          `Send your name, location & phone to complete it, or type *cancel*.`
      );
    }
    for (const order of orders.slice(0, 3)) {
      blocks.push(renderOrderCard(order));
    }

    await sendText(
      to,
      `📦 *Your Sokoni orders*\n\n` +
        blocks.join("\n\n━━━━━━━━━━━━━━━\n\n") +
        `\n\n_Type an order number (e.g. ${orders[0]?.id || "SKN-1001"}) for details, or *menu* to shop._`
    );
    await sendPaymentReminderSafe(to, pickPaymentReminderOrder(orders));
    return true;
  } catch (err) {
    console.error("[track] sendTrackOrderMenu failed:", err.message);
    return sendText(to, "Sorry, could not load your orders. Type *track* again or *menu* for help.");
  }
}

/** Recent TikTok/viral featured deals (synced from backend cron). */
export async function sendViralDealsMenu(to) {
  const ids = getFeaturedProductIds();
  if (!ids.length) {
    return sendText(
      to,
      `🔥 *Viral Bargains*\n\n` +
        `Hakuna deal mpya ya TikTok bado — check tena baadaye!\n\n` +
        `Type *menu* → *1* to browse all categories, or tell me what you're looking for.`
    );
  }
  const products = [];
  for (const id of ids.slice(0, 5)) {
    const p = await getProductById(id);
    if (p) products.push(p);
  }
  if (!products.length) {
    return sendText(to, "Featured deals are updating — type *menu* to browse meanwhile.");
  }
  return sendNumberedProductList(to, products, {
    title: "🔥 *As seen on TikTok* — recent viral deals:",
  });
}

export async function sendHumanHandoff(customerKey, { chatId, displayName, phone, lastMessage } = {}) {
  await sendText(
    customerKey,
    "Got it — connecting you with our team. Someone will reply here shortly. 🙏"
  );
  await startHumanHandoff(customerKey, {
    chatId: chatId || customerKey,
    displayName,
    phone,
    lastMessage,
  });
}

export function sendHowItWorks(to) {
  return sendText(to, `${howItWorksMessage()}\n\n${siteUrlLine()}`);
}

export function sendWebsiteLink(to) {
  return sendText(
    to,
    `${siteUrlLine("Shop Sokoni online")}\n\n` +
      `Browse all categories, hot deals & viral bargains — then order here on WhatsApp (100% prepaid 💵).\n\n` +
      `_Type *menu* to continue shopping in chat._`
  );
}

export async function sendProductFollowUpContext(id) {
  const productId = id.replace("ask_ai_", "");
  return getProductById(productId);
}

export async function startCodOrder(to, productId) {
  return startPrepaidOrder(to, productId);
}

function phoneDigitsFromChat(to) {
  const metaPhone = getCustomerMeta(to)?.phone;
  const raw = String(metaPhone || to || "").replace(/\D/g, "");
  if (raw.startsWith("0") && raw.length >= 10) return `254${raw.slice(1)}`;
  if (raw.length === 9) return `254${raw}`;
  return raw;
}

/** Start prepaid checkout from an accepted structured offer (agreed buyer total). */
export async function startPrepaidOrderFromOffer(to, offerId) {
  try {
    const { findOrCreateBuyerUserByPhone } = await import("../db/repositories/users.js");
    const { getAcceptedOfferForCheckout } = await import("../db/repositories/social.js");
    const phone = phoneDigitsFromChat(to);
    const userResult = await findOrCreateBuyerUserByPhone(phone);
    if (userResult.error || !userResult.user?.id) {
      return sendText(
        to,
        "I couldn't match your WhatsApp to a Sokoni buyer profile. Open the site, verify WhatsApp, then reply *pay_offer_" +
          String(offerId) +
          "* again."
      );
    }
    const checkout = await getAcceptedOfferForCheckout({
      offerId,
      buyerUserId: userResult.user.id,
    });
    if (checkout.error) {
      return sendText(to, checkout.message || "That offer can't be checked out right now.");
    }
    return startPrepaidOrder(to, checkout.productId, {
      offerId: checkout.offer.id,
      totalsOverride: checkout.breakdown,
    });
  } catch (err) {
    console.error("[offer-checkout] start failed:", err.message);
    return sendText(to, "Couldn't start offer checkout right now. Try again in a moment.");
  }
}

export async function startPrepaidOrder(to, productId, { offerId = null, totalsOverride = null } = {}) {
  const product = await getProductById(productId);
  if (!product) return sendMainMenu(to);

  let totals = totalsOverride;
  let activeOfferId = offerId;

  if (activeOfferId && !totals) {
    return startPrepaidOrderFromOffer(to, activeOfferId);
  }

  if (!totals) {
    totals = computeProductTotals(product);
  }

  setPendingOrder(to, {
    productId: product.id,
    name: product.name,
    priceKes: totals.itemKes,
    shippingKes: totals.shippingKes,
    totalKes: totals.totalKes,
    platformFeeKes: totals.platformFeeKes,
    sellerNetKes: totals.sellerNetKes,
    offerId: activeOfferId || null,
    fromOffer: Boolean(activeOfferId),
  });

  const offerNote = activeOfferId
    ? `\n🤝 *Accepted offer* — paying agreed total *KES ${Number(totals.totalKes).toLocaleString()}* (not list price).\n`
    : "";

  return sendText(
    to,
    `Great choice! 🛍️\n` +
      `*${product.name}*\n` +
      `${formatBuyerTotalLine(totals)} (100% prepaid · escrow)` +
      offerNote +
      `\n` +
      `To place your order, reply in *one message* with:\n` +
      `1️⃣ Your full name\n` +
      `2️⃣ Delivery location (estate/town + a landmark)\n` +
      `3️⃣ Phone number for the rider\n\n` +
      `_Example: Jane Wanjiru, Umoja 1 near the market, 07xx xxx xxx_\n\n` +
      `You'll pay upfront via M-Pesa before we dispatch — no COD.\n\n` +
      `Wrong item? Type *cancel* or tell me the correct product name.`
  );
}

/** Handle messages while customer is mid-order (before confirm). */
export async function tryHandlePendingOrder(to, text) {
  const pendingCart = getPendingCart(to);
  if (pendingCart?.lines?.length) {
    const lower = text.toLowerCase();
    if (/^(cancel|stop|nevermind|abort)(\s+order)?$/i.test(lower) || /cancel order/i.test(lower)) {
      clearPendingCart(to);
      await sendText(to, "Cart checkout cancelled ✅ Type *menu* or reopen your website bag.");
      return true;
    }
    const parsed = parseDeliveryDetails(text);
    if (!parsed) {
      await sendText(
        to,
        `Still checking out your *cart* (${pendingCart.lines.length} items).\n\n` +
          `${deliveryDetailsHint(text)}\n\n` +
          `_Example: Jane Wanjiru, Nakuru Naivas, 0712345678_`
      );
      return true;
    }
    return confirmCartOrder(to, parsed);
  }

  const pending = getPendingOrder(to);
  if (!pending) return false;

  const lower = text.toLowerCase();

  if (/^(cancel|stop|nevermind|abort)(\s+order)?$/i.test(lower) || /cancel order/i.test(lower)) {
    clearPendingOrder(to);
    await sendText(to, "Order cancelled ✅ Type *menu* to shop again.");
    return true;
  }

  if (isOrderCorrectionMessage(text)) {
    const alt = await findProductFromMessage(text);
    if (alt) return startPrepaidOrder(to, alt.id);
    clearPendingOrder(to);
    await sendText(
      to,
      "Order cancelled. Type *menu* → browse categories, pick a number, then reply *1* to order."
    );
    return true;
  }

  const parsed = parseDeliveryDetails(text);
  if (!parsed) {
    if (!looksLikeDeliveryDetails(text)) {
      const alt = await findProductFromMessage(text);
      if (alt && alt.id !== pending.productId) return startPrepaidOrder(to, alt.id);
    }
    await sendText(
      to,
      `Still ordering *${pending.name}*.\n\n` +
        `${deliveryDetailsHint(text)}\n\n` +
        `_Example: Jane Wanjiru, Umoja 1 near the market, 0712345678_\n\n` +
        `Wrong item? Type *cancel* or say e.g. "I want Hisense TV instead".`
    );
    return true;
  }

  return confirmPrepaidOrder(to, parsed);
}

export async function cancelOrder(to) {
  if (getPendingCart(to)) {
    clearPendingCart(to);
    return sendText(to, "Cart checkout cancelled ✅ Type *menu* to shop again.");
  }
  if (getPendingOrder(to)) {
    clearPendingOrder(to);
    return sendText(to, "Your order was cancelled ✅ Type *menu* to shop again.");
  }
  return sendText(to, "You don't have an open order. Type *menu* to browse and order.");
}

export async function changeOrder(to) {
  if (getPendingOrder(to)) {
    clearPendingOrder(to);
    return sendText(
      to,
      "Order cleared ✅ Type *menu* → browse → reply with the item number, then *1* to order the new item."
    );
  }
  return sendText(to, "No active order to change. Type *menu* to start shopping.");
}

export async function handleCart(to) {
  const pendingCart = getPendingCart(to);
  if (pendingCart?.lines?.length) {
    const n = pendingCart.lines.length;
    return sendText(
      to,
      `🛒 *Cart checkout in progress* (${n} item${n === 1 ? "" : "s"})\n` +
        `Estimated total: *KES ${Number(pendingCart.estimatedTotalKes || 0).toLocaleString()}*\n\n` +
        `Send delivery details in one message:\n` +
        `1️⃣ Full name\n2️⃣ Landmark / pickup spot\n3️⃣ Phone for M-Pesa\n\n` +
        `_Example: Jane Wanjiru, Nakuru Naivas, 0712345678_\n\n` +
        `Type *cancel* to clear the cart checkout.`
    );
  }
  const pending = getPendingOrder(to);
  if (pending) {
    return sendText(
      to,
      `🛒 *Your current order:*\n*${pending.name}*\n${formatBuyerTotalLine(pending)} (100% prepaid)\n\n` +
        `Send delivery details to complete, or type *cancel* / *change order*.`
    );
  }
  if (!isMultiSellerCartEnabled()) {
    return sendText(
      to,
      "Sokoni orders one item at a time (100% prepaid — no cart).\n\nType *menu* → browse → reply with an item number → *1* to order."
    );
  }
  return sendText(
    to,
    "🛒 *Multi-seller cart*\n\n" +
      "Save items on the website bag, then tap *Order cart on WhatsApp*.\n" +
      "You'll pay once via M-Pesa; each item gets its own tracking ID (SKN-…-1, SKN-…-2…).\n\n" +
      "Or type *menu* to order a single item as before."
  );
}

/**
 * Website bag handoff (SOKONI_CART + [SKU:id]).
 * Flow: product images for each line → ONE message asking name / landmark / phone.
 * No AI till prompts, no "pick a number" lists.
 */
export async function startCartFromHandoff(to, text) {
  if (!isMultiSellerCartEnabled()) return false;
  const parsed = parseCartHandoffMessage(text);
  if (!parsed?.lines?.length) return false;

  clearPendingOrder(to);
  clearMenuState(to);

  const resolved = [];
  for (const line of parsed.lines.slice(0, 20)) {
    const product = await getProductById(line.productId);
    if (!product) continue;
    const fees = computeCartLineFees({ ...product, productId: product.id }, line.quantity || 1);
    resolved.push({ product: { ...product, productId: product.id }, quantity: fees.quantity, fees });
  }
  if (!resolved.length) {
    await sendText(
      to,
      "I couldn't match those bag items in the catalog. Open the site bag again or type *menu* to browse."
    );
    return true;
  }

  const parentTotals = computeCartParentTotals(resolved.map((r) => r.fees));
  setPendingCart(to, {
    lines: resolved.map((r) => ({
      productId: r.product.id,
      quantity: r.quantity,
      name: r.product.name,
      lineBuyerKes: r.fees.lineBuyerKes,
    })),
    estimatedTotalKes: parentTotals.totalKes,
    estimatedTxnFeeKes: parentTotals.transactionFeeKes,
    estimatedPlatformFeeKes: parentTotals.platformFeeKes,
    createdAt: Date.now(),
  });

  // 1) Show each ordered item with its photo (no order-action menus)
  for (const r of resolved) {
    const caption =
      `*${r.product.name}*\n` +
      `KES ${r.fees.lineBuyerKes.toLocaleString()}` +
      (r.quantity > 1 ? ` × ${r.quantity}` : "") +
      `\n_In your cart_`;
    try {
      const sent = await sendProductImage(to, r.product, caption);
      if (!sent) {
        await sendText(to, caption);
      }
    } catch (err) {
      console.warn("[cart] image send failed:", r.product.id, err.message);
      await sendText(to, caption);
    }
  }

  // 2) Single ask for delivery / M-Pesa details (payment STK comes after this)
  await sendText(
    to,
    `🛒 *${resolved.length} item${resolved.length === 1 ? "" : "s"} ready*\n` +
      `💰 Total: *KES ${parentTotals.totalKes.toLocaleString()}*\n` +
      `_10% Sokoni fee per item · one M-Pesa fee on the total_\n\n` +
      `Reply in *one message* with:\n` +
      `1️⃣ Full name\n` +
      `2️⃣ Landmark / town\n` +
      `3️⃣ Phone for M-Pesa\n\n` +
      `_Example: Amina Otieno, Archways Mall hub, 0712345678_`
  );
  return true;
}

export async function confirmCartOrder(to, parsed) {
  const pending = getPendingCart(to);
  if (!pending?.lines?.length) return false;

  const details =
    typeof parsed === "string" ? parseDeliveryDetails(parsed) : parsed;
  if (!details) {
    await sendText(
      to,
      `Still checking out your cart.\n\n${deliveryDetailsHint(typeof parsed === "string" ? parsed : "")}\n\n` +
        `_Example: Jane Wanjiru, Nakuru Naivas, 0712345678_`
    );
    return true;
  }

  clearPendingCart(to);
  setCustomerMeta(to, { phone: details.phone.replace(/\D/g, "") });
  const meta = getCustomerMeta(to) || {};

  const lineInputs = [];
  for (const line of pending.lines) {
    const product = await getProductById(line.productId);
    if (!product) continue;
    lineInputs.push({
      product: { ...product, productId: product.id },
      quantity: line.quantity || 1,
    });
  }
  if (!lineInputs.length) {
    await sendText(to, "Those cart items are no longer available. Type *menu* to browse again.");
    return true;
  }

  let created = null;
  try {
    created = createCartOrder({
      customerKey: to,
      chatId: meta.chatId || to,
      lines: lineInputs,
      details,
    });
  } catch (err) {
    console.error("[cart] createCartOrder failed:", err.message);
    await sendText(
      to,
      `Could not create the cart order (${err.message}). Type *menu* or try a single-item order.`
    );
    return true;
  }

  let { parent, children } = created;
  try {
    const ensured = await ensureHybridShippingBeforePayment(parent);
    if (ensured?.order) parent = ensured.order;
    children = (parent.itemIds || []).map((id) => getOrder(id)).filter(Boolean);
  } catch (err) {
    console.warn("[cart] hybrid shipping ensure skipped:", err?.message || err);
  }

  const childLines = children
    .map((c) => `• *${c.id}* — ${c.productName}`)
    .join("\n");

  try {
    await sendText(
      config.admin.primary,
      `🛒 *CART ORDER ${parent.id}*\n` +
        `${children.length} lines · KES ${orderBuyerTotal(parent).toLocaleString()}\n` +
        `Buyer: ${details.name} · ${details.phone}\n` +
        `📍 ${details.location}\n` +
        `${childLines}`
    );
  } catch (err) {
    console.error("[cart] admin notify failed:", err.message);
  }

  const shipLine =
    Math.round(Number(parent.shippingKes) || 0) > 0
      ? `🚚 Shipping: KES ${Math.round(Number(parent.shippingKes)).toLocaleString()}\n`
      : "";

  await sendText(
    to,
    `✅ *Cart placed — ${parent.id}*\n\n` +
      `${childLines}\n\n` +
      shipLine +
      `💰 Total: *KES ${orderBuyerTotal(parent).toLocaleString()}*\n` +
      `(Includes 10% Sokoni fee *per item* + one M-Pesa fee)\n` +
      `📍 ${details.location}\n\n` +
      `Pay once — escrow holds each item separately.\n` +
      `🌐 Pay: ${checkoutUrlForOrder(parent.id)}\n` +
      `${siteUrlLine()}`
  );

  await sendPrepaidCheckoutSafe(to, parent);
  return true;
}

export async function confirmPrepaidOrder(to, parsed) {
  const pending = getPendingOrder(to);
  if (!pending) return false;

  const details =
    typeof parsed === "string" ? parseDeliveryDetails(parsed) : parsed;
  if (!details) {
    await sendText(
      to,
      `I can't place the order yet — I still need your delivery details.\n\n` +
        `${deliveryDetailsHint(typeof parsed === "string" ? parsed : text)}\n\n` +
        `_Example: Jane Wanjiru, Umoja 1 near the market, 0712345678_`
    );
    return true;
  }

  clearPendingOrder(to);

  setCustomerMeta(to, { phone: details.phone.replace(/\D/g, "") });

  const meta = getCustomerMeta(to) || {};
  const catalogProduct = pending.productId ? await getProductById(pending.productId) : null;
  const productForOrder = catalogProduct
    ? { ...catalogProduct, productId: catalogProduct.id }
    : pending;

  let order = null;
  try {
    const totalsOverride =
      pending.offerId && pending.totalKes != null
        ? {
            itemKes: pending.priceKes,
            shippingKes: pending.shippingKes,
            totalKes: pending.totalKes,
            platformFeeKes: pending.platformFeeKes,
            sellerNetKes: pending.sellerNetKes,
          }
        : null;
    order = createOrder({
      customerKey: to,
      chatId: meta.chatId || to,
      product: productForOrder,
      details,
      offerId: pending.offerId || null,
      totalsOverride,
    });
  } catch (err) {
    console.error("[order] createOrder failed (continuing):", err.message);
  }

  if (order) {
    try {
      const ensured = await ensureHybridShippingBeforePayment(order);
      if (ensured?.order) order = ensured.order;
    } catch (err) {
      console.warn("[order] hybrid shipping ensure skipped:", err?.message || err);
    }
  }

  const summary = buildOrderAdminSummary({
    customerKey: to,
    pending,
    details,
    order,
  });
  console.log("[order:new]\n" + summary);

  try {
    await sendText(config.admin.primary, summary);
  } catch (err) {
    console.error("Failed to notify business of order:", err.message);
  }

  if (config.adminNotifyUrl) {
    try {
      await fetch(config.adminNotifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "prepaid_order", from: to, order, details }),
      });
    } catch (err) {
      console.error("Failed to notify admin of order:", err.message);
    }
  }

  const orderRef = order?.id;
  await sendText(
    to,
    prepaidOrderPlacedMessage({
      orderId: orderRef || "pending",
      productName: pending.name,
      amountKes: order ? orderBuyerTotal(order) : pending.totalKes ?? pending.priceKes,
      itemKes: order?.sellerNetKes ?? order?.priceKes ?? pending.priceKes,
      shippingKes: order?.shippingKes ?? pending.shippingKes,
      customerName: details.name,
      location: details.location,
      phone: details.phone,
    }) +
      (order ? `\nStatus: ${statusLabel(order.status)}` : "") +
      `\n\n${siteUrlLine()}` +
      (orderRef ? `\n💳 Pay online: ${checkoutUrlForOrder(orderRef)}` : "")
  );

  if (order) await sendPrepaidCheckoutSafe(to, order);
  await sendUpsell(to, pending);
  return true;
}

/** @deprecated alias — Phase 5 prepaid-only */
export async function confirmCodOrder(to, parsed) {
  return confirmPrepaidOrder(to, parsed);
}

/** Suggest a popular add-on after an order (TakeApp-style best-seller nudge). */
async function sendUpsell(to, justOrdered) {
  try {
    const picks = await searchProducts({ scope: "local", fulfillment: "store", limit: 6 });
    const suggestion = picks.find((p) => p.id !== justOrdered.productId && p.priceKes);
    if (!suggestion) return;
    setProductContext(to, suggestion);
    setMenuState(to, {
      type: "product",
      productId: suggestion.id,
      options: [
        { id: `order_${suggestion.id}`, label: `Order ${suggestion.name}` },
        { id: "menu_main", label: "⬅ Main menu" },
      ],
    });
    await sendText(
      to,
      `🔥 *Customers also love…*\n\n` +
        `*${suggestion.name}*\n` +
        `KES ${formatProductListPrice(suggestion)} · ⭐ ${suggestion.rating} · 100% prepaid\n\n` +
        `Add it too? Reply *1* to order, or *menu* to keep shopping.`
    );
  } catch (err) {
    console.error("[upsell] failed:", err.message);
  }
}

/** Route a menu action id (from numbered reply or legacy interactive id). */
export async function handleMenuAction(from, id) {
  if (id === "menu_main") return sendMainMenu(from);
  if (id === "shop_all") return sendCategoryList(from);
  if (await isCategoryMenuId(id)) return sendCategorySubmenu(from, id);
  if (await isSubcategoryRowId(id)) return sendProductsForSubcategory(from, id);
  if (id.startsWith("order_") && id.includes("_offer_")) {
    const match = id.match(/^order_(.+)_offer_(\d+)$/i);
    if (match) return startPrepaidOrder(from, match[1], { offerId: match[2] });
  }
  if (id.startsWith("pay_offer_")) {
    return startPrepaidOrderFromOffer(from, id.replace(/^pay_offer_/i, ""));
  }
  if (id.startsWith("order_")) return startPrepaidOrder(from, id.replace("order_", ""));
  if (id.startsWith("pick_")) return showProductActions(from, id.replace("pick_", ""));
  if (id === "deals_today") return sendDealsOfTheDay(from);
  if (id === "intl_shop" || id === "intl_trending" || id === "intl_custom") {
    return sendText(
      from,
      "Sokoni Mall is *100% local & prepaid* — brand new and pre-loved items from Kenya sellers only.\n\nType *menu* to browse, or tell me what you're looking for."
    );
  }
  if (id === "track_order") return sendTrackOrderMenu(from, getCustomerMeta(from)?.phone || "");
  if (id === "visit_site") return sendWebsiteLink(from);
  if (id === "human_handoff") {
    const meta = getCustomerMeta(from) || {};
    return sendHumanHandoff(from, { ...meta, lastMessage: "Menu → Talk to a Human" });
  }
  if (id === "how_it_works") return sendHowItWorks(from);
  if (id.startsWith("vendor_")) {
    const { handleVendorMenuAction } = await import("./role-menus.js");
    const phone = getCustomerMeta(from)?.phone || "";
    return handleVendorMenuAction(from, id, { phone });
  }
  if (id.startsWith("ask_ai_")) {
    const product = await sendProductFollowUpContext(id);
    if (product) {
      const { setProductContext, pushMessage } = await import("./session.js");
      setProductContext(from, product);
      pushMessage(
        from,
        "system",
        `The customer wants to ask about this specific product: ${JSON.stringify(product)}`
      );
    }
    return sendText(from, "Sure — what would you like to know about it? 🤔");
  }
  return sendMainMenu(from);
}
