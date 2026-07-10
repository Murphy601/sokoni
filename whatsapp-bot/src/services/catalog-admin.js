import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import OpenAI from "openai";
import { config } from "../config.js";
import { computeRetailPrice, pricingBreakdown } from "./pricing.js";
import { invalidateProductCache } from "./catalog.js";
import { downloadWahaMedia, sendText, phoneDigitsFromChatId } from "./whatsapp.js";
import { isAdminSender, canRunAdminCommands } from "./admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MASTER_CATALOG = path.join(__dirname, "..", "data", "products.json");
const IMAGES_DIR = path.join(REPO_ROOT, "website", "assets", "images", "products");
const BUILD_SCRIPT = path.join(REPO_ROOT, "scripts", "build-site-catalog.mjs");
const COMMIT_SCRIPT = path.join(REPO_ROOT, "scripts", "commit-catalog.mjs");

/** Admin-only inbox — never customer order chats. */
function resolveAdminNotifyChat(contextChatId = null) {
  if (contextChatId && isAdminSender(contextChatId)) return contextChatId;
  for (const p of config.admin.phones) {
    const id = `${String(p).replace(/\D/g, "")}@c.us`;
    if (isAdminSender(id, p)) return id;
  }
  if (config.admin.primary) {
    return `${String(config.admin.primary).replace(/\D/g, "")}@c.us`;
  }
  return null;
}

/** Catalog ops (cost, sync, OCR) — admin eyes only, never shoppers. */
async function sendAdminOnlyText(contextChatId, text) {
  const to = resolveAdminNotifyChat(contextChatId);
  if (!to || !isAdminSender(to)) {
    console.log("[catalog-admin] admin notify skipped");
    return;
  }
  await sendText(to, text);
}

const CATEGORY_PREFIX = {
  "phones-tablets": "pt",
  "tvs-audio": "ta",
  appliances: "ap",
  "health-beauty": "hb",
  "home-office": "ho",
  fashion: "fa",
  computing: "co",
  gaming: "ga",
  supermarket: "sm",
  "baby-products": "bp",
};

const CATEGORY_EMOJI = {
  "phones-tablets": "📱",
  "tvs-audio": "📺",
  appliances: "🔌",
  "health-beauty": "💄",
  "home-office": "🏠",
  fashion: "👗",
  computing: "💻",
  gaming: "🎮",
  supermarket: "🛒",
  "baby-products": "🍼",
};

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

const VALID_CATEGORIES = Object.keys(CATEGORY_PREFIX);

function visionModelChain() {
  const primary = config.catalog.visionModel?.trim();
  const fallbacks = config.catalog.visionFallbacks || [];
  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function normalizeSubcategory(category, subcategory, name) {
  const sub = String(subcategory || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (sub && sub.length > 1) return sub;
  return slugifySubcategory(name, category);
}

function buildVisionPrompt(caption = "") {
  const categoryLines = VALID_CATEGORIES.map(
    (c) => `- ${c}: subcategories → ${SUBCATEGORY_GUIDE[c] || c}`
  ).join("\n");
  const capHints = caption ? parseCaptionHints(caption) : null;

  return (
    `You catalog products for a Kenyan WhatsApp shop (Sokoni).\n` +
    `Study the product photo carefully — many store photos have NO price sticker and NO printed product name.\n\n` +
    `TASK:\n` +
    `1. *name* — ALWAYS provide a clear English product title:\n` +
    `   - If a brand/label is visible (e.g. NICE STYLE, DLGM), include it.\n` +
    `   - If NO label, DESCRIBE what you see: item type + colour + style/material.\n` +
    `   - Examples: "Women's Rhinestone Flat Sandals - Burgundy", "Men's Leather Slide Sandals - Black", "Assorted Women's Flat Sandals (4 styles)".\n` +
    `   - Multiple items in one photo → one title for the main product type shown.\n` +
    `2. *sourcePriceKes* — store cost in KES (integer):\n` +
    `   - From price sticker/tag if visible.\n` +
    `   - If NO price on image, use the WhatsApp caption price if given.\n` +
    `   - If still unknown, use 0 (caption will be applied after).\n` +
    `3. *category* + *subcategory* — from what the item IS (not only caption):\n` +
    `   - Sandals, slides, shoes, flats → fashion / shoes\n` +
    `   - Women's clothing → fashion / womens-fashion\n` +
    `   - Men's clothing → fashion / mens-fashion\n` +
    `   - Bags, watches → fashion\n` +
    `   - Phones, power banks → phones-tablets\n\n` +
    `CATEGORIES:\n${categoryLines}\n\n` +
    (caption
      ? `WhatsApp caption from seller: "${caption}"\n` +
        (capHints?.cost != null ? `Caption price hint: KES ${capHints.cost}\n` : "") +
        (capHints?.category ? `Caption category hint: ${capHints.category}\n` : "") +
        `\n`
      : "") +
    `Reply ONLY JSON, no markdown. NEVER return error just because there is no price tag — always name the product from the image.\n` +
    `{"name":"Women's Rhinestone Flat Sandals - Burgundy","sourcePriceKes":130,"category":"fashion","subcategory":"shoes"}`
  );
}

function parseCost(text) {
  const t = String(text || "");
  const patterns = [
    /(?:cost|wholesale|supply|price|@)\s*[:=]?\s*ksh?\s*([\d,]+)/i,
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

/** Hints from WhatsApp caption when the photo has no price tag or name. */
function parseCaptionHints(caption = "") {
  const t = String(caption || "").trim();
  const lower = t.toLowerCase();
  const hints = {
    cost: parseCost(t),
    category: null,
    subcategory: null,
    nameHint: "",
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
    hints.subcategory = hints.subcategory === "mens-fashion" ? "shoes" : hints.subcategory === "womens-fashion" ? "shoes" : "shoes";
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

function applyCaptionToDraft(parsed, caption = "") {
  const hints = parseCaptionHints(caption);
  if (hints.cost != null && (!parsed.sourcePriceKes || parsed.sourcePriceKes === 0)) {
    parsed.sourcePriceKes = hints.cost;
  }
  if (hints.category && !VALID_CATEGORIES.includes(parsed.category)) {
    parsed.category = hints.category;
  }
  if (hints.subcategory) {
    parsed.subcategory = hints.subcategory;
  }
  if (hints.nameHint && (!parsed.name || parsed.name.length < 4)) {
    parsed.name = hints.nameHint;
  }
  return parsed;
}

function finalizeVisionDraft(parsed, caption = "") {
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
  return parsed;
}

const CATEGORY_KEYWORDS = [
  { category: "phones-tablets", words: ["phone", "tecno", "samsung", "iphone", "redmi", "infinix", "tablet", "ipad", "power bank", "powerbank", "charger", "case", "cover", "screen guard"] },
  { category: "tvs-audio", words: ["tv", "television", "speaker", "soundbar", "earbud", "headphone", "hisense"] },
  { category: "appliances", words: ["fridge", "freezer", "washing", "microwave", "blender", "cooker", "iron"] },
  { category: "health-beauty", words: ["perfume", "lotion", "cream", "makeup", "soap", "shampoo", "beauty"] },
  { category: "fashion", words: ["dress", "shirt", "shoe", "shoes", "sandal", "slide", "flat", "sneaker", "bag", "jeans", "suit", "women", "ladies", "wear"] },
  { category: "computing", words: ["laptop", "computer", "monitor", "keyboard", "mouse", "printer"] },
  { category: "gaming", words: ["playstation", "xbox", "game", "controller", "ps5", "ps4"] },
  { category: "supermarket", words: ["rice", "flour", "sugar", "oil", "tea", "coffee", "cereal"] },
  { category: "baby-products", words: ["diaper", "pampers", "baby", "stroller", "formula"] },
  { category: "home-office", words: ["chair", "desk", "bed", "mattress", "curtain", "lamp", "furniture"] },
];

/** @type {Array<{ adminChatId: string, task: () => Promise<void> }>} */
const queue = [];
let queueRunning = false;
let publishTimer = null;
let pendingPublishCount = 0;
let lastCatalogAdminChatId = null;

const GIT_SCRIPT_ENV = {
  GIT_AUTHOR_NAME: "sokoni-bot",
  GIT_AUTHOR_EMAIL: "bot@sokonimall.com",
  GIT_COMMITTER_NAME: "sokoni-bot",
  GIT_COMMITTER_EMAIL: "bot@sokonimall.com",
};

export function isCatalogCommand(text) {
  const t = (text || "").trim();
  return /^#(?:catalog|add|price|stock|find|sync)\b/i.test(t);
}

export function isCatalogMedia(mimetype = "") {
  const mt = String(mimetype || "").toLowerCase();
  return mt.startsWith("image/") || mt === "application/pdf";
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeName(value).split(/\s+/).filter((t) => t.length > 1));
}

function nameSimilarity(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap / Math.max(ta.size, tb.size);
}

function inferCategory(name) {
  const hay = normalizeName(name);
  let best = { category: "home-office", score: 0 };
  for (const row of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const w of row.words) if (hay.includes(w)) score += 1;
    if (score > best.score) best = { category: row.category, score };
  }
  return best.category;
}

function slugifySubcategory(name, category) {
  const words = normalizeName(name).split(/\s+/).slice(0, 2).join("-");
  return words || category;
}

function imageKeyForName(name) {
  return createHash("sha256").update(String(name).trim().toLowerCase()).digest("hex").slice(0, 12);
}

async function loadMaster() {
  const raw = await readFile(MASTER_CATALOG, "utf-8");
  return JSON.parse(raw);
}

async function saveMaster(products) {
  await writeFile(MASTER_CATALOG, JSON.stringify(products, null, 2) + "\n", "utf-8");
  invalidateProductCache();
}

function nextProductId(products, category) {
  const prefix = CATEGORY_PREFIX[category] || "ho";
  let max = 0;
  for (const p of products) {
    const m = String(p.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function findStoreProduct(products, query) {
  const q = String(query || "").trim();
  if (!q) return null;

  const byId = products.find((p) => p.id === q.toLowerCase() || p.id === q);
  if (byId) return byId;

  const idMatch = q.match(/\b([a-z]{2}-\d{3})\b/i);
  if (idMatch) {
    const hit = products.find((p) => p.id === idMatch[1].toLowerCase());
    if (hit) return hit;
  }

  let best = null;
  let bestScore = 0;
  for (const p of products) {
    if (p.fulfillment !== "store" && p.scope !== "local") continue;
    const score = nameSimilarity(q, p.name);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 0.45 ? best : null;
}

/** Parse: #add Name | category | cost 12000 */
export function parseAddCommand(text) {
  const raw = text.replace(/^#add\b/i, "").trim();
  if (!raw) return { error: "missing_fields" };

  const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { error: "missing_fields" };

  const name = parts[0];
  let category = null;
  let cost = null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (VALID_CATEGORIES.includes(part)) {
      category = part;
      continue;
    }
    const c = parseCost(part);
    if (c != null) cost = c;
  }

  if (cost == null) cost = parseCost(raw);
  if (!category) category = inferCategory(name);
  if (!name || cost == null) return { error: "missing_fields", name, category, cost };

  return { name, category, sourcePriceKes: cost, subcategory: slugifySubcategory(name, category) };
}

/** Parse: #price pt-001 cost 12000  OR  #price Tecno Spark 12000 */
export function parsePriceCommand(text) {
  const raw = text.replace(/^#price\b/i, "").trim();
  if (!raw) return { error: "missing_fields" };

  const pipeParts = raw.split("|").map((s) => s.trim());
  const query = pipeParts[0];
  const cost = parseCost(pipeParts[1] || raw);
  if (!query || cost == null) return { error: "missing_fields", query, cost };
  return { query, sourcePriceKes: cost };
}

function formatProductAck(product, { updated = false } = {}) {
  const bd = pricingBreakdown(product.sourcePriceKes);
  const verb = updated ? "Updated" : "Added";
  const cat = product.subcategory ? `${product.category} / ${product.subcategory}` : product.category;
  return (
    `✅ *${verb}* \`${product.id}\` · ${product.name}\n` +
    `📂 ${cat}\n` +
    `Cost KES ${bd.supplierPriceKes.toLocaleString()} → Retail *KES ${bd.retailPriceKes.toLocaleString()}*`
  );
}

async function saveProductImage(productId, buffer) {
  if (!existsSync(IMAGES_DIR)) await mkdir(IMAGES_DIR, { recursive: true });
  const filePath = path.join(IMAGES_DIR, `${productId}.jpg`);
  await writeFile(filePath, buffer);
  return `assets/images/products/${productId}.jpg`;
}

async function upsertStoreProduct(draft, imageBuffer = null) {
  const products = await loadMaster();
  const existing = findStoreProduct(products, draft.matchQuery || draft.name);
  const sourcePriceKes = Math.max(0, Number(draft.sourcePriceKes) || 0);
  const retail = computeRetailPrice(sourcePriceKes);
  const category = VALID_CATEGORIES.includes(draft.category) ? draft.category : inferCategory(draft.name);

  let product;
  let updated = false;

  if (existing && (draft.matchQuery || nameSimilarity(existing.name, draft.name) >= 0.45)) {
    product = { ...existing };
    product.name = draft.name || product.name;
    product.sourcePriceKes = sourcePriceKes;
    product.priceKes = retail;
    if (draft.category) product.category = category;
    if (draft.subcategory) product.subcategory = draft.subcategory;
    product.inStock = draft.inStock !== false;
    updated = true;
    const idx = products.findIndex((p) => p.id === product.id);
    products[idx] = product;
  } else {
    const id = nextProductId(products, category);
    product = {
      id,
      name: draft.name,
      category,
      subcategory: draft.subcategory || slugifySubcategory(draft.name, category),
      sourcePriceKes,
      priceKes: retail,
      rating: 4.5,
      reviews: 0,
      source: "Sokoni",
      emoji: CATEGORY_EMOJI[category] || "🛍️",
      tags: [],
      scope: "local",
      fulfillment: "store",
      payment: "cod",
      inStock: true,
    };
    products.push(product);
  }

  if (imageBuffer?.length) {
    product.imageUrl = await saveProductImage(product.id, imageBuffer);
    product.imageKey = imageKeyForName(product.name);
  }

  await saveMaster(products);
  schedulePublish(lastCatalogAdminChatId);
  return { product, updated };
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: { ...process.env, ...GIT_SCRIPT_ENV },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      console.log("[catalog-script]", s.trim());
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      console.error("[catalog-script]", s.trim());
    });
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || out || `exit ${code}`))));
  });
}

function trackCatalogAdmin(adminChatId) {
  if (adminChatId) lastCatalogAdminChatId = adminChatId;
}

function schedulePublish(adminChatId = null) {
  trackCatalogAdmin(adminChatId);
  pendingPublishCount += 1;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    const count = pendingPublishCount;
    pendingPublishCount = 0;
    publishCatalog({ count, adminChatId: lastCatalogAdminChatId }).catch((err) => {
      console.error("[catalog-admin] publish failed:", err.message);
      if (lastCatalogAdminChatId) {
        sendAdminOnlyText(
          lastCatalogAdminChatId,
          `⚠️ *Catalog sync failed*\n${err.message}\n\nRun on server:\n\`node scripts/publish-catalog-now.mjs\`\nOr WhatsApp: *#sync*`
        ).catch(() => {});
      }
    });
  }, config.catalog.publishDebounceMs);
}

/** Force immediate rebuild + git push (admin #sync). */
export async function forcePublishCatalog(adminChatId) {
  trackCatalogAdmin(adminChatId);
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  const count = Math.max(pendingPublishCount, 1);
  pendingPublishCount = 0;
  await sendAdminOnlyText(adminChatId, "⏳ Syncing catalog to website…");
  await publishCatalog({ count, adminChatId });
}

async function publishCatalog({ count = 1, adminChatId = null } = {}) {
  console.log("[catalog-admin] publishing catalog…");
  await runNodeScript(BUILD_SCRIPT);
  if (config.catalog.autoPush) {
    try {
      await runNodeScript(COMMIT_SCRIPT);
      if (adminChatId) {
        await sendAdminOnlyText(
          adminChatId,
          `📦 *Catalog live* — ${count} change${count === 1 ? "" : "s"} synced to site.\n` +
            `_Pushed to GitHub; Cloudflare deploys in ~1–2 min._`
        );
      }
    } catch (err) {
      console.warn("[catalog-admin] git push failed:", err.message);
      if (adminChatId) {
        await sendAdminOnlyText(
          adminChatId,
          `⚠️ Catalog saved locally but git push failed.\nRun on server:\n\`node scripts/commit-catalog.mjs\``
        );
      }
    }
  } else if (adminChatId) {
    await sendAdminOnlyText(
      adminChatId,
      `📦 Catalog rebuilt (${count} item${count === 1 ? "" : "s"}).\n` +
        `_Set CATALOG_AUTO_PUSH=true on server to auto-publish to site._`
    );
  }
}

let visionClient = null;
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

async function extractFromImage(buffer, mimetype, caption = "") {
  const client = getVisionClient();
  if (!client) throw new Error("OPENAI_API_KEY not set — vision OCR unavailable");

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimetype || "image/jpeg"};base64,${base64}`;
  const prompt = buildVisionPrompt(caption);
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  let lastError = null;
  for (const model of visionModelChain()) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 400,
        temperature: 0.1,
      });

      const raw = response.choices[0]?.message?.content?.trim() || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Vision model returned no JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error && (!caption || !parseCost(caption))) throw new Error(parsed.error);

      finalizeVisionDraft(parsed, caption);
      console.log(`[catalog-admin] vision ok via ${model}:`, parsed.name, parsed.sourcePriceKes, parsed.category);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[catalog-admin] vision failed (${model}):`, err.message);
    }
  }

  throw lastError || new Error("All vision models failed");
}

function enqueue(adminChatId, task) {
  queue.push({ adminChatId, task });
  drainQueue();
}

async function drainQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) {
    const { adminChatId, task } = queue.shift();
    try {
      await task();
    } catch (err) {
      console.error("[catalog-admin] task failed:", err.message);
      try {
        await sendAdminOnlyText(adminChatId, `⚠️ Catalog error: ${err.message}`);
      } catch {}
    }
  }
  queueRunning = false;
}

export function catalogHelpText() {
  return (
    `📦 *Catalog commands* (admin)\n\n` +
    `*Add by text:*\n` +
    `#add Product name | category | cost 12000\n` +
    `_category optional — bot guesses from name_\n\n` +
    `*Update price:*\n` +
    `#price pt-001 cost 11500\n` +
    `#price Tecno Spark 20 | cost 13499\n\n` +
    `*Stock:*\n` +
    `#stock pt-001 off` + ` — hide from shop\n` +
    `#stock pt-001 on` + ` — show again\n\n` +
    `*Search:* #find tecno\n\n` +
    `*Push to website:* #sync\n\n` +
    `*Photos (auto — no confirm):*\n` +
    `Send or forward product photos to this chat.\n` +
    `• *With price tag* — bot reads name + cost from the photo.\n` +
    `• *No price tag* — add a caption with cost, e.g. \`130 ksh per shoe\` or \`130ksh women sandals\`.\n` +
    `AI names items from the photo (e.g. women's flat sandals) even without a label.\n` +
    `Retail = cost + KES 100 + 8% (rounded to KES 50).\n\n` +
    `Categories: ${VALID_CATEGORIES.join(", ")}`
  );
}

export async function handleCatalogCommand(adminChatId, text) {
  const t = (text || "").trim();
  const phone = phoneDigitsFromChatId(adminChatId) || "";
  if (!canRunAdminCommands(adminChatId, phone)) return false;
  trackCatalogAdmin(adminChatId);

  if (/^#sync\b/i.test(t)) {
    await forcePublishCatalog(adminChatId);
    return true;
  }

  if (/^#catalog\b/i.test(t) || /^#catalog\s+help\b/i.test(t)) {
    await sendAdminOnlyText(adminChatId, catalogHelpText());
    return true;
  }

  if (/^#find\b/i.test(t)) {
    const q = t.replace(/^#find\b/i, "").trim();
    const products = await loadMaster();
    const hits = products
      .filter((p) => p.fulfillment === "store")
      .map((p) => ({ p, score: nameSimilarity(q, p.name) }))
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (!hits.length) {
      await sendAdminOnlyText(adminChatId, `No store items matching *${q}*.`);
      return true;
    }
    const lines = hits.map(
      ({ p }) =>
        `\`${p.id}\` ${p.name} — cost ${p.sourcePriceKes?.toLocaleString() || "?"} → retail ${p.priceKes?.toLocaleString() || "?"}`
    );
    await sendAdminOnlyText(adminChatId, `🔎 *Matches for "${q}"*\n\n${lines.join("\n")}`);
    return true;
  }

  if (/^#add\b/i.test(t)) {
    const draft = parseAddCommand(t);
    if (draft.error) {
      await sendAdminOnlyText(
        adminChatId,
        `⚠️ Usage: #add Product name | phones-tablets | cost 12000\n\n${catalogHelpText()}`
      );
      return true;
    }
    const { product, updated } = await upsertStoreProduct(draft);
    await sendAdminOnlyText(adminChatId, formatProductAck(product, { updated }));
    return true;
  }

  if (/^#price\b/i.test(t)) {
    const parsed = parsePriceCommand(t);
    if (parsed.error) {
      await sendAdminOnlyText(adminChatId, `⚠️ Usage: #price pt-001 cost 12000`);
      return true;
    }
    const products = await loadMaster();
    const existing = findStoreProduct(products, parsed.query);
    if (!existing) {
      await sendAdminOnlyText(adminChatId, `⚠️ No product found for *${parsed.query}*. Try #find ${parsed.query}`);
      return true;
    }
    const { product, updated } = await upsertStoreProduct({
      name: existing.name,
      category: existing.category,
      subcategory: existing.subcategory,
      sourcePriceKes: parsed.sourcePriceKes,
      matchQuery: existing.id,
    });
    await sendAdminOnlyText(adminChatId, formatProductAck(product, { updated: true }));
    return true;
  }

  if (/^#stock\b/i.test(t)) {
    const m = t.match(/^#stock\s+(\S+)\s+(on|off)\b/i);
    if (!m) {
      await sendAdminOnlyText(adminChatId, `⚠️ Usage: #stock pt-001 off`);
      return true;
    }
    const products = await loadMaster();
    const existing = findStoreProduct(products, m[1]);
    if (!existing) {
      await sendAdminOnlyText(adminChatId, `⚠️ Product *${m[1]}* not found.`);
      return true;
    }
    existing.inStock = m[2].toLowerCase() === "on";
    const idx = products.findIndex((p) => p.id === existing.id);
    products[idx] = existing;
    await saveMaster(products);
    schedulePublish(adminChatId);
    await sendAdminOnlyText(
      adminChatId,
      `${existing.inStock ? "✅" : "🚫"} *${existing.id}* ${existing.name} — ${existing.inStock ? "back in shop" : "hidden from shop"}`
    );
    return true;
  }

  return false;
}

export async function handleCatalogMedia(adminChatId, { mediaUrl, mediaMimetype, caption = "", messageId, chatId, session }) {
  const phone = phoneDigitsFromChatId(adminChatId) || "";
  if (!canRunAdminCommands(adminChatId, phone)) return false;
  trackCatalogAdmin(adminChatId);
  if (!isCatalogMedia(mediaMimetype)) {
    await sendAdminOnlyText(adminChatId, "⚠️ Send a product *photo* (JPEG/PNG).");
    return true;
  }

  enqueue(adminChatId, async () => {
    await sendAdminOnlyText(adminChatId, "⏳ Reading product photo…");
    // WAHA may still be saving media when the webhook fires.
    await new Promise((r) => setTimeout(r, 2000));

    let buffer;
    try {
      buffer = await downloadWahaMedia(mediaUrl, { messageId, chatId, session });
    } catch (err) {
      throw new Error(`Could not download image: ${err.message}`);
    }

    if (String(mediaMimetype).includes("pdf")) {
      throw new Error("PDF not supported yet — photograph the price label and send as image.");
    }

    const draft = await extractFromImage(buffer, mediaMimetype, caption);
    const { product, updated } = await upsertStoreProduct(draft, buffer);
    await sendAdminOnlyText(adminChatId, formatProductAck(product, { updated }));
  });

  return true;
}
