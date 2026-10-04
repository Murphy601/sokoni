/**
 * What to do when the heap crosses 380MB.
 *
 * PM2 restarts the process at 450MB. Reclaiming first gives the process a
 * chance to stay up. Live chat recordings stay until their own expiry: wiping
 * those would delete a voice note a buyer still needs to play. This clears
 * recordings that are already past that expiry, plus abandoned files in the
 * system temp directory, then asks V8 to collect if it was started with
 * --expose-gc.
 */

import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP_MAX_AGE_MS = 15 * 60 * 1000;

async function clearSokoniTempFiles(dir = tmpdir(), now = Date.now()) {
  let deleted = 0;
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return deleted;
  }
  for (const name of names) {
    if (!name.startsWith("sokoni-")) continue;
    const full = path.join(dir, name);
    try {
      const info = await stat(full);
      if (!info.isFile()) continue;
      if (now - info.mtimeMs < TMP_MAX_AGE_MS) continue;
      await unlink(full);
      deleted += 1;
    } catch {
      /* already gone */
    }
  }
  return deleted;
}

/**
 * @param {object} [opts]
 * @param {() => void} [opts.gc]
 * @param {() => Promise<{deleted?: number}>} [opts.purgeVoice]
 * @param {() => Promise<{deleted?: number}>} [opts.purgePhotos]
 */
export async function reclaimHeap({
  gc = global.gc,
  purgeVoice = null,
  purgePhotos = null,
} = {}) {
  const result = { voice: 0, photos: 0, temp: 0, gc: false };
  try {
    const voice = purgeVoice
      ? await purgeVoice()
      : await import("../services/voice-upload.js").then((m) => m.purgeExpiredVoiceNotes());
    result.voice = Number(voice?.deleted) || 0;
  } catch (err) {
    console.warn("[heap] voice purge skipped:", err?.message || err);
  }
  try {
    const photos = purgePhotos
      ? await purgePhotos()
      : await import("../services/chat-photo-store.js").then((m) => m.purgeExpiredChatPhotos());
    result.photos = Number(photos?.deleted) || 0;
  } catch (err) {
    console.warn("[heap] photo purge skipped:", err?.message || err);
  }
  try {
    result.temp = await clearSokoniTempFiles();
  } catch (err) {
    console.warn("[heap] temp purge skipped:", err?.message || err);
  }
  if (typeof gc === "function") {
    try {
      gc();
      result.gc = true;
    } catch (err) {
      console.warn("[heap] gc skipped:", err?.message || err);
    }
  }
  return result;
}
