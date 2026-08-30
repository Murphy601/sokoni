/**
 * Shop handle parsing for Boss WhatsApp commands.
 * Supports multi-word names with spaces / apostrophes (e.g. "@Adiv's thrift").
 */

/** Strip leading @ and trim. */
export function stripHandleAt(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .trim();
}

/**
 * Canonical slug keys for fuzzy match (adiv_thrift, adiv-thrift, …).
 * @param {string} value
 * @returns {string[]}
 */
export function shopHandleLookupKeys(value) {
  const cleaned = stripHandleAt(value).toLowerCase();
  if (!cleaned) return [];
  const keys = new Set([cleaned]);

  // Drop possessive 's so "adiv's thrift" → "adiv thrift" → adiv_thrift
  const noPossessive = cleaned.replace(/[''`´']s\b/g, "").replace(/[''`´']/g, "");
  keys.add(noPossessive);

  // Also keep plain apostrophe-strip variant (adivs thrift) for completeness
  const noApos = cleaned.replace(/[''`´']/g, "");
  keys.add(noApos);

  for (const base of [noPossessive, noApos, cleaned]) {
    const underscored = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (underscored) {
      keys.add(underscored);
      keys.add(underscored.replace(/_/g, "-"));
      keys.add(underscored.replace(/_/g, ""));
    }
    const spaced = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (spaced) keys.add(spaced);
  }

  return [...keys].filter(Boolean);
}

/** True when two handle/name strings refer to the same shop. */
export function shopHandlesMatch(a, b) {
  const ka = shopHandleLookupKeys(a);
  const kb = new Set(shopHandleLookupKeys(b));
  if (!ka.length || !kb.size) return false;
  return ka.some((k) => kb.has(k));
}

/**
 * Extract handle (+ optional trailing score) from a Boss command remainder.
 * Examples:
 *   "@Adiv's thrift"           → { handle: "Adiv's thrift", score: null }
 *   "@Adiv's thrift 4.8"       → { handle: "Adiv's thrift", score: 4.8 }
 *   "adiv_thrift 4.8"          → { handle: "adiv_thrift", score: 4.8 }
 *   "+254712345678 4.5"        → { handle: "+254712345678", score: 4.5 }
 *
 * @param {string} rest
 * @param {{ requireScore?: boolean }} [opts]
 * @returns {{ handle: string, score: number|null } | null}
 */
export function parseHandleAndOptionalScore(rest, { requireScore = false } = {}) {
  const raw = String(rest || "").trim();
  if (!raw) return null;

  // Phone targets: keep compact (no multi-word phones)
  const phoneScore = raw.match(/^(\+?\d[\d\s-]{7,}\d)\s+(\d{1,2}(?:\.\d+)?)\s*$/);
  if (phoneScore) {
    return {
      handle: phoneScore[1].replace(/\s+/g, ""),
      score: Number(phoneScore[2]),
    };
  }
  const phoneOnly = raw.match(/^(\+?\d[\d\s-]{7,}\d)\s*$/);
  if (phoneOnly) {
    if (requireScore) return null;
    return { handle: phoneOnly[1].replace(/\s+/g, ""), score: null };
  }

  // Trailing 0–99(.x) score/commission — keep handle (may include spaces / apostrophes)
  const withScore = raw.match(/^(.+?)\s+(\d{1,2}(?:\.\d+)?)\s*$/);
  if (withScore) {
    const handle = stripHandleAt(withScore[1]);
    const score = Number(withScore[2]);
    if (handle && Number.isFinite(score)) {
      return { handle, score };
    }
  }

  if (requireScore) return null;
  const handle = stripHandleAt(raw);
  return handle ? { handle, score: null } : null;
}
