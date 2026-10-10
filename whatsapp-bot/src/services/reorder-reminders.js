/**
 * 30-day consumable re-order nudges. Numbered replies — WAHA buttons are unreliable.
 */
import { listAllOrders } from "./orders.js";
import { isDbEnabled, query } from "../db/pool.js";
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";

export const REORDER_WINDOW_DAYS = Number(process.env.REORDER_REMINDER_DAYS || 30) || 30;
export const REORDER_HOUR_EAT = Number(process.env.REORDER_REMINDER_HOUR_EAT ?? 9);

const CONSUMABLE_RE =
  /\b(skincare|skin care|serum|lotion|cream|moisturizer|moisturiser|sunscreen|soap|shampoo|conditioner|toothpaste|deodorant|perfume|fragrance|oil|supplement|vitamin|tea|coffee|grocery|groceries|spice|sauce|honey|detergent|pad|liner|wipe)\b/i;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isConsumableOrder(order = {}, product = null) {
  const blob = [
    order.productName,
    order.category,
    order.productCategory,
    product?.name,
    product?.category,
    product?.subcategory,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ]
    .filter(Boolean)
    .join(" ");
  return CONSUMABLE_RE.test(blob);
}

export function orderDeliveredAt(order) {
  const hist = Array.isArray(order.history) ? order.history : [];
  const last = [...hist].reverse().find((h) => String(h.status || "") === "delivered");
  if (last?.at) return Number(last.at) || 0;
  if (String(order.status || "") === "delivered") {
    return Number(order.updatedAt || order.deliveredAt || order.createdAt) || 0;
  }
  return 0;
}

export function isDeliveredAboutDaysAgo(order, days = REORDER_WINDOW_DAYS, now = Date.now()) {
  const at = orderDeliveredAt(order);
  if (!at) return false;
  const age = now - at;
  const target = days * DAY_MS;
  return age >= target - 18 * 60 * 60 * 1000 && age < target + 30 * 60 * 60 * 1000;
}

export function listReorderCandidates(now = Date.now()) {
  return listAllOrders().filter((o) => {
    if (o.kind === "cart_child") return false;
    if (String(o.status || "") !== "delivered") return false;
    if (!isDeliveredAboutDaysAgo(o, REORDER_WINDOW_DAYS, now)) return false;
    return isConsumableOrder(o);
  });
}

async function alreadySent(orderId, phone) {
  if (isDbEnabled()) {
    try {
      const { rows } = await query(
        `SELECT 1 FROM reorder_reminders
          WHERE order_id = $1 AND phone = $2
            AND (snooze_until IS NULL OR snooze_until > NOW())
          LIMIT 1`,
        [orderId, phone]
      );
      if (rows?.length) return true;
    } catch {
      /* allow send */
    }
  }
  return false;
}

async function recordSent({ orderId, phone, productId, snoozeUntil = null }) {
  if (!isDbEnabled()) return;
  try {
    await query(
      `INSERT INTO reorder_reminders (order_id, phone, product_id, snooze_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (order_id, phone) DO UPDATE SET
         sent_at = NOW(),
         snooze_until = EXCLUDED.snooze_until,
         product_id = COALESCE(EXCLUDED.product_id, reorder_reminders.product_id)`,
      [orderId, phone, productId || null, snoozeUntil]
    );
  } catch (err) {
    console.warn("[reorder] record skipped:", err.message);
  }
}

export function reorderMenuText(order) {
  const name = order.productName || "your last order";
  return (
    `About 30 days since *${name}* was delivered.\n\n` +
    `1. Re-order now (prepaid escrow)\n` +
    `2. Remind me in a week\n\n` +
    `_Reply with the number._`
  );
}

export async function snoozeReorderReminder({ orderId, phone, days = 7 }) {
  const until = new Date(Date.now() + days * DAY_MS).toISOString();
  await recordSent({ orderId, phone: normalizeKenyaPhone(phone) || phone, snoozeUntil: until });
  return { ok: true, snoozeUntil: until };
}

export async function sendReorderReminders({ now = Date.now(), sender } = {}) {
  const { sendText, toChatId } = await import("./whatsapp.js");
  const { setMenuState } = await import("./session.js");
  const send = sender || sendText;
  const candidates = listReorderCandidates(now);
  let sent = 0;

  for (const order of candidates.slice(0, 40)) {
    const phone = normalizeKenyaPhone(order.phone || order.mpesaPhone || order.customerKey);
    if (!phone) continue;
    if (await alreadySent(order.id, phone)) continue;

    const chatId = toChatId(phone);
    setMenuState(chatId, {
      type: "reorder_reminder",
      orderId: order.id,
      productId: order.productId || null,
      options: [
        { id: `reorder_now_${order.productId || order.id}`, label: "Re-order now" },
        { id: `reorder_week_${order.id}`, label: "Remind me in a week" },
      ],
    });

    try {
      await send(chatId, reorderMenuText(order));
      await recordSent({ orderId: order.id, phone, productId: order.productId || null });
      sent += 1;
    } catch (err) {
      console.warn("[reorder] send failed:", order.id, err.message);
    }
  }
  return { ok: true, candidates: candidates.length, sent };
}
