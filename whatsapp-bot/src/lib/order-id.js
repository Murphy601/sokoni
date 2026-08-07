/**
 * Shared Sokoni order / tracking ID helpers.
 * Accepts legacy SK-#### and cart SKN-#### / SKN-####-n.
 * Never coerces SKN-1002-1 → SK-10021.
 */

/** Full order id in free text (parent, child, or legacy SK). */
export const ORDER_ID_RE = /\b(SKN-\d+(?:-\d+)?|SK-\d+)\b/i;

/** Same, for command templates that need a capture group name. */
export const ORDER_ID_CAPTURE = "(SKN-\\d+(?:-\\d+)?|SK-\\d+)";

/**
 * Normalize SK-####, SKN-####, SKN-####-n (and missing-hyphen variants).
 * Bare digits map to SKN-#### (current single-item + cart parent prefix).
 * Explicit SK-#### remains valid for legacy orders.
 */
export function normalizeOrderId(id) {
  if (id == null || id === "") return null;
  let raw = String(id).trim().toUpperCase();
  if (!raw) return null;

  // SKN1002 / SKN1002-1 / SK1019 → hyphenated form
  raw = raw.replace(/^SKN(?=\d)/, "SKN-").replace(/^SK(?!N)(?=\d)/, "SK-");

  if (/^SKN-\d+-\d+$/.test(raw)) return raw;
  if (/^SKN-\d+$/.test(raw)) return raw;
  if (/^SK-\d+$/.test(raw)) return raw;
  if (raw.startsWith("SKN-")) return raw;
  if (raw.startsWith("SK-")) return raw;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `SKN-${digits}`;
}

/** First order id found in free text, or null. */
export function extractOrderIdFromText(text) {
  const m = String(text || "").match(ORDER_ID_RE);
  return m ? normalizeOrderId(m[1]) : null;
}

/** True if string is a known Sokoni order id shape after normalize. */
export function isSokoniOrderId(id) {
  const n = normalizeOrderId(id);
  return Boolean(n && (/^SKN-\d+(-\d+)?$/.test(n) || /^SK-\d+$/.test(n)));
}
