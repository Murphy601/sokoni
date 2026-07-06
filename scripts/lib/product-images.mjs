import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..", "..");
export const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
export const IMAGES_DIR = path.join(ROOT, "website", "assets", "images", "products");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Stable hash of product name — regenerate image when the name changes. */
export function imageKeyForName(name) {
  return createHash("sha256").update(String(name).trim().toLowerCase()).digest("hex").slice(0, 12);
}

export function catalogImagePath(productId) {
  return `assets/images/products/${productId}.jpg`;
}

export function localImageFile(productId) {
  return path.join(IMAGES_DIR, `${productId}.jpg`);
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isPlaceholderImage(url) {
  if (!url) return true;
  return /example\.com|placeholder|via\.placeholder|picsum\.photos/i.test(url);
}

export function needsImage(product, { force = false } = {}) {
  if (force) return true;
  if (isPlaceholderImage(product.imageUrl)) return true;
  if (product.imageKey && product.imageKey !== imageKeyForName(product.name)) return true;
  if (product.imageUrl && !product.imageUrl.includes("assets/images/products")) return true;
  return false;
}

function seedFromId(id) {
  return parseInt(createHash("md5").update(id).digest("hex").slice(0, 8), 16);
}

function searchQuery(product) {
  return `${product.name} product photo`.replace(/\s+/g, " ").trim();
}

function scoreImageCandidate(url, title = "") {
  let score = 0;
  const hay = `${url} ${title}`.toLowerCase();
  if (/product|pack|box|device|phone|tv|laptop|earbud|speaker/.test(hay)) score += 2;
  if (/logo|icon|banner|sprite|avatar|profile|map|building|house|certificate/.test(hay)) score -= 5;
  if (/\.(jpg|jpeg|webp)(\?|$)/i.test(url)) score += 1;
  if (/thumb|512|400|300/.test(url)) score += 1;
  return score;
}

/** Serper Google Images — best quality; optional free key from serper.dev */
export async function fetchSerperImage(product, apiKey) {
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: searchQuery(product), num: 10, gl: "ke" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = await res.json();
  const ranked = (data.images || [])
    .filter((img) => img.imageUrl && !/\.gif(\?|$)/i.test(img.imageUrl))
    .map((img) => ({ url: img.imageUrl, score: scoreImageCandidate(img.imageUrl, img.title) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || null;
}

/** Wikimedia Commons — free; great for phones/TVs with official product shots. */
export async function fetchWikimediaImage(product) {
  const q = encodeURIComponent(product.name.split(/[,(]/)[0].trim());
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${q}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url` +
    `&iiurlwidth=512&format=json&origin=*`;
  const res = await fetch(api, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Wikimedia HTTP ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  const ranked = pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      const url = info?.thumburl || info?.url;
      const title = p.title || "";
      return url ? { url, score: scoreImageCandidate(url, title) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].url : ranked[0]?.url || null;
}

/** Openverse (Creative Commons) — free, no key. */
export async function fetchOpenverseImage(product) {
  const q = encodeURIComponent(searchQuery(product));
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${q}&page_size=10`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  const data = await res.json();
  const ranked = (data.results || [])
    .filter((r) => r.url && r.detail_url)
    .map((r) => ({ url: r.url, score: scoreImageCandidate(r.url, r.title) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || null;
}

/** DuckDuckGo image search — free, no key. */
export async function fetchDuckDuckGoImage(product) {
  const query = searchQuery(product);
  const landing = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  const html = await landing.text();
  const vqd = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([\d-]+)/)?.[1];
  if (!vqd) return null;

  const imgRes = await fetch(
    `https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) }
  );
  if (!imgRes.ok) return null;
  const data = await imgRes.json();
  const ranked = (data.results || [])
    .filter((r) => r.image && !/\.gif(\?|$)/i.test(r.image))
    .map((r) => ({ url: r.image, score: scoreImageCandidate(r.image, r.title) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || null;
}

/** Pollinations AI — last resort when search APIs find nothing. */
export function pollinationsImageUrl(product) {
  const prompt =
    `Professional e-commerce product photograph of ${product.name}, ` +
    `single product centered, white background, studio lighting, photorealistic, no text`;
  const seed = seedFromId(product.id);
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=512&height=512&seed=${seed}&nologo=true&enhance=true`
  );
}

export async function downloadToFile(sourceUrl, destPath, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(sourceUrl, {
        headers: { "User-Agent": UA, Accept: "image/*,*/*", Referer: "https://www.google.com/" },
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 && attempt < retries) {
        await sleep(3000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1500) throw new Error(`Image too small (${buf.length} bytes)`);
      const type = res.headers.get("content-type") || "";
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      const isWebp = buf.slice(0, 4).toString() === "RIFF";
      if (!type.startsWith("image/") && !isJpeg && !isPng && !isWebp) {
        throw new Error(`Not an image (content-type: ${type || "unknown"})`);
      }
      await writeFile(destPath, buf);
      return buf.length;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Collect image URLs from all sources (best first). Used with fallbacks if
 * download is blocked (403/429 from hotlink protection).
 */
export async function collectImageCandidates(product, { serperKey, log = () => {} }) {
  const candidates = [];
  const seen = new Set();

  function push(url, source) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, source });
  }

  if (serperKey) {
    try {
      push(await fetchSerperImage(product, serperKey), "serper");
    } catch (err) {
      log(`  serper: ${err.message}`);
    }
  }

  for (const [name, fn] of [
    ["wikimedia", () => fetchWikimediaImage(product)],
    ["duckduckgo", () => fetchDuckDuckGoImage(product)],
    ["openverse", () => fetchOpenverseImage(product)],
  ]) {
    try {
      push(await fn(), name);
    } catch (err) {
      log(`  ${name}: ${err.message}`);
    }
  }

  push(pollinationsImageUrl(product), "pollinations");
  return candidates;
}

export async function enrichProductImage(product, { serperKey, force = false, log = console.log }) {
  await mkdir(IMAGES_DIR, { recursive: true });
  const dest = localImageFile(product.id);
  const rel = catalogImagePath(product.id);

  if (!needsImage(product, { force }) && (await fileExists(dest))) {
    return { path: rel, skipped: true, source: "cached" };
  }

  const candidates = await collectImageCandidates(product, { serperKey, log });
  let lastErr;

  for (const { url, source } of candidates) {
    try {
      await downloadToFile(url, dest);
      log(`  saved via ${source}`);
      return { path: rel, skipped: false, source };
    } catch (err) {
      lastErr = err;
      log(`  ${source} download failed: ${err.message}`);
    }
  }

  throw lastErr || new Error("No image candidates");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
