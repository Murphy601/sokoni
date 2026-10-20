/**
 * Where a fit pic is written.
 *
 * Kept, not expired. Unlike a voice note this becomes a public review on the
 * seller's profile, and a review whose photo vanishes after two days is worse
 * than no photo at all -- it reads as a deleted image to everyone who visits
 * afterwards.
 *
 * The cost is bounded by how many orders actually complete, which is a number
 * we want to grow, and a photo is capped at 5MB by the route.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIT_DIR = path.join(__dirname, "..", "..", "data", "fit-checks");

const EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/**
 * Write the photo and return its public URL.
 *
 * Named with a UUID, never from anything the uploader sent, so a crafted
 * filename cannot escape the folder or overwrite someone else's review.
 */
export async function storeFitPhoto(buffer, mimetype) {
  const ext = EXT.get(String(mimetype || "").split(";")[0].toLowerCase());
  if (!ext) throw new Error("unsupported_image");
  if (!existsSync(FIT_DIR)) await mkdir(FIT_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(FIT_DIR, filename), buffer);
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return { filename, url: `${base}/assets/fit-checks/${filename}` };
}
