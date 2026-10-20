/**
 * Photos sent inside a chat thread.
 *
 * Separate from fit-check photos on purpose. A fit pic becomes a public review
 * and is kept; a chat photo is "here's the back of the jacket" and only has to
 * outlive the negotiation. Keeping those forever on a 1GB VM would fill the
 * disk with pictures nobody will open again.
 *
 * Fourteen days, which covers a slow negotiation and the dispute window after
 * delivery. The real size control is client side: the browser downscales
 * before uploading, so a 4MB phone photo arrives at roughly 200KB. The cap
 * here is for browsers that could not do that, not the expected path.
 */

import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHAT_PHOTO_DIR = path.join(__dirname, "..", "..", "data", "chat-photos");

/** Upload cap. Generous, because it only catches the un-downscaled case. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** How long a chat photo stays fetchable. */
export const PHOTO_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/** Strip any parameters: "image/jpeg; charset=x" -> "image/jpeg". */
export function basePhotoMimetype(raw) {
  return String(raw || "").split(";")[0].trim().toLowerCase();
}

export function photoExtensionFor(mimetype) {
  return ALLOWED.get(basePhotoMimetype(mimetype)) || null;
}

/**
 * Check an upload before anything touches disk.
 *
 * Note this trusts the declared mimetype only to pick an extension. The file
 * is served with nosniff and rendered in an <img>, so a mislabelled file
 * fails to decode rather than executing.
 *
 * @returns {{ok:true,ext:string}|{ok:false,error:string,message:string}}
 */
export function validatePhotoUpload({ buffer, mimetype } = {}) {
  if (!buffer?.length) {
    return { ok: false, error: "empty_photo", message: "That photo was empty." };
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      error: "photo_too_large",
      message: "That photo is too big. Try a smaller one.",
    };
  }
  const ext = photoExtensionFor(mimetype);
  if (!ext) {
    return {
      ok: false,
      error: "unsupported_image",
      message: "Send a JPG, PNG or WebP.",
    };
  }
  return { ok: true, ext };
}

/**
 * Write the photo and return the URL the thread will show.
 *
 * The filename is a random UUID, never anything derived from the upload, so a
 * crafted name cannot escape the folder or overwrite someone else's photo.
 */
export async function storeChatPhoto(buffer, ext) {
  if (!existsSync(CHAT_PHOTO_DIR)) await mkdir(CHAT_PHOTO_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(CHAT_PHOTO_DIR, filename), buffer);
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return { filename, url: `${base}/assets/chat-photos/${filename}` };
}

/**
 * Relay the photo to a WhatsApp number.
 *
 * Never awaited by the upload route: WAHA runs in its own container and can be
 * slow or restarting, and a buyer pressing send should not wait on it. A
 * failed relay costs the seller a WhatsApp copy, not the message -- it is in
 * the web thread either way.
 */
export async function relayPhotoToWhatsApp(toPhone, buffer, mimetype, filename, caption = "") {
  const to = String(toPhone || "").replace(/\D/g, "");
  if (!to) return { skipped: true, reason: "no_phone" };
  try {
    const { sendImageBuffer } = await import("./whatsapp.js");
    return await sendImageBuffer(to, buffer, { mimetype, filename, caption });
  } catch (err) {
    console.warn("[chat-photo] WhatsApp relay skipped:", err.message);
    return { skipped: true, reason: err.message };
  }
}

/**
 * Delete photos past their TTL.
 *
 * On a timer from the server rather than a crontab the VM has to be told
 * about -- one fewer thing to remember, and the folder cannot quietly grow
 * because nobody installed it.
 *
 * @returns {Promise<{deleted:number, kept:number}>}
 */
export async function purgeExpiredChatPhotos(ttlMs = PHOTO_TTL_MS) {
  if (!existsSync(CHAT_PHOTO_DIR)) return { deleted: 0, kept: 0 };
  let deleted = 0;
  let kept = 0;
  const cutoff = Date.now() - ttlMs;
  try {
    for (const name of await readdir(CHAT_PHOTO_DIR)) {
      const full = path.join(CHAT_PHOTO_DIR, name);
      try {
        const info = await stat(full);
        if (info.isFile() && info.mtimeMs < cutoff) {
          await unlink(full);
          deleted += 1;
        } else {
          kept += 1;
        }
      } catch {
        // Already gone, or being written right now. Either is fine.
      }
    }
  } catch (err) {
    console.warn("[chat-photo] purge skipped:", err.message);
  }
  if (deleted) console.log(`[chat-photo] purged ${deleted} expired photo(s)`);
  return { deleted, kept };
}
