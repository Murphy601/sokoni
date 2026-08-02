import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_IMAGES_DIR = path.join(__dirname, "..", "..", "..", "website", "assets", "images", "products");

export function catalogImageFileForProduct(product) {
  if (!product?.id) return null;
  const filePath = path.join(CATALOG_IMAGES_DIR, `${product.id}.jpg`);
  return existsSync(filePath) ? filePath : null;
}

/** Filename for a product photo on disk /catalog-images. */
export function catalogImageFilename(productOrId, ext = "jpg") {
  const id =
    typeof productOrId === "string" || typeof productOrId === "number"
      ? String(productOrId)
      : productOrId?.id;
  if (!id) return null;
  return `${id}.${ext}`;
}

/** HTTPS URL on the bot server — available immediately after listing upload (no Cloudflare wait). */
export function catalogImageBotUrl(product) {
  if (!product?.id || !config.botPublicUrl) return null;
  const fileOnDisk = catalogImageFileForProduct(product);
  if (!fileOnDisk) return null;
  return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
}

/**
 * Prefer bot /catalog-images when the file exists on the VM.
 * Fall back to absolute site URL / already-absolute imageUrl.
 * Relative `assets/images/products/…` paths break on Cloudflare until git push.
 */
export function resolveStorefrontImageUrl(product) {
  if (!product) return null;

  const raw = product.imageUrl || (Array.isArray(product.images) ? product.images[0] : null);
  // Prefer durable CDN URLs saved at publish (no on-the-fly Cloudinary transforms).
  if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);

  const bot = catalogImageBotUrl(product);
  if (bot) return bot;

  if (!raw) {
    // Last resort: point at bot path even if file probe missed (e.g. race right after write).
    if (product.id && config.botPublicUrl) {
      return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
    }
    return null;
  }
  if (/^(assets\/images\/products\/|catalog-images\/)/i.test(String(raw).replace(/^\//, ""))) {
    const base = String(raw).replace(/^\//, "").replace(/^assets\/images\/products\//i, "");
    if (config.botPublicUrl) {
      return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(base.split("/").pop())}`;
    }
  }
  return `${config.publicSiteUrl}/${String(raw).replace(/^\//, "")}`;
}

/** HTTPS URL on the public website (Cloudflare Pages). */
export function catalogImageSiteUrl(product) {
  if (!product?.imageUrl) return null;
  if (/^https?:\/\//i.test(product.imageUrl)) return product.imageUrl;
  return `${config.publicSiteUrl}/${product.imageUrl.replace(/^\//, "")}`;
}

/** Ordered URLs to try when WAHA fetches product photos. */
export function catalogImageUrlCandidates(product) {
  const out = [];
  const bot = catalogImageBotUrl(product);
  const site = catalogImageSiteUrl(product);
  if (bot) out.push(bot);
  if (site && site !== bot) out.push(site);
  return out;
}

export async function readCatalogImageBase64(product) {
  const filePath = catalogImageFileForProduct(product);
  if (!filePath) return null;
  const buf = await readFile(filePath);
  return buf.toString("base64");
}

/** True when a catalog video file exists on disk for this product id. */
export function catalogVideoFileForProduct(product) {
  if (!product?.id) return null;
  const filePath = path.join(CATALOG_IMAGES_DIR, `${product.id}.mp4`);
  return existsSync(filePath) ? filePath : null;
}

/**
 * Public storefront video URL (seller clip or AI preview).
 * Prefer bot /catalog-images/{id}.mp4 when present; else absolute videoUrl.
 */
export function resolveStorefrontVideoUrl(product) {
  if (!product) return null;
  const raw = product.videoUrl;
  // Prefer absolute CDN reel/clip URLs saved at publish (static delivery).
  if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);

  if (product.id && config.botPublicUrl) {
    const onDisk = catalogVideoFileForProduct(product);
    if (onDisk) {
      return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(product.id)}.mp4`;
    }
  }
  if (!raw) {
    if (product.id && config.botPublicUrl) {
      // Race right after publish — point at bot path even if probe missed.
      const guess = path.join(CATALOG_IMAGES_DIR, `${product.id}.mp4`);
      if (existsSync(guess)) {
        return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(product.id)}.mp4`;
      }
    }
    return null;
  }
  if (/^(assets\/images\/products\/|catalog-images\/)/i.test(String(raw).replace(/^\//, ""))) {
    const base = String(raw).replace(/^\//, "").replace(/^assets\/images\/products\//i, "");
    if (config.botPublicUrl) {
      return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(base.split("/").pop())}`;
    }
  }
  return `${config.publicSiteUrl}/${String(raw).replace(/^\//, "")}`;
}
