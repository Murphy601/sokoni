/**
 * Native WhatsApp catalog / order-cart payloads from WAHA.
 * Interactive list/buttons are unreliable on this WAHA build — we still use numbered menus.
 * A cart JSON from WhatsApp becomes the same pendingCart as the website bag handoff.
 * STK waits until delivery details exist (shipping gate).
 */
import { getProductById, searchProducts } from "./catalog.js";
import { computeCartLineFees, computeCartParentTotals } from "./cart-orders.js";
import { isMultiSellerCartEnabled } from "./platform-flags.js";
import { setPendingCart, clearPendingOrder, clearMenuState } from "./session.js";
import { sendText, sendProductImage } from "./whatsapp.js";

function firstArray(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  return [];
}

function kesFromAmount(raw, currency = "KES") {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1000 && Number.isInteger(n) && String(Math.round(n)).endsWith("000")) {
    return Math.round(n / 1000);
  }
  if (String(currency || "").toUpperCase() === "KES") return Math.round(n > 5000 && n % 1000 === 0 ? n / 1000 : n);
  return Math.round(n);
}

/**
 * Pull line items from WAHA order / catalog cart webhooks.
 */
export function extractWahaOrderCart(payload) {
  if (!payload || typeof payload !== "object") return null;
  const roots = [
    payload,
    payload._data,
    payload._data?.message,
    payload.message,
    payload.orderMessage,
    payload.order_message,
    payload._data?.orderMessage,
    payload._data?.message?.orderMessage,
  ].filter(Boolean);

  for (const root of roots) {
    const order =
      root.orderMessage ||
      root.order_message ||
      root.order ||
      (root.itemCount || root.items || root.productList ? root : null);
    if (!order) continue;
    const items = firstArray(
      order.productList,
      order.product_list,
      order.items,
      order.order?.items,
      order.order?.productList,
      root.items
    );
    const lines = items
      .map((it) => {
        const name = String(it.name || it.title || it.productName || "").trim();
        const qty = Math.max(1, Math.round(Number(it.quantity || it.qty || 1) || 1));
        const retailerId = String(it.productId || it.retailerId || it.id || "").trim() || null;
        const priceKes = kesFromAmount(
          it.amount ?? it.price ?? it.priceAmount1000 ?? it.priceAmount,
          it.currency || it.currencyCode
        );
        if (!name && !retailerId) return null;
        return { name, quantity: qty, retailerId, priceKes };
      })
      .filter(Boolean);
    if (!lines.length) continue;
    return {
      orderId: String(order.orderId || order.id || root.orderId || "").trim() || null,
      itemCount: lines.length,
      lines,
    };
  }
  return null;
}

async function resolveLine(line) {
  if (line.retailerId) {
    const byId = await getProductById(line.retailerId);
    if (byId) return { product: byId, quantity: line.quantity };
  }
  if (line.name) {
    const hits = await searchProducts(line.name);
    const exact = (hits || []).find((p) => String(p.name || "").toLowerCase() === line.name.toLowerCase());
    if (exact) return { product: exact, quantity: line.quantity };
    if (hits?.[0]) return { product: hits[0], quantity: line.quantity };
  }
  return null;
}

/**
 * Turn a native WhatsApp cart into pendingCart and ask for delivery details.
 * Does not fire STK until shipping is quoted (same as website bag).
 */
export async function startNativeWhatsAppCart(to, payload) {
  const cart = extractWahaOrderCart(payload);
  if (!cart?.lines?.length) return false;
  if (!isMultiSellerCartEnabled()) {
    await sendText(to, "One item at a time here. Type *menu* and reply *1* to order.");
    return true;
  }

  const resolved = [];
  for (const line of cart.lines.slice(0, 20)) {
    const hit = await resolveLine(line);
    if (!hit?.product) continue;
    const fees = computeCartLineFees({ ...hit.product, productId: hit.product.id }, hit.quantity);
    resolved.push({ product: hit.product, quantity: fees.quantity, fees });
  }

  if (!resolved.length) {
    await sendText(
      to,
      "I saw your WhatsApp cart but could not match those items in Sokoni stock. Type the product name, or *menu*."
    );
    return true;
  }

  clearPendingOrder(to);
  clearMenuState(to);
  const parentTotals = computeCartParentTotals(resolved.map((r) => r.fees));
  setPendingCart(to, {
    lines: resolved.map((r) => ({
      productId: r.product.id,
      quantity: r.quantity,
      name: r.product.name,
      lineBuyerKes: r.fees.lineBuyerKes,
    })),
    estimatedTotalKes: parentTotals.totalKes,
    estimatedTxnFeeKes: parentTotals.transactionFeeKes,
    estimatedPlatformFeeKes: parentTotals.platformFeeKes,
    createdAt: Date.now(),
    source: "whatsapp_native_cart",
  });

  for (const r of resolved) {
    const caption =
      `*${r.product.name}*\n` +
      `KES ${r.fees.lineBuyerKes.toLocaleString()}` +
      (r.quantity > 1 ? ` × ${r.quantity}` : "") +
      `\n_From your WhatsApp cart_`;
    try {
      const sent = await sendProductImage(to, r.product, caption);
      if (!sent) await sendText(to, caption);
    } catch {
      await sendText(to, caption);
    }
  }

  await sendText(
    to,
    `Cart (${resolved.length}) · ~KES ${parentTotals.totalKes.toLocaleString()}\n` +
      `Prepaid escrow holds until you confirm.\n\n` +
      `Send: *Name, location, phone*\n` +
      `Then we send the M-Pesa STK. Or *cancel*.`
  );
  return true;
}
