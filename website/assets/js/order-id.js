/**
 * Shared Sokoni order / tracking ID helpers (website).
 * Accepts legacy SK-#### and cart SKN-#### / SKN-####-n.
 * Never coerces SKN-1002-1 → SK-10021.
 */
(function (global) {
  "use strict";

  const ORDER_ID_RE = /\b(SKN-\d+(?:-\d+)?|SK-\d+)\b/i;

  function normalizeOrderId(id) {
    if (id == null || id === "") return "";
    let raw = String(id).trim().toUpperCase();
    if (!raw) return "";

    raw = raw.replace(/^SKN(?=\d)/, "SKN-").replace(/^SK(?!N)(?=\d)/, "SK-");

    if (/^SKN-\d+-\d+$/.test(raw)) return raw;
    if (/^SKN-\d+$/.test(raw)) return raw;
    if (/^SK-\d+$/.test(raw)) return raw;
    if (raw.startsWith("SKN-") || raw.startsWith("SK-")) return raw;

    const digits = raw.replace(/\D/g, "");
    return digits ? `SK-${digits}` : "";
  }

  function extractOrderIdFromText(text) {
    const m = String(text || "").match(ORDER_ID_RE);
    return m ? normalizeOrderId(m[1]) : "";
  }

  global.SokoniOrderId = {
    ORDER_ID_RE,
    normalizeOrderId,
    extractOrderIdFromText,
  };
})(typeof window !== "undefined" ? window : globalThis);
