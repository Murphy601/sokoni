import { config } from "../config.js";
import { sendText, sendProductCard } from "./whatsapp.js";
import { searchProducts, getProductById, findProductFromMessage, listCategoryProducts, getPerfumeVariantsForFamily, listPerfumeScentFamilies } from "./catalog.js";
import { formatListNumber, formatKes } from "./list-format.js";
import { buildAffiliateLink, SOURCE_LABELS } from "./affiliate.js";
import {
  setPendingOrder,
  getPendingOrder,
  clearPendingOrder,
  setMenuState,
  setProductContext,
  clearHumanHandoff,
  getCustomerMeta,
  setCustomerMeta,
} from "./session.js";
import { startHumanHandoff, buildOrderAdminSummary } from "./handoff.js";
import {
  createOrder,
  getOrdersForCustomer,
  statusLabel,
  getOrder,
} from "./orders.js";
import { getFeaturedProductIds } from "./tiktok.js";
import { siteUrlLine } from "./reviews.js";
import { formatShortPaymentReminder, formatMpesaTillBlock } from "./payment.js";

function formatNumberedMenu(title, options) {
  const lines = options.map((o, i) => `${i + 1}. ${o.label}`);
  return `${title}\n\n${lines.join("\n")}\n\n_Reply with the number (e.g. 1)_`;
}

function sendNumberedMenu(to, title, options) {
  setMenuState(to, { options });
  return sendText(to, formatNumberedMenu(title, options));
}

export async function sendWelcome(to) {
  await sendText(
    to,
    `👋 Karibu! I'm *${config.brand.name} AI* — your shopping buddy on WhatsApp.\n` +
      `Tell me what you're looking for, or reply with a number from the menu 👇\n\n` +
      `${siteUrlLine()}`
  );
  return sendMainMenu(to);
}

export function sendMainMenu(to) {
  const options = [
    { id: "shop_all", label: "🛍️ Browse Categories" },
    { id: "deals_today", label: "🔥 Today's Picks" },
    { id: "intl_shop", label: "🌍 Shop International" },
    { id: "track_order", label: "🧾 Track My Order" },
    { id: "visit_site", label: "🌐 Visit Website" },
    { id: "human_handoff", label: "🙋 Talk to a Human" },
    { id: "how_it_works", label: "❓ How Sokoni Works" },
  ];
  return sendNumberedMenu(to, "Karibu Sokoni! Everything is *pay on delivery* 💵", options);
}

const CATALOG_PAGE_SIZE = 12;

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

const CATEGORY_SUBMENUS = {
  cat_phones: {
    category: "phones-tablets",
    label: "📱 Phones & Tablets",
    rows: [
      { id: "sub_phones_smartphones", title: "Smartphones", subcategory: "smartphones" },
      { id: "sub_phones_tablets", title: "Tablets", subcategory: "tablets" },
      { id: "sub_phones_power-banks", title: "Power Banks", subcategory: "power-banks" },
      { id: "sub_phones_accessories", title: "Phone Accessories", subcategory: "phone-accessories" },
    ],
  },
  cat_tvaudio: {
    category: "tvs-audio",
    label: "📺 TVs & Audio",
    rows: [
      { id: "sub_tvaudio_televisions", title: "Televisions", subcategory: "televisions" },
      { id: "sub_tvaudio_headphones", title: "Headphones & Earbuds", subcategory: "headphones" },
      { id: "sub_tvaudio_speakers", title: "Speakers", subcategory: "speakers" },
      { id: "sub_tvaudio_home-theatre", title: "Home Theatre", subcategory: "home-theatre" },
    ],
  },
  cat_appliances: {
    category: "appliances",
    label: "🔌 Appliances",
    rows: [
      { id: "sub_appliances_kitchen", title: "Kitchen Appliances", subcategory: "kitchen-appliances" },
      { id: "sub_appliances_kettles", title: "Kettles", subcategory: "kettles" },
      { id: "sub_appliances_blenders", title: "Blenders", subcategory: "blenders" },
      { id: "sub_appliances_irons", title: "Irons", subcategory: "irons" },
      { id: "sub_appliances_washing", title: "Washing Machines", subcategory: "washing-machines" },
    ],
  },
  cat_beauty: {
    category: "health-beauty",
    label: "💄 Health & Beauty",
    rows: [
      { id: "sub_beauty_skincare", title: "Skincare", subcategory: "skincare" },
      { id: "sub_beauty_haircare", title: "Hair Care", subcategory: "haircare" },
      { id: "sub_beauty_makeup", title: "Makeup", subcategory: "makeup" },
      { id: "sub_beauty_personal-care", title: "Personal Care", subcategory: "personal-care" },
      { id: "sub_beauty_fragrances", title: "Fragrances", subcategory: "fragrances" },
      { id: "sub_beauty_perfume-oils", title: "Perfume Oils", subcategory: "perfume-oils" },
    ],
  },
  cat_home: {
    category: "home-office",
    label: "🏠 Home & Office",
    rows: [
      { id: "sub_home_kitchen-dining", title: "Kitchen & Dining", subcategory: "kitchen-dining" },
      { id: "sub_home_bedding", title: "Bedding", subcategory: "bedding" },
      { id: "sub_home_cleaning", title: "Cleaning", subcategory: "cleaning" },
      { id: "sub_home_decor", title: "Home Decor", subcategory: "home-decor" },
      { id: "sub_home_stationery", title: "Stationery", subcategory: "stationery" },
    ],
  },
  cat_fashion: {
    category: "fashion",
    label: "👗 Fashion",
    rows: [
      { id: "sub_fashion_mens", title: "Men's Fashion", subcategory: "mens-fashion" },
      { id: "sub_fashion_womens", title: "Women's Fashion", subcategory: "womens-fashion" },
      { id: "sub_fashion_shoes", title: "Shoes", subcategory: "shoes" },
      { id: "sub_fashion_bags", title: "Bags", subcategory: "bags" },
      { id: "sub_fashion_watches", title: "Watches", subcategory: "watches" },
    ],
  },
  cat_computing: {
    category: "computing",
    label: "💻 Computing",
    rows: [
      { id: "sub_computing_laptops", title: "Laptops", subcategory: "laptops" },
      { id: "sub_computing_printers", title: "Printers", subcategory: "printers" },
      { id: "sub_computing_storage", title: "Storage", subcategory: "storage" },
      { id: "sub_computing_accessories", title: "Accessories", subcategory: "computer-accessories" },
    ],
  },
  cat_gaming: {
    category: "gaming",
    label: "🎮 Gaming",
    rows: [
      { id: "sub_gaming_consoles", title: "Consoles", subcategory: "consoles" },
      { id: "sub_gaming_controllers", title: "Controllers", subcategory: "controllers" },
      { id: "sub_gaming_accessories", title: "Gaming Accessories", subcategory: "gaming-accessories" },
    ],
  },
  cat_supermarket: {
    category: "supermarket",
    label: "🛒 Supermarket",
    rows: [
      { id: "sub_supermarket_food", title: "Food Cupboard", subcategory: "food-cupboard" },
      { id: "sub_supermarket_drinks", title: "Drinks", subcategory: "drinks" },
      { id: "sub_supermarket_household", title: "Household Supplies", subcategory: "household-supplies" },
    ],
  },
  cat_baby: {
    category: "baby-products",
    label: "🍼 Baby Products",
    rows: [
      { id: "sub_baby_diapering", title: "Diapering", subcategory: "diapering" },
      { id: "sub_baby_feeding", title: "Feeding", subcategory: "feeding" },
      { id: "sub_baby_toys", title: "Toys", subcategory: "toys" },
      { id: "sub_baby_gear", title: "Baby Gear", subcategory: "baby-gear" },
    ],
  },
};

export function sendCategoryList(to) {
  const options = Object.entries(CATEGORY_SUBMENUS).map(([id, menu]) => ({
    id,
    label: menu.label,
  }));
  options.push({ id: "menu_main", label: "⬅ Main menu" });
  return sendNumberedMenu(to, "Shop by category — all items are pay on delivery 💵", options);
}

export function isCategoryMenuId(id) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_SUBMENUS, id);
}

export function sendCategorySubmenu(to, categoryMenuId) {
  const menu = CATEGORY_SUBMENUS[categoryMenuId];
  const options = [
    ...menu.rows.map((row) => ({ id: row.id, label: row.title })),
    { id: "menu_main", label: "⬅ Main menu" },
  ];
  return sendNumberedMenu(to, `${menu.label} — pick a sub-category:`, options);
}

function findSubcategoryRow(rowId) {
  for (const menu of Object.values(CATEGORY_SUBMENUS)) {
    const row = menu.rows.find((r) => r.id === rowId);
    if (row) return { category: menu.category, subcategory: row.subcategory };
  }
  return null;
}

export function isSubcategoryRowId(id) {
  return Boolean(findSubcategoryRow(id));
}

export async function sendProductsForSubcategory(to, rowId, page = 0) {
  const target = findSubcategoryRow(rowId);
  if (!target) return sendMainMenu(to);
  if (target.subcategory === "perfume-oils") {
    return sendPerfumeScentList(to, { page, rowId });
  }
  const products = await listCategoryProducts({
    category: target.category,
    subcategory: target.subcategory,
    scope: "local",
    fulfillment: "store",
  });
  if (products.length === 0) {
    await sendText(to, "I don't have picks here yet — reply *1* on the main menu to browse categories.");
    return sendMainMenu(to);
  }
  const label = SUBCATEGORY_LABELS[target.subcategory] || target.subcategory;
  return sendPaginatedProductList(to, products, {
    title: `*${label}* — full catalog (${products.length} items)`,
    page,
    rowId,
  });
}

/** Step 1: scent names only (no size) — paginated. */
export async function sendPerfumeScentList(to, { page = 0, rowId = "sub_beauty_perfume-oils" } = {}) {
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
    return `${formatListNumber(i + 1)} *${label}* — ${formatKes(p.priceKes)} · pay on delivery`;
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
      `${formatListNumber(i + 1)} *${p.name}*\n   ${formatKes(p.priceKes)} · ⭐ ${p.rating} · pay on delivery`
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
    }
  }
}

export async function sendDealsOfTheDay(to) {
  const deals = await searchProducts({
    scope: "local",
    fulfillment: "store",
    limit: 5,
  });
  return sendNumberedProductList(to, deals, { title: "🔥 Today's Picks — pay on delivery 💵" });
}

/** Show a numbered list — customer replies 1, 2, 3 to pick an item. */
export async function sendNumberedProductList(to, products, { title = "Pick an item", footer = "" } = {}) {
  const lines = products.map(
    (p, i) =>
      `${formatListNumber(i + 1)} *${p.name}*\n   ${formatKes(p.priceKes)} · ⭐ ${p.rating} · pay on delivery`
  );

  const options = products.map((p) => ({
    id: `pick_${p.id}`,
    label: `${p.name} — KES ${p.priceKes.toLocaleString()}`,
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

const STATUS_STEPS = ["received", "confirmed", "packed", "out_for_delivery", "delivered"];

function formatOrderKes(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function paymentLineForOrder(order) {
  if (order.customerPaymentStatus === "confirmed") return "✅ Payment confirmed";
  if (order.customerPaymentStatus === "claimed") return "⏳ Payment pending verification";
  return "pay on delivery";
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

async function sendTillIntroSafe(to, amountKes) {
  try {
    await sendText(to, formatMpesaTillBlock(amountKes));
  } catch (err) {
    console.error("[payment] till intro failed:", err.message);
  }
}

function pickPaymentReminderOrder(orders) {
  const eligible = orders.filter(
    (o) => o.customerPaymentStatus !== "confirmed" && o.status !== "cancelled"
  );
  const priority = ["out_for_delivery", "packed", "confirmed", "received"];
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

function renderStatusTimeline(currentStatus) {
  if (currentStatus === "cancelled") return "❌ This order was cancelled.";
  const idx = STATUS_STEPS.indexOf(currentStatus);
  return STATUS_STEPS.map((s, i) => {
    const mark = i < idx ? "✅" : i === idx ? "🔵" : "⚪";
    return `${mark} ${statusLabel(s)}`;
  }).join("\n");
}

function renderOrderCard(order) {
  return (
    `📦 *${order.id}*\n` +
    `🛍️ ${order.productName}\n` +
    `💰 KES ${formatOrderKes(order.priceKes)} — ${paymentLineForOrder(order)}\n` +
    `📍 ${order.location}\n\n` +
    `${renderStatusTimeline(order.status)}`
  );
}

/** Show a specific order by ID (customer typed e.g. SK-1042). */
export async function sendOrderStatus(to, orderId, phone = "") {
  const order = getOrder(orderId);
  if (!orderBelongsToCustomer(order, to, phone)) {
    return sendText(to, `I couldn't find order *${orderId}* on this number. Type *track* to see your orders.`);
  }
  try {
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
          `Type *menu* → browse → reply *1* on an item to order. All orders are *pay on delivery* 💵`
      );
    }

    const blocks = [];
    if (pending) {
      blocks.push(
        `⏳ *Order not finished*\n` +
          `${pending.name} — KES ${formatOrderKes(pending.priceKes)}\n` +
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
        `\n\n_Type an order number (e.g. ${orders[0]?.id || "SK-1001"}) for details, or *menu* to shop._`
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
  return sendText(
    to,
    `*How ${config.brand.name} works* 🛍️\n\n` +
      `1️⃣ Chat Sokoni on WhatsApp (or browse sokonimall.com).\n` +
      `2️⃣ Our AI finds the right product from our *pay-on-delivery* store catalog.\n` +
      `3️⃣ Reply *1* to order — share name, location & phone in one message.\n` +
      `4️⃣ We deliver — you pay cash or M-Pesa to the rider on arrival.\n` +
      `5️⃣ Track anytime with your *SK-####* order number.\n\n` +
      `*International?* Type *menu* → *Shop International* for AliExpress, Temu & Amazon links (1–4 weeks; customs may apply).\n\n` +
      `${config.store.deliveryNote}\n\n` +
      `${siteUrlLine()}\n\n` +
      `Type *menu* anytime to start again.`
  );
}

export function sendWebsiteLink(to) {
  return sendText(
    to,
    `${siteUrlLine("Shop Sokoni online")}\n\n` +
      `Browse all categories, hot deals & viral bargains — then order here on WhatsApp (pay on delivery 💵).\n\n` +
      `_Type *menu* to continue shopping in chat._`
  );
}

export async function sendProductFollowUpContext(id) {
  const productId = id.replace("ask_ai_", "");
  return getProductById(productId);
}

export async function startCodOrder(to, productId) {
  const product = await getProductById(productId);
  if (!product) return sendMainMenu(to);
  setPendingOrder(to, {
    productId: product.id,
    name: product.name,
    priceKes: product.priceKes,
  });
  return sendText(
    to,
    `Great choice! 🛍️\n` +
      `*${product.name}* — KES ${product.priceKes.toLocaleString()} (pay on delivery)\n\n` +
      `To place your order, reply in *one message* with:\n` +
      `1️⃣ Your full name\n` +
      `2️⃣ Delivery location (estate/town + a landmark)\n` +
      `3️⃣ Phone number for the rider\n\n` +
      `_Example: Jane Wanjiru, Umoja 1 near the market, 07xx xxx xxx_\n\n` +
      `Wrong item? Type *cancel* or tell me the correct product name.`
  );
}

function normalizeKenyanPhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith("0") && digits.length === 10) return digits;
  if (digits.length === 9 && /^[17]/.test(digits)) return `0${digits}`;
  return null;
}

function isOrderCorrectionMessage(text) {
  const lower = text.toLowerCase();
  return (
    /^(cancel|stop|nevermind|abort)(\s+order)?$/i.test(lower) ||
    /cancel order|change order|wrong item|wrong product/i.test(lower) ||
    /change|instead|wrong|not .*want|i choose|i wanted/i.test(lower) ||
    (/\bnot\b/i.test(lower) && /tv|phone|redmi|hisense|samsung|infinix|item|product/i.test(lower))
  );
}

/**
 * Strict parse — order only completes when name, location, and phone are all present.
 * Returns null if anything is missing or the message looks like a product/correction.
 */
function parseDeliveryDetails(text) {
  const t = text.trim();
  if (!t || t.length < 12) return null;

  if (/^(yes|ok|okay|sure|confirm|proceed|done|thanks?|thank you|hi|hello|menu|\d{1,2})$/i.test(t)) {
    return null;
  }

  if (isOrderCorrectionMessage(t)) return null;

  const phoneMatch = t.match(/(?:\+?254|0)\d[\d\s-]{7,12}\d/);
  if (!phoneMatch) return null;

  const phone = normalizeKenyanPhone(phoneMatch[0]);
  if (!phone) return null;

  const withoutPhone = t
    .replace(phoneMatch[0], "")
    .replace(/[,;]\s*$/, "")
    .trim();

  const parts = withoutPhone
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const name = parts[0];
  const location = parts.slice(1).join(", ");

  if (name.length < 3 || name.split(/\s+/).length < 2) return null;
  if (location.length < 8) return null;
  if (/^(i want|i choose|looking for|send|show|hisense|redmi|samsung|infinix|smart tv|phone)/i.test(name)) {
    return null;
  }
  if (!/[a-z]/i.test(location)) return null;

  return { name, location, phone, raw: t };
}

function deliveryDetailsHint(_parsedAttempt, text) {
  const t = text.trim();
  const hasPhone = /(?:\+?254|0)\d[\d\s-]{7,12}\d/.test(t);
  const parts = t
    .replace(/(?:\+?254|0)\d[\d\s-]{7,12}\d/g, "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!hasPhone) {
    return "Please include your *phone number* for the rider (e.g. 0712345678).";
  }
  if (parts.length < 2) {
    return "Please send *name and location* separated by a comma.";
  }
  if (parts[0].split(/\s+/).length < 2) {
    return "Please include your *full name* (first and last name).";
  }
  if (parts.slice(1).join(", ").length < 8) {
    return "Please include a clearer *delivery location* (estate/town + landmark).";
  }
  return "Please send all three in one message: *full name, location, phone*.";
}

/** Handle messages while customer is mid-order (before confirm). */
export async function tryHandlePendingOrder(to, text) {
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
    if (alt) return startCodOrder(to, alt.id);
    clearPendingOrder(to);
    await sendText(
      to,
      "Order cancelled. Type *menu* → browse categories, pick a number, then reply *1* to order."
    );
    return true;
  }

  const parsed = parseDeliveryDetails(text);
  if (!parsed) {
    const alt = await findProductFromMessage(text);
    if (alt && alt.id !== pending.productId) return startCodOrder(to, alt.id);
    await sendText(
      to,
      `Still ordering *${pending.name}*.\n\n` +
        `${deliveryDetailsHint(null, text)}\n\n` +
        `_Example: Jane Wanjiru, Umoja 1 near the market, 0712345678_\n\n` +
        `Wrong item? Type *cancel* or say e.g. "I want Hisense TV instead".`
    );
    return true;
  }

  return confirmCodOrder(to, parsed);
}

export async function cancelOrder(to) {
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
  const pending = getPendingOrder(to);
  if (pending) {
    return sendText(
      to,
      `🛒 *Your current order:*\n*${pending.name}* — KES ${pending.priceKes.toLocaleString()} (pay on delivery)\n\n` +
        `Send delivery details to complete, or type *cancel* / *change order*.`
    );
  }
  return sendText(
    to,
    "Sokoni orders one item at a time (pay on delivery — no cart).\n\nType *menu* → browse → reply with an item number → *1* to order."
  );
}

export async function confirmCodOrder(to, parsed) {
  const pending = getPendingOrder(to);
  if (!pending) return false;

  const details =
    typeof parsed === "string" ? parseDeliveryDetails(parsed) : parsed;
  if (!details) {
    await sendText(
      to,
      `I can't place the order yet — I still need your delivery details.\n\n` +
        `${deliveryDetailsHint(null, typeof parsed === "string" ? parsed : "")}\n\n` +
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
    order = createOrder({
      customerKey: to,
      chatId: meta.chatId || to,
      product: productForOrder,
      details,
    });
  } catch (err) {
    console.error("[order] createOrder failed (continuing):", err.message);
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
        body: JSON.stringify({ type: "cod_order", from: to, order, details }),
      });
    } catch (err) {
      console.error("Failed to notify admin of order:", err.message);
    }
  }

  const orderRef = order?.id;
  await sendText(
    to,
    `✅ *Order received!*${orderRef ? `  ·  *${orderRef}*` : ""}\n\n` +
      `🧾 *Order summary*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🛍️ ${pending.name}\n` +
      `💰 KES ${formatOrderKes(pending.priceKes)} — *pay on delivery*\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📍 ${details.name} — ${details.location}\n` +
      `📞 ${details.phone}\n\n` +
      `${order ? `Status: ${statusLabel(order.status)}\n` : ""}` +
      `Our team will confirm shortly. ${config.store.deliveryNote}\n\n` +
      `${orderRef ? `_Track anytime: type *track* or *${orderRef}*._\n` : ""}` +
      `${siteUrlLine()}\n\n` +
      `Asante for shopping with Sokoni! 🙏`
  );

  await sendTillIntroSafe(to, pending.priceKes);
  await sendUpsell(to, pending);
  return true;
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
        `KES ${suggestion.priceKes.toLocaleString()} · ⭐ ${suggestion.rating} · pay on delivery\n\n` +
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
  if (isCategoryMenuId(id)) return sendCategorySubmenu(from, id);
  if (isSubcategoryRowId(id)) return sendProductsForSubcategory(from, id);
  if (id.startsWith("order_")) return startCodOrder(from, id.replace("order_", ""));
  if (id.startsWith("pick_")) return showProductActions(from, id.replace("pick_", ""));
  if (id === "deals_today") return sendDealsOfTheDay(from);
  if (id === "intl_shop") return sendInternationalMenu(from);
  if (id === "intl_trending") return sendInternationalTrending(from);
  if (id === "intl_custom") {
    return sendText(from, "Tell me what you're looking for and I'll search AliExpress, Temu and Amazon for you! 🌍");
  }
  if (id === "track_order") return sendTrackOrderMenu(from, getCustomerMeta(from)?.phone || "");
  if (id === "visit_site") return sendWebsiteLink(from);
  if (id === "human_handoff") {
    const meta = getCustomerMeta(from) || {};
    return sendHumanHandoff(from, { ...meta, lastMessage: "Menu → Talk to a Human" });
  }
  if (id === "how_it_works") return sendHowItWorks(from);
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
