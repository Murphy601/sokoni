/**
 * Phase 7 — Shared AI tools (catalog, browse taxonomy, orders, site info).
 * Used by WhatsApp Sokoni Plug and website Ask (POST /api/agent/chat).
 */
import { searchProducts, getProductById, listBrowseProducts } from "./catalog.js";
import { getOrder, getOrdersForCustomer, listAllOrders, extractOrderIdFromText, isSokoniOrderId } from "./orders.js";
import { normalizeOrderId } from "../lib/order-id.js";
import { findSupplierByPhone, getSupplier } from "./suppliers.js";
import { buildPublicTrackingPayload } from "./shipments.js";
import { checkoutMeta } from "./prepaid-checkout.js";
import { normalizeShopperQuery, isShopperFillerOnly } from "./shopper-language.js";
import { isFulfillmentComplaint } from "./dispute-protocol.js";
import { browseTaxonomyForAi, matchBrowseFromText, priceTierMaxKes } from "./browse-menu.js";
import { isProductAvailable } from "./product-availability.js";
import { config } from "../config.js";
import {
  howItWorksMessage,
  paymentTrustDisclosure,
  tillExplainLine,
  formatPhoneDisplay,
  formatWhatsAppLink,
  formatSupportEmail,
  offerLine,
  PROMO_CODE,
  OFFER_PERCENT,
} from "./trust-copy.js";
import { getSellerEscrowLedger } from "./seller-onboard.js";
import { getWithdrawableEntries } from "./seller-withdrawals.js";
import {
  getVendorShippingProfile,
  vendorKeyCandidatesFromSeller,
} from "./vendor-shipping.js";
import { evaluateGoodwillVoucher } from "./agent-specialists.js";

export const TOOL_NAMES = [
  "search_products",
  "browse_products",
  "browse_taxonomy",
  "get_product",
  "track_order",
  "list_orders",
  "list_seller_orders",
  "lookup_order_seller",
  "list_seller_listings",
  "store_info",
  "open_return_case",
  "get_seller_onboarding",
  "get_seller_payout",
  "get_shipping_rates",
  "propose_goodwill",
  "create_checkout_link",
  "update_inventory",
  "dispatch_with_rider",
  "verify_payment_code",
  "check_aup",
];

/** Keep only tools allowed for the active specialist. */
export function filterToolsForSpecialist(toolResults, allowedTools) {
  if (!allowedTools?.length) return toolResults || [];
  const allow = new Set(allowedTools);
  return (toolResults || []).filter((t) => allow.has(t.tool));
}

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

/** Seller asking about shop sales / orders placed through their store (not buyer tracking). */
export function isSellerShopOrdersIntent(text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  if (!lower) return false;
  // Asking who the seller IS on an order / dispute — NOT "my shop sales"
  if (isOrderSellerLookupIntent(raw)) return false;
  // Bare @handle after bot asked for handle — treat as shop-orders follow-up
  if (/^@[\w][\w\s'.-]{1,40}$/i.test(raw)) return true;
  if (
    /\b((my|our)\s+(shop|store)\s+(orders?|sales)|shop\s+orders?|my\s+sales|orders?\s+(from|in|through|for)\s+(my|our)\s+(shop|store)|(?:orders?|sales)\s+purchased\s+from\s+my|(?:show|list|see)\s+(me\s+)?(my\s+)?(shop\s+)?(orders?|sales)|what\s+(have\s+i|did\s+i)\s+sell)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  // "orders" + shop/sales — but NOT "seller" alone (that matches "who is the seller for those orders")
  if (/\borders?\b/i.test(lower) && /\b(shop|store|sold|sales)\b/i.test(lower)) {
    return true;
  }
  return false;
}

/** Boss/buyer: who sells this order / dispute seller metadata. */
export function isOrderSellerLookupIntent(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return false;
  if (
    /\b(who\s+(is|are|was|were)\s+(the\s+)?sellers?|which\s+sellers?|seller\s+(for|on|of)\s+(this|that|those|the|my)?\s*(order|dispute|skn)|sellers?\s+(name|handle|phone|contact|info|details)|who\s+sold|seller\s+on\s+the\s+dispute)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/\b(seller|vendors?)\b/i.test(lower) && /\b(order|dispute|skn-|those|these)\b/i.test(lower)) {
    return true;
  }
  return false;
}

/** Seller catalog: active listings / my products. */
export function isSellerListingsIntent(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return false;
  return /\b((active|live|my|current)\s+listings?|my\s+(products?|catalog|inventory|items)|show\s+(me\s+)?(my\s+)?(listings?|products?|catalog)|list\s+(my\s+)?(listings?|products?))\b/i.test(
    lower
  );
}

/** Extract all SKN/SK ids from free text (current message or history). */
export function extractAllOrderIdsFromText(text) {
  const re = /\b(SKN-\d+(?:-\d+)?|SK-\d+)\b/gi;
  const found = [];
  const seen = new Set();
  let m;
  const s = String(text || "");
  while ((m = re.exec(s)) !== null) {
    const id = normalizeOrderId(m[1]);
    if (id && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

function recentOrderIdsFromHistory(history = [], limit = 6) {
  const seen = new Set();
  const out = [];
  const rows = Array.isArray(history) ? [...history].reverse() : [];
  for (const row of rows) {
    const ids = extractAllOrderIdsFromText(row?.content || row?.text || "");
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function isPaymentOrSiteInfoQuery(lower) {
  return (
    /\b(prepaid|escrow|mpesa|pay|payment|stk|till|how (?:it|sokoni) works|how does|delivery|shipping|dispatch|courier|pickup|return|refund|scam|safe|trust|about sokoni|what is sokoni|support\s*email|customer\s*care|contact\s*(us|info|details)?|email\s*address)\b/i.test(
      lower
    ) &&
    !/\b(buy|want|need|find|search|show|looking|nataka|yoghurt|yogurt|dress|shoes|phone|simu)\b/i.test(
      lower
    )
  );
}

/**
 * Static contact facts (email / phone / customer care) — answer from config, not LLM guess.
 */
export function isContactInfoIntent(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return false;
  // Explicit contact / email / phone / customer care
  if (
    /\b(support\s*email|email\s*address|e-?mail|contact\s*(email|number|phone|details|info)|customer\s*care|call\s*centre|call\s*center|office\s*(number|phone|email)|how (do i|to) (reach|contact|email)|write\s*to\s*(you|sokoni)|barua\s*pepe|nambari\s*ya\s*(simu|support))\b/i.test(
      lower
    )
  ) {
    return true;
  }
  // "what is your email" / "sokoni email" / "support contact"
  if (/\b(email|e-?mail|whatsapp\s*number|phone\s*number|hotline)\b/i.test(lower) &&
      /\b(sokoni|support|you|your|official|team|care)\b/i.test(lower)) {
    return true;
  }
  return false;
}

function isTaxonomyQuery(lower) {
  return /\b(categor(y|ies)|subcategor(y|ies)|departments?|sections?|browse menu|what do you (sell|have)|what('s| is) (on |in )?sokoni|aesthetics?|vibes?|price tiers?|shop by|restaurant menu|kenya (food|meals|dishes)|wines?|spirits?|liquor|alcohol|beer aisle)\b/i.test(
    lower
  );
}

/** Human support / agent handoff. */
export function isSupportIntent(text) {
  const lower = String(text || "").toLowerCase();
  // Contact-info questions are handled by isContactInfoIntent (include email) — not HITL alone
  if (isContactInfoIntent(text)) return false;
  return /\b(support|customer\s*care|help\s*desk|human|agent|speak to|talk to|connect me|representative|complaint|escalate)\b/i.test(
    lower
  );
}

/**
 * "How does Sokoni / everything work?" — deterministic spaced card (no LLM wall of text).
 */
export function isHowItWorksIntent(text) {
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return false;
  if (
    /\b(how (does|do|is) (everything|sokoni|this|it|the (process|system|platform|escrow)) (work|handled|happen)|how (sokoni|everything) works|explain (how|the process|escrow)|how (do|does) (prepaid|escrow|delivery) work)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  // Short confirmations after a how-it-works answer are handled elsewhere; this is the ask itself.
  if (/^(how (does|do|is) (it|this|everything)\??)$/i.test(lower)) return true;
  return false;
}

/** How to buy / how can you help / guide me. */
export function isGuideIntent(text) {
  const lower = String(text || "").toLowerCase();
  // "how are you" is small talk, not a buy guide
  if (isGreetingIntent(lower, { allowGuideOverlap: true })) return false;
  if (isHowItWorksIntent(text)) return false;
  return /\b(how (can|do) (you|i)|help me|guide me|make a purchase|how to (buy|order|shop|pay|sell|list)|what can you (do|help)|assist me|what do you (sell|have|offer)|how does (sokoni|this|it) work)\b/i.test(
    lower
  );
}

/** Seller-side marketplace topics (listing, payouts, hubs). */
export function isSellerTopic(text) {
  const lower = String(text || "").toLowerCase();
  // Buyer asking to see merchandise — not Seller Hub ops
  if (
    /\b(listings? for|list(?:ings?)?\s+(?:of\s+)?(?:the\s+)?(?:dresses?|shoes?|sneakers?|phones?|items?|products?|bags?))\b/i.test(
      lower
    )
  ) {
    return false;
  }
  if (
    /\b(do you have|looking for|show me|find|stock of|any)\b/i.test(lower) &&
    /\b(shoes?|dress(?:es)?|sneaker|phone|laptop|stock|mug|bag|jeans)\b/i.test(lower) &&
    !/\b(seller hub|my shop|payout|as a seller)\b/i.test(lower)
  ) {
    return false;
  }
  return /\b(sell(?:er|ing)?|list(?:ing|ings)?|payout|withdraw(?:al)?|b2c|drop-?offs?|mashinani|inventory|stock units?|m-?pesa ledger|seller hub|onboard(?:ing)?|commission|platform fee|hub drop|create (a )?listing|list (an? )?item)\b/i.test(
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
    if (
      !/\b(dress(?:es)?|sneaker|phone|laptop|shoes?|jeans|hoodie|electronics|fashion|thrift|denim|kiondo|mug|bag)\b/i.test(
        raw
      )
    ) {
      return false;
    }
  }
  if (budget != null) return true;
  if (browseMatch) return true;
  if (isSokoniOrderId(raw) || extractOrderIdFromText(raw)) return false;

  // Availability / stock checks are shopping (must run catalog search)
  if (
    /\b(do you (have|sell)|have you got|any|in stock|stock of|still (have|sell))\b/i.test(raw) &&
    !/\b(how (does|do|to)|escrow|fee|commission|account|login)\b/i.test(raw)
  ) {
    return true;
  }

  // Explicit hunt verbs (avoid bare "need" / "any" / "list" — those match escrow help too)
  if (
    /\b(show me|find( me)?|looking for|search( for)?|nataka|nipee|shop for|browse for|listings? for)\b/i.test(raw)
  ) {
    return true;
  }
  if (
    /\b(buy|want|order)\b/i.test(raw) &&
    /\b(dress(?:es)?|sneaker|phone|laptop|shoes?|jeans|hoodie|electronics|fashion|thrift|denim|kiondo|bag|shirt|mug|under|chini|kes)\b/i.test(
      raw
    )
  ) {
    return true;
  }
  if (
    /\b(sneakers?|dresses?|phones?|laptops?|shoes?|jeans|hoodie|electronics|fashion|thrift|kicks|denim|kiondo|mugs?|bags?)\b/i.test(
      raw
    ) &&
    !/\b(how (does|do|to|can)|what is|explain|policy|escrow|fee|commission|refund|dispute|account|login)\b/i.test(
      raw
    )
  ) {
    return true;
  }

  // 1–2 token merchandise keywords only (e.g. "denim", "kiondo", "mug") — not full questions
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
export async function runToolRouter(
  userMessage,
  { phone = "", customerKey = "", specialist = "general", allowedTools = null, history = [] } = {}
) {
  const text = String(userMessage || "").trim();
  const lower = text.toLowerCase();
  const results = [];
  const allow = (name) => !allowedTools || allowedTools.includes(name);

  const orderIdsInMsg = extractAllOrderIdsFromText(text);
  const orderId = orderIdsInMsg[0] || extractOrderId(text);
  const contextOrderIds =
    orderIdsInMsg.length > 0 ? orderIdsInMsg : recentOrderIdsFromHistory(history, 6);

  // Order → seller metadata (Boss/buyer/dispute) — NEVER list_seller_orders
  if (allow("lookup_order_seller") && isOrderSellerLookupIntent(text)) {
    results.push(
      await executeTool(
        "lookup_order_seller",
        { orderIds: contextOrderIds },
        { phone, customerKey, history }
      )
    );
  } else if (allow("list_seller_listings") && isSellerListingsIntent(text)) {
    results.push(await executeTool("list_seller_listings", {}, { phone, customerKey }));
  } else if (allow("list_seller_orders") && isSellerShopOrdersIntent(text)) {
    // Seller shop sales — phone → supplierId → real rows only (never buyer list_orders)
    results.push(await executeTool("list_seller_orders", {}, { phone, customerKey }));
  } else if (
    orderId ||
    /\b(track|tracking|status|wapi order|order yangu|where is my (package|order|parcel))\b/i.test(lower)
  ) {
    if (orderId && allow("track_order")) {
      results.push(await executeTool("track_order", { orderId }, { phone, customerKey }));
    } else if ((phone || customerKey) && allow("list_orders")) {
      results.push(await executeTool("list_orders", {}, { phone, customerKey }));
    }
  }

  // Also: seller specialist + vague "orders" / "only this?" follow-ups when phone is a shop
  if (
    allow("list_seller_orders") &&
    !results.some((r) => r.tool === "list_seller_orders" || r.tool === "lookup_order_seller") &&
    specialist === "seller" &&
    !isOrderSellerLookupIntent(text) &&
    /\b(orders?|sales|only this|that'?s all|ndio hizo)\b/i.test(lower)
  ) {
    results.push(await executeTool("list_seller_orders", {}, { phone, customerKey }));
  }

  // Damaged / wrong item / refund → ALWAYS run dispute protocol (order id optional;
  // we resolve from the buyer's recent paid orders when omitted).
  if (allow("open_return_case") && isFulfillmentComplaint(text)) {
    const { runFulfillmentDisputeProtocol } = await import("./dispute-protocol.js");
    const dispute = await runFulfillmentDisputeProtocol({
      text,
      phone,
      customerKey,
    });
    if (dispute.handled) {
      try {
        const { markAwaitingDisputeEvidence } = await import("./dispute-protocol.js");
        markAwaitingDisputeEvidence(customerKey, {
          orderId: dispute.orderId || null,
          disputeId: dispute.disputeId || null,
          phone,
        });
      } catch {
        /* ignore */
      }
      results.push({
        tool: "open_return_case",
        ok: Boolean(dispute.ok),
        orderId: dispute.orderId,
        disputeId: dispute.disputeId,
        payoutHeld: Boolean(dispute.payoutHeld),
        askForEvidence: Boolean(dispute.askForEvidence),
        needsOrderId: Boolean(dispute.needsOrderId),
        candidates: dispute.candidates || [],
        message: dispute.message,
        error: dispute.error || undefined,
        deterministic: true,
      });
    }
  } else if (
    allow("open_return_case") &&
    orderId &&
    /\b(refund|damaged|damage|return|money back|wrong item|broken|scam)\b/i.test(lower)
  ) {
    results.push(
      await executeTool(
        "open_return_case",
        { orderId, reason: text.slice(0, 400) },
        { phone, customerKey }
      )
    );
  }

  if (
    allow("propose_goodwill") &&
    /\b(goodwill|voucher|apology credit|compensation)\b/i.test(lower)
  ) {
    const m = text.match(/(?:kes\s*)?(\d[\d,]*)/i);
    const amount = m ? Number(m[1].replace(/,/g, "")) : 300;
    results.push(await executeTool("propose_goodwill", { amountKes: amount }, { phone }));
  }

  if (
    allow("create_checkout_link") &&
    /\b(add\s+\d+|to\s+(?:my\s+)?cart|send\s+(?:me\s+)?(?:the\s+)?(?:payment|pay|checkout)\s+link|reserve\s+\d+)\b/i.test(
      lower
    )
  ) {
    const intent = (await import("./commerce-ops.js")).parseCommerceIntent(text);
    const qty = intent.addToCart?.quantity || Number((text.match(/\badd\s+(\d+)/i) || [])[1]) || 1;
    const query =
      intent.addToCart?.query ||
      text
        .replace(/\b(add|reserve|buy)\s+\d+\s+(of\s+)?(those\s+|the\s+)?/i, "")
        .replace(/\s+to\s+(my\s+)?cart.*$/i, "")
        .replace(/\s+and\s+send.*$/i, "")
        .trim();
    results.push(
      await executeTool(
        "create_checkout_link",
        { quantity: qty, query, productId: "" },
        { phone, customerKey }
      )
    );
  }

  if (allow("update_inventory") && /\b(update\s+(?:my\s+)?inventory|restock|stock\s+\S+\s+\d+)\b/i.test(lower)) {
    const intent = (await import("./commerce-ops.js")).parseCommerceIntent(text);
    const stock = intent.stockUpdate || {};
    results.push(
      await executeTool(
        "update_inventory",
        {
          productId: stock.productId || "",
          productQuery: stock.query || "",
          stockQuantity: stock.quantity,
          priceKes: stock.priceKes,
        },
        { phone }
      )
    );
  }

  if (allow("dispatch_with_rider") && /\bdispatch\s+skn-/i.test(lower)) {
    const intent = (await import("./commerce-ops.js")).parseCommerceIntent(text);
    if (intent.dispatch) {
      results.push(
        await executeTool(
          "dispatch_with_rider",
          intent.dispatch,
          { phone, customerKey }
        )
      );
    }
  }

  if (allow("verify_payment_code") && /\b(paid|mpesa|m-pesa|transaction\s+code|qa\d)\b/i.test(lower)) {
    const intent = (await import("./commerce-ops.js")).parseCommerceIntent(text);
    const orderId = extractOrderId(text);
    if (intent.paymentCode || orderId) {
      results.push(
        await executeTool(
          "verify_payment_code",
          { orderId, code: intent.paymentCode || "" },
          { phone, customerKey }
        )
      );
    }
  }

  if (
    allow("check_aup") &&
    /\b(list(?:ing)?|sell|upload)\b/i.test(lower) &&
    /\b(pill|medical|pharma|weapon|drug|counterfeit)\b/i.test(lower)
  ) {
    results.push(
      await executeTool("check_aup", { title: text, description: text }, { phone })
    );
  }

  if (
    allow("get_seller_onboarding") &&
    /\b(register as|how (do|to) (i )?sell|become a seller|onboard|link (my )?m-?pesa|till|paybill|seller setup)\b/i.test(
      lower
    )
  ) {
    results.push(await executeTool("get_seller_onboarding", {}, { phone }));
  }

  if (
    allow("get_seller_payout") &&
    /\b(payout|balance|earnings|withdraw|what (is|do) i (owe|get|have)|pending (payout|balance)|this week)\b/i.test(
      lower
    )
  ) {
    results.push(await executeTool("get_seller_payout", {}, { phone }));
  }

  if (
    allow("get_shipping_rates") &&
    /\b(shipping rate|delivery (price|fee|rate)|upcountry|set (my )?delivery|shipping zone)\b/i.test(
      lower
    )
  ) {
    results.push(await executeTool("get_shipping_rates", {}, { phone }));
  }

  if (
    allow("store_info") &&
    /\b(prepaid|escrow|mpesa|pay|payment|stk|till|how (?:it|sokoni) works|delivery|shipping|dispatch|return|refund|about sokoni|what is sokoni|safe|trust)\b/i.test(
      lower
    )
  ) {
    results.push(await executeTool("store_info", {}, { phone }));
  }

  if (allow("browse_taxonomy") && isTaxonomyQuery(lower)) {
    results.push(await executeTool("browse_taxonomy", {}, { phone }));
  }

  const productIdMatch = text.match(/\b(prod_[a-z0-9_-]+|[a-z]{2}-[a-z0-9]+-\d+)\b/i);
  if (productIdMatch && allow("get_product")) {
    results.push(await executeTool("get_product", { productId: productIdMatch[1] }, { phone }));
  }

  const browseMatch = await matchBrowseFromText(text);
  const budget = extractBudget(text);
  const secondhandOnly = wantsSecondhand(text) && !wantsNew(text);
  const shopping = isShoppingIntent(text, { browseMatch, budget });

  // Every Sokoni turn gets live site facts so the LLM can answer any marketplace question.
  if (allow("store_info") && !isOffTopicIntent(text) && !results.some((r) => r.tool === "store_info")) {
    results.push(await executeTool("store_info", {}, { phone }));
  }
  if (
    allow("browse_taxonomy") &&
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
    (isSellerTopic(text) && !shopping) ||
    isOffTopicIntent(text) ||
    text.length < 2 ||
    (!allow("search_products") && !allow("browse_products"));

  if (!skipSearch) {
    if (browseMatch && shouldBrowseList(text, lower, browseMatch) && allow("browse_products")) {
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
      if (allow("browse_taxonomy") && !results.some((r) => r.tool === "browse_taxonomy")) {
        results.push(
          await executeTool(
            "browse_taxonomy",
            { focusCategory: browseMatch.browseCategory },
            { phone }
          )
        );
      }
    } else if (allow("search_products")) {
      let browseCategory = browseMatch?.browseCategory || null;
      let browseSubCategory = browseMatch?.browseSubCategory || null;
      let browseLabel = browseMatch?.label || null;
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
      case "list_seller_orders":
        return toolListSellerOrders(context);
      case "lookup_order_seller":
        return await toolLookupOrderSeller(args, context);
      case "list_seller_listings":
        return await toolListSellerListings(context);
      case "store_info":
        return toolStoreInfo();
      case "open_return_case":
        return await toolOpenReturnCase(args, context);
      case "get_seller_onboarding":
        return toolSellerOnboarding();
      case "get_seller_payout":
        return toolSellerPayout(context);
      case "get_shipping_rates":
        return toolShippingRates(context);
      case "propose_goodwill":
        return toolProposeGoodwill(args);
      case "create_checkout_link":
        return await toolCreateCheckout(args, context);
      case "update_inventory":
        return await toolUpdateInventory(args, context);
      case "dispatch_with_rider":
        return await toolDispatchRider(args, context);
      case "verify_payment_code":
        return toolVerifyPayment(args, context);
      case "check_aup":
        return toolCheckAup(args);
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
    // Never force scope/fulfillment here — seller rows may use other values
    products = await searchProducts({
      keywords,
      browseCategory: browseCategory || undefined,
      browseSubCategory: browseSubCategory || undefined,
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
    // AI aisle browse must see all live stock, not only platform "local/store" rows
    scope: "all",
    fulfillment: "all",
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

/**
 * Shop sales for the WhatsApp sender — DB/JSON rows only.
 * Never invents IDs; empty shop → explicit 0 orders message.
 */
function toolListSellerOrders({ phone = "" } = {}) {
  if (!phone) {
    return {
      tool: "list_seller_orders",
      ok: false,
      error: "phone_required",
      count: 0,
      orders: [],
      message:
        "I need your seller WhatsApp number on this chat to load shop orders. Message Sokoni from the phone linked to your shop.",
      deterministic: true,
    };
  }

  const supplier = findSupplierByPhone(phone);
  if (!supplier?.id) {
    return {
      tool: "list_seller_orders",
      ok: false,
      error: "not_a_seller",
      count: 0,
      orders: [],
      message:
        "❌ This WhatsApp number isn't linked to an active seller shop on Sokoni.\n\nOpen Seller Hub to finish setup:\nsokonimall.com/suppliers/list.html",
      deterministic: true,
    };
  }

  const handle =
    String(supplier.shopHandle || supplier.handle || supplier.businessName || supplier.shopName || "your shop")
      .replace(/^@/, "")
      .trim() || "your shop";
  const displayHandle = handle.startsWith("@") ? handle : `@${handle}`;

  const rows = listAllOrders()
    .filter((o) => o.supplierId === supplier.id && o.kind !== "cart_parent")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 10)
    .map((o) => {
      const amount = Math.round(
        Number(o.totalKes || o.priceKes || o.sellerNetKes || 0) || 0
      );
      const paid =
        o.customerPaymentStatus === "confirmed" ||
        o.paymentStatus === "paid" ||
        Boolean(o.paidAt);
      let status = String(o.status || "pending");
      if (o.status === "cancelled") status = "Cancelled";
      else if (paid) status = String(o.shipmentStatus || o.bodaStatus || "Paid");
      return {
        id: o.id,
        productName: String(o.productName || o.title || "Item").slice(0, 80),
        amountKes: amount,
        status,
        paid,
      };
    });

  if (!rows.length) {
    const message =
      `📦 *${displayHandle}* — You currently have *0 orders* placed through your shop.\n\n` +
      `When buyers prepaid-checkout your listings, they will show here. Seller Hub → Orders also lists live sales.`;
    return {
      tool: "list_seller_orders",
      ok: true,
      count: 0,
      orders: [],
      shopHandle: displayHandle,
      supplierId: supplier.id,
      message,
      deterministic: true,
    };
  }

  const lines = rows.map(
    (o) =>
      `• *${o.id}*: ${o.productName} | KES ${Number(o.amountKes || 0).toLocaleString()} | *${o.status}*`
  );
  const message =
    `📦 *Live orders for ${displayHandle}* (${rows.length}):\n\n` +
    `${lines.join("\n")}\n\n` +
    `These are the only shop orders on file for this WhatsApp. Reply with an order id for more detail.`;

  return {
    tool: "list_seller_orders",
    ok: true,
    count: rows.length,
    orders: rows,
    shopHandle: displayHandle,
    supplierId: supplier.id,
    message,
    deterministic: true,
  };
}

async function resolveSellerForOrder(order) {
  if (!order) return null;
  let o = order;
  try {
    const { ensureOrderSupplier } = await import("./communication-hub.js");
    o = (await ensureOrderSupplier(order)) || order;
  } catch {
    /* ignore */
  }
  let supplier = o.supplierId ? getSupplier(o.supplierId) : null;
  if (!supplier && o.sellerPhone) supplier = findSupplierByPhone(o.sellerPhone);
  if (!supplier && o.productId) {
    try {
      const product = await getProductById(o.productId);
      if (product?.supplierId) supplier = getSupplier(product.supplierId);
      if (!supplier && product?.sellerPhone) supplier = findSupplierByPhone(product.sellerPhone);
    } catch {
      /* ignore */
    }
  }
  const handle = String(
    supplier?.shopHandle || supplier?.handle || o.shopHandle || o.sellerHandle || ""
  )
    .replace(/^@/, "")
    .trim();
  const phone =
    supplier?.phone || supplier?.mpesaNumber || o.sellerPhone || null;
  return {
    supplierId: supplier?.id || o.supplierId || null,
    handle: handle ? `@${handle}` : null,
    businessName: supplier?.businessName || supplier?.shopName || o.sellerName || null,
    phone: phone || null,
    verified: Boolean(supplier?.isVerifiedStore || supplier?.isSellerVerified || supplier?.verifiedBadge),
  };
}

async function toolLookupOrderSeller(args = {}, context = {}) {
  let ids = Array.isArray(args.orderIds) ? args.orderIds.map(normalizeOrderId).filter(Boolean) : [];
  if (!ids.length && args.orderId) {
    const one = normalizeOrderId(args.orderId);
    if (one) ids = [one];
  }
  if (!ids.length) {
    ids = extractAllOrderIdsFromText(args.text || "");
  }
  if (!ids.length && context.history) {
    ids = recentOrderIdsFromHistory(context.history, 6);
  }

  if (!ids.length) {
    return {
      tool: "lookup_order_seller",
      ok: false,
      error: "missing_order_id",
      count: 0,
      orders: [],
      message:
        "I need an order id like *SKN-1011* to look up the seller. Paste the SKN / SK id (or ask again right after a message that lists those orders).",
      deterministic: true,
    };
  }

  const rows = [];
  for (const id of ids.slice(0, 8)) {
    let order = getOrder(id);
    if (!order) {
      rows.push({
        id,
        found: false,
        productName: null,
        status: null,
        seller: null,
        dispute: null,
      });
      continue;
    }
    const seller = await resolveSellerForOrder(order);
    let dispute = null;
    try {
      const { getOpenDisputeForOrder } = await import("./disputes.js");
      dispute = await getOpenDisputeForOrder(id);
    } catch {
      if (order.disputeId || order.disputeStatus) {
        dispute = {
          id: order.disputeId || null,
          status: order.disputeStatus || "open",
          reason: order.disputeReason || null,
        };
      }
    }
    rows.push({
      id: order.id,
      found: true,
      productName: String(order.productName || order.title || "Item").slice(0, 80),
      status: String(order.status || order.shipmentStatus || "—"),
      seller,
      dispute: dispute
        ? {
            id: dispute.id || dispute.disputeId || null,
            status: dispute.status || "open",
            reason: dispute.reason || dispute.buyerReason || null,
          }
        : null,
    });
  }

  const found = rows.filter((r) => r.found);
  if (!found.length) {
    return {
      tool: "lookup_order_seller",
      ok: false,
      error: "not_found",
      count: 0,
      orders: rows,
      message: `No orders found for ${ids.join(", ")}. Double-check the SKN / SK id.`,
      deterministic: true,
    };
  }

  const lines = found.map((r) => {
    const s = r.seller;
    const sellerLabel = s?.handle
      ? `${s.handle}${s.phone ? ` (${s.phone})` : ""}`
      : s?.businessName || s?.phone || "Unknown seller (not linked on file)";
    const disputeLine = r.dispute
      ? `⚠️ Dispute: ${r.dispute.status}${r.dispute.reason ? ` — ${String(r.dispute.reason).slice(0, 80)}` : ""}`
      : "✅ No active dispute on file";
    return (
      `📦 *${r.id}*\n` +
      `• Item: ${r.productName}\n` +
      `• Status: *${r.status}*\n` +
      `• Seller: ${sellerLabel}\n` +
      `• ${disputeLine}`
    );
  });

  const missing = rows.filter((r) => !r.found).map((r) => r.id);
  const message =
    `Here is the seller info for ${found.length} order${found.length === 1 ? "" : "s"}:\n\n` +
    `${lines.join("\n\n")}` +
    (missing.length ? `\n\n_Not found: ${missing.join(", ")}_` : "");

  return {
    tool: "lookup_order_seller",
    ok: true,
    count: found.length,
    orders: rows,
    message,
    deterministic: true,
  };
}

async function toolListSellerListings({ phone = "" } = {}) {
  if (!phone) {
    return {
      tool: "list_seller_listings",
      ok: false,
      error: "phone_required",
      count: 0,
      listings: [],
      message: "Message Sokoni from the WhatsApp number linked to your shop to list active listings.",
      deterministic: true,
    };
  }
  const supplier = findSupplierByPhone(phone);
  if (!supplier?.id) {
    return {
      tool: "list_seller_listings",
      ok: false,
      error: "not_a_seller",
      count: 0,
      listings: [],
      message:
        "❌ This WhatsApp number isn't linked to an active seller shop on Sokoni.\n\nOpen Seller Hub: sokonimall.com/suppliers/list.html",
      deterministic: true,
    };
  }

  const handle =
    String(supplier.shopHandle || supplier.handle || supplier.businessName || "your shop")
      .replace(/^@/, "")
      .trim() || "your shop";
  const displayHandle = `@${handle}`;

  let live = [];
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const masterFile = path.join(botRoot, "data", "products.json");
    const master = JSON.parse(await readFile(masterFile, "utf-8"));
    const digits = String(phone || "").replace(/\D/g, "");
    const sellerHandle = handle.toLowerCase();
    live = (Array.isArray(master) ? master : []).filter((p) => {
      if (p.supplierId && p.supplierId === supplier.id) return true;
      const ph = String(p.shopHandle || p.sellerHandle || "")
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      if (ph && ph === sellerHandle) return true;
      const sp = String(p.sellerPhone || "").replace(/\D/g, "");
      if (digits && sp && (sp.endsWith(digits.slice(-9)) || digits.endsWith(sp.slice(-9)))) return true;
      return false;
    });
  } catch (err) {
    console.warn("[ai-tools] list_seller_listings master:", err.message);
  }

  const active = live
    .filter((p) => p.inStock !== false && !p.isSold && String(p.status || "live").toLowerCase() !== "hidden")
    .slice(0, 15)
    .map((p) => ({
      id: p.id,
      name: p.name || p.title,
      priceKes: Math.round(Number(p.priceKes || p.draft?.priceKes || 0) || 0),
      stock:
        p.stockQuantity != null
          ? Math.max(0, Math.round(Number(p.stockQuantity) || 0))
          : p.inStock === false
            ? 0
            : 1,
    }));

  if (!active.length) {
    return {
      tool: "list_seller_listings",
      ok: true,
      count: 0,
      listings: [],
      shopHandle: displayHandle,
      message: `📦 *${displayHandle}* — You currently have *0 active listings* on Sokoni.\n\nAdd items in Seller Hub: sokonimall.com/suppliers/list.html`,
      deterministic: true,
    };
  }

  const lines = active.map(
    (p, i) =>
      `${i + 1}. *${p.name}*\n` +
      `   • Price: KES ${Number(p.priceKes || 0).toLocaleString()}\n` +
      `   • ID: \`${p.id}\`\n` +
      `   • Stock: ${p.stock > 0 ? `In stock (${p.stock})` : "OUT OF STOCK"}`
  );
  const message =
    `🛍️ *Active listings for ${displayHandle}* (${active.length}):\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Manage in Seller Hub → Listings.`;

  return {
    tool: "list_seller_listings",
    ok: true,
    count: active.length,
    listings: active,
    shopHandle: displayHandle,
    message,
    deterministic: true,
  };
}

async function toolOpenReturnCase({ orderId, reason = "" } = {}, { phone = "", customerKey = "" } = {}) {
  const { openBuyerReturnCase } = await import("./communication-hub.js");
  const result = await openBuyerReturnCase({
    orderId,
    phone,
    customerKey,
    reason,
  });
  try {
    const { markAwaitingDisputeEvidence } = await import("./dispute-protocol.js");
    if (result.ok || result.askForEvidence) {
      markAwaitingDisputeEvidence(customerKey, {
        orderId: result.orderId || orderId || null,
        disputeId: result.disputeId || null,
        phone,
      });
    }
  } catch {
    /* ignore */
  }
  return {
    tool: "open_return_case",
    ok: Boolean(result.ok),
    ...result,
  };
}

function toolSellerOnboarding() {
  const site = "https://sokonimall.com";
  return {
    tool: "get_seller_onboarding",
    ok: true,
    steps: [
      "Open Seller Hub → sokonimall.com/suppliers/list.html",
      "Verify WhatsApp (Send code → enter 6-digit code)",
      "Create shop name + optional @handle",
      "Settings → Payouts: add M-Pesa number and/or Buy Goods Till / Paybill",
      "Optional: add National ID for vetting (list without it)",
      "List items; set stock; item promos via % Set promo on each listing",
    ],
    sellerHub: `${site}/suppliers/list.html`,
    note: "Approval for verification usually within a few hours on business days.",
  };
}

function toolSellerPayout({ phone = "" } = {}) {
  if (!phone) {
    return {
      tool: "get_seller_payout",
      ok: false,
      error: "phone_required",
      message: "Sign in on WhatsApp with your seller number to see payouts.",
    };
  }
  const supplier = findSupplierByPhone(phone);
  if (!supplier) {
    return {
      tool: "get_seller_payout",
      ok: false,
      error: "not_a_seller",
      message:
        "This WhatsApp is not a registered seller yet. Open Seller Hub to onboard, then ask again.",
      sellerHub: "https://sokonimall.com/suppliers/list.html",
    };
  }
  const ledger = getSellerEscrowLedger(supplier.id);
  const owed = getWithdrawableEntries(supplier.id);
  const withdrawable = owed.reduce((s, e) => s + (e.payoutAmountKes || 0), 0);
  return {
    tool: "get_seller_payout",
    ok: true,
    shopName: supplier.businessName || supplier.shopName || supplier.id,
    readyForMpesaKes: withdrawable,
    pendingEscrowKes: ledger.pendingEscrow?.totalKes || 0,
    inTransitKes: ledger.inTransit?.totalKes || 0,
    message:
      `Ready for M-Pesa: KES ${withdrawable.toLocaleString()}. ` +
      `Pending escrow: KES ${(ledger.pendingEscrow?.totalKes || 0).toLocaleString()}. ` +
      `In transit: KES ${(ledger.inTransit?.totalKes || 0).toLocaleString()}. ` +
      `Reply WITHDRAW on WhatsApp or use Seller Hub → M-Pesa Ledger.`,
  };
}

function toolShippingRates({ phone = "" } = {}) {
  const guide = {
    tool: "get_shipping_rates",
    ok: true,
    howToSet: [
      "Seller Hub → Shipping Rates → Add Zone",
      "Example: Nairobi / local = KES 300",
      "Example: Upcountry Kenya = KES 500",
      "Save — buyers see rates at checkout by location",
    ],
    sellerHub: "https://sokonimall.com/suppliers/list.html",
  };
  if (!phone) return guide;
  const supplier = findSupplierByPhone(phone);
  if (!supplier) return guide;
  const keys = vendorKeyCandidatesFromSeller(supplier);
  let profile = null;
  for (const key of keys) {
    profile = getVendorShippingProfile(key);
    if (profile?.sellerConfigured) break;
  }
  if (!profile) return { ...guide, shopName: supplier.businessName || supplier.shopName };
  return {
    ...guide,
    ok: true,
    shopName: supplier.businessName || supplier.shopName,
    configured: Boolean(profile.sellerConfigured),
    flatLocalRateKes: profile.flatLocalRateKes,
    flatUpcountryRateKes: profile.flatUpcountryRateKes,
    shippingType: profile.shippingType,
  };
}

function toolProposeGoodwill({ amountKes = 300 } = {}) {
  const result = evaluateGoodwillVoucher(amountKes);
  return { tool: "propose_goodwill", ...result };
}

async function toolCreateCheckout(args, context = {}) {
  const { createWhatsAppCheckoutSession } = await import("./commerce-ops.js");
  const result = await createWhatsAppCheckoutSession({
    customerKey: context.customerKey,
    phone: context.phone,
    productId: args.productId,
    query: args.query,
    quantity: args.quantity,
  });
  return { tool: "create_checkout_link", ...result };
}

async function toolUpdateInventory(args, context = {}) {
  const { updateInventoryFromWhatsApp } = await import("./commerce-ops.js");
  const result = await updateInventoryFromWhatsApp({
    phone: context.phone,
    productId: args.productId,
    productQuery: args.productQuery,
    stockQuantity: args.stockQuantity,
    priceKes: args.priceKes,
  });
  return { tool: "update_inventory", ...result };
}

async function toolDispatchRider(args, context = {}) {
  const { dispatchOrderWithRider } = await import("./commerce-ops.js");
  const result = await dispatchOrderWithRider({
    orderId: args.orderId,
    phone: context.phone,
    customerKey: context.customerKey,
    riderName: args.riderName,
    riderPhone: args.riderPhone,
  });
  return { tool: "dispatch_with_rider", ...result };
}

function toolVerifyPayment(args, context = {}) {
  // sync import via dynamic in callers — use require pattern
  return import("./commerce-ops.js").then(({ verifyPaymentProof }) => ({
    tool: "verify_payment_code",
    ...verifyPaymentProof({
      orderId: args.orderId,
      code: args.code,
      customerKey: context.customerKey,
      phone: context.phone,
    }),
  }));
}

function toolCheckAup(args) {
  return import("./commerce-ops.js").then(({ checkAcceptableUsePolicy }) => ({
    tool: "check_aup",
    ...checkAcceptableUsePolicy({ title: args.title, description: args.description }),
  }));
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
    supportEmail: formatSupportEmail(),
    whatsappLink: formatWhatsAppLink(),
    humanSupportHours: `${config.businessHours?.humanSupportStart || "07:30"}–${
      config.businessHours?.humanSupportEnd || "21:00"
    } EAT`,
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
      "When a seller requests boda pickup, ask which order id (from list_seller_orders) and the exact pickup location. Identify the seller by WhatsApp phone — never invent a list of pending orders.",
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
        `LOOKUP search_products (${r.count || 0} hits for "${r.query}"${path ? `; aisle ${path}` : ""}):\n` +
        (r.suggestions?.length ? `Suggestions: ${r.suggestions.join(", ")}\n` : "") +
        (formatProductLines(r.products).join("\n") || "(no products)")
      );
    }
    if (r.tool === "search_products") {
      return (
        `LOOKUP search_products: 0 hits for "${r.query || ""}". ` +
        `Do not invent products. Suggest another keyword, aisle, or escalate if needed.`
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
      return (
        `TOOL track_order ${t.orderId}:\n` +
        `Product: ${t.productName}\n` +
        `Payment: ${t.paymentLine}\n` +
        `Shipment: ${t.shipmentStatusLabel}\n` +
        (t.courier ? `Courier: ${t.courier}\n` : "") +
        (t.riderName || t.riderPhone
          ? `Rider: ${t.riderName || "—"} ${t.riderPhone || ""}\n`
          : "") +
        (t.etaNote ? `ETA: ${t.etaNote}\n` : "") +
        (t.dropOffHub ? `Hub: ${t.dropOffHub}\n` : "") +
        `Timeline: ${steps || t.orderStatusLabel}`
      );
    }
    if (r.tool === "list_orders" && r.orders) {
      const lines = r.orders.map(
        (o) => `${o.id} · ${o.productName} · ${o.shipmentStatus || o.status} · ${o.paid ? "paid" : "unpaid"}`
      );
      return `TOOL list_orders:\n${lines.join("\n") || "No orders found for this number."}`;
    }
    if (r.tool === "list_seller_orders") {
      if (r.message) {
        return (
          `TOOL list_seller_orders (AUTHORITATIVE — copy facts only, never invent rows):\n` +
          `ok=${r.ok} count=${r.count ?? 0} shop=${r.shopHandle || "—"}\n` +
          `${r.message}`
        );
      }
      const lines = (r.orders || []).map(
        (o) => `${o.id} · ${o.productName} · KES ${o.amountKes} · ${o.status}`
      );
      return (
        `TOOL list_seller_orders (AUTHORITATIVE):\n` +
        `count=${r.count ?? 0}\n` +
        (lines.join("\n") || "0 shop orders for this WhatsApp.")
      );
    }
    if (r.tool === "lookup_order_seller") {
      return (
        `TOOL lookup_order_seller (AUTHORITATIVE — never invent sellers):\n` +
        `ok=${r.ok} count=${r.count ?? 0}\n` +
        `${r.message || r.error || ""}`
      );
    }
    if (r.tool === "list_seller_listings") {
      return (
        `TOOL list_seller_listings (AUTHORITATIVE):\n` +
        `ok=${r.ok} count=${r.count ?? 0} shop=${r.shopHandle || "—"}\n` +
        `${r.message || ""}`
      );
    }
    if (r.tool === "open_return_case") {
      return (
        `TOOL open_return_case:\n` +
        `ok=${r.ok} order=${r.orderId || "—"} payoutHeld=${Boolean(r.payoutHeld)} askPhotos=${Boolean(r.askForEvidence)}\n` +
        `${r.message || r.error || ""}`
      );
    }
    if (r.tool === "get_seller_onboarding" && r.ok) {
      return (
        `TOOL get_seller_onboarding:\n` +
        (r.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n") +
        `\nHub: ${r.sellerHub}\n${r.note || ""}`
      );
    }
    if (r.tool === "get_seller_payout") {
      if (!r.ok) return `TOOL get_seller_payout: ${r.message || r.error}`;
      return (
        `TOOL get_seller_payout (${r.shopName}):\n` +
        `Ready M-Pesa: KES ${Number(r.readyForMpesaKes || 0).toLocaleString()}\n` +
        `Pending escrow: KES ${Number(r.pendingEscrowKes || 0).toLocaleString()}\n` +
        `In transit: KES ${Number(r.inTransitKes || 0).toLocaleString()}\n` +
        `${r.message || ""}`
      );
    }
    if (r.tool === "get_shipping_rates") {
      return (
        `TOOL get_shipping_rates:\n` +
        (r.howToSet || []).map((s, i) => `${i + 1}. ${s}`).join("\n") +
        (r.configured
          ? `\nSaved: local KES ${r.flatLocalRateKes} · upcountry KES ${r.flatUpcountryRateKes}`
          : "") +
        `\nHub: ${r.sellerHub}`
      );
    }
    if (r.tool === "propose_goodwill") {
      return `TOOL propose_goodwill: ${r.message || JSON.stringify(r)}`;
    }
    if (r.tool === "create_checkout_link") {
      return (
        `TOOL create_checkout_link:\n` +
        `ok=${r.ok} order=${r.orderId || "—"} qty=${r.quantity || 1} total=KES ${r.totalKes || "—"}\n` +
        `payUrl=${r.payUrl || "—"}\n${r.message || r.error || ""}`
      );
    }
    if (r.tool === "update_inventory") {
      return `TOOL update_inventory: ${r.message || r.error || JSON.stringify(r)}`;
    }
    if (r.tool === "dispatch_with_rider") {
      return `TOOL dispatch_with_rider: ${r.message || r.error || JSON.stringify(r)}`;
    }
    if (r.tool === "verify_payment_code") {
      return `TOOL verify_payment_code verified=${r.verified}: ${r.message || r.error || ""}`;
    }
    if (r.tool === "check_aup") {
      return `TOOL check_aup allowed=${r.allowed}: ${r.message || ""}`;
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
        `Support email: ${r.supportEmail || "support@sokonimall.com"}\n` +
        `WhatsApp: ${r.whatsappLink}\n` +
        `Human support hours: ${r.humanSupportHours || "07:30–21:00 EAT"}\n` +
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
  return `LOOKUP RESULTS (authoritative — use only this data; do not call API tools):\n${blocks.join("\n\n")}`;
}

/** Exported for tests */
export {
  priceTierMaxKes,
  isTaxonomyQuery,
  isPaymentOrSiteInfoQuery,
};
