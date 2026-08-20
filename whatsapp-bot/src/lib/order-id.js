/**
 * Shared Sokoni order / tracking ID helpers.
 * Accepts legacy SK-#### and cart SKN-#### / SKN-####-n.
 * Never coerces SKN-1002-1 → SK-10021.
 * Never treats shopping sentences like "Electronics under 10000" as order ids.
 */

/** Full order id in free text (parent, child, or legacy SK). */
export const ORDER_ID_RE = /\b(SKN-\d+(?:-\d+)?|SK-\d+)\b/i;

/** Same, for command templates that need a capture group name. */
export const ORDER_ID_CAPTURE = "(SKN-\\d+(?:-\\d+)?|SK-\\d+)";

/** Whole-string order id token (not a shopping sentence). */
const ORDER_ID_TOKEN_RE = /^(SKN-?\d+(?:-\d+)?|SK-?\d+|\d{3,8})$/i;

/**
 * Normalize SK-####, SKN-####, SKN-####-n (and missing-hyphen variants).
 * Bare digits map to SKN-#### only when the whole value is digits (a typed id).
 * Explicit SK-#### remains valid for legacy orders.
 */
export function normalizeOrderId(id) {
  if (id == null || id === "") return null;
  let raw = String(id).trim().toUpperCase();
  if (!raw) return null;

  // Shopping copy with spaces is never an order id — use extractOrderIdFromText.
  if (/\s/.test(raw)) {
    const m = raw.match(ORDER_ID_RE);
    return m ? normalizeOrderId(m[1]) : null;
  }

  // SKN1002 / SKN1002-1 / SK1019 → hyphenated form
  raw = raw.replace(/^SKN(?=\d)/, "SKN-").replace(/^SK(?!N)(?=\d)/, "SK-");

  if (/^SKN-\d+-\d+$/.test(raw)) return raw;
  if (/^SKN-\d+$/.test(raw)) return raw;
  if (/^SK-\d+$/.test(raw)) return raw;

  // Bare tracking digits only (e.g. "1002"), not "electronicsunder10000"
  if (/^\d{3,8}$/.test(raw)) return `SKN-${raw}`;

  return null;
}

/** First order id found in free text, or null. */
export function extractOrderIdFromText(text) {
  const m = String(text || "").match(ORDER_ID_RE);
  return m ? normalizeOrderId(m[1]) : null;
}

/** True if string is a known Sokoni order id shape after normalize. */
export function isSokoniOrderId(id) {
  const raw = String(id ?? "").trim();
  if (!raw || !ORDER_ID_TOKEN_RE.test(raw)) return false;
  const n = normalizeOrderId(raw);
  return Boolean(n && (/^SKN-\d+(-\d+)?$/.test(n) || /^SK-\d+$/.test(n)));
}
