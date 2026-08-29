/**
 * Layer 3 — Dynamic user context for the LLM (does not replace tools or command router).
 * Fail-soft: missing DB / suppliers / riders never throws into the agent turn.
 *
 * Updating this block does NOT wipe system-prompt training — it only injects live state.
 */
import { getOrdersForCustomer } from "./orders.js";
import { orderBuyerTotal } from "./shipping-tiers.js";

function digits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d;
}

function formatOrderLine(o) {
  const total = Math.round(Number(orderBuyerTotal(o) || o.totalKes || o.priceKes || 0));
  const pay = o.customerPaymentStatus === "confirmed" ? "paid" : o.paymentStatus || o.status;
  const ship = o.bodaStatus || o.shipmentStatus || o.fulfillmentMode || "—";
  return `- ${o.id}: ${String(o.productName || "item").slice(0, 40)} · KES ${total.toLocaleString()} · ${pay} · ${ship}`;
}

/**
 * Build a compact USER CONTEXT block for buildGroundedSystemPrompt.
 * @returns {Promise<string>}
 */
export async function buildUserContextBlock({ phone = "", customerKey = "" } = {}) {
  const lines = ["### DYNAMIC USER CONTEXT (Layer 3 — live; prefer LOOKUP RESULTS if they conflict)"];
  const phoneDigits = digits(phone || customerKey);
  lines.push(`Phone: ${phoneDigits || "(unknown)"}`);

  let role = "buyer_or_guest";
  try {
    const { findSupplierByPhone } = await import("./suppliers.js");
    const supplier = phoneDigits ? findSupplierByPhone(phoneDigits) : null;
    if (supplier?.id) {
      role = "seller";
      lines.push(
        `Role: seller · shop=${supplier.shopName || supplier.name || "—"} · id=${supplier.id}`
      );
      lines.push(
        "Seller money questions: use LOOKUP RESULTS from get_seller_payout when present; else tell them to reply *balance*."
      );
    }
  } catch {
    /* ignore */
  }

  try {
    const { isDbEnabled, query } = await import("../db/pool.js");
    if (isDbEnabled() && phoneDigits) {
      const { rows } = await query(
        `SELECT id, full_name, operating_town, verification_status, is_available, rating
           FROM riders WHERE phone = $1 LIMIT 1`,
        [phoneDigits]
      );
      if (rows[0]) {
        role = role === "seller" ? "seller_and_rider" : "rider";
        const r = rows[0];
        lines.push(
          `Role: rider · #${r.id} ${r.full_name || "—"} · zone=${r.operating_town || "—"} · ` +
            `${r.verification_status || "—"} · ${r.is_available ? "AVAILABLE" : "OFFLINE"} · ★${Number(r.rating || 5).toFixed(1)}`
        );
      }
    }
  } catch {
    /* riders table may be absent */
  }

  if (role === "buyer_or_guest") lines.push("Role: buyer_or_guest");

  try {
    const orders = getOrdersForCustomer(customerKey || phone, phoneDigits).slice(0, 5);
    if (orders.length) {
      lines.push("Recent orders:");
      for (const o of orders) lines.push(formatOrderLine(o));
    } else {
      lines.push("Recent orders: (none on this WhatsApp)");
    }
  } catch {
    lines.push("Recent orders: (unavailable)");
  }

  lines.push(
    "Note: Custody actions (ACCEPT / PICKUP / CONFIRM / WAYBILL / PARTIAL_REFUND) are Layer 1 commands — instruct the exact format; do not pretend you executed them."
  );

  return lines.join("\n");
}
