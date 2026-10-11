/**
 * Morning catalog drop — posts to WhatsApp Status AND the official Channel.
 * Off unless DAILY_DROP_ENABLED=true. Caption is prepaid-escrow, countrywide Kenya.
 */
import { config } from "../config.js";

export const DAILY_DROP_HOUR_EAT = Number(config.dailyDrop?.hourEat ?? 8) || 8;

function popularity(product) {
  if (product.views != null || product.viewCount != null || product.impressions != null) {
    return Number(product.views ?? product.viewCount ?? product.impressions) || 0;
  }
  return Number(product.reviews || 0) * 10 + Number(product.rating || 0);
}

export function pickDailyDropItems(products = [], limit = 5) {
  return (Array.isArray(products) ? products : [])
    .filter((p) => p && p.inStock !== false && !p.isSold && isProductLive(p))
    .sort((a, b) => popularity(b) - popularity(a) || (Number(b.rating) || 0) - (Number(a.rating) || 0))
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 5)));
}

function isProductLive(p) {
  const qty = Number(p.quantity ?? p.stock ?? 1);
  return !Number.isFinite(qty) || qty > 0;
}

export function dailyDropCaption(items = []) {
  const rows = items.slice(0, 5).map((p, i) => {
    const kes = Number(p.priceKes ?? p.price) || 0;
    return `${i + 1}. ${String(p.name || "Item").slice(0, 60)}${kes ? ` — KES ${kes}` : ""}`;
  });
  return (
    `Today's drop — ${rows.length} still available. Prepaid M-Pesa escrow.\n\n` +
    `${rows.join("\n")}\n\n` +
    `Shop on WhatsApp or sokonimall.com. Countrywide Kenya — never pay a rider directly.`
  );
}

export async function loadDailyDropItems(limit = 5) {
  const { searchProducts } = await import("./catalog.js");
  const products = await searchProducts({ keywords: "", limit: 40 });
  return pickDailyDropItems(products, limit);
}

export async function runDailyDrop(extras = {}) {
  const items = extras.items || (await loadDailyDropItems(5));
  if (!items.length) {
    return { ok: false, error: "empty_catalog", tool: "daily_drop", message: "No unsold listings to post." };
  }
  const text = extras.text || dailyDropCaption(items);
  const { isAllowedOpsMediaUrl } = await import("./ops-desk-actions.js");
  let media = String(extras.media_url || extras.mediaUrl || "").trim();
  if (!media) {
    const lead = items[0] || {};
    try {
      const { catalogImageBotUrl, resolveStorefrontImageUrl } = await import("../lib/catalog-images.js");
      media = catalogImageBotUrl(lead) || resolveStorefrontImageUrl(lead) || "";
    } catch {
      media = lead.image || lead.imageUrl || lead.photo || "";
    }
  }
  media = String(media || "").trim();
  const mediaSkipped = Boolean(media) && !isAllowedOpsMediaUrl(media);
  if (mediaSkipped) media = "";
  const dest = String(extras.destination_type || extras.destination || config.dailyDrop?.destination || "BOTH")
    .trim()
    .toUpperCase();
  const { publishWhatsAppStatusOrChannel } = await import("./ops-desk-actions.js");
  const posted = await publishWhatsAppStatusOrChannel(
    {
      destination_type: dest === "STATUS" || dest === "CHANNEL" ? dest : "BOTH",
      channel_id: extras.channel_id || config.waha?.channelId,
      text,
      media_url: media || undefined,
    },
    extras
  );
  return {
    ...posted,
    tool: posted.tool || "publish_whatsapp_status_or_channel",
    dailyDrop: true,
    itemCount: items.length,
    mediaSkipped: mediaSkipped || undefined,
    items: items.map((p) => ({ id: p.id, name: p.name, priceKes: p.priceKes })),
  };
}
