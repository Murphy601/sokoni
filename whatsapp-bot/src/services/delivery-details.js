/**
 * Delivery detail parsing — shared so catalog search does not hijack order messages.
 */

export function normalizeKenyanPhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith("0") && digits.length === 10) return digits;
  if (digits.length === 9 && /^[17]/.test(digits)) return `0${digits}`;
  return null;
}

/** True when the message looks like name + location + phone (not a product search). */
export function looksLikeDeliveryDetails(text) {
  const t = String(text || "").trim();
  if (t.length < 10) return false;
  if (!/(?:\+?254|0)\d[\d\s-]{7,12}\d/.test(t)) return false;
  if (!/[,;]/.test(t)) return false;

  const withoutPhone = t
    .replace(/(?:\+?254|0)\d[\d\s-]{7,12}\d/g, "")
    .replace(/[,;]\s*$/, "")
    .trim();
  const parts = withoutPhone
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;

  const name = parts[0];
  const location = parts.slice(1).join(", ");
  return name.length >= 3 && location.length >= 3 && /[a-z]/i.test(location);
}

export function isOrderCorrectionMessage(text) {
  const lower = String(text || "").toLowerCase();
  if (looksLikeDeliveryDetails(text)) return false;
  return (
    /^(cancel|stop|nevermind|abort)(\s+order)?$/i.test(lower) ||
    /cancel order|change order|wrong item|wrong product/i.test(lower) ||
    /change|instead|wrong|not .*want|i choose|i wanted/i.test(lower) ||
    (/\bnot\b/i.test(lower) && /tv|phone|redmi|hisense|samsung|infinix|item|product/i.test(lower))
  );
}

/**
 * Strict parse — order only completes when name, location, and phone are all present.
 */
export function parseDeliveryDetails(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 12) return null;

  if (/^(yes|ok|okay|sure|confirm|proceed|done|thanks?|thank you|hi|hello|menu|\d{1,2})$/i.test(t)) {
    return null;
  }

  if (isOrderCorrectionMessage(t)) return null;

  const phoneMatch = t.match(/(?:\+?254|0)\d[\d\s-]{7,12}\d/);
  if (!phoneMatch) return null;

  const phone = normalizeKenyanPhone(phoneMatch[0]);
  if (!phone) return null;

  const withoutPhone = t
    .replace(phoneMatch[0], "")
    .replace(/[,;]\s*$/, "")
    .trim();

  const parts = withoutPhone
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const name = parts[0];
  const location = parts.slice(1).join(", ");

  if (name.length < 3 || name.split(/\s+/).length < 2) return null;
  if (location.length < 4) return null;
  if (/^(i want|i choose|looking for|send|show|hisense|redmi|samsung|infinix|smart tv|phone)/i.test(name)) {
    return null;
  }
  if (!/[a-z]/i.test(location)) return null;

  return { name, location, phone, raw: t };
}

export function deliveryDetailsHint(text) {
  const t = String(text || "").trim();
  const hasPhone = /(?:\+?254|0)\d[\d\s-]{7,12}\d/.test(t);
  const parts = t
    .replace(/(?:\+?254|0)\d[\d\s-]{7,12}\d/g, "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!hasPhone) {
    return "Please include your *phone number* for the rider (e.g. 0712345678).";
  }
  if (parts.length < 2) {
    return "Please send *name and location* separated by a comma.";
  }
  if (parts[0].split(/\s+/).length < 2) {
    return "Please include your *full name* (first and last name).";
  }
  if (parts.slice(1).join(", ").length < 4) {
    return "Please include a clearer *delivery location* (estate/town + landmark).";
  }
  return "Please send all three in one message: *full name, location, phone*.";
}
