/**
 * Atomic JSON persistence for the file-backed stores under whatsapp-bot/data.
 *
 * A plain writeFileSync truncates the target before it writes. If the process
 * dies mid-write, or two handlers persist the same store in the same tick, the
 * file on disk is left half-written and the next load() throws on parse --
 * which for orders.json / settlements.json means losing order and payout state.
 *
 * Write to a sibling temp file, then rename over the target. rename(2) is
 * atomic within a filesystem, so a reader sees either the old file or the new
 * one, never a partial. Temp lives in the same directory so it stays on the
 * same filesystem as the target.
 */
import { writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Serialize `value` and replace `filePath` atomically.
 *
 * @param {string} filePath  absolute path to the JSON file
 * @param {unknown} value    anything JSON.stringify can take
 * @param {{ indent?: number, trailingNewline?: boolean }} [opts]
 * @returns {boolean} true when the file was replaced
 * @throws never -- logs and returns false so a persist failure cannot take down a handler
 */
export function writeJsonAtomic(filePath, value, { indent = 2, trailingNewline = true } = {}) {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const body = JSON.stringify(value, null, indent) + (trailingNewline ? "\n" : "");
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, filePath);
    return true;
  } catch (err) {
    // Never leave the temp behind to accumulate on the VM disk.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    console.warn(`[atomic-json] write failed for ${path.basename(filePath)}:`, err?.message || err);
    return false;
  }
}
