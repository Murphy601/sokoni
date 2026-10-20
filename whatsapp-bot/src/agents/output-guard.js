/**
 * Stop an agent reply from carrying a receipt code the database did not return.
 *
 * The receipt pattern needs both a letter and a digit, so a KES amount and an
 * order id like SKN-1042 stay intact. Matching ignores case, so qa12bc3456
 * is stripped the same way as QA12BC3456. Phone numbers are masked. It runs
 * on text we composed for the admin, never on a message a person typed.
 */

const RECEIPT_LIKE = /\b(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{10}\b/gi;
const PHONE_LIKE = /(?:\+?254|0)[17]\d{8}/g;

const ACTION_TYPES = new Set(["NOTIFY_SELLER", "SEND_UI_CARD", "QUEUE_LEVEL2_APPROVAL"]);
const ACTION_KEYS = new Set(["actionType", "targetId", "reason", "suggestedAmount"]);

export function sanitizeOutboundAgentText(text, validContext = {}) {
  const allowed = new Set(
    (Array.isArray(validContext.mpesaReceipts) ? validContext.mpesaReceipts : []).map((code) =>
      String(code).toUpperCase()
    )
  );
  const masked = String(text || "").replace(PHONE_LIKE, "[REDACTED_PHONE]");
  return masked.replace(RECEIPT_LIKE, (match) => {
    if (allowed.has(match.toUpperCase())) return match;
    console.warn("[admin-notifier] stripped an unverified receipt-like token");
    return "[Transaction Code Pending]";
  });
}

/**
 * Accept one structured agent suggestion. Anything outside the four fields,
 * or an amount that is not an integer, is dropped.
 */
export function parseAgentActionOutput(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const key of Object.keys(obj)) {
    if (!ACTION_KEYS.has(key)) return null;
  }
  if (!ACTION_TYPES.has(obj.actionType)) return null;
  if (typeof obj.targetId !== "string" || !obj.targetId.trim() || obj.targetId.length > 64) return null;
  if (typeof obj.reason !== "string" || obj.reason.length > 200) return null;
  const out = {
    actionType: obj.actionType,
    targetId: obj.targetId.trim(),
    reason: obj.reason,
  };
  if (Object.prototype.hasOwnProperty.call(obj, "suggestedAmount") && obj.suggestedAmount != null) {
    if (!Number.isInteger(obj.suggestedAmount)) return null;
    out.suggestedAmount = obj.suggestedAmount;
  }
  return out;
}
