/**
 * Where a buyer WhatsApp message should actually go.
 *
 * Web checkout stores customerKey as web:buyer:<id>. That string is not a
 * chat id. The registered phone lives on users.phone.
 */

import { isDbEnabled, query } from "../db/pool.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";
import { toChatId } from "./whatsapp.js";

export function buyerUserIdFromOrder(order) {
  const direct = Number(order?.buyerUserId);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = String(order?.customerKey || "").match(/^web:buyer:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function nationalForm(phone) {
  const intl = normalizeKenyaPhone(phone);
  if (!intl) return "";
  return intl.startsWith("254") && intl.length > 3 ? `0${intl.slice(3)}` : intl;
}

/**
 * The signed-in user id has to be the buyer on this order.
 * A matching tail of a phone number is not enough.
 */
export async function sessionBuyerOwnsOrder(order, buyerUserId) {
  const sessionId = Number(buyerUserId);
  if (!order || !Number.isInteger(sessionId) || sessionId < 1) return false;
  const onOrder = buyerUserIdFromOrder(order);
  if (onOrder && onOrder === sessionId) return true;

  const phone = normalizeKenyaPhone(order.phone || order.mpesaPhone || "");
  if (!phone || !isDbEnabled()) return false;
  try {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE id = $1 AND (phone = $2 OR phone = $3)
        LIMIT 1`,
      [sessionId, phone, nationalForm(phone)]
    );
    return Boolean(rows[0]);
  } catch (err) {
    console.warn("[buyer-whatsapp] owner lookup failed:", err?.message || err);
    return false;
  }
}

/** WAHA chat id for the buyer's registered phone, or empty when we cannot tell. */
export async function buyerWhatsAppDestination(order) {
  const direct = normalizeKenyaPhone(order?.phone || order?.mpesaPhone || order?.customerPhone || "");
  if (direct) return toChatId(direct);
  const key = String(order?.customerKey || "");
  if (key.includes("@")) return toChatId(key);

  const id = buyerUserIdFromOrder(order);
  if (!id || !isDbEnabled()) return "";
  try {
    const { rows } = await query(`SELECT phone FROM users WHERE id = $1`, [id]);
    const phone = normalizeKenyaPhone(rows[0]?.phone || "");
    return phone ? toChatId(phone) : "";
  } catch (err) {
    console.warn("[buyer-whatsapp] phone lookup skipped:", err?.message || err);
    return "";
  }
}
