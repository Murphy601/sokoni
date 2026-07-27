/**
 * Phase 4 — Seller listing photo AI (CATALOG_VISION_MODEL via OpenRouter).
 * Used by sell page + listing studio only — NOT WhatsApp chat (see ai-agent.js).
 */
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { computeRetailPrice } from "./pricing.js";
import { geminiVisionAvailable, geminiVisionListingJson } from "./gemini-vision.js";

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
  return [...new Set([primary, ...fallbacks].filter(Boolean))];
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

function inferConditionFromHints(name, isSecondhand) {
  if (isSecondhand) return "gently_used";
  const hay = normalizeName(name);
  if (/with tags|bnwt|brand new/.test(hay)) return "brand_new_with_tags";
  return "brand_new_without_tags";
}

export async function resolveBrowsePath({ category, subcategory, browseCategory, browseSubCategory, name = "" }) {
  const tax = await getTaxonomy();
  if (browseCategory && browseSubCategory) {
    return { browse: browseCategory, sub: browseSubCategory };
  }
  const mapped = tax.mapLegacyToBrowse(category, subcategory);
  const hay = normalizeName(name);
  if (/\bwomen\b|\bladies\b|\bfemale\b/.test(hay)) {
    return { browse: "women", sub: mapped.sub === "sneakers" ? "shoes" : mapped.sub };
  }
  if (/\bmen\b|\bgents\b|\bmale\b/.test(hay) && !/\bwomen\b/.test(hay)) {
    return { browse: "men", sub: mapped.sub === "shoes" ? "sneakers" : mapped.sub };
  }
  if (/kid|baby|child/.test(hay)) {
    return { browse: "kids", sub: mapped.sub === "shoes" ? "shoes" : "clothing" };
  }
  return mapped;
}

async function buildListingPrompt(caption = "") {
  const tax = await getTaxonomy();
  const categoryLines = VALID_CATEGORIES.map(
    (c) => `- ${c}: subcategories → ${SUBCATEGORY_GUIDE[c] || c}`
  ).join("\n");
  const browseLines = tax.BROWSE_TAXONOMY.map(
    (c) => `- ${c.id}: ${c.subcategories.map((s) => s.id).join(", ")}`
  ).join("\n");
  const capHints = caption ? parseCaptionHints(caption) : null;

  return (
    `You catalog products for Sokoni Mall — a Kenyan WhatsApp marketplace (Depop-style browse).\n` +
    `Study the product photo. Many supplier photos have NO price sticker and NO printed name.\n\n` +
    `TASK — reply ONLY JSON (no markdown):\n` +
    `1. *name* — clear English title (brand if visible, else item type + colour + style)\n` +
    `2. *sourcePriceKes* — store cost in KES (integer)\n` +
    (capHints?.cost != null
      ? `   - Caption price for this batch: use *${capHints.cost}*, ignore stickers.\n`
      : `   - From sticker/tag, caption, or 0 if unknown.\n`) +
    `3. *category* + *subcategory* — legacy catalog (see below)\n` +
    `4. *browseCategory* + *browseSubCategory* — Depop-style drawer path (see BROWSE)\n` +
    `5. *condition* — one of: ${VALID_CONDITIONS.join(", ")}\n` +
    `6. *isSecondhand* — true for thrift/pre-loved/vintage, else false\n` +
    `7. *brand*, *color* — strings or null\n` +
    `8. *description* — 1–2 sentence shopper-friendly description\n\n` +
    `LEGACY CATEGORIES:\n${categoryLines}\n\n` +
    `BROWSE PATHS (browseCategory / browseSubCategory):\n${browseLines}\n\n` +
    (caption ? `WhatsApp caption: "${caption}"\n\n` : "") +
    `Example:\n` +
    `{"name":"Women's Rhinestone Flat Sandals - Burgundy","sourcePriceKes":130,"category":"fashion","subcategory":"shoes","browseCategory":"women","browseSubCategory":"shoes","condition":"brand_new_without_tags","isSecondhand":false,"brand":null,"color":"burgundy","description":"Flat sandals with rhinestone detail. 100% prepaid across Kenya."}`
  );
}

function applyCaptionToDraft(parsed, caption = "") {
  const hints = parseCaptionHints(caption);
  const capCost = parseCost(caption);
  if (capCost != null) {
    parsed.sourcePriceKes = capCost;
  } else if (hints.cost != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes === 0)) {
    parsed.sourcePriceKes = hints.cost;
  }
  if (hints.category && !VALID_CATEGORIES.includes(parsed.category)) {
    parsed.category = hints.category;
  }
  if (hints.subcategory) parsed.subcategory = hints.subcategory;
  if (hints.nameHint && (!parsed.name || parsed.name.length < 4)) {
    parsed.name = hints.nameHint;
  }
  if (hints.isSecondhand) parsed.isSecondhand = true;
  return parsed;
}

export async function finalizeListingDraft(parsed, caption = "") {
  applyCaptionToDraft(parsed, caption);

  if (!parsed.name || String(parsed.name).trim().length < 3) {
    throw new Error("Could not identify product — add a short caption e.g. `130 ksh women sandals`");
  }

  if (!parsed.sourcePriceKes || parsed.sourcePriceKes <= 0) {
    const capCost = parseCost(caption);
    if (capCost != null) parsed.sourcePriceKes = capCost;
    else throw new Error("No price found — add caption e.g. `130 ksh per shoe` or `cost 130`");
  }

  if (!VALID_CATEGORIES.includes(parsed.category)) parsed.category = inferCategory(parsed.name);
  parsed.subcategory = normalizeSubcategory(parsed.category, parsed.subcategory, parsed.name);
  parsed.sourcePriceKes = Math.round(Number(parsed.sourcePriceKes));

  if (!VALID_CONDITIONS.includes(parsed.condition)) {
    parsed.condition = inferConditionFromHints(parsed.name, Boolean(parsed.isSecondhand));
  }
  parsed.isSecondhand = Boolean(parsed.isSecondhand) || ["gently_used", "fair_condition", "like_new"].includes(parsed.condition);

  const browse = await resolveBrowsePath({
    category: parsed.category,
    subcategory: parsed.subcategory,
    browseCategory: parsed.browseCategory,
    browseSubCategory: parsed.browseSubCategory,
    name: parsed.name,
  });
  parsed.browseCategory = browse.browse;
  parsed.browseSubCategory = browse.sub;
  parsed.priceKes = computeRetailPrice(parsed.sourcePriceKes);

  if (!parsed.description) {
    parsed.description = `${parsed.name}. 100% prepaid across Kenya.`;
  }

  return parsed;
}

/** Seller draft or API submit — enrich with browse path + condition defaults. */
export async function enrichManualDraft(draft, caption = "") {
  const base = { ...draft };
  if (caption) applyCaptionToDraft(base, caption);
  if (!VALID_CATEGORIES.includes(base.category)) base.category = inferCategory(base.name);
  base.subcategory = normalizeSubcategory(base.category, base.subcategory, base.name);
  if (!VALID_CONDITIONS.includes(base.condition)) {
    base.condition = inferConditionFromHints(base.name, Boolean(base.isSecondhand));
  }
  base.isSecondhand = Boolean(base.isSecondhand);
  const browse = await resolveBrowsePath({
    category: base.category,
    subcategory: base.subcategory,
    browseCategory: base.browseCategory,
    browseSubCategory: base.browseSubCategory,
    name: base.name,
  });
  base.browseCategory = browse.browse;
  base.browseSubCategory = browse.sub;
  const listingPrice = Math.round(Number(base.priceKes) || 0);
  base.sourcePriceKes = Math.round(Number(base.sourcePriceKes) || 0);
  if (listingPrice > 0) {
    base.priceKes = listingPrice;
    if (!base.sourcePriceKes) base.sourcePriceKes = Math.round(listingPrice * 0.92);
  } else if (base.sourcePriceKes > 0) {
    base.priceKes = computeRetailPrice(base.sourcePriceKes);
  } else {
    base.priceKes = 0;
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
  if (draft.description) product.description = draft.description;
  if (draft.sourcePriceKes != null) {
    product.sourcePriceKes = draft.sourcePriceKes;
    product.priceKes = draft.priceKes != null ? draft.priceKes : computeRetailPrice(draft.sourcePriceKes);
  } else if (draft.priceKes != null) {
    product.priceKes = draft.priceKes;
    product.sourcePriceKes = Math.round(draft.priceKes * 0.92);
  }
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
 * Generate a listing draft from a product photo (OpenRouter vision, then Gemini/caption).
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
      try {
        const response = await client.chat.completions.create({
          model,
          messages,
          max_tokens: 600,
          temperature: 0.1,
        });

        const raw = response.choices[0]?.message?.content?.trim() || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Vision model returned no JSON");
        const parsed = JSON.parse(jsonMatch[0]);
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
  } else {
    lastError = new Error("OPENAI_API_KEY not set — OpenRouter vision unavailable");
  }

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
      console.warn("[listing-generator] Gemini vision fallback failed:", err.message);
    }
  }

  const capCost = parseCost(caption);
  const hints = parseCaptionHints(caption);
  if (capCost != null || hints.nameHint) {
    try {
      const stub = {
        name: hints.nameHint || "Product listing",
        sourcePriceKes: capCost || hints.cost || 0,
        category: hints.category || "fashion",
        subcategory: hints.subcategory,
        isSecondhand: hints.isSecondhand,
      };
      await finalizeListingDraft(stub, caption);
      console.log("[listing-generator] caption-only fallback:", stub.name, stub.sourcePriceKes);
      return stub;
    } catch (capErr) {
      lastError = capErr;
    }
  }

  throw lastError || new Error("All vision models failed — add a caption with price e.g. `130 ksh women sandals`");
}

/** Build a draft from WhatsApp-style caption only (no photo). */
export async function generateListingFromCaption(caption = "") {
  const hints = parseCaptionHints(caption);
  const stub = {
    name: hints.nameHint || "",
    sourcePriceKes: hints.cost || parseCost(caption) || 0,
    category: hints.category || "fashion",
    subcategory: hints.subcategory,
    isSecondhand: hints.isSecondhand,
  };
  return finalizeListingDraft(stub, caption);
}
