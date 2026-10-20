/**
 * Seller inventory alerts — WhatsApp when stock hits low / zero.
 * Threshold matches Seller Hub badge (LOW_STOCK_THRESHOLD).
 */
import { getSupplier } from "./suppliers.js";
import { config } from "../config.js";
import {
  LOW_STOCK_THRESHOLD,
  isLowStock,
  listProductVariants,
  productStockOnHand,
} from "./product-availability.js";
import { msgSellerLowStock, sellerHubRestockUrl } from "../lib/wa-ux.js";

export const ADMIN_LOW_STOCK_UNITS = Number(process.env.ADMIN_LOW_STOCK_UNITS || 5) || 5;

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
  return lines.length ? lines.join("\n") : "";
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
    const body = msgSellerLowStock({
      itemName: name,
      remainingUnits: onHand,
      restockUrl: sellerHubRestockUrl(),
      variantLines: variantSummary(product),
    });

    const { sendText } = await import("./whatsapp.js");
    for (const to of chats) {
      try {
        await sendText(to, body);
      } catch (err) {
        console.warn("[inventory-alerts] send failed:", to, err.message);
      }
    }
    lastAlertAt.set(key, Date.now());
    await notifyAdminLowStock(product, { onHand });
    return { ok: true, onHand, productId: product.id };
  } catch (err) {
    console.warn("[inventory-alerts]", err.message);
    return { error: err.message };
  }
}

export async function notifyAdminLowStock(product, { onHand } = {}) {
  try {
    const units = onHand != null ? Number(onHand) : productStockOnHand(product);
    if (!(units <= ADMIN_LOW_STOCK_UNITS)) return { skipped: true, reason: "ok_stock" };
    const key = `admin:${product?.id}:${units === 0 ? "zero" : "low"}`;
    const prev = lastAlertAt.get(key) || 0;
    if (Date.now() - prev < ALERT_COOLDOWN_MS) return { skipped: true, reason: "cooldown" };

    const admins = [
      ...new Set(
        [...(config.admin?.phones || []), config.admin?.primary]
          .map((p) => String(p || "").replace(/\D/g, ""))
          .filter((p) => p.length >= 9)
      ),
    ];
    if (!admins.length) return { skipped: true, reason: "no_admin" };

    const name = product?.name || product?.id || "listing";
    const body =
      `⚠️ *Low stock*\n\n` +
      `• *${name}*\n` +
      `• Units: *${units}* (alert under ${ADMIN_LOW_STOCK_UNITS})\n` +
      `Seller Hub restock: ${sellerHubRestockUrl()}`;

    const { sendText } = await import("./whatsapp.js");
    for (const phone of admins) {
      try {
        await sendText(`${phone}@c.us`, body);
      } catch (err) {
        console.warn("[inventory-alerts] admin send failed:", phone, err.message);
      }
    }
    lastAlertAt.set(key, Date.now());
    return { ok: true, onHand: units };
  } catch (err) {
    console.warn("[inventory-alerts] admin:", err.message);
    return { error: err.message };
  }
}

export { LOW_STOCK_THRESHOLD };
