/**
 * Phase 7 — Shared AI tools (catalog, browse taxonomy, orders, site info).
 * Used by WhatsApp Sokoni Plug and website Ask (POST /api/agent/chat).
 */
import { searchProducts, getProductById, listBrowseProducts } from "./catalog.js";
import { getOrder, getOrdersForCustomer, extractOrderIdFromText, isSokoniOrderId } from "./orders.js";
import { buildPublicTrackingPayload } from "./shipments.js";
import { checkoutMeta } from "./prepaid-checkout.js";
import { normalizeShopperQuery, isShopperFillerOnly } from "./shopper-language.js";
import { browseTaxonomyForAi, matchBrowseFromText, priceTierMaxKes } from "./browse-menu.js";
import { isProductAvailable } from "./product-availability.js";
import { config } from "../config.js";
import {
  howItWorksMessage,
  paymentTrustDisclosure,
  tillExplainLine,
  formatPhoneDisplay,
  formatWhatsAppLink,
  offerLine,
  PROMO_CODE,
  OFFER_PERCENT,
} from "./trust-copy.js";

export const TOOL_NAMES = [
  "search_products",
  "browse_products",
  "browse_taxonomy",
  "get_product",
  "track_order",
  "list_orders",
  "store_info",
];

function extractOrderId(text) {
  return extractOrderIdFromText(text);
}

function extractBudget(text) {
  const under = String(text || "").match(/(?:under|chini ya|below|less than)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (under) return Number(under[1].replace(/,/g, ""));
  return null;
}

function wantsSecondhand(text) {
  return /\b(thrift|pre[- ]?loved|second[- ]?hand|vintage|used|mtumba)\b/i.test(String(text || ""));
}

function wantsNew(text) {
  return /\b(brand new|new with tags|bnwt|new)\b/i.test(String(text || ""));
}

function isTrackOnlyQuery(text, lower) {
  if (isSokoniOrderId(text)) return true;
  return (
    /\b(track|tracking|status|wapi order|order yangu)\b/i.test(lower) &&
    !/\b(buy|want|need|find|search|show|looking|nataka)\b/i.test(lower)
  );
}

function isPaymentOrSiteInfoQuery(lower) {
  return (
    /\b(prepaid|escrow|mpesa|pay|payment|stk|till|how (?:it|sokoni) works|how does|delivery|shipping|dispatch|courier|pickup|return|refund|scam|safe|trust|about sokoni|what is sokoni)\b/i.test(
      lower
    ) &&
    !/\b(buy|want|need|find|search|show|looking|nataka|yoghurt|yogurt|dress|shoes|phone|simu)\b/i.test(
      lower
    )
  );
}

function isTaxonomyQuery(lower) {
  return /\b(categor(y|ies)|subcategor(y|ies)|departments?|sections?|browse menu|what do you (sell|have)|what('s| is) (on |in )?sokoni|aesthetics?|vibes?|price tiers?|shop by|restaurant menu|kenya (food|meals|dishes)|wines?|spirits?|liquor|alcohol|beer aisle)\b/i.test(
    lower
  );
}

/** Human support / agent handoff. */
export function isSupportIntent(text) {
  const lower = String(text || "").toLowerCase();
  return /\b(support|customer\s*care|help\s*desk|human|agent|speak to|talk to|connect me|representative|complaint|escalate)\b/i.test(
    lower
  );
}

/** How to buy / how can you help / guide me. */
export function isGuideIntent(text) {
  const lower = String(text || "").toLowerCase();
  // "how are you" is small talk, not a buy guide
  if (isGreetingIntent(lower, { allowGuideOverlap: true })) return false;
  return /\b(how (can|do) (you|i)|help me|guide me|make a purchase|how to (buy|order|shop|pay|sell|list)|what can you (do|help)|assist me|what do you (sell|have|offer)|how does (sokoni|this|it) work)\b/i.test(
    lower
  );
}

/** Seller-side marketplace topics (listing, payouts, hubs). */
export function isSellerTopic(text) {
  const lower = String(text || "").toLowerCase();
  return /\b(sell(?:er|ing)?|list(?:ing|ings)?|payout|withdraw(?:al)?|b2c|drop-?offs?|mashinani|inventory|stock units?|m-?pesa ledger|seller hub|onboard(?:ing)?|commission|platform fee|hub drop)\b/i.test(
    lower
  );
}

/**
 * Clearly off Sokoni (general world chat). Keep narrow so Kenya/commerce questions still pass.
 * Greetings / "how are you" are NOT off-topic — they are normal shop-assistant chat.
 */
export function isOffTopicIntent(text) {
  const lower = String(text || "").toLowerCase();
  if (isGreetingIntent(lower, { allowGuideOverlap: true })) return false;
  if (
    /\b(sokoni|marketplace|order|escrow|mpesa|m-pesa|whatsapp|track|delivery|seller|buyer|listing|kes|thrift|catalog)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  return /\b(weather|forecast|temperature|premier league|champions league|bitcoin|crypto|stock market|write (me )?(a )?code|homework|essay|politics|election|trump|biden|tell me a joke|who won the|chatgpt|girlfriend|boyfriend|horoscope)\b/i.test(
    lower
  );
}

/**
 * Greetings + light small talk with the shop assistant — never product search.
 * @param {{ allowGuideOverlap?: boolean }} opts — internal: skip guide/seller guards when nested
 */
export function isGreetingIntent(text, opts = {}) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t || t.length > 80) return false;
  if (!opts.allowGuideOverlap) {
    if (isSupportIntent(t) || isSellerTopic(t)) return false;
  }

  // Whole-message greetings (optional trailing punctuation only)
  if (
    /^(hi|hello|hey|yo|hola|habari|mambo|sasa|niaje|hujambo|howdy|sup|ola|hiya|helo|hallo)[!?.,]*$/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^(good\s*(morning|afternoon|evening)|morning|evening)[!?.,]*$/i.test(t)) {
    return true;
  }
  if (
    /^(hi|hello|hey|yo)[,!]?\s+(there|sokoni|plug)?[!?.,]*$/i.test(t)
  ) {
    return true;
  }
  // Small talk / check-ins — must be the whole message (not "thanks for the denim…")
  if (
    /^(how are you( doing)?( today)?|how're you( doing)?|how r you|how are u|how r u|how have you been|how's it going|how is it going|how you doing|how's everything|what's up|whats up|wassup|you good|you okay|uko aje|habari yako|habari yenu|mzuri|poa sana|i'm (fine|good|great|okay|ok|poa|well)|im (fine|good|great|okay|ok|poa|well)|doing (fine|good|great|well)|thanks|thank you|thanks you|asante|asante sana|cool|nice|great|awesome|sawa|okay|ok|yeah|yep|nah|no worries|just checking)[!?.,]*$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Social / filler words — short phrases made only of these are not product hunts. */
const SHOP_STOPWORDS = new Set(
  [
    "how",
    "are",
    "you",
    "u",
    "i",
    "am",
    "im",
    "i'm",
    "what",
    "whats",
    "what's",
    "up",
    "is",
    "it",
    "the",
    "a",
    "an",
    "to",
    "for",
    "me",
    "my",
    "your",
    "please",
    "thanks",
    "thank",
    "ok",
    "okay",
    "sawa",
    "yes",
    "no",
    "yeah",
    "yep",
    "nah",
    "fine",
    "good",
    "great",
    "cool",
    "nice",
    "poa",
    "sasa",
    "uko",
    "aje",
    "doing",
    "today",
    "bro",
    "sis",
    "mate",
    "there",
    "here",
    "just",
    "checking",
    "in",
    "about",
    "and",
    "or",
    "with",
    "from",
    "can",
    "could",
    "would",
    "will",
    "be",
    "been",
    "was",
    "were",
    "this",
    "that",
    "of",
    "on",
    "at",
    "if",
    "so",
    "very",
    "really",
    "well",
    "hey",
    "hi",
    "hello",
  ].map((w) => w.toLowerCase())
);

/**
 * True when the shopper is clearly looking for products / aisles / budgets.
 * Policy, how-to, seller, and general Sokoni questions must NOT trigger catalog search.
 */
export function isShoppingIntent(text, { browseMatch = null, budget = null } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isGreetingIntent(raw) || isSupportIntent(raw) || isOffTopicIntent(raw)) return false;
  if (isPaymentOrSiteInfoQuery(raw.toLowerCase()) && budget == null && !browseMatch) return false;
  // Guide / seller Q without a product keyword is conversational, not a SKU hunt
  if ((isGuideIntent(raw) || isSellerTopic(raw)) && !browseMatch && budget == null) {
    if (!/\b(dress|sneaker|phone|laptop|shoes?|jeans|hoodie|electronics|fashion|thrift|denim|kiondo)\b/i.test(raw)) {
      return false;
    }
  }
  if (budget != null) return true;
  if (browseMatch) return true;
  if (isSokoniOrderId(raw) || extractOrderIdFromText(raw)) return false;

  // Explicit hunt verbs (avoid bare "need" / "any" / "list" — those match escrow help too)
  if (
    /\b(show me|find( me)?|looking for|search( for)?|nataka|nipee|shop for|browse for)\b/i.test(raw)
  ) {
    return true;
  }
  if (
    /\b(buy|want|order)\b/i.test(raw) &&
    /\b(dress|sneaker|phone|laptop|shoes?|jeans|hoodie|electronics|fashion|thrift|denim|kiondo|bag|shirt|under|chini|kes)\b/i.test(
      raw
    )
  ) {
    return true;
  }
  if (
    /\b(sneakers?|dresses?|phones?|laptops?|shoes?|jeans|hoodie|electronics|fashion|thrift|kicks|denim|kiondo)\b/i.test(
      raw
    ) &&
    !/\b(how (does|do|to|can)|what is|explain|policy|escrow|fee|commission|refund|dispute|account|login)\b/i.test(
      raw
    )
  ) {
    return true;
  }

  // 1–2 token merchandise keywords only (e.g. "denim", "kiondo") — not full questions
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length <= 2 && !isGuideIntent(raw) && !isSellerTopic(raw)) {
    const content = tokens.filter((tok) => !SHOP_STOPWORDS.has(tok.replace(/'/g, "")));
    if (!content.length) return false;
    return content.every((tok) => /^[a-z][a-z0-9-]{2,}$/i.test(tok));
  }
  return false;
}

/**
 * Marketplace conversation that may use the LLM (buyer or seller), still Sokoni-only.
 */
export function isSokoniConversation(text, { browseMatch = null, budget = null } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isOffTopicIntent(raw)) return false;
  if (isGreetingIntent(raw)) return true;
  if (isShoppingIntent(raw, { browseMatch, budget })) return true;
  if (
    isSupportIntent(raw) ||
    isGuideIntent(raw) ||
    isSellerTopic(raw) ||
    isPaymentOrSiteInfoQuery(raw.toLowerCase()) ||
    isTaxonomyQuery(raw.toLowerCase())
  ) {
    return true;
  }
  return /\b(sokoni|marketplace|order|escrow|mpesa|m-pesa|whatsapp|track|delivery|pickup|buyer|seller|account|login|log ?in|signup|sign ?up|sign ?in|password|thrift|catalog|listing|kes|shop|bag|checkout|dispute|refund|hub|mashinani|visa|card|fee|commission|withdraw|payout|ship(?:ping|ment)?|boda|courier)\b/i.test(
    raw
  );
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer aisle listing only when the shopper is asking for a category/sub,
 * not a branded/specific item query (those stay on keyword search + browse filter).
 */
function shouldBrowseList(text, lower, browseMatch) {
  if (!browseMatch) return false;
  if (browseMatch.source === "aesthetic") return false;
  if (/\b(under|chini|below|less than)\b/i.test(lower)) return false;

  if (/\b(show|browse|list|see|shop|any|ona)\b/i.test(lower) && !/\b(nike|adidas|samsung|iphone|delmonte)\b/i.test(lower)) {
    return true;
  }

  const normalized = normalizeLoose(text);
  const labelTail = normalizeLoose(String(browseMatch.label || "").split("→").pop());
  const cat = normalizeLoose(browseMatch.browseCategory);
  const sub = normalizeLoose(browseMatch.browseSubCategory);
  if (normalized === labelTail || normalized === cat || (sub && normalized === sub)) return true;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length <= 2 && (browseMatch.source === "category" || browseMatch.source === "subcategory")) {
    // "mens sneakers" / "health beauty" aisle — not "nike sneakers red"
    return true;
  }
  return false;
}

/** Intent router — runs tools before LLM (works on free models without function-calling). */
export async function runToolRouter(userMessage, { phone = "", customerKey = "" } = {}) {
  const text = String(userMessage || "").trim();
  const lower = text.toLowerCase();
  const results = [];

  const orderId = extractOrderId(text);
  if (orderId || /\b(track|tracking|status|wapi order|order yangu)\b/i.test(lower)) {
    if (orderId) {
      results.push(await executeTool("track_order", { orderId }, { phone }));
    } else if (phone || customerKey) {
      results.push(await executeTool("list_orders", {}, { phone, customerKey }));
    }
  }

  if (
    /\b(prepaid|escrow|mpesa|pay|payment|stk|till|how (?:it|sokoni) works|delivery|shipping|dispatch|return|refund|about sokoni|what is sokoni|safe|trust)\b/i.test(
      lower
    )
  ) {
    results.push(await executeTool("store_info", {}, { phone }));
  }

  if (isTaxonomyQuery(lower)) {
    results.push(await executeTool("browse_taxonomy", {}, { phone }));
  }

  const productIdMatch = text.match(/\b(prod_[a-z0-9_-]+|[a-z]{2}-[a-z0-9]+-\d+)\b/i);
  if (productIdMatch) {
    results.push(await executeTool("get_product", { productId: productIdMatch[1] }, { phone }));
  }

  const browseMatch = await matchBrowseFromText(text);
  const budget = extractBudget(text);
  const secondhandOnly = wantsSecondhand(text) && !wantsNew(text);
  const shopping = isShoppingIntent(text, { browseMatch, budget });

  // Every Sokoni turn gets live site facts so the LLM can answer any marketplace question.
  if (!isOffTopicIntent(text) && !results.some((r) => r.tool === "store_info")) {
    results.push(await executeTool("store_info", {}, { phone }));
  }
  if (
    (isGuideIntent(text) ||
      isSellerTopic(text) ||
      isTaxonomyQuery(lower) ||
      (shopping && browseMatch) ||
      /\b(categor|aisle|department|what (can|do) (i|you) (buy|sell|find))\b/i.test(lower)) &&
    !results.some((r) => r.tool === "browse_taxonomy")
  ) {
    results.push(await executeTool("browse_taxonomy", {}, { phone }));
  }

  const alreadyCatalogued = results.some(
    (r) => r.tool === "search_products" || r.tool === "browse_products"
  );
  const skipSearch =
    alreadyCatalogued ||
    !shopping ||
    isTrackOnlyQuery(text, lower) ||
    isPaymentOrSiteInfoQuery(lower) ||
    isTaxonomyQuery(lower) ||
    isShopperFillerOnly(text) ||
    isGreetingIntent(text) ||
    isSupportIntent(text) ||
    isSellerTopic(text) ||
    isOffTopicIntent(text) ||
    text.length < 2;

  if (!skipSearch) {
    if (browseMatch && shouldBrowseList(text, lower, browseMatch)) {
      results.push(
        await executeTool(
          "browse_products",
          {
            browseCategory: browseMatch.browseCategory,
            browseSubCategory: browseMatch.browseSubCategory,
            aesthetic: browseMatch.aesthetic || null,
            maxPriceKes: budget,
            secondhandOnly,
            label: browseMatch.label,
          },
          { phone }
        )
      );
      if (!results.some((r) => r.tool === "browse_taxonomy")) {
        results.push(
          await executeTool(
            "browse_taxonomy",
            { focusCategory: browseMatch.browseCategory },
            { phone }
          )
        );
      }
    } else {
      let browseCategory = browseMatch?.browseCategory || null;
      let browseSubCategory = browseMatch?.browseSubCategory || null;
      let browseLabel = browseMatch?.label || null;
      // Budget-only / price-tier hits: search the whole live catalog under maxPriceKes
      if (
        budget &&
        browseCategory === "sale" &&
        /^under[- ]?\d+/i.test(String(browseSubCategory || ""))
      ) {
        browseCategory = null;
        browseSubCategory = null;
        browseLabel = null;
      }
      results.push(
        await executeTool(
          "search_products",
          {
            query: text,
            maxPriceKes: budget,
            secondhandOnly,
            browseCategory,
            browseSubCategory,
            aesthetic: browseMatch?.aesthetic || null,
            browseLabel,
          },
          { phone }
        )
      );
    }
  }

  return results.filter(Boolean);
}

export async function executeTool(name, args = {}, context = {}) {
  try {
    switch (name) {
      case "search_products":
        return await toolSearchProducts(args);
      case "browse_products":
        return await toolBrowseProducts(args);
      case "browse_taxonomy":
        return await toolBrowseTaxonomy(args);
      case "get_product":
        return await toolGetProduct(args);
      case "track_order":
        return toolTrackOrder(args, context);
      case "list_orders":
        return toolListOrders(context);
      case "store_info":
        return toolStoreInfo();
      default:
        return { tool: name, ok: false, error: "unknown_tool" };
    }
  } catch (err) {
    return { tool: name, ok: false, error: err.message };
  }
}

async function toolSearchProducts({
  query = "",
  maxPriceKes = null,
  secondhandOnly = false,
  limit = 5,
  browseCategory = null,
  browseSubCategory = null,
  aesthetic = null,
  browseLabel = null,
}) {
  const keywords = normalizeShopperQuery(query);
  let products = [];
  let suggestions = [];
  try {
    const { smartSearch } = await import("./smart-search.js");
    const smart = await smartSearch({
      q: keywords,
      browseCategory: browseCategory || undefined,
      browseSubCategory: browseSubCategory || undefined,
      maxPriceKes: maxPriceKes && Number.isFinite(Number(maxPriceKes)) ? Number(maxPriceKes) : undefined,
      limit: Math.min(Number(limit) || 5, 8),
    });
    products = smart.products || [];
    suggestions = smart.suggestions || [];
  } catch {
    products = await searchProducts({
      keywords,
      browseCategory: browseCategory || undefined,
      browseSubCategory: browseSubCategory || undefined,
      fulfillment: "store",
      scope: "local",
      maxPriceKes: maxPriceKes && Number.isFinite(Number(maxPriceKes)) ? Number(maxPriceKes) : undefined,
      limit: Math.min(Number(limit) || 5, 8),
    });
  }

  if (secondhandOnly) {
    products = products.filter((p) => p.isSecondhand || p.condition !== "brand_new_with_tags");
  }

  // Aesthetic vibe: soft re-rank / filter by tag overlap when provided
  if (aesthetic) {
    const vibe = String(aesthetic).toLowerCase();
    const scored = products.map((p) => {
      const blob = `${p.name} ${(p.tags || []).join(" ")}`.toLowerCase();
      return { p, hit: blob.includes(vibe) };
    });
    if (scored.some((s) => s.hit)) {
      products = scored.sort((a, b) => Number(b.hit) - Number(a.hit)).map((s) => s.p);
    }
  }

  products = products.filter((p) => isProductAvailable(p));

  return {
    tool: "search_products",
    ok: true,
    query: keywords,
    suggestions,
    browseCategory: browseCategory || null,
    browseSubCategory: browseSubCategory || null,
    browseLabel: browseLabel || null,
    count: products.length,
    products: products.slice(0, 5).map(publicProductSummary),
  };
}

async function toolBrowseProducts({
  browseCategory,
  browseSubCategory = null,
  maxPriceKes = null,
  secondhandOnly = false,
  aesthetic = null,
  label = null,
  limit = 5,
}) {
  if (!browseCategory) {
    return { tool: "browse_products", ok: false, error: "missing_browse_category" };
  }

  let products = await listBrowseProducts({
    browseCategory,
    browseSubCategory: browseSubCategory || undefined,
    maxPriceKes: maxPriceKes && Number.isFinite(Number(maxPriceKes)) ? Number(maxPriceKes) : undefined,
  });

  if (secondhandOnly) {
    products = products.filter((p) => p.isSecondhand || p.condition !== "brand_new_with_tags");
  }
  if (aesthetic) {
    const vibe = String(aesthetic).toLowerCase();
    products = products.filter((p) => {
      const blob = `${p.name} ${(p.tags || []).join(" ")}`.toLowerCase();
      return blob.includes(vibe);
    });
  }

  // Prefer rated items when browsing a whole aisle
  products = [...products]
    .filter((p) => isProductAvailable(p))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return {
    tool: "browse_products",
    ok: true,
    browseCategory,
    browseSubCategory: browseSubCategory || null,
    label: label || `${browseCategory}${browseSubCategory ? ` → ${browseSubCategory}` : ""}`,
    count: products.length,
    products: products.slice(0, Math.min(Number(limit) || 5, 8)).map(publicProductSummary),
  };
}

async function toolBrowseTaxonomy({ focusCategory = null } = {}) {
  const tax = await browseTaxonomyForAi();
  let categories = tax.categories || [];
  if (focusCategory) {
    const focused = categories.filter(
      (c) => c.id === focusCategory || c.resolvesTo?.browse === focusCategory
    );
    if (focused.length) categories = focused;
  }

  return {
    tool: "browse_taxonomy",
    ok: true,
    version: tax.version,
    focusCategory: focusCategory || null,
    categories: categories.map((c) => ({
      id: c.id,
      label: c.label,
      emoji: c.emoji,
      navOnly: c.navOnly,
      resolvesTo: c.resolvesTo,
      subcategories: (c.subcategories || []).map((s) => ({
        id: s.id,
        label: s.label,
        resolvesTo: s.resolvesTo || null,
      })),
    })),
    itemTypes: tax.itemTypes || [],
    priceTiers: tax.priceTiers || [],
    aesthetics: tax.aesthetics || [],
    decades: tax.decades || [],
    sitePaths: {
      home: "/",
      browse: "/#browse",
      ask: "/ask.html",
      track: "/track.html",
      sell: "/sell.html",
    },
  };
}

async function toolGetProduct({ productId }) {
  const p = await getProductById(productId);
  if (!p || !isProductAvailable(p)) {
    return { tool: "get_product", ok: false, error: "not_found" };
  }
  return { tool: "get_product", ok: true, product: publicProductSummary(p) };
}

function toolTrackOrder({ orderId }, { phone = "" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { tool: "track_order", ok: false, error: "not_found", orderId };

  if (phone) {
    const digits = String(phone).replace(/\D/g, "");
    const orderPhone = String(order.phone || "").replace(/\D/g, "");
    const match =
      orderPhone.endsWith(digits.slice(-9)) ||
      digits.endsWith(orderPhone.slice(-9)) ||
      !digits;
    if (!match && digits.length >= 9) {
      return { tool: "track_order", ok: false, error: "phone_mismatch", orderId };
    }
  }

  return {
    tool: "track_order",
    ok: true,
    tracking: buildPublicTrackingPayload(order),
  };
}

function toolListOrders({ phone = "", customerKey = "" } = {}) {
  if (!phone && !customerKey) return { tool: "list_orders", ok: false, error: "missing_phone" };
  const orders = getOrdersForCustomer(customerKey, phone).slice(0, 5);
  return {
    tool: "list_orders",
    ok: true,
    count: orders.length,
    orders: orders.map((o) => ({
      id: o.id,
      productName: o.productName,
      status: o.status,
      shipmentStatus: o.shipmentStatus,
      paid: o.customerPaymentStatus === "confirmed",
      priceKes: o.priceKes,
    })),
  };
}

function toolStoreInfo() {
  const meta = checkoutMeta();
  const site = (config.publicSiteUrl || "https://sokonimall.com").replace(/\/$/, "");
  // Prefer production site URL for buyer-facing answers when running on localhost
  const publicSite =
    /localhost|127\.0\.0\.1/i.test(site) ? "https://sokonimall.com" : site;

  return {
    tool: "store_info",
    ok: true,
    brand: config.brand?.name || "Sokoni Mall",
    prepaidOnly: meta.prepaidOnly,
    paymentMethods: meta.paymentMethods,
    darajaConfigured: meta.darajaConfigured,
    autoConfirm: meta.autoConfirm,
    escrow: meta.escrow,
    phoneDisplay: formatPhoneDisplay(),
    whatsappLink: formatWhatsAppLink(),
    promoCode: PROMO_CODE,
    offerPercent: OFFER_PERCENT,
    offerLine: offerLine(),
    deliveryNote: config.store.deliveryNote,
    paymentLine: tillExplainLine().replace(/\*/g, ""),
    howItWorks: howItWorksMessage().replace(/\*/g, ""),
    paymentTrust: paymentTrustDisclosure().replace(/\*/g, ""),
    siteUrls: {
      home: publicSite,
      ask: `${publicSite}/ask.html`,
      track: `${publicSite}/track.html`,
      browse: `${publicSite}/`,
      sell: `${publicSite}/sell.html`,
      sellerHub: `${publicSite}/suppliers/list.html`,
    },
    sellerHub:
      "Seller Hub (sokonimall.com/suppliers/list.html): Hub Drop-Offs (countrywide + city hubs, rider pickup), Inventory alerts (set units — multi-stock stays on menu until 0), WhatsApp Promo (share sokonimall.com + @handle separately), Orders, Offers, Grow, M-Pesa Ledger.",
    stockNote:
      "Multi-unit listings decrement on each sale and stay visible until stock hits zero. Unique 1-of-1 thrift locks sold after purchase.",
    pickupRiderNote:
      "When a seller requests boda pickup, ask which order and the exact pickup location. Shop @handle is enough to identify them — do not list every pending order unless asked.",
    note:
      "100% prepaid upfront for local items. Funds held in escrow until delivery confirmed. Sellers dispatch via Sokoni Mashinani hubs (countrywide). Browse on sokonimall.com; checkout on WhatsApp.",
  };
}

function publicProductSummary(p) {
  return {
    id: p.id,
    name: p.name,
    priceKes: p.priceKes,
    rating: p.rating,
    inStock: p.inStock !== false,
    isSecondhand: Boolean(p.isSecondhand),
    condition: p.condition || null,
    category: p.category,
    browseCategory: p.browseCategory || null,
    browseSubCategory: p.browseSubCategory || null,
    tags: (p.tags || []).slice(0, 5),
  };
}

function formatTaxonomyBlock(r) {
  const cats = (r.categories || []).slice(0, 16);
  const lines = cats.map((c) => {
    const subs = (c.subcategories || [])
      .slice(0, 12)
      .map((s) => s.label)
      .join(", ");
    const alias = c.resolvesTo ? ` → ${c.resolvesTo.browse}/${c.resolvesTo.sub || ""}` : "";
    return `• ${c.emoji || ""} ${c.label} (${c.id}${alias})${subs ? `: ${subs}` : ""}`;
  });
  const vibes = (r.aesthetics || [])
    .slice(0, 10)
    .map((a) => a.label || a.id)
    .join(", ");
  const tiers = (r.priceTiers || [])
    .slice(0, 8)
    .map((t) => t.label || t.id)
    .join(", ");
  return (
    `TOOL browse_taxonomy${r.focusCategory ? ` (focus:${r.focusCategory})` : ""}:\n` +
    `${lines.join("\n")}\n` +
    (vibes ? `Aesthetics: ${vibes}\n` : "") +
    (tiers ? `Price tiers: ${tiers}\n` : "") +
    `Site paths: ask=${r.sitePaths?.ask || "/ask.html"}, track=${r.sitePaths?.track || "/track.html"}`
  );
}

function formatProductLines(products) {
  return products.map(
    (p, i) =>
      `${i + 1}. ${p.name} | KES ${Number(p.priceKes).toLocaleString()} | ${p.isSecondhand ? "pre-loved" : "new"} | id:${p.id} | stock:${p.inStock ? "yes" : "no"}${
        p.browseCategory ? ` | browse:${p.browseCategory}${p.browseSubCategory ? `/${p.browseSubCategory}` : ""}` : ""
      }`
  );
}

export function formatToolResultsForPrompt(toolResults) {
  if (!toolResults?.length) return null;
  const blocks = toolResults.map((r) => {
    if (r.tool === "search_products" && (r.products?.length || r.suggestions?.length)) {
      const path =
        r.browseLabel ||
        (r.browseCategory
          ? `${r.browseCategory}${r.browseSubCategory ? `/${r.browseSubCategory}` : ""}`
          : "");
      return (
        `TOOL search_products (${r.count || 0} hits for "${r.query}"${path ? `; aisle ${path}` : ""}):\n` +
        (r.suggestions?.length ? `Suggestions: ${r.suggestions.join(", ")}\n` : "") +
        (formatProductLines(r.products).join("\n") || "(no products)")
      );
    }
    if (r.tool === "browse_products" && r.products?.length) {
      return (
        `TOOL browse_products (${r.count} in ${r.label || r.browseCategory}):\n` +
        formatProductLines(r.products).join("\n")
      );
    }
    if (r.tool === "browse_products" && r.ok) {
      return `TOOL browse_products: 0 items in ${r.label || r.browseCategory}. Suggest another subcategory from browse_taxonomy or try different words.`;
    }
    if (r.tool === "browse_taxonomy" && r.ok) {
      return formatTaxonomyBlock(r);
    }
    if (r.tool === "get_product" && r.product) {
      const p = r.product;
      return `TOOL get_product:\n${p.name} | KES ${Number(p.priceKes).toLocaleString()} | id:${p.id}${
        p.browseCategory ? ` | browse:${p.browseCategory}/${p.browseSubCategory || ""}` : ""
      }`;
    }
    if (r.tool === "track_order" && r.tracking) {
      const t = r.tracking;
      const steps = (t.shipmentTimeline || [])
        .map((s) => `${s.done ? "done" : s.active ? "now" : "pending"}:${s.label}`)
        .join(" → ");
      return `TOOL track_order ${t.orderId}:\nProduct: ${t.productName}\nPayment: ${t.paymentLine}\nShipment: ${t.shipmentStatusLabel}\nTimeline: ${steps || t.orderStatusLabel}`;
    }
    if (r.tool === "list_orders" && r.orders) {
      const lines = r.orders.map(
        (o) => `${o.id} · ${o.productName} · ${o.shipmentStatus || o.status} · ${o.paid ? "paid" : "unpaid"}`
      );
      return `TOOL list_orders:\n${lines.join("\n") || "No orders found for this number."}`;
    }
    if (r.tool === "store_info") {
      return (
        `TOOL store_info:\n` +
        `Brand: ${r.brand}\n` +
        `Prepaid only: ${r.prepaidOnly}\n` +
        `Escrow: ${r.escrow}\n` +
        `Payment: ${(r.paymentMethods || []).join(", ") || "mpesa_stk"}\n` +
        `Pay how: ${r.paymentLine || "M-Pesa STK on WhatsApp / site"}\n` +
        `Phone: ${r.phoneDisplay}\n` +
        `WhatsApp: ${r.whatsappLink}\n` +
        `Promo: ${r.offerLine}\n` +
        `Delivery: ${r.deliveryNote}\n` +
        `Site: ${r.siteUrls?.home}\n` +
        `Ask: ${r.siteUrls?.ask}\n` +
        `Track: ${r.siteUrls?.track}\n` +
        `Seller Hub: ${r.siteUrls?.sellerHub || ""}\n` +
        `Seller Hub tip: ${r.sellerHub || ""}\n` +
        `Stock: ${r.stockNote || ""}\n` +
        `Pickup rider: ${r.pickupRiderNote || ""}\n` +
        `How it works:\n${r.howItWorks}\n` +
        `Trust:\n${r.paymentTrust}\n` +
        `${r.note}`
      );
    }
    if (!r.ok) return `TOOL ${r.tool}: ${r.error || "failed"}`;
    return `TOOL ${r.tool}: (no data)`;
  });
  return `TOOL RESULTS (authoritative — use only this data):\n${blocks.join("\n\n")}`;
}

/** Exported for tests */
export {
  priceTierMaxKes,
  isTaxonomyQuery,
  isPaymentOrSiteInfoQuery,
};
