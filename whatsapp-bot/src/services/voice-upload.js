/**
 * Voice notes recorded in the browser.
 *
 * The buyer records with MediaRecorder, the blob arrives in memory, and two
 * things happen with it before the buffer is dropped:
 *
 *  1. It is relayed to the seller's WhatsApp through WAHA, so a seller who
 *     never opens the site still hears it.
 *  2. A short-lived copy is written for web playback.
 *
 * Step 2 is not what the zero-storage plan assumed, and the reason is worth
 * stating. WAHA downloads media for messages it *receives* -- that is what
 * WHATSAPP_DOWNLOAD_MEDIA covers. A file we upload outbound is not kept in
 * /app/.media, so there is nothing to stream back. Without a local copy the
 * buyer would send a voice note and then be unable to play their own message.
 *
 * The copy is bounded rather than permanent: 30 seconds of opus is about
 * 60KB, it carries an expiry the thread honours, and purge-voice-notes.sh
 * clears the folder.
 */

import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VOICE_DIR = path.join(__dirname, "..", "..", "data", "voice-notes");

/** Caps. A voice note is a sentence, not a podcast. */
export const MAX_VOICE_BYTES = 400 * 1024;
export const MAX_VOICE_MS = 30_000;
/** How long a recording stays playable on the web. */
export const VOICE_TTL_MS = 48 * 60 * 60 * 1000;

/** Container types a browser MediaRecorder actually produces. */
const ALLOWED = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
]);

/** Strip the codecs parameter: "audio/webm;codecs=opus" -> "audio/webm". */
export function baseMimetype(raw) {
  return String(raw || "").split(";")[0].trim().toLowerCase();
}

export function extensionFor(mimetype) {
  return ALLOWED.get(baseMimetype(mimetype)) || null;
}

/**
 * Check an upload before anything touches disk or the network.
 * @returns {{ok:true,ext:string}|{ok:false,error:string,message:string}}
 */
export function validateVoiceUpload({ buffer, mimetype, durationMs } = {}) {
  if (!buffer?.length) {
    return { ok: false, error: "empty_recording", message: "Nothing was recorded." };
  }
  if (buffer.length > MAX_VOICE_BYTES) {
    return {
      ok: false,
      error: "recording_too_large",
      message: "That recording is too long. Keep it under 30 seconds.",
    };
  }
  const ext = extensionFor(mimetype);
  if (!ext) {
    return {
      ok: false,
      error: "unsupported_audio",
      message: "That audio format isn't supported.",
    };
  }
  // Trust the byte cap over the claimed duration -- the client sets the
  // latter and a lie there must not buy a larger file.
  const ms = Number(durationMs);
  if (Number.isFinite(ms) && ms > MAX_VOICE_MS + 2000) {
    return {
      ok: false,
      error: "recording_too_long",
      message: "Keep voice notes under 30 seconds.",
    };
  }
  return { ok: true, ext };
}

/**
 * Write the recording and return the URL the thread will play.
 *
 * The filename is a random UUID, never anything derived from user input, so a
 * crafted name cannot escape the folder or collide with someone else's note.
 */
export async function storeVoiceNote(buffer, ext) {
  if (!existsSync(VOICE_DIR)) await mkdir(VOICE_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(VOICE_DIR, name), buffer);
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return { filename: name, url: `${base}/assets/voice-notes/${name}` };
}

/**
 * Relay the recording to a WhatsApp number.
 *
 * Never awaited by the upload route: WAHA runs in its own container and can
 * be slow or restarting, and a buyer pressing send should not wait on it. A
 * failed relay costs the seller a WhatsApp copy, not the message itself --
 * it is already in the web thread either way.
 */
export async function relayVoiceToWhatsApp(toPhone, buffer, mimetype, filename) {
  const to = String(toPhone || "").replace(/\D/g, "");
  if (!to) return { skipped: true, reason: "no_phone" };
  try {
    const { sendVoiceBuffer } = await import("./whatsapp.js");
    return await sendVoiceBuffer(to, buffer, { mimetype, filename });
  } catch (err) {
    console.warn("[voice-upload] WhatsApp relay skipped:", err.message);
    return { skipped: true, reason: err.message };
  }
}

/**
 * Delete recordings past their TTL.
 *
 * Called on a timer by the server rather than by a cron the VM has to be
 * told about -- one fewer thing to remember, and the folder cannot quietly
 * grow because someone forgot to install a crontab.
 *
 * @returns {Promise<{deleted:number, kept:number}>}
 */
export async function purgeExpiredVoiceNotes(ttlMs = VOICE_TTL_MS) {
  if (!existsSync(VOICE_DIR)) return { deleted: 0, kept: 0 };
  let deleted = 0;
  let kept = 0;
  const cutoff = Date.now() - ttlMs;
  try {
    for (const name of await readdir(VOICE_DIR)) {
      const full = path.join(VOICE_DIR, name);
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
    console.warn("[voice-upload] purge skipped:", err.message);
  }
  if (deleted) console.log(`[voice-upload] purged ${deleted} expired voice note(s)`);
  return { deleted, kept };
}
