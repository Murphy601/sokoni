/**
 * Durable chat memory in Postgres (fail-soft).
 * Keys by phone digits + chat id so @lid / @c.us share state when phone is known.
 */
import { isDbEnabled, query } from "../db/pool.js";

function phoneDigits(raw) {
  return String(raw || "").replace(/\D/g, "");
}

export function memoryKeys(customerKey, phone = "") {
  const keys = new Set();
  if (customerKey) keys.add(String(customerKey));
  const digits = phoneDigits(phone) || phoneDigits(customerKey);
  if (digits && digits.length >= 9) {
    keys.add(digits);
    keys.add(`${digits}@c.us`);
  }
  return [...keys];
}

export async function loadChatMemory(customerKey, phone = "") {
  if (!isDbEnabled() || !customerKey) return null;
  const keys = memoryKeys(customerKey, phone);
  try {
    const { rows } = await query(
      `SELECT phone_key, thread_id, history, customer_meta, human_handoff, last_product_context, updated_at
         FROM chat_memory
        WHERE phone_key = ANY($1::text[])
        ORDER BY updated_at DESC
        LIMIT 1`,
      [keys]
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      phoneKey: row.phone_key,
      threadId: row.thread_id || null,
      history: Array.isArray(row.history) ? row.history : [],
      customerMeta: row.customer_meta && typeof row.customer_meta === "object" ? row.customer_meta : {},
      humanHandoff: row.human_handoff || null,
      lastProductContext: row.last_product_context || null,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    if (!/chat_memory|does not exist/i.test(String(err.message || ""))) {
      console.warn("[chat-memory] load skipped:", err.message);
    }
    return null;
  }
}

export async function saveChatMemory(customerKey, snapshot = {}, phone = "") {
  if (!isDbEnabled() || !customerKey) return { ok: false };
  const keys = memoryKeys(customerKey, phone || snapshot.customerMeta?.phone);
  const primary = keys[0] || customerKey;
  const history = Array.isArray(snapshot.history) ? snapshot.history.slice(-40) : [];
  const meta = snapshot.customerMeta && typeof snapshot.customerMeta === "object" ? snapshot.customerMeta : {};
  const handoff = snapshot.humanHandoff || null;
  const lastProduct = snapshot.lastProductContext || null;
  const threadId = snapshot.threadId || primary;

  try {
    // Upsert primary + mirror phone digit key for cross-id recovery
    for (const key of keys.slice(0, 3)) {
      await query(
        `INSERT INTO chat_memory
           (phone_key, thread_id, history, customer_meta, human_handoff, last_product_context, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
         ON CONFLICT (phone_key) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           history = EXCLUDED.history,
           customer_meta = EXCLUDED.customer_meta,
           human_handoff = EXCLUDED.human_handoff,
           last_product_context = EXCLUDED.last_product_context,
           updated_at = NOW()`,
        [
          key,
          threadId,
          JSON.stringify(history),
          JSON.stringify(meta),
          handoff ? JSON.stringify(handoff) : null,
          lastProduct ? JSON.stringify(lastProduct) : null,
        ]
      );
    }
    return { ok: true };
  } catch (err) {
    if (!/chat_memory|does not exist/i.test(String(err.message || ""))) {
      console.warn("[chat-memory] save skipped:", err.message);
    }
    return { ok: false, reason: err.message };
  }
}

/** Debounced async persist — never blocks WhatsApp webhook. */
const pending = new Map();
export function scheduleChatMemorySave(customerKey, getSnapshot, phone = "") {
  if (!customerKey || typeof getSnapshot !== "function") return;
  const prev = pending.get(customerKey);
  if (prev) clearTimeout(prev);
  pending.set(
    customerKey,
    setTimeout(() => {
      pending.delete(customerKey);
      let snap;
      try {
        snap = getSnapshot();
      } catch {
        return;
      }
      void saveChatMemory(customerKey, snap, phone).catch(() => {});
    }, 250)
  );
}
