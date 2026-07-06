import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import OpenAI from "openai";
import { config } from "../config.js";
import { readFile } from "node:fs/promises";
import { resolvePublicImageUrl } from "./whatsapp.js";
import { getValidAccessToken, refreshAccessToken } from "./tiktok-auth.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const POSTS_FILE = path.join(DATA_DIR, "tiktok-posts.json");
const PROMPT_FILE = path.join(__dirname, "..", "prompts", "tiktok-caption.prompt.md");
const PRODUCTS_FILE = path.join(__dirname, "..", "data", "products.json");
const SITE_FEATURED = path.join(__dirname, "..", "..", "..", "website", "data", "tiktok-featured.json");

const DEFAULT_STATE = { posts: [], lastPostAt: null };

function loadState() {
  try {
    if (existsSync(POSTS_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(POSTS_FILE, "utf-8")) };
    }
  } catch (err) {
    console.error("[tiktok] load state:", err.message);
  }
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(POSTS_FILE, JSON.stringify(state, null, 2));
  syncFeaturedToWebsite(state);
}

/** Publish product ids for the website "Viral Bargains" tab (backend-only source of truth). */
export function syncFeaturedToWebsite(state) {
  const recent = (state.posts || []).slice(-12);
  const productIds = [...new Set(recent.map((p) => p.productId))];
  const payload = {
    updatedAt: state.lastPostAt || new Date().toISOString(),
    productIds,
    posts: recent.map(({ productId, postedAt, caption }) => ({ productId, postedAt, caption })),
  };
  try {
    const dir = path.dirname(SITE_FEATURED);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SITE_FEATURED, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("[tiktok] sync website featured:", err.message);
  }
}

export function getFeaturedProductIds() {
  const state = loadState();
  const ids = [...new Set((state.posts || []).slice(-12).map((p) => p.productId))];
  return ids;
}

async function loadProducts() {
  const raw = await readFile(PRODUCTS_FILE, "utf-8");
  const all = JSON.parse(raw).filter((p) => p.inStock !== false);
  const store = all.filter((p) => p.fulfillment === "store" || p.scope === "local");
  return store.length ? store : all;
}

function pickRandomProduct(products, state) {
  const recentIds = new Set((state.posts || []).slice(-20).map((p) => p.productId));
  const pool = products.filter((p) => !recentIds.has(p.id));
  const list = pool.length ? pool : products;
  return list[Math.floor(Math.random() * list.length)];
}

async function buildCaption(product) {
  const template = readFileSync(PROMPT_FILE, "utf-8");
  const userPrompt = template.replace("{{PRODUCT_JSON}}", JSON.stringify(product, null, 2));

  if (!config.openai.apiKey) {
    const price =
      product.priceKes != null
        ? `KES ${product.priceKes.toLocaleString()}`
        : `$${product.priceUsd}`;
    return `Buda, stop scrolling — ${product.name} iko chini ya bei at ${price}! 🔥 Reviews ziko form na rating iko juu. Link kwa bio, text Sokoni AI on WhatsApp ukichukua chap chap before stock iishe 💬 #SokoniMall #TikTokDealsKenya #ShengTech #KenyaShopping`;
  }

  const client = new OpenAI({
    apiKey: config.openai.apiKey,
    baseURL: config.openai.baseUrl,
  });
  const { choices } = await client.chat.completions.create({
    model: config.openai.model,
    messages: [
      {
        role: "system",
        content:
          "You are Sokoni Mall's automated Social Media Director. Write TikTok photo captions. Follow every rule in the user message exactly. Output caption text only.",
      },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 280,
    temperature: 0.85,
  });
  return choices[0]?.message?.content?.trim() || "";
}

async function postToTikTok({ caption, product }) {
  const { clientKey } = config.tiktok;
  const accessToken = await getValidAccessToken();

  if (!accessToken || !clientKey) {
    console.log("[tiktok:dry-run] Would post:\n", caption);
    console.log("[tiktok:dry-run] Image:", resolvePublicImageUrl(product) || product.imageUrl);
    return { dryRun: true, id: `dry-${Date.now()}` };
  }

  const imageUrl = resolvePublicImageUrl(product) || product.imageUrl;
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
    throw new Error("Product image must be a public HTTPS URL for TikTok posting");
  }

  const body = {
    post_info: {
      title: caption.slice(0, 150),
      description: caption,
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: 0,
      photo_images: [imageUrl],
    },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  };

  const publish = async (token) => {
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const errText = !initRes.ok ? await initRes.text() : "";
    return { ok: initRes.ok, status: initRes.status, errText, data: initRes.ok ? await initRes.json() : null };
  };

  let result = await publish(accessToken);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const fresh = await refreshAccessToken({ force: true });
    result = await publish(fresh);
  }

  if (!result.ok) {
    throw new Error(`TikTok init failed: ${result.status} ${result.errText}`);
  }
  return { id: result.data?.data?.publish_id || "unknown", dryRun: false };
}
/** Run one automated TikTok post (call from cron 3× daily). */
export async function runTiktokPostJob() {
  const state = loadState();
  const products = await loadProducts();
  if (!products.length) throw new Error("No products in catalog");

  const product = pickRandomProduct(products, state);
  const caption = await buildCaption(product);
  const result = await postToTikTok({ caption, product });

  const entry = {
    productId: product.id,
    productName: product.name,
    caption,
    postedAt: new Date().toISOString(),
    tiktokPublishId: result.id,
    dryRun: result.dryRun,
  };
  state.posts = [...(state.posts || []), entry].slice(-50);
  state.lastPostAt = entry.postedAt;
  saveState(state);

  console.log("[tiktok] posted", product.id, result.dryRun ? "(dry-run)" : result.id);
  return entry;
}
