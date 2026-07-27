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

/** HTTPS URL on the bot server — available immediately after WhatsApp catalog upload. */
export function catalogImageBotUrl(product) {
  if (!product?.id || !config.botPublicUrl) return null;
  return `${config.botPublicUrl}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
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
