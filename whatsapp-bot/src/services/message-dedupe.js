/**
 * Inbound WhatsApp (WAHA) message-id idempotency.
 * Blocks duplicate webhook deliveries of the same message.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

/** @type {Map<string, number>} messageId → expiresAt */
const seen = new Map();

function prune(now = Date.now()) {
  for (const [id, expiresAt] of seen.entries()) {
    if (expiresAt <= now) seen.delete(id);
  }
  if (seen.size <= MAX_ENTRIES) return;
  const overflow = seen.size - MAX_ENTRIES;
  let i = 0;
  for (const id of seen.keys()) {
    seen.delete(id);
    i += 1;
    if (i >= overflow) break;
  }
}

/**
 * @param {string|null|undefined} messageId
 * @param {{ ttlMs?: number }} [opts]
 * @returns {boolean} true if this id was already claimed (duplicate)
 */
export function claimInboundMessageId(messageId, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const id = String(messageId || "").trim();
  if (!id) return false;
  const now = Date.now();
  prune(now);
  const prev = seen.get(id);
  if (prev && prev > now) return true;
  seen.set(id, now + Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS));
  return false;
}

/** Test helper — clear the in-memory set. */
export function resetInboundMessageDedupe() {
  seen.clear();
}

export function inboundDedupeSize() {
  prune();
  return seen.size;
}
