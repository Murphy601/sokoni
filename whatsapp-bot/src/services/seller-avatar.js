/**
 * Optional seller shop avatar — stored under website/assets/images/avatars/
 * and served from the bot (same pattern as listing product photos).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { updateUserShopProfile } from "../db/repositories/social.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
export const AVATARS_DIR = path.join(REPO_ROOT, "website", "assets", "images", "avatars");

const MAX_AVATAR_BYTES = 2.5 * 1024 * 1024;

function decodeBase64(dataUrlOrB64) {
  const raw = String(dataUrlOrB64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) return Buffer.alloc(0);
  try {
    return Buffer.from(raw, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function sniffImageExt(buffer, mimeType = "") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "webp";
  return "jpg";
}

export function avatarPublicUrl(filename) {
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return `${base}/assets/images/avatars/${encodeURIComponent(filename)}`;
}

/**
 * Save avatar bytes and set users.avatar_url.
 * @returns {{ success: true, avatarUrl: string, shop: object } | { error, message }}
 */
export async function uploadSellerShopAvatar({ userId, sellerId = null, imageBase64, mimeType = "image/jpeg" }) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    return { error: "invalid_user", message: "Seller user id missing." };
  }

  const buffer = decodeBase64(imageBase64);
  if (!buffer.length) {
    return { error: "missing_image", message: "Choose a profile photo to upload." };
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    return { error: "image_too_large", message: "Profile photo is too large — try a smaller image." };
  }

  if (!existsSync(AVATARS_DIR)) await mkdir(AVATARS_DIR, { recursive: true });

  const ext = sniffImageExt(buffer, mimeType);
  const filename = `user-${uid}.${ext}`;
  await writeFile(path.join(AVATARS_DIR, filename), buffer);

  const avatarUrl = `${avatarPublicUrl(filename)}?v=${Date.now()}`;
  const result = await updateUserShopProfile({
    userId: uid,
    sellerId,
    avatarUrl,
  });
  if (result.error) return result;

  return {
    success: true,
    avatarUrl,
    shop: result.shop,
    message: "Profile photo updated.",
  };
}
