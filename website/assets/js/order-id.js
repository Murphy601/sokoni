/**
 * Shared Sokoni order / tracking ID helpers (website).
 * Accepts legacy SK-#### and cart SKN-#### / SKN-####-n.
 * Never coerces SKN-1002-1 → SK-10021.
 * Never treats shopping sentences like "Electronics under 10000" as order ids.
 */
(function (global) {
  "use strict";

  const ORDER_ID_RE = /\b(SKN-\d+(?:-\d+)?|SK-\d+)\b/i;
  const ORDER_ID_TOKEN_RE = /^(SKN-?\d+(?:-\d+)?|SK-?\d+|\d{3,8})$/i;

  function normalizeOrderId(id) {
    if (id == null || id === "") return "";
    let raw = String(id).trim().toUpperCase();
    if (!raw) return "";

    if (/\s/.test(raw)) {
      const m = raw.match(ORDER_ID_RE);
      return m ? normalizeOrderId(m[1]) : "";
    }

    raw = raw.replace(/^SKN(?=\d)/, "SKN-").replace(/^SK(?!N)(?=\d)/, "SK-");

    if (/^SKN-\d+-\d+$/.test(raw)) return raw;
    if (/^SKN-\d+$/.test(raw)) return raw;
    if (/^SK-\d+$/.test(raw)) return raw;

    if (/^\d{3,8}$/.test(raw)) return `SKN-${raw}`;
    return "";
  }

  function extractOrderIdFromText(text) {
    const m = String(text || "").match(ORDER_ID_RE);
    return m ? normalizeOrderId(m[1]) : "";
  }

  function isSokoniOrderId(id) {
    const raw = String(id ?? "").trim();
    if (!raw || !ORDER_ID_TOKEN_RE.test(raw)) return false;
    const n = normalizeOrderId(raw);
    return Boolean(n && (/^SKN-\d+(-\d+)?$/.test(n) || /^SK-\d+$/.test(n)));
  }

  global.SokoniOrderId = {
    ORDER_ID_RE,
    normalizeOrderId,
    extractOrderIdFromText,
    isSokoniOrderId,
  };
})(typeof window !== "undefined" ? window : globalThis);
