/**
 * Normalize person names for fuzzy M-Pesa vs National ID / rider profile match.
 */
export function normalizePersonName(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\b(MR|MRS|MS|MISS|DR|ENG|HON|CPA)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Safaricom ReceiverPartyPublicName is often "2547… - JOHN KAMAU".
 */
export function extractMpesaDisplayName(receiverPublicName) {
  const raw = String(receiverPublicName || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s*-\s*/);
  if (parts.length >= 2) return parts.slice(1).join(" - ").trim();
  return raw.replace(/^254\d{9}\s*/i, "").trim();
}

/**
 * Token overlap match — both names must share ≥2 tokens or one contains the other.
 */
export function namesLikelyMatch(registeredName, mpesaName) {
  const a = normalizePersonName(registeredName);
  const b = normalizePersonName(mpesaName);
  if (!a || !b) return { match: false, reason: "missing_name" };
  if (a === b) return { match: true, reason: "exact" };
  if (a.includes(b) || b.includes(a)) return { match: true, reason: "contains" };

  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  if (overlap >= 2) return { match: true, reason: "token_overlap", overlap };
  if (overlap === 1 && ta.size <= 2 && tb.size <= 2) {
    return { match: true, reason: "single_token_short", overlap };
  }
  return { match: false, reason: "mismatch", overlap };
}
