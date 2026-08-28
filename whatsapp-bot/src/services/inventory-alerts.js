/**
 * Seller inventory alerts — WhatsApp when stock hits low / zero.
 * Threshold matches Seller Hub badge (LOW_STOCK_THRESHOLD).
 */
import { getSupplier } from "./suppliers.js";
import {
  LOW_STOCK_THRESHOLD,
  isLowStock,
  listProductVariants,
  productStockOnHand,
} from "./product-availability.js";

const lastAlertAt = new Map();
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h per product

function sellerChatCandidates(supplier) {
  const chats = [];
  if (supplier?.whatsappChatId) chats.push(supplier.whatsappChatId);
  if (supplier?.phone) {
    const digits = String(supplier.phone).replace(/\D/g, "");
    if (digits) chats.push(`${digits}@c.us`);
  }
  return [...new Set(chats.filter(Boolean))];
}

function variantSummary(product) {
  const variants = listProductVariants(product);
  if (!variants.length) return "";
  const low = variants.filter((v) => v.stockQuantity > 0 && v.stockQuantity <= LOW_STOCK_THRESHOLD);
  const lines = (low.length ? low : variants.slice(0, 6)).map((v) => {
    const label = [v.size, v.color].filter(Boolean).join("/") || v.id;
    return `· ${label}: ${v.stockQuantity}`;
  });
  return lines.length ? `\n${lines.join("\n")}` : "";
}

/**
 * Notify seller on WhatsApp when units are low or zero after a stock change.
 * Fail-soft — never blocks checkout / stock save.
 */
export async function notifySellerLowStock(product, { reason = "stock_update" } = {}) {
  try {
    if (!product?.id || !product.supplierId) return { skipped: true, reason: "no_supplier" };
    const onHand = productStockOnHand(product);
    const low = isLowStock(product) || onHand === 0;
    if (!low) return { skipped: true, reason: "ok_stock" };

    const key = `${product.id}:${onHand === 0 ? "zero" : "low"}`;
    const prev = lastAlertAt.get(key) || 0;
    if (Date.now() - prev < ALERT_COOLDOWN_MS) {
      return { skipped: true, reason: "cooldown" };
    }

    const supplier = getSupplier(product.supplierId);
    const chats = sellerChatCandidates(supplier);
    if (!chats.length) return { skipped: true, reason: "no_chat" };

    const name = product.name || product.id;
    const hub = "https://sokonimall.com/suppliers/list.html";
    const body =
      onHand === 0
        ? `📦 *Out of stock*\n*${name}* has *0* units left — buyers won't see it until you restock.\n\nUpdate units / size-colour variants in Seller Hub:\n${hub}\n_(${reason})_`
        : `⚠️ *Low stock*\n*${name}* — only *${onHand}* unit${onHand === 1 ? "" : "s"} left (alert at ≤${LOW_STOCK_THRESHOLD}).${variantSummary(product)}\n\nRestock in Seller Hub:\n${hub}\n_(${reason})_`;

    const { sendText } = await import("./whatsapp.js");
    for (const to of chats) {
      try {
        await sendText(to, body);
      } catch (err) {
        console.warn("[inventory-alerts] send failed:", to, err.message);
      }
    }
    lastAlertAt.set(key, Date.now());
    return { ok: true, onHand, productId: product.id };
  } catch (err) {
    console.warn("[inventory-alerts]", err.message);
    return { error: err.message };
  }
}

export { LOW_STOCK_THRESHOLD };
