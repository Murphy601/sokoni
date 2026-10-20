/**
 * Fire-and-forget entry the rest of the bot can import.
 *
 * The fabric module pulls in the bus. Importing that from a payment or
 * dispatch file would tangle startup, so callers only import this function
 * and the real work happens on a later tick.
 */

export function emitPlatformEvent(event, data = {}) {
  void import("./fabric.js")
    .then((mod) => mod.announce(event, data))
    .catch((err) => console.warn("[fabric] event skipped:", err?.message || err));
}
