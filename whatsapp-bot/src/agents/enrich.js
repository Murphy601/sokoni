/**
 * Context snapshot attached to an event before agents see it.
 *
 * publish() stays synchronous and allocation-free on purpose: a webhook must
 * not wait on Postgres. This path is the one that can look a user up, and it
 * always leaves the caller's stack first.
 *
 * The lookup uses columns that exist: rating, completed orders, pending
 * escrow on the user. There is no trust score column, and contact numbers are
 * not copied onto the bus — a listener that logs the event would otherwise
 * rebroadcast them.
 */

import { isDbEnabled, query } from "../db/pool.js";
import { agentBus } from "./event-bus.js";

const PARTY_KEYS = ["senderUserId", "receiverUserId"];

function intId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Copy only the fields agents are allowed to see. */
export function pickEventData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const data = {};
  const senderUserId = intId(raw.senderUserId);
  const receiverUserId = intId(raw.receiverUserId);
  const flaggedId = intId(raw.flaggedId);
  const messageId = intId(raw.messageId);
  if (senderUserId) data.senderUserId = senderUserId;
  if (receiverUserId) data.receiverUserId = receiverUserId;
  if (flaggedId) data.flaggedId = flaggedId;
  if (messageId) data.messageId = messageId;
  if (raw.violationType) data.violationType = String(raw.violationType).slice(0, 32);
  if (raw.kind) data.kind = String(raw.kind).slice(0, 40);
  if (raw.orderId) data.orderId = String(raw.orderId).slice(0, 40);
  if (raw.escrowStatus) data.escrowStatus = String(raw.escrowStatus).slice(0, 32);
  const amountKes = finiteNumber(raw.amountKes);
  if (amountKes != null) data.amountKes = amountKes;
  if (typeof raw.text === "string" && raw.text) data.text = raw.text.slice(0, 400);
  return data;
}

function mapParty(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    displayName: row.display_name || null,
    role: row.role || null,
    handle: row.handle || null,
    sellerVerified: Boolean(row.is_seller_verified),
    pendingEscrowKes: Number(row.pending_escrow) || 0,
    ratingScore: Number(row.rating_score),
    ratingCount: Number(row.rating_count) || 0,
    completedOrders: Number(row.completed_orders) || 0,
    disputeCount: Number(row.dispute_count) || 0,
    unresolvedDisputes: Number(row.unresolved_disputes) || 0,
    badgeTier: row.badge_tier || null,
  };
}

/**
 * One primary-key read for the two people in the thread.
 * Returns {} when there is nothing to look up or the database is off.
 */
export async function enrichContext(data) {
  if (!isDbEnabled()) return {};
  const ids = [];
  for (const key of PARTY_KEYS) {
    const id = intId(data?.[key]);
    if (id) ids.push(id);
  }
  const unique = [...new Set(ids)];
  if (!unique.length) return {};

  const { rows } = await query(
    `SELECT id, display_name, role, handle,
            is_seller_verified, pending_escrow,
            rating_score, rating_count, completed_orders,
            dispute_count, unresolved_disputes, badge_tier
     FROM users
     WHERE id = ANY($1::int[])`,
    [unique]
  );
  const byId = new Map(rows.map((row) => [Number(row.id), mapParty(row)]));
  return {
    sender: byId.get(intId(data.senderUserId)) || null,
    receiver: byId.get(intId(data.receiverUserId)) || null,
  };
}

async function emitEnriched(event, rawData, lookup) {
  const data = pickEventData(rawData);
  let context = {};
  const hasParty = Boolean(data.senderUserId || data.receiverUserId);
  if (hasParty && lookup) {
    try {
      const found = await lookup(data);
      if (found && typeof found === "object" && !Array.isArray(found)) context = found;
    } catch (err) {
      console.warn("[agent-bus] context skipped:", err?.message || err);
    }
  }
  const richEvent = {
    eventId: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    eventType: String(event),
    timestamp: Date.now(),
    data,
    context,
  };
  agentBus.publish(event, richEvent);
  return richEvent;
}

/**
 * Enrich, then publish. Returns immediately.
 *
 * The promise settles after the event is on the bus so a test can await it.
 * Request handlers must not await it: a slow lookup must not stall M-Pesa or
 * a chat send. A lookup that throws still publishes, with an empty context.
 *
 * @param {string} event
 * @param {object} [rawData]
 * @param {(data: object) => Promise<object>} [lookup]
 */
export function publishEnriched(event, rawData = {}, lookup = enrichContext) {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      emitEnriched(event, rawData, lookup).then(resolve, reject);
    });
  }).catch((err) => {
    console.warn("[agent-bus] enrich failed:", err?.message || err);
    return null;
  });
}
