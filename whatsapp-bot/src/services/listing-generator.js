/**
 * Phase 4 — Seller listing photo AI (CATALOG_VISION_MODEL via OpenRouter).
 * Used by sell page + listing studio only — NOT WhatsApp chat (see ai-agent.js).
 */
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { applyAiShippingSuggestion, computeFeeBreakdown } from "./shipping-tiers.js";
import { geminiVisionAvailable, geminiVisionListingJson } from "./gemini-vision.js";
import { nvidiaVisionAvailable, nvidiaVisionListingJson } from "./nvidia-vision.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY_PATH = path.join(__dirname, "..", "..", "..", "scripts", "browse-taxonomy.mjs");

export const VALID_CATEGORIES = [
  "phones-tablets",
  "tvs-audio",
  "appliances",
  "health-beauty",
  "home-office",
  "fashion",
  "computing",
  "gaming",
  "supermarket",
  "baby-products",
  "restaurant",
  "wines-spirits",
];

export const VALID_CONDITIONS = [
  "brand_new_with_tags",
  "brand_new_without_tags",
  "like_new",
  "gently_used",
  "fair_condition",
];

const SUBCATEGORY_GUIDE = {
  "phones-tablets": "smartphones, tablets, power-banks, phone-accessories",
  "tvs-audio": "televisions, headphones, speakers, home-theatre, wearables",
  appliances: "kitchen-appliances, kettles, irons, blenders, washing-machines",
  "health-beauty": "personal-care, skincare, makeup, haircare, fragrances",
  "home-office": "kitchen-dining, bedding, cleaning, home-decor, stationery",
  fashion: "mens-fashion, womens-fashion, shoes, bags, watches",
  computing: "laptops, computer-accessories, printers, storage",
  gaming: "consoles, gaming-accessories",
  supermarket: "groceries, beverages, snacks, household",
  "baby-products": "diapers, feeding, baby-care, toys",
  restaurant:
    "nyama-choma, ugali plates, pilau, chapati, githeri, stews, chicken, fish, street bites, breakfast, lunch boxes, vegan, healthy bowls, diet meals, juices, desserts, catering",
  "wines-spirits":
    "local beer, Kenyan spirits (Kenya Cane), red wine, white wine, sparkling/champagne, whisky, gin, vodka, cognac/brandy, rum, cider/RTDs, liqueurs, mixers, party packs, non-alcoholic",
};

const CATEGORY_KEYWORDS = [
  { category: "phones-tablets", words: ["phone", "tecno", "samsung", "iphone", "redmi", "infinix", "tablet", "ipad", "power bank", "powerbank", "charger", "case", "cover", "screen guard"] },
  { category: "tvs-audio", words: ["tv", "television", "speaker", "soundbar", "earbud", "headphone", "hisense"] },
  { category: "appliances", words: ["fridge", "freezer", "washing", "microwave", "blender", "cooker", "iron"] },
  { category: "health-beauty", words: ["perfume", "lotion", "cream", "makeup", "soap", "shampoo", "beauty"] },
  { category: "fashion", words: ["dress", "shirt", "shoe", "shoes", "sandal", "slide", "flat", "sneaker", "bag", "jeans", "suit", "women", "ladies", "wear", "hoodie", "top"] },
  { category: "computing", words: ["laptop", "computer", "monitor", "keyboard", "mouse", "printer"] },
  { category: "gaming", words: ["playstation", "xbox", "game", "controller", "ps5", "ps4"] },
  { category: "supermarket", words: ["rice", "flour", "sugar", "oil", "tea", "coffee", "cereal"] },
  { category: "baby-products", words: ["diaper", "pampers", "baby", "stroller", "formula"] },
  { category: "home-office", words: ["chair", "desk", "bed", "mattress", "curtain", "lamp", "furniture"] },
  {
    category: "wines-spirits",
    words: [
      "wine",
      "wines",
      "spirit",
      "spirits",
      "liquor",
      "alcohol",
      "beer",
      "tusker",
      "whitecap",
      "guinness",
      "kenya cane",
      "cane",
      "whisky",
      "whiskey",
      "gin",
      "vodka",
      "cognac",
      "brandy",
      "rum",
      "champagne",
      "prosecco",
      "cider",
      "liqueur",
      "baileys",
      "mixer",
      "soda water",
      "tonic",
    ],
  },
  {
    category: "restaurant",
    words: [
      "nyama",
      "choma",
      "ugali",
      "sukuma",
      "githeri",
      "pilau",
      "biryani",
      "chapati",
      "mandazi",
      "mahamri",
      "mutura",
      "smokie",
      "viazi",
      "matumbo",
      "tilapia",
      "samosa",
      "meal",
      "dish",
      "stew",
      "plate",
      "catering",
      "juice",
      "vegan",
      "lunch",
      "breakfast",
      "dinner",
    ],
  },
];

let taxonomyModule = null;
let visionClient = null;

async function getTaxonomy() {
  if (!taxonomyModule) {
    taxonomyModule = await import(pathToFileURL(TAXONOMY_PATH).href);
  }
  return taxonomyModule;
}

function visionModelChain() {
  const primary = config.catalog.visionModel?.trim();
  const fallbacks = config.catalog.visionFallbacks || [];
  const chain = [...new Set([primary, ...fallbacks].filter(Boolean))];
  if (chain.some((m) => /^krea\//i.test(m) || /image-gen|flux|dall-e|stable-diffusion/i.test(m))) {
    console.warn(
      "[listing-generator] image-gen models (e.g. krea) stay in CATALOG_VISION_FALLBACKS but are skipped for photo→JSON — Gemini / multimodal chat models handle listing drafts."
    );
  }
  return chain;
}

function getVisionClient() {
  if (!config.openai.apiKey) return null;
  if (!visionClient) {
    visionClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
        "X-Title": config.brand.name,
      },
    });
  }
  return visionClient;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCost(text) {
  const t = String(text || "");
  const patterns = [
    /(?:cost|wholesale|supply|price|@)\s*[:=]?\s*(?:ksh|kes)?\s*([\d,]+)/i,
    /(?:cost|wholesale|supply|price|@)\s*[:=]?\s*([\d,]+)\s*(?:ksh|kes)\b/i,
    /\b(\d{2,6})\s*ksh\b/i,
    /\b(\d{2,6})\s*(?:ksh|kes)\b/i,
    /\b(?:ksh|kes)\s*(\d{2,6})\b/i,
    /\b(\d{2,6})\s*(?:\/|per)\s*(?:shoe|pair|pc|piece|item|unit)\b/i,
    /\b(\d{2,6})\s*k\b/i,
    /\b([\d]{2,7})\b/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Math.round(Number(String(m[1]).replace(/,/g, "")));
      if (n >= 10 && n <= 5_000_000) return n;
    }
  }
  return null;
}

function parseCaptionHints(caption = "") {
  const t = String(caption || "").trim();
  const lower = t.toLowerCase();
  const hints = {
    cost: parseCost(t),
    category: null,
    subcategory: null,
    nameHint: "",
    isSecondhand: /pre-?loved|thrift|secondhand|used|mtumba|vintage/i.test(lower),
  };

  if (/women|ladies|female|girl|woman/.test(lower)) {
    hints.category = "fashion";
    hints.subcategory = "womens-fashion";
  } else if (/men|gents|male|man\b/.test(lower)) {
    hints.category = "fashion";
    hints.subcategory = "mens-fashion";
  }

  if (/shoe|sandal|slide|footwear|flat|heel|sneaker|boot/.test(lower)) {
    hints.category = "fashion";
    hints.subcategory = "shoes";
  }

  if (/phone|tecno|samsung|charger|power\s*bank/.test(lower)) hints.category = "phones-tablets";
  if (/perfume|lotion|makeup|beauty/.test(lower)) hints.category = "health-beauty";

  const namePart = t
    .replace(/(?:cost|wholesale|supply|price|@)\s*[:=]?\s*ksh?\s*[\d,]+/gi, "")
    .replace(/\b\d{2,6}\s*(?:ksh|kes|k)\b/gi, "")
    .replace(/\b\d{2,6}\s*(?:\/|per)\s*(?:shoe|pair|pc|piece|item|unit)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (namePart.length > 2) hints.nameHint = namePart;

  return hints;
}

export function inferCategory(name) {
  const hay = normalizeName(name);
  let best = { category: "home-office", score: 0 };
  for (const row of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const w of row.words) if (hay.includes(w)) score += 1;
    if (score > best.score) best = { category: row.category, score };
  }
  return best.category;
}

export function slugifySubcategory(name, category) {
  const words = normalizeName(name).split(/\s+/).slice(0, 2).join("-");
  return words || category;
}

function normalizeSubcategory(category, subcategory, name) {
  const sub = String(subcategory || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (sub && sub.length > 1) return sub;
  return slugifySubcategory(name, category);
}

const CONDITION_ALIASES = {
  brand_new_with_tags: "brand_new_with_tags",
  "brand new with tags": "brand_new_with_tags",
  bnwt: "brand_new_with_tags",
  brand_new_without_tags: "brand_new_without_tags",
  "brand new without tags": "brand_new_without_tags",
  brand_new: "brand_new_without_tags",
  "brand new": "brand_new_without_tags",
  new: "brand_new_without_tags",
  like_new: "like_new",
  "like new": "like_new",
  excellent: "like_new",
  gently_used: "gently_used",
  "gently used": "gently_used",
  good: "gently_used",
  used: "gently_used",
  "pre-loved": "gently_used",
  preloved: "gently_used",
  "pre loved": "gently_used",
  thrift: "gently_used",
  fair_condition: "fair_condition",
  "fair condition": "fair_condition",
  fair: "fair_condition",
  well_loved: "fair_condition",
  "well loved": "fair_condition",
};

function normalizeCondition(raw) {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const underscored = key.replace(/\s+/g, "_");
  return (
    CONDITION_ALIASES[key] ||
    CONDITION_ALIASES[underscored] ||
    (VALID_CONDITIONS.includes(underscored) ? underscored : null)
  );
}

function inferConditionFromHints(name, isSecondhand) {
  if (isSecondhand) return "gently_used";
  const hay = normalizeName(name);
  if (/with tags|bnwt|brand new with tags/.test(hay)) return "brand_new_with_tags";
  if (/brand new|bnwot|unworn|deadstock/.test(hay)) return "brand_new_without_tags";
  if (/like new|excellent/.test(hay)) return "like_new";
  if (/fair|worn|faded|stain/.test(hay)) return "fair_condition";
  // Sokoni is thrift-first — don't invent "brand new" when the photo is ambiguous.
  return "gently_used";
}

/** Drop placeholder brands / empty strings the model invents when nothing is readable. */
function sanitizeOptionalLabel(value, maxLen = 60) {
  const s = String(value || "").trim();
  if (!s) return undefined;
  if (/^(unknown|n\/?a|none|null|undefined|not visible|unreadable|no brand|blank)$/i.test(s)) {
    return undefined;
  }
  return s.slice(0, maxLen);
}

function isValidBrowsePath(tax, browseCategory, browseSubCategory) {
  const cat = tax.BROWSE_TAXONOMY.find((c) => c.id === browseCategory);
  if (!cat || cat.navOnly) return false;
  return Boolean(cat.subcategories?.some((s) => s.id === browseSubCategory));
}

export async function resolveBrowsePath({ category, subcategory, browseCategory, browseSubCategory, name = "", caption = "" }) {
  const tax = await getTaxonomy();
  if (browseCategory && browseSubCategory && isValidBrowsePath(tax, browseCategory, browseSubCategory)) {
    return { browse: browseCategory, sub: browseSubCategory };
  }

  // AI sometimes puts legacy ids (fashion) into browse fields — remap instead of trusting.
  const mapped = tax.mapLegacyToBrowse(category, subcategory);
  const hay = normalizeName(`${name} ${caption}`);
  if (/\bwomen\b|\bladies\b|\bfemale\b|\bgirl\b/.test(hay)) {
    const sub = mapped.sub === "sneakers" ? "shoes" : mapped.sub;
    const browse = "women";
    if (isValidBrowsePath(tax, browse, sub)) return { browse, sub };
    return { browse: "women", sub: "tops" };
  }
  if (/\bmen\b|\bgents\b|\bmale\b|\bman\b/.test(hay) && !/\bwomen\b/.test(hay)) {
    const sub = mapped.sub === "shoes" ? "sneakers" : mapped.sub;
    const browse = "men";
    if (isValidBrowsePath(tax, browse, sub)) return { browse, sub };
    return { browse: "men", sub: "t-shirts" };
  }
  if (/kid|baby|child|toddler|infant/.test(hay)) {
    if (/\bshoe|sneaker|boot|sandal|trainer\b/.test(hay)) return { browse: "kids", sub: "shoes" };
    if (/\btoy|lego|doll|puzzle\b/.test(hay)) return { browse: "kids", sub: "toys" };
    if (/\bbaby|stroller|pram|cot\b/.test(hay)) return { browse: "kids", sub: "baby-gear" };
    if (/\bschool|uniform\b/.test(hay)) return { browse: "kids", sub: "school-wear" };
    return { browse: "kids", sub: "clothing" };
  }
  if (/\b(tv|television|smart\s*tv)\b/.test(hay)) return { browse: "electronics", sub: "tvs-audio" };
  if (/\b(console|playstation|xbox|nintendo|controller|gaming)\b/.test(hay)) {
    return { browse: "electronics", sub: "gaming" };
  }
  if (/\b(power\s*bank|phone\s*case|charger|earbud|airpod|phone\s*accessor)\b/.test(hay)) {
    return { browse: "electronics", sub: "phones" };
  }
  if (/\b(laptop|notebook\s*pc|macbook)\b/.test(hay)) return { browse: "electronics", sub: "computing" };
  if (/\b(camera|dslr|mirrorless)\b/.test(hay)) return { browse: "electronics", sub: "cameras" };
  if (/\b(fridge|freezer|fan|air\s*con|ac\s*unit|washing\s*machine|blender)\b/.test(hay)) {
    return { browse: "electronics", sub: "appliances" };
  }
  if (/\b(dog|cat|pet\s*food|leash|collar)\b/.test(hay)) return { browse: "pets", sub: "pet-food" };
  if (/\b(plant|seedling|garden\s*tool|hose)\b/.test(hay)) return { browse: "garden", sub: "plants" };
  if (/\b(notebook|pen|stationery|textbook)\b/.test(hay)) return { browse: "office", sub: "stationery" };
  if (/\b(tusker|whitecap|guinness|local\s*beer|kenya\s*beer|\bbeer\b)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "local-beer" };
  }
  if (/\b(kenya\s*cane|kenyan\s*spirit|chrome\s*vodka|chrome)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "kenyan-spirits" };
  }
  if (/\b(red\s*wine|merlot|cabernet|shiraz)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "red-wine" };
  }
  if (/\b(white\s*wine|sauvignon|chardonnay)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "white-wine" };
  }
  if (/\b(champagne|prosecco|sparkling\s*wine)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "sparkling-champagne" };
  }
  if (/\b(whisky|whiskey|johnnie|jameson|scotch)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "whisky" };
  }
  if (/\b(\bgin\b|gordons|tanqueray)\b/.test(hay)) return { browse: "wines-spirits", sub: "gin" };
  if (/\b(vodka|smirnoff)\b/.test(hay)) return { browse: "wines-spirits", sub: "vodka" };
  if (/\b(cognac|brandy|hennessy|remy)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "cognac-brandy" };
  }
  if (/\b(\brum\b|bacardi|captain\s*morgan)\b/.test(hay)) return { browse: "wines-spirits", sub: "rum" };
  if (/\b(cider|rtd|ready[- ]to[- ]drink|snapp)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "cider-rtd" };
  }
  if (/\b(liqueur|baileys|amarula)\b/.test(hay)) return { browse: "wines-spirits", sub: "liqueurs" };
  if (/\b(mixer|tonic|soda\s*water|bitter\s*lemon)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "mixers" };
  }
  if (/\b(party\s*pack|crate|case\s*of\s*beer|dozen\s*beer)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "party-packs" };
  }
  if (/\b(non[- ]?alcoholic|alcohol[- ]free|0%\s*alcohol)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "non-alcoholic" };
  }
  if (/\b(\bwine\b|wines|spirits?|liquor|alcohol)\b/.test(hay)) {
    return { browse: "wines-spirits", sub: "red-wine" };
  }
  if (/\b(nyama\s*choma|choma|mbuzi|nyama)\b/.test(hay)) {
    return { browse: "restaurant", sub: "nyama-choma" };
  }
  if (/\b(ugali|sukuma)\b/.test(hay)) return { browse: "restaurant", sub: "ugali-plates" };
  if (/\b(pilau|biryani)\b/.test(hay)) return { browse: "restaurant", sub: "pilau-biryani" };
  if (/\b(chapati|mahamri|mandazi)\b/.test(hay)) return { browse: "restaurant", sub: "chapati-meals" };
  if (/\b(githeri|matumbo|stew|soup)\b/.test(hay)) return { browse: "restaurant", sub: "githeri-stews" };
  if (/\b(tilapia|fish|samaki|seafood)\b/.test(hay)) return { browse: "restaurant", sub: "fish-seafood" };
  if (/\b(mutura|smokie|viazi|street\s*food|kibanda)\b/.test(hay)) {
    return { browse: "restaurant", sub: "street-bites" };
  }
  if (/\b(vegan|plant[- ]based)\b/.test(hay)) return { browse: "restaurant", sub: "vegan-plant" };
  if (/\b(diet|keto|low[- ]carb|diabetic)\b/.test(hay)) return { browse: "restaurant", sub: "diet-meals" };
  if (/\b(juice|smoothie|uji)\b/.test(hay)) return { browse: "restaurant", sub: "fresh-juices" };
  if (/\b(catering|platter|buffet)\b/.test(hay)) return { browse: "restaurant", sub: "catering-platters" };
  if (/\b(breakfast|brunch)\b/.test(hay)) return { browse: "restaurant", sub: "breakfast" };
  if (/\b(lunch\s*box|meal\s*prep)\b/.test(hay)) return { browse: "restaurant", sub: "lunch-boxes" };
  if (/\b(dessert|cake|sweet)\b/.test(hay)) return { browse: "restaurant", sub: "desserts" };
  if (/\b(chicken|kuku)\b/.test(hay) && /\b(meal|dish|plate|fried|stew)\b/.test(hay)) {
    return { browse: "restaurant", sub: "chicken-dishes" };
  }
  if (isValidBrowsePath(tax, mapped.browse, mapped.sub)) return mapped;
  return { browse: "trending", sub: "streetwear" };
}

async function buildListingPrompt(caption = "") {
  const tax = await getTaxonomy();
  const sellerTax =
    typeof tax.sellerBrowseTaxonomy === "function"
      ? tax.sellerBrowseTaxonomy()
      : tax.BROWSE_TAXONOMY.filter((c) => !c.navOnly);
  const browseLines = sellerTax
    .map((c) => `- ${c.id}: ${(c.subcategories || []).map((s) => s.id).join(", ")}`)
    .join("\n");
  const capHints = caption ? parseCaptionHints(caption) : null;

  return (
    `You are a Sokoni Mall listing assistant (Kenya) — fashion thrift AND local brand-new goods.\n` +
    `Look ONLY at what is visible in the product photo. Do NOT invent brands, sizes, colours, or details you cannot see.\n` +
    `If something is unclear, use null — never guess.\n\n` +
    `Reply with ONLY a JSON object (no markdown fences).\n\n` +
    `Required fields:\n` +
    `1. name — short English title from what you see (type + colour + style). Include brand ONLY if a logo/label is readable.\n` +
    `2. sellerNetKes — integer KES the seller receives.\n` +
    (capHints?.cost != null
      ? `   Caption already has the price: use ${capHints.cost} exactly. Ignore any sticker that differs.\n`
      : `   Use a readable price sticker/tag if present; otherwise 0.\n`) +
    `3. browseCategory + browseSubCategory — MUST be ids from BROWSE PATHS below (not free text, not "fashion").\n` +
    `   Matching tips:\n` +
    `   - Kids footwear → kids / shoes (never women/shoes heels).\n` +
    `   - Phone chargers, cases, cables → electronics / phones (caption may say accessories).\n` +
    `   - Power banks → electronics / phones.\n` +
    `   - TVs → electronics / tvs-audio; consoles/controllers → electronics / gaming.\n` +
    `   - Fans, AC, fridge cooling → electronics / appliances.\n` +
    `   - Cameras → electronics / cameras; plugs/smart bulbs → electronics / smart-home.\n` +
    `   - Pet food/collars → pets; notebooks/pens → office; plants/tools → garden.\n` +
    `   - Skirts/jumpsuits/sleepwear → women; trousers/shorts/jackets → men.\n` +
    `   - Kenyan meals/food (nyama choma, ugali, pilau, chapati, githeri, street bites, juices) → restaurant + matching sub.\n` +
    `   - Prefer Kenya dishes/diets — not foreign restaurant chains or import cuisine labels.\n` +
    `   - Beer, wine, whisky, gin, vodka, Kenya Cane, champagne, mixers → wines-spirits + matching sub (Kenya liquor aisle).\n` +
    `   - Soft drinks alone stay supermarket/beverages; alcohol & bar stock → wines-spirits.\n` +
    `4. category — one of: ${VALID_CATEGORIES.join(", ")}\n` +
    `5. subcategory — short legacy slug (e.g. shoes, mens-fashion, womens-fashion)\n` +
    `6. condition — exactly one of: ${VALID_CONDITIONS.join(", ")}\n` +
    `   Prefer gently_used / like_new for worn thrift. Use brand_new_* only if tags/packaging clearly show new.\n` +
    `7. isSecondhand — true unless clearly brand-new with packaging/tags\n` +
    `8. brand — string or null (null if logo not readable)\n` +
    `9. color — dominant colour string or null\n` +
    `10. size — size label if visible on tag/item (e.g. "M", "UK 9", "32W/32L"), else null\n` +
    `11. tags — array of up to 5 short vibe tags from the photo (e.g. ["vintage","denim","90s"]), else []\n` +
    `12. description — 1–2 factual sentences about the item in the photo (no marketing fluff)\n` +
    `13. Optional flat measurements in inches if garment is laid flat and measurable: pitToPitIn, lengthIn, waistIn (numbers or null)\n` +
    `Do NOT suggest shipping fees or weight classes — sellers arrange delivery themselves.\n\n` +
    `BROWSE PATHS (browseCategory / browseSubCategory — pick ONLY from this list):\n${browseLines}\n\n` +
    (caption ? `Seller caption (hints only): "${caption}"\n\n` : "") +
    `Example JSON:\n` +
    `{"name":"Navy Nike Hoodie","sellerNetKes":2500,"category":"fashion","subcategory":"mens-fashion","browseCategory":"men","browseSubCategory":"hoodies","condition":"gently_used","isSecondhand":true,"brand":"Nike","color":"navy","size":"L","tags":["vintage","streetwear","90s"],"description":"Navy Nike pullover hoodie with visible swoosh. Light wear at cuffs.","pitToPitIn":22,"lengthIn":28,"waistIn":null}`
  );
}

function applyCaptionToDraft(parsed, caption = "") {
  const hints = parseCaptionHints(caption);
  const capCost = parseCost(caption);
  // Caption/form price always wins when present — don't let a wrong sticker OCR overwrite it.
  if (capCost != null) {
    parsed.sourcePriceKes = capCost;
    parsed.sellerNetKes = capCost;
  } else if (hints.cost != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0)) {
    parsed.sourcePriceKes = hints.cost;
    parsed.sellerNetKes = hints.cost;
  }
  if (hints.category && !VALID_CATEGORIES.includes(parsed.category)) {
    parsed.category = hints.category;
  }
  // Only fill subcategory from caption when AI left it empty/invalid — don't clobber a good vision read.
  const aiSub = String(parsed.subcategory || "").trim();
  if (hints.subcategory && (!aiSub || aiSub.length < 2)) {
    parsed.subcategory = hints.subcategory;
  }
  if (hints.nameHint && (!parsed.name || parsed.name.length < 4 || /^product listing$/i.test(parsed.name))) {
    parsed.name = hints.nameHint;
  }
  if (hints.isSecondhand) parsed.isSecondhand = true;
  return parsed;
}

function normalizeOptionalInches(value) {
  if (value == null || value === "") return undefined;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 10) / 10;
}

function normalizeTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[,;#]+/)
        .map((t) => t.trim());
  return list
    .map((t) => String(t || "").replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
}

export async function finalizeListingDraft(parsed, caption = "") {
  // Alias price fields before caption merge / validation.
  if (parsed.sellerNetKes != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0)) {
    parsed.sourcePriceKes = parsed.sellerNetKes;
  }
  if (parsed.sourcePriceKes != null && (parsed.sellerNetKes == null || parsed.sellerNetKes <= 0)) {
    parsed.sellerNetKes = parsed.sourcePriceKes;
  }

  applyCaptionToDraft(parsed, caption);

  if (!parsed.name || String(parsed.name).trim().length < 3) {
    throw new Error("Could not identify product — add a short caption e.g. `130 ksh women sandals`");
  }

  if (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0) {
    const capCost = parseCost(caption);
    if (capCost != null) parsed.sourcePriceKes = capCost;
    else throw new Error("No price found — add your price on the sell form, or a caption e.g. `130 ksh`");
  }

  if (!VALID_CATEGORIES.includes(parsed.category)) parsed.category = inferCategory(parsed.name);
  parsed.subcategory = normalizeSubcategory(parsed.category, parsed.subcategory, parsed.name);
  parsed.sourcePriceKes = Math.round(Number(parsed.sourcePriceKes));

  const mappedCondition = normalizeCondition(parsed.condition);
  if (mappedCondition) parsed.condition = mappedCondition;
  else parsed.condition = inferConditionFromHints(parsed.name, Boolean(parsed.isSecondhand));
  parsed.isSecondhand =
    Boolean(parsed.isSecondhand) ||
    ["gently_used", "fair_condition", "like_new"].includes(parsed.condition);

  const browse = await resolveBrowsePath({
    category: parsed.category,
    subcategory: parsed.subcategory,
    browseCategory: parsed.browseCategory,
    browseSubCategory: parsed.browseSubCategory,
    name: parsed.name,
    caption,
  });
  parsed.browseCategory = browse.browse;
  parsed.browseSubCategory = browse.sub;

  // Prefer caption price when present; otherwise keep AI sellerNet/sourcePrice.
  const capCost = parseCost(caption);
  const sellerNet = Math.round(
    Number(capCost != null ? capCost : parsed.sellerNetKes ?? parsed.sourcePriceKes) || 0
  );
  parsed.sellerNetKes = sellerNet;
  parsed.sourcePriceKes = sellerNet;
  parsed.priceKes = sellerNet;

  parsed.brand = sanitizeOptionalLabel(parsed.brand, 60);
  parsed.color = sanitizeOptionalLabel(parsed.color, 40);
  parsed.size = sanitizeOptionalLabel(parsed.size, 40);
  parsed.tags = normalizeTags(parsed.tags);
  parsed.pitToPitIn = normalizeOptionalInches(parsed.pitToPitIn);
  parsed.lengthIn = normalizeOptionalInches(parsed.lengthIn);
  parsed.waistIn = normalizeOptionalInches(parsed.waistIn);

  const desc = String(parsed.description || "").trim();
  if (!desc || /100% prepaid across Kenya/i.test(desc)) {
    const bits = [parsed.name];
    if (parsed.color) bits.push(`Colour: ${parsed.color}.`);
    if (parsed.size) bits.push(`Size ${parsed.size}.`);
    if (parsed.condition === "gently_used") bits.push("Pre-loved condition.");
    parsed.description = bits.join(" ").slice(0, 2000);
  } else {
    parsed.description = desc.slice(0, 2000);
  }

  Object.assign(parsed, applyAiShippingSuggestion(parsed));

  return parsed;
}

/** Seller draft or API submit — enrich with browse path + condition defaults. */
export async function enrichManualDraft(draft, caption = "") {
  const base = { ...draft };
  if (caption) applyCaptionToDraft(base, caption);
  if (!VALID_CATEGORIES.includes(base.category)) base.category = inferCategory(base.name);
  base.subcategory = normalizeSubcategory(base.category, base.subcategory, base.name);
  const mappedCondition = normalizeCondition(base.condition);
  if (mappedCondition) base.condition = mappedCondition;
  else base.condition = inferConditionFromHints(base.name, Boolean(base.isSecondhand));
  base.isSecondhand = Boolean(base.isSecondhand);
  const browse = await resolveBrowsePath({
    category: base.category,
    subcategory: base.subcategory,
    browseCategory: base.browseCategory,
    browseSubCategory: base.browseSubCategory,
    name: base.name,
    caption,
  });
  base.browseCategory = browse.browse;
  base.browseSubCategory = browse.sub;
  const sellerNet = Math.round(Number(base.sellerNetKes ?? base.priceKes ?? base.sourcePriceKes) || 0);
  base.sellerNetKes = sellerNet;
  base.sourcePriceKes = sellerNet;
  base.priceKes = sellerNet;
  if (base.shippingKes != null || base.freeShipping) {
    Object.assign(base, applyAiShippingSuggestion(base));
  } else {
    Object.assign(base, applyAiShippingSuggestion({ name: base.name }));
  }
  return base;
}

export function applyListingFieldsToProduct(product, draft) {
  if (draft.name) product.name = draft.name;
  if (draft.category) product.category = draft.category;
  if (draft.subcategory) product.subcategory = draft.subcategory;
  if (draft.browseCategory) product.browseCategory = draft.browseCategory;
  if (draft.browseSubCategory) product.browseSubCategory = draft.browseSubCategory;
  if (draft.condition) product.condition = draft.condition;
  if (draft.isSecondhand != null) product.isSecondhand = Boolean(draft.isSecondhand);
  if (draft.brand) product.brand = draft.brand;
  if (draft.color) product.color = draft.color;
  if (draft.size) product.size = draft.size;
  if (Array.isArray(draft.tags) && draft.tags.length) product.tags = draft.tags.slice(0, 5);
  if (draft.pitToPitIn != null) product.pitToPitIn = Number(draft.pitToPitIn);
  if (draft.lengthIn != null) product.lengthIn = Number(draft.lengthIn);
  if (draft.waistIn != null) product.waistIn = Number(draft.waistIn);
  if (draft.description) product.description = draft.description;
  if (draft.sourcePriceKes != null || draft.sellerNetKes != null || draft.priceKes != null) {
    const sellerNet = Math.round(Number(draft.sellerNetKes ?? draft.sourcePriceKes ?? draft.priceKes) || 0);
    product.sellerNetKes = sellerNet;
    product.sourcePriceKes = sellerNet;
    const fees = computeFeeBreakdown(sellerNet, product.shippingKes ?? draft.shippingKes, {
      freeShipping: product.freeShipping ?? draft.freeShipping,
      deliveryMethod: product.deliveryMethod ?? draft.deliveryMethod,
    });
    product.priceKes = fees.buyerTotalKes;
    product.platformFeeKes = fees.platformFeeKes;
    if (fees.transactionFeeKes != null) product.transactionFeeKes = fees.transactionFeeKes;
  }
  if (draft.shippingKes != null) product.shippingKes = Math.round(Number(draft.shippingKes));
  if (draft.freeShipping != null) product.freeShipping = Boolean(draft.freeShipping);
  if (draft.estimatedWeightClass) product.estimatedWeightClass = draft.estimatedWeightClass;
  return product;
}

export async function formatListingBrowseLabel(product) {
  const tax = await getTaxonomy();
  const cat = tax.BROWSE_TAXONOMY.find((c) => c.id === product.browseCategory);
  const sub = cat?.subcategories?.find((s) => s.id === product.browseSubCategory);
  if (cat && sub) return `${cat.label} → ${sub.label}`;
  if (cat) return cat.label;
  return product.browseCategory || "";
}

/**
 * Generate a listing draft from a product photo.
 * Order: OpenRouter (primary) → NVIDIA NIM (random free VLMs) → Gemini → caption stub.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} [caption]
 */
export async function generateListingFromImage(buffer, mimetype, caption = "") {
  const prompt = await buildListingPrompt(caption);
  let lastError = null;

  const client = getVisionClient();
  if (client) {
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimetype || "image/jpeg"};base64,${base64}`;
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    for (const model of visionModelChain()) {
      // Skip known image-generation models that cannot describe photos.
      if (/^krea\//i.test(model) || /image-gen|flux|dall-e|stable-diffusion/i.test(model)) {
        console.warn(`[listing-generator] skipping non-vision model: ${model}`);
        continue;
      }
      try {
        const response = await client.chat.completions.create({
          model,
          messages,
          max_tokens: 1200,
          temperature: 0.05,
        });

        const raw = response.choices[0]?.message?.content?.trim() || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Vision model returned no JSON");
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.sellerNetKes != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0)) {
          parsed.sourcePriceKes = parsed.sellerNetKes;
        }
        if (parsed.error && (!caption || !parseCost(caption))) throw new Error(parsed.error);

        await finalizeListingDraft(parsed, caption);
        console.log(
          `[listing-generator] ok via openrouter/${model}:`,
          parsed.name,
          parsed.sourcePriceKes,
          parsed.browseCategory,
          parsed.browseSubCategory
        );
        return parsed;
      } catch (err) {
        lastError = err;
        console.warn(`[listing-generator] openrouter failed (${model}):`, err.message);
      }
    }
  } else if (!lastError) {
    lastError = new Error("OPENAI_API_KEY not set — OpenRouter vision unavailable");
  }

  // NVIDIA NIM — free VLMs when OpenRouter is rate-limited / out of tokens.
  if (nvidiaVisionAvailable()) {
    try {
      const { parsed, model } = await nvidiaVisionListingJson({
        prompt,
        imageBuffer: buffer,
        mimeType: mimetype,
      });
      if (parsed.error && (!caption || !parseCost(caption))) throw new Error(String(parsed.error));
      if (parsed.sellerNetKes != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0)) {
        parsed.sourcePriceKes = parsed.sellerNetKes;
      }
      await finalizeListingDraft(parsed, caption);
      console.log(
        `[listing-generator] ok via nvidia/${model}:`,
        parsed.name,
        parsed.sourcePriceKes,
        parsed.browseCategory,
        parsed.browseSubCategory
      );
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn("[listing-generator] NVIDIA vision failed:", err.message);
    }
  }

  // Gemini direct API — second fallback (generous free tier).
  if (geminiVisionAvailable()) {
    try {
      const { parsed, model } = await geminiVisionListingJson({
        prompt,
        imageBuffer: buffer,
        mimeType: mimetype,
      });
      if (parsed.error && (!caption || !parseCost(caption))) throw new Error(String(parsed.error));
      await finalizeListingDraft(parsed, caption);
      console.log(
        `[listing-generator] ok via gemini/${model}:`,
        parsed.name,
        parsed.sourcePriceKes,
        parsed.browseCategory,
        parsed.browseSubCategory
      );
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn("[listing-generator] Gemini vision failed:", err.message);
    }
  }

  const capCost = parseCost(caption);
  const hints = parseCaptionHints(caption);
  // Caption-only fallback only when we have a real name hint — never invent "fashion" silently.
  if (capCost != null && hints.nameHint && hints.nameHint.length > 3) {
    try {
      const stub = {
        name: hints.nameHint,
        sourcePriceKes: capCost,
        sellerNetKes: capCost,
        category: hints.category || inferCategory(hints.nameHint),
        subcategory: hints.subcategory,
        isSecondhand: hints.isSecondhand,
        condition: hints.isSecondhand ? "gently_used" : undefined,
      };
      await finalizeListingDraft(stub, caption);
      console.log("[listing-generator] caption-only fallback:", stub.name, stub.sourcePriceKes);
      return stub;
    } catch (capErr) {
      lastError = capErr;
    }
  }

  throw new Error(friendlyListingVisionError(lastError));
}

/** Never leak raw Gemini/NVIDIA/OpenRouter auth payloads to the sell page. */
export function friendlyListingVisionError(err) {
  const msg = String(err?.message || "");
  if (/401|invalid authentication|UNAUTH|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return "AI draft unavailable right now — keep your price, fill the details, or try again in a minute.";
  }
  if (/429|rate limit|quota|insufficient/i.test(msg)) {
    return "AI is busy right now — wait a moment and try again, or fill details manually.";
  }
  if (/Gemini|NVIDIA|openrouter|Vision model|no JSON/i.test(msg)) {
    return "Could not read that photo clearly — check the image is sharp, add your price, and fill details manually if needed.";
  }
  if (!msg) {
    return "Could not read that photo clearly — check the image is sharp, add your price, and fill details manually if needed.";
  }
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

/** Build a draft from WhatsApp-style caption only (no photo). */
export async function generateListingFromCaption(caption = "") {
  const hints = parseCaptionHints(caption);
  const stub = {
    name: hints.nameHint || "",
    sourcePriceKes: hints.cost || parseCost(caption) || 0,
    sellerNetKes: hints.cost || parseCost(caption) || 0,
    category: hints.category || (hints.nameHint ? inferCategory(hints.nameHint) : undefined),
    subcategory: hints.subcategory,
    isSecondhand: hints.isSecondhand,
    condition: hints.isSecondhand ? "gently_used" : undefined,
  };
  return finalizeListingDraft(stub, caption);
}
