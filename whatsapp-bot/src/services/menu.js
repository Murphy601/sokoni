import { config } from "../config.js";
import { sendList, sendText, sendButtons, sendProductCard } from "./whatsapp.js";
import { searchProducts, getDealOfTheDay, getProductById } from "./catalog.js";
import { buildAffiliateLink, SOURCE_LABELS } from "./affiliate.js";

export async function sendWelcome(to) {
  await sendText(
    to,
    `👋 Karibu! I'm *${config.brand.name} AI* — your shopping buddy on WhatsApp.\n` +
      `Tell me what you're looking for, or pick an option below 👇`
  );
  return sendMainMenu(to);
}

export function sendMainMenu(to) {
  return sendList(to, {
    body: "What are you shopping for today?",
    buttonText: "View Menu",
    sections: [
      {
        title: "Shop by Category",
        rows: [
          { id: "cat_electronics", title: "📱 Electronics & Phones", description: "Phones, audio, gadgets" },
          { id: "cat_fashion", title: "👗 Fashion & Beauty", description: "Clothing, shoes, accessories" },
          { id: "cat_home", title: "🏠 Home & Living", description: "Kitchen, essentials, appliances" },
        ],
      },
      {
        title: "More",
        rows: [
          { id: "deals_today", title: "🔥 Today's Hot Deals", description: "Best discounts right now" },
          { id: "intl_shop", title: "🌍 Shop International", description: "AliExpress, Temu, Amazon" },
          { id: "track_order", title: "🧾 Track My Order", description: "Find your order status" },
          { id: "human_handoff", title: "🙋 Talk to a Human", description: "Chat with our team" },
          { id: "how_it_works", title: "❓ How Sokoni Works", description: "About us & affiliate links" },
        ],
      },
    ],
  });
}

const CATEGORY_SUBMENUS = {
  cat_electronics: {
    category: "electronics",
    label: "Electronics & Phones",
    rows: [
      { id: "sub_electronics_smartphones", title: "Smartphones", subcategory: "smartphones" },
      { id: "sub_electronics_audio", title: "Audio (earbuds/speakers)", subcategory: "audio" },
      { id: "sub_electronics_wearables", title: "Wearables", subcategory: "wearables" },
    ],
  },
  cat_fashion: {
    category: "fashion",
    label: "Fashion & Beauty",
    rows: [
      { id: "sub_fashion_menswear", title: "Menswear", subcategory: "menswear" },
      { id: "sub_fashion_womenswear", title: "Womenswear", subcategory: "womenswear" },
    ],
  },
  cat_home: {
    category: "home",
    label: "Home & Living",
    rows: [
      { id: "sub_home_kitchen", title: "Kitchen", subcategory: "kitchen" },
      { id: "sub_home_essentials", title: "Home Essentials", subcategory: "essentials" },
    ],
  },
};

export function isCategoryMenuId(id) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_SUBMENUS, id);
}

export function sendCategorySubmenu(to, categoryMenuId) {
  const menu = CATEGORY_SUBMENUS[categoryMenuId];
  return sendList(to, {
    body: `${menu.label} — pick a sub-category:`,
    buttonText: "View Options",
    sections: [
      {
        title: menu.label,
        rows: [
          ...menu.rows.map((row) => ({ id: row.id, title: row.title })),
          { id: "menu_main", title: "⬅ Back to Main Menu" },
        ],
      },
    ],
  });
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

export async function sendProductsForSubcategory(to, rowId) {
  const target = findSubcategoryRow(rowId);
  if (!target) return sendMainMenu(to);
  const products = await searchProducts({
    category: target.category,
    subcategory: target.subcategory,
    scope: "local",
    limit: 3,
  });
  if (products.length === 0) {
    await sendText(to, "I don't have picks here yet, but I can search internationally too!");
    return sendMainMenu(to);
  }
  await sendText(to, `Here are my top picks 👇`);
  for (const product of products) {
    const affiliateUrl = buildAffiliateLink(product, to);
    await sendProductCard(to, product, affiliateUrl, SOURCE_LABELS[product.source]);
  }
}

export async function sendDealsOfTheDay(to, scope = "all") {
  const deals = await getDealOfTheDay({ scope, limit: 3 });
  await sendText(to, "🔥 *Today's Hot Deals* — grab these before they're gone:");
  for (const deal of deals) {
    const affiliateUrl = buildAffiliateLink(deal, to);
    await sendProductCard(to, deal, affiliateUrl, SOURCE_LABELS[deal.source]);
  }
}

export async function sendInternationalMenu(to) {
  await sendText(
    to,
    "🌍 *Before we go international* — a quick heads-up:\n" +
      "• AliExpress/Temu/Amazon ship *from overseas* (not Kenya), typically 1-4 weeks depending on the item.\n" +
      "• Kenya charges import duty + VAT + other fees on arrival, paid by *you*, on top of the item price — this is standard for any international order, not a Sokoni charge.\n" +
      "• Not every item ships to Kenya — I'll always double-check before sending you a link.\n\n" +
      "Still keen? 👇"
  );
  return sendButtons(to, {
    body: "Want trending picks, or do you know exactly what you want?",
    buttons: [
      { id: "intl_trending", title: "🔥 Trending Picks" },
      { id: "intl_custom", title: "🔍 I know what I want" },
    ],
  });
}

export async function sendInternationalTrending(to) {
  const products = await searchProducts({ scope: "international", limit: 3 });
  await sendText(to, "Here's what's trending internationally right now 👇");
  for (const product of products) {
    const affiliateUrl = buildAffiliateLink(product, to);
    await sendProductCard(to, product, affiliateUrl, SOURCE_LABELS[product.source]);
  }
}

export function sendTrackOrderMenu(to) {
  return sendButtons(to, {
    body: "Which store did you order from?",
    buttons: [
      { id: "track_kilimall", title: "Kilimall" },
      { id: "track_jumia", title: "Jumia" },
      { id: "track_other", title: "Somewhere else" },
    ],
  });
}

const TRACKING_INFO = {
  track_kilimall: "You can track your Kilimall order at https://www.kilimall.co.ke/my-orders (login required).",
  track_jumia: "You can track your Jumia order at https://www.jumia.co.ke/customer/order/ (login required).",
  track_other:
    "Let me know the store name and I'll point you to the right tracking page, or tap 'Talk to a Human' for help.",
};

export function sendTrackingInfo(to, id) {
  return sendText(to, TRACKING_INFO[id] || TRACKING_INFO.track_other);
}

export async function sendHumanHandoff(to) {
  await sendText(to, "Got it — connecting you with our team. Someone will reply here shortly. 🙏");
  if (config.adminNotifyUrl) {
    try {
      await fetch(config.adminNotifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: to, message: "Customer requested a human agent." }),
      });
    } catch (err) {
      console.error("Failed to notify admin:", err.message);
    }
  }
}

export function sendHowItWorks(to) {
  return sendText(
    to,
    `*How ${config.brand.name} works* 🛍️\n\n` +
      `I'm an AI shopping concierge — I help you find great products from trusted partner ` +
      `stores (Kilimall, Jumia, AliExpress, Temu, Amazon) and send you straight to their ` +
      `checkout to buy. I don't hold stock or take your payment myself.\n\n` +
      `I may earn a small commission when you buy through my links — it never costs you extra. ` +
      `That's how I can help you shop for free! 🙏\n\n` +
      `Type "menu" anytime to see the categories again.`
  );
}

export async function sendProductFollowUpContext(id) {
  const productId = id.replace("ask_ai_", "");
  return getProductById(productId);
}
