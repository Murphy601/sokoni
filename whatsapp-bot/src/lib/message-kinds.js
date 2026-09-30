/**
 * Inbox message kinds and their payload shapes.
 *
 * A message is either something a person typed or a card the product renders.
 * Both live in the same table and the same thread, so the client needs one
 * place to learn what each kind carries. Validation happens here rather than
 * in the schema: a CHECK per kind would mean a migration every time a card
 * gains a field.
 *
 * Unknown kinds are not an error. An older client that has never heard of
 * 'swap_offer' falls back to the message's own text, so shipping a new card
 * never blanks a thread for someone on a stale page.
 */

/** @typedef {"text"|"image"|"voice"|"video"|"escrow_status"|"deal_ledger"|"offer_card"|"swap_offer"|"bundle"|"locked_drop"|"scratch_card"|"fit_check"|"nudge"} MessageKind */

export const MESSAGE_KINDS = Object.freeze({
  TEXT: "text",
  IMAGE: "image",
  VOICE: "voice",
  VIDEO: "video",
  ESCROW_STATUS: "escrow_status",
  DEAL_LEDGER: "deal_ledger",
  OFFER_CARD: "offer_card",
  SWAP_OFFER: "swap_offer",
  BUNDLE: "bundle",
  LOCKED_DROP: "locked_drop",
  SCRATCH_CARD: "scratch_card",
  FIT_CHECK: "fit_check",
  NUDGE: "nudge",
});

const ALL = new Set(Object.values(MESSAGE_KINDS));

/** Cards the system injects. A person can never send one of these. */
const SYSTEM_ONLY = new Set([
  MESSAGE_KINDS.ESCROW_STATUS,
  MESSAGE_KINDS.DEAL_LEDGER,
  MESSAGE_KINDS.FIT_CHECK,
]);

/**
 * Required payload fields per kind. Anything else in the payload is kept --
 * cards gain fields over time and an older row must not stop rendering.
 */
const REQUIRED = {
  // mediaUrl, not url: getMessageMedia reads payload.mediaUrl, and two names
  // for the same thing is how a voice note ends up failing validation while
  // looking correct in every log.
  //
  // Duration is not required. WAHA does not always report it, and a voice
  // note whose length is unknown is still a voice note -- the player reads it
  // from the stream. Demanding it would reject real messages.
  [MESSAGE_KINDS.IMAGE]: ["mediaUrl"],
  [MESSAGE_KINDS.VOICE]: ["mediaUrl"],
  [MESSAGE_KINDS.VIDEO]: ["mediaUrl"],
  [MESSAGE_KINDS.ESCROW_STATUS]: ["orderRef", "state"],
  [MESSAGE_KINDS.DEAL_LEDGER]: ["orderRef", "state"],
  [MESSAGE_KINDS.OFFER_CARD]: ["offerId"],
  [MESSAGE_KINDS.SWAP_OFFER]: ["offeredProductIds", "wantedProductId"],
  [MESSAGE_KINDS.BUNDLE]: ["productIds"],
  [MESSAGE_KINDS.LOCKED_DROP]: ["productId", "unlocksAt"],
  [MESSAGE_KINDS.SCRATCH_CARD]: ["perk"],
  [MESSAGE_KINDS.FIT_CHECK]: ["orderRef"],
  [MESSAGE_KINDS.NUDGE]: [],
};

/** Escrow states a card may show, in the order they happen. */
export const ESCROW_STATES = Object.freeze([
  "awaiting_payment",
  "locked",
  "dispatched",
  "delivered",
  "released",
  "refunded",
  "disputed",
]);

export function isKnownKind(kind) {
  return ALL.has(String(kind || ""));
}

export function isSystemKind(kind) {
  return SYSTEM_ONLY.has(String(kind || ""));
}

/**
 * Check a payload before it is stored.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 * @returns {{ok: true, payload: Record<string, unknown>} | {ok: false, error: string, message: string}}
 */
/**
 * Kinds whose `content` is prose a person typed.
 *
 * Everything else carries a sentence the platform wrote -- "🎁 A deal to
 * scratch", an escrow state -- so screening it would only ever produce false
 * positives. A photo or video caption is typed by a person and has to be
 * screened exactly like a text message; leaving it out meant a caption was a
 * clean way to pass a phone number and take the deal off-platform.
 */
export const USER_AUTHORED_KINDS = Object.freeze([
  MESSAGE_KINDS.TEXT,
  MESSAGE_KINDS.IMAGE,
  MESSAGE_KINDS.VIDEO,
]);

/** True when this kind's content came from a person, not from Sokoni. */
export function isUserAuthoredKind(kind) {
  return USER_AUTHORED_KINDS.includes(String(kind || ""));
}

export function validatePayload(kind, payload = {}) {
  const k = String(kind || MESSAGE_KINDS.TEXT);
  if (!isKnownKind(k)) {
    return { ok: false, error: "unknown_kind", message: `Unknown message kind: ${k}` };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "bad_payload", message: "payload must be an object." };
  }

  const missing = (REQUIRED[k] || []).filter((field) => {
    const v = payload[field];
    if (Array.isArray(v)) return v.length === 0;
    return v === undefined || v === null || v === "";
  });
  if (missing.length) {
    return {
      ok: false,
      error: "missing_payload_fields",
      message: `${k} needs: ${missing.join(", ")}`,
    };
  }

  if (
    (k === MESSAGE_KINDS.ESCROW_STATUS || k === MESSAGE_KINDS.DEAL_LEDGER) &&
    !ESCROW_STATES.includes(String(payload.state))
  ) {
    return {
      ok: false,
      error: "bad_escrow_state",
      message: `state must be one of: ${ESCROW_STATES.join(", ")}`,
    };
  }

  return { ok: true, payload };
}

/**
 * Plain-text stand-in for a card.
 *
 * Every card needs one. It is what a client that does not know the kind shows,
 * what the thread preview in the inbox list shows, and what goes to WhatsApp
 * where there is no card to render at all.
 *
 * @param {string} kind
 * @param {Record<string, any>} payload
 * @returns {string}
 */
export function fallbackText(kind, payload = {}) {
  const money = (n) => `KES ${Number(n || 0).toLocaleString("en-US")}`;
  switch (kind) {
    case MESSAGE_KINDS.IMAGE:
      return "📷 Photo";
    case MESSAGE_KINDS.VOICE:
      return "🎤 Voice note";
    case MESSAGE_KINDS.VIDEO:
      return "🎥 Video";
    case MESSAGE_KINDS.ESCROW_STATUS:
    case MESSAGE_KINDS.DEAL_LEDGER:
      return `${payload.orderRef || "Order"}: ${String(payload.state || "").replace(/_/g, " ")}`;
    case MESSAGE_KINDS.OFFER_CARD:
      return payload.amountKes ? `Offer: ${money(payload.amountKes)}` : "Offer";
    case MESSAGE_KINDS.SWAP_OFFER:
      return payload.topUpKes
        ? `Swap proposed, plus ${money(payload.topUpKes)}`
        : "Swap proposed";
    case MESSAGE_KINDS.BUNDLE:
      return `Bundle of ${(payload.productIds || []).length} items${
        payload.priceKes ? ` — ${money(payload.priceKes)}` : ""
      }`;
    case MESSAGE_KINDS.LOCKED_DROP:
      return "🔒 Early access drop";
    case MESSAGE_KINDS.SCRATCH_CARD:
      return "🎁 A deal to scratch";
    case MESSAGE_KINDS.FIT_CHECK:
      return "📸 Share a fit pic";
    case MESSAGE_KINDS.NUDGE:
      return "👋 Nudge";
    default:
      return "";
  }
}
