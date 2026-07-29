/**
 * Phase 7 — Shared AI tools (catalog, orders, checkout meta).
 */
import { searchProducts, getProductById } from "./catalog.js";
import { getOrder, getOrdersForCustomer } from "./orders.js";
import { buildPublicTrackingPayload } from "./shipments.js";
import { checkoutMeta } from "./prepaid-checkout.js";
import { normalizeShopperQuery, isShopperFillerOnly } from "./shopper-language.js";

export const TOOL_NAMES = [
  "search_products",
  "get_product",
  "track_order",
  "list_orders",
  "store_info",
];

function extractOrderId(text) {
  const m = String(text || "").match(/\b(SK-\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractBudget(text) {
  const under = String(text || "").match(/(?:under|chini ya|below|less than)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (under) return Number(under[1].replace(/,/g, ""));
  return null;
}

function wantsSecondhand(text) {
  return /\b(thrift|pre[- ]?loved|second[- ]?hand|vintage|used|mtumba)\b/i.test(String(text || ""));
}

function wantsNew(text) {
  return /\b(brand new|new with tags|bnwt|new)\b/i.test(String(text || ""));
}

function isTrackOnlyQuery(text, lower) {
  if (/^SK-\d+$/i.test(text)) return true;
  return (
    /\b(track|tracking|status|wapi order|order yangu)\b/i.test(lower) &&
    !/\b(buy|want|need|find|search|show|looking|nataka)\b/i.test(lower)
  );
}

function isPaymentOnlyQuery(lower) {
  return (
    /\b(prepaid|escrow|mpesa|pay|payment|stk|till)\b/i.test(lower) &&
    !/\b(buy|want|need|find|search|show|looking|nataka|yoghurt|yogurt|dress|shoes|phone|simu)\b/i.test(
      lower
    )
  );
}

/** Intent router — runs tools before LLM (works on free models without function-calling). */
export async function runToolRouter(userMessage, { phone = "", customerKey = "" } = {}) {
  const text = String(userMessage || "").trim();
  const lower = text.toLowerCase();
  const results = [];

  const orderId = extractOrderId(text);
  if (orderId || /\b(track|tracking|status|wapi order|order yangu)\b/i.test(lower)) {
    if (orderId) {
      results.push(await executeTool("track_order", { orderId }, { phone }));
    } else if (phone || customerKey) {
      results.push(await executeTool("list_orders", {}, { phone, customerKey }));
    }
  }

  if (/\b(prepaid|escrow|mpesa|pay|payment|stk|till)\b/i.test(lower)) {
    results.push(await executeTool("store_info", {}, { phone }));
  }

  const productIdMatch = text.match(/\b(prod_[a-z0-9_-]+|[a-z]{2}-[a-z0-9]+-\d+)\b/i);
  if (productIdMatch) {
    results.push(await executeTool("get_product", { productId: productIdMatch[1] }, { phone }));
  }

  const alreadySearched = results.some((r) => r.tool === "search_products");
  const skipSearch =
    alreadySearched ||
    isTrackOnlyQuery(text, lower) ||
    isPaymentOnlyQuery(lower) ||
    isShopperFillerOnly(text) ||
    text.length < 2;

  // Default to catalog search for product queries — including brand/item names
  // like "delmonte yoghurt" that never matched the old fashion/electronics keyword list.
  if (!skipSearch) {
    results.push(
      await executeTool(
        "search_products",
        {
          query: text,
          maxPriceKes: extractBudget(text),
          secondhandOnly: wantsSecondhand(text) && !wantsNew(text),
        },
        { phone }
      )
    );
  }

  return results.filter(Boolean);
}

export async function executeTool(name, args = {}, context = {}) {
  try {
    switch (name) {
      case "search_products":
        return toolSearchProducts(args);
      case "get_product":
        return toolGetProduct(args);
      case "track_order":
        return toolTrackOrder(args, context);
      case "list_orders":
        return toolListOrders(context);
      case "store_info":
        return toolStoreInfo();
      default:
        return { tool: name, ok: false, error: "unknown_tool" };
    }
  } catch (err) {
    return { tool: name, ok: false, error: err.message };
  }
}

async function toolSearchProducts({ query = "", maxPriceKes = null, secondhandOnly = false, limit = 5 }) {
  const keywords = normalizeShopperQuery(query);
  let products = await searchProducts({
    keywords,
    fulfillment: "store",
    scope: "local",
    limit: Math.min(Number(limit) || 5, 8),
  });

  if (maxPriceKes && Number.isFinite(Number(maxPriceKes))) {
    products = products.filter((p) => Number(p.priceKes) <= Number(maxPriceKes));
  }
  if (secondhandOnly) {
    products = products.filter((p) => p.isSecondhand || p.condition !== "brand_new_with_tags");
  }

  return {
    tool: "search_products",
    ok: true,
    query: keywords,
    count: products.length,
    products: products.slice(0, 5).map(publicProductSummary),
  };
}

async function toolGetProduct({ productId }) {
  const p = await getProductById(productId);
  if (!p) return { tool: "get_product", ok: false, error: "not_found" };
  return { tool: "get_product", ok: true, product: publicProductSummary(p) };
}

function toolTrackOrder({ orderId }, { phone = "" } = {}) {
  const order = getOrder(orderId);
  if (!order) return { tool: "track_order", ok: false, error: "not_found", orderId };

  if (phone) {
    const digits = String(phone).replace(/\D/g, "");
    const orderPhone = String(order.phone || "").replace(/\D/g, "");
    const match =
      orderPhone.endsWith(digits.slice(-9)) ||
      digits.endsWith(orderPhone.slice(-9)) ||
      !digits;
    if (!match && digits.length >= 9) {
      return { tool: "track_order", ok: false, error: "phone_mismatch", orderId };
    }
  }

  return {
    tool: "track_order",
    ok: true,
    tracking: buildPublicTrackingPayload(order),
  };
}

function toolListOrders({ phone = "", customerKey = "" } = {}) {
  if (!phone && !customerKey) return { tool: "list_orders", ok: false, error: "missing_phone" };
  const orders = getOrdersForCustomer(customerKey, phone).slice(0, 5);
  return {
    tool: "list_orders",
    ok: true,
    count: orders.length,
    orders: orders.map((o) => ({
      id: o.id,
      productName: o.productName,
      status: o.status,
      shipmentStatus: o.shipmentStatus,
      paid: o.customerPaymentStatus === "confirmed",
      priceKes: o.priceKes,
    })),
  };
}

function toolStoreInfo() {
  const meta = checkoutMeta();
  return {
    tool: "store_info",
    ok: true,
    prepaidOnly: meta.prepaidOnly,
    paymentMethods: meta.paymentMethods,
    darajaConfigured: meta.darajaConfigured,
    autoConfirm: meta.autoConfirm,
    escrow: meta.escrow,
    note: "100% prepaid upfront for local items. Funds held in escrow until delivery confirmed.",
  };
}

function publicProductSummary(p) {
  return {
    id: p.id,
    name: p.name,
    priceKes: p.priceKes,
    rating: p.rating,
    inStock: p.inStock !== false,
    isSecondhand: Boolean(p.isSecondhand),
    condition: p.condition || null,
    category: p.category,
    tags: (p.tags || []).slice(0, 5),
  };
}

export function formatToolResultsForPrompt(toolResults) {
  if (!toolResults?.length) return null;
  const blocks = toolResults.map((r) => {
    if (r.tool === "search_products" && r.products?.length) {
      const lines = r.products.map(
        (p, i) =>
          `${i + 1}. ${p.name} | KES ${Number(p.priceKes).toLocaleString()} | ${p.isSecondhand ? "pre-loved" : "new"} | id:${p.id} | stock:${p.inStock ? "yes" : "no"}`
      );
      return `TOOL search_products (${r.count} hits for "${r.query}"):\n${lines.join("\n")}`;
    }
    if (r.tool === "get_product" && r.product) {
      const p = r.product;
      return `TOOL get_product:\n${p.name} | KES ${Number(p.priceKes).toLocaleString()} | id:${p.id}`;
    }
    if (r.tool === "track_order" && r.tracking) {
      const t = r.tracking;
      const steps = (t.shipmentTimeline || []).map((s) => `${s.done ? "done" : s.active ? "now" : "pending"}:${s.label}`).join(" → ");
      return `TOOL track_order ${t.orderId}:\nProduct: ${t.productName}\nPayment: ${t.paymentLine}\nShipment: ${t.shipmentStatusLabel}\nTimeline: ${steps || t.orderStatusLabel}`;
    }
    if (r.tool === "list_orders" && r.orders) {
      const lines = r.orders.map((o) => `${o.id} · ${o.productName} · ${o.shipmentStatus || o.status} · ${o.paid ? "paid" : "unpaid"}`);
      return `TOOL list_orders:\n${lines.join("\n") || "No orders found for this number."}`;
    }
    if (r.tool === "store_info") {
      return `TOOL store_info:\nPrepaid only: ${r.prepaidOnly}\nEscrow: ${r.escrow}\nPayment: ${(r.paymentMethods || []).join(", ")}\n${r.note}`;
    }
    if (!r.ok) return `TOOL ${r.tool}: ${r.error || "failed"}`;
    return `TOOL ${r.tool}: (no data)`;
  });
  return `TOOL RESULTS (authoritative — use only this data):\n${blocks.join("\n\n")}`;
}
