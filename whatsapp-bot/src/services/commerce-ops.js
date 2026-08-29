/**
 * Advanced WhatsApp commerce ops — cart/pay links, inventory, dispatch+rider,
 * PoP verification, AUP checks, abandon recovery. Phone number = thread_id.
 * Extends the Node WAHA bot (no FastAPI rewrite).
 */
import { getProductById, searchProducts, invalidateProductCache } from "./catalog.js";
import { createOrder, getOrder, listRecentOrders, updateOrderMeta } from "./orders.js";
import { checkoutUrlForOrder, initiateMpesaCheckout } from "./prepaid-checkout.js";
import { orderBuyerTotal, computeProductTotals } from "./shipping-tiers.js";
import { requireSeller } from "./seller-onboard.js";
import { scanListingLocally } from "./listing-moderation.js";
import { cartAbandonmentMessage } from "./trust-copy.js";
import { formatShortPaymentReminder } from "./payment.js";
import { sendText } from "./whatsapp.js";
import { listPendingDiskEntries, markPendingAbandonNudge } from "./session.js";
import { config } from "../config.js";

/** thread_id for LangGraph-style memory = WhatsApp phone / customer key */
export function threadIdFromPhone(phoneOrKey) {
  const raw = String(phoneOrKey || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits || raw;
}

/**
 * Create a prepaid SKN order for qty of a product and return checkout / STK link.
 */
export async function createWhatsAppCheckoutSession({
  customerKey,
  phone,
  productId = "",
  query = "",
  quantity = 1,
  customerName = "",
  location = "Kenya",
} = {}) {
  const qty = Math.max(1, Math.min(20, Math.round(Number(quantity) || 1)));
  let product = productId ? await getProductById(productId) : null;
  if (!product && query) {
    const hits = await searchProducts({ keywords: query, limit: 3, scope: "local" });
    product = (hits || []).find((p) => p && p.inStock !== false) || null;
  }
  if (!product) {
    return { ok: false, error: "product_not_found", message: "No live listing matched — search again." };
  }
  if (product.inStock === false) {
    return { ok: false, error: "out_of_stock", message: `${product.name} is out of stock.` };
  }

  const digits = String(phone || "").replace(/\D/g, "");
  const details = {
    name: customerName || "WhatsApp shopper",
    phone: digits || phone,
    location: location || "Kenya",
    quantity: qty,
  };

  const unitTotals = computeProductTotals(product);
  const totalsOverride =
    qty > 1
      ? {
          ...unitTotals,
          itemKes: unitTotals.itemKes * qty,
          totalKes: unitTotals.itemKes * qty + (unitTotals.shippingKes || 0),
          sellerNetKes: (unitTotals.sellerNetKes || 0) * qty,
          sellerPayoutKes: (unitTotals.sellerPayoutKes || unitTotals.sellerNetKes || 0) * qty,
        }
      : null;

  let order;
  try {
    order = createOrder({
      customerKey: customerKey || `${digits}@c.us`,
      chatId: customerKey || `${digits}@c.us`,
      product,
      details,
      totalsOverride,
    });
  } catch (err) {
    return {
      ok: false,
      error: err.code || "create_failed",
      message: err.message || "Could not reserve stock.",
    };
  }

  const payUrl = checkoutUrlForOrder(order.id);
  let stk = null;
  try {
    stk = await initiateMpesaCheckout(order, { phone: digits || phone });
  } catch (err) {
    console.warn("[commerce-ops] STK initiate:", err.message);
  }

  const unit = orderBuyerTotal({ ...order, quantity: 1 }) || order.priceKes;
  const total = orderBuyerTotal(order);
  return {
    ok: true,
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    quantity: qty,
    totalKes: total,
    unitKes: unit,
    payUrl,
    stkOk: Boolean(stk?.ok),
    stkMethod: stk?.method || null,
    message:
      `Done — reserved *${qty}× ${product.name}* (KES ${Number(total).toLocaleString()} total).\n` +
      (stk?.ok && stk.method !== "manual_till"
        ? `M-Pesa STK sent — enter your PIN.\n`
        : `Tap to pay via M-Pesa:\n${payUrl}\n`) +
      `Order *${order.id}*`,
  };
}

/**
 * Verify a typed M-Pesa / Paystack code against order webhook records (anti fake PoP).
 */
export function verifyPaymentProof({ orderId, code, customerKey = "", phone = "" } = {}) {
  const order = orderId ? getOrder(orderId) : null;
  if (!order) {
    return { ok: false, error: "order_not_found", message: "Order not found." };
  }
  const cleanCode = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (cleanCode.length < 6) {
    return {
      ok: false,
      error: "invalid_code",
      verified: false,
      message:
        "That does not look like a valid M-Pesa / Paystack code. Complete payment via the official checkout link or STK.",
    };
  }

  if (order.customerPaymentStatus === "confirmed") {
    return {
      ok: true,
      verified: true,
      alreadyPaid: true,
      orderId: order.id,
      message: `Order *${order.id}* is already confirmed paid.`,
    };
  }

  const stored = [
    order.mpesaReceipt,
    order.mpesaCheckoutRequestId,
    order.paystackReference,
    order.paystackAccessCode,
    order.paymentReference,
  ]
    .map((x) => String(x || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);

  const match = stored.some((s) => s === cleanCode || s.endsWith(cleanCode) || cleanCode.endsWith(s));
  if (match) {
    return {
      ok: true,
      verified: true,
      orderId: order.id,
      message: `Code matches our payment records for *${order.id}*. If status is still pending, wait for the webhook or reply *paid*.`,
    };
  }

  // Soft claim path — do not auto-confirm; reject as unverified PoP
  updateOrderMeta(order.id, {
    lastUnverifiedPopCode: cleanCode.slice(0, 24),
    lastUnverifiedPopAt: Date.now(),
    lastUnverifiedPopFrom: customerKey || phone || "",
  });

  return {
    ok: false,
    verified: false,
    error: "code_not_found",
    orderId: order.id,
    message:
      `We could not verify transaction code *${cleanCode}* with M-Pesa / Paystack for *${order.id}*.\n` +
      `Please pay through our official checkout / STK — not a screenshot alone.\n` +
      checkoutUrlForOrder(order.id),
  };
}

/**
 * Seller WA inventory update authenticated by registered seller phone (no Hub session).
 */
export async function updateInventoryFromWhatsApp({
  phone,
  productId = "",
  productQuery = "",
  stockQuantity,
  priceKes = null,
} = {}) {
  const seller = requireSeller(phone);
  if (seller.error) {
    return {
      ok: false,
      error: seller.error,
      message: "This WhatsApp is not a registered seller. Reply *vendor menu* to sign in.",
    };
  }

  let pid = productId;
  if (!pid && productQuery) {
    const hits = await searchProducts({
      keywords: productQuery,
      limit: 8,
      scope: "local",
    });
    const mine = (hits || []).filter(
      (p) =>
        p.supplierId === seller.supplier.id ||
        String(p.sellerPhone || "").replace(/\D/g, "").endsWith(String(phone).replace(/\D/g, "").slice(-9))
    );
    if (mine.length === 1) pid = mine[0].id;
    else if (mine.length > 1) {
      return {
        ok: false,
        error: "ambiguous",
        message:
          `Several matches — reply with product id:\n` +
          mine.slice(0, 5).map((p) => `• ${p.id} — ${p.name}`).join("\n"),
        candidates: mine.slice(0, 5).map((p) => ({ id: p.id, name: p.name })),
      };
    }
  }
  if (!pid) {
    return { ok: false, error: "missing_product", message: "Name the listing or send its product id." };
  }

  // Phone-auth path: create a short-lived bypass via requireSeller already checked.
  // updateSellerListingStock needs session — use internal stock apply for WA.
  const result = await applySellerStockPhoneAuth({
    supplier: seller.supplier,
    phone,
    productId: pid,
    stockQuantity,
    priceKes,
  });
  return result;
}

async function applySellerStockPhoneAuth({ supplier, phone, productId, stockQuantity, priceKes }) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    path.join(__dirname, "..", "data", "products.json"),
    path.join(__dirname, "..", "..", "..", "website", "assets", "data", "products.json"),
  ].filter((p) => existsSync(p));

  const qty = Math.round(Number(stockQuantity));
  if (!Number.isFinite(qty) || qty < 0 || qty > 9999) {
    return { ok: false, error: "invalid_stock", message: "Units must be 0–9999." };
  }

  const aup = scanListingLocally({
    name: productId,
    title: productId,
    priceKes: priceKes || 100,
    images: ["x"],
  });
  // AUP on id alone is weak — also check query-like names when price set later

  let updated = null;
  const sellerDigits = String(phone || "").replace(/\D/g, "");
  for (const file of files) {
    try {
      const products = JSON.parse(await readFile(file, "utf-8"));
      const idx = products.findIndex((p) => {
        if (p.id !== productId) return false;
        if (p.supplierId && p.supplierId === supplier.id) return true;
        if (sellerDigits && String(p.sellerPhone || "").replace(/\D/g, "").endsWith(sellerDigits.slice(-9))) {
          return true;
        }
        return false;
      });
      if (idx === -1) continue;
      const { applyStockQuantityFields, clearSoldSku } = await import("./product-availability.js");
      if (qty > 0) await clearSoldSku(productId);
      let next = applyStockQuantityFields({ ...products[idx] }, qty);
      if (priceKes != null && Number(priceKes) >= 50) {
        const net = Math.round(Number(priceKes));
        next.sourcePriceKes = net;
        next.sellerNetKes = net;
        const totals = computeProductTotals(next);
        next.priceKes = totals.itemKes;
        next.buyerTotalKes = totals.totalKes;
      }
      // AUP on listing title before save
      const mod = scanListingLocally(next);
      if (mod.flags?.includes("prohibited_item")) {
        return {
          ok: false,
          error: "prohibited",
          message:
            `Listing blocked by Acceptable Use Policy (${mod.reason || "prohibited item"}). ` +
            `Medical / regulated goods need licensing — see Vendor Rules.`,
        };
      }
      next.stockUpdatedAt = Date.now();
      products[idx] = next;
      await writeFile(file, JSON.stringify(products, null, 2) + "\n", "utf-8");
      updated = next;
    } catch (err) {
      console.warn("[commerce-ops] stock file:", file, err.message);
    }
  }
  if (!updated) {
    return { ok: false, error: "not_found", message: "Listing not found or not yours." };
  }
  try {
    invalidateProductCache();
  } catch {}
  return {
    ok: true,
    productId: updated.id,
    productName: updated.name,
    stockQuantity: updated.stockQuantity,
    priceKes: updated.priceKes || updated.sourcePriceKes,
    message:
      `Inventory updated — *${updated.name}* set to *${updated.stockQuantity}* units` +
      (updated.priceKes ? ` at KES ${Number(updated.priceKes).toLocaleString()}` : "") +
      `. Listing is live on Sokoni Mall.`,
  };
}

/**
 * DISPATCH with optional rider phone/name — wraps Hub seller dispatch fields.
 */
export async function dispatchOrderWithRider({
  orderId,
  phone,
  customerKey = "",
  riderPhone = "",
  riderName = "",
} = {}) {
  const { sellerDispatchOrder } = await import("./seller-onboard.js");
  // sellerDispatchOrder needs sessionToken — use communication-hub path with meta update instead
  const { authorizeSellerForOrder, isPaidHeld, isDispatched, isAdminTakeOver, msgBuyerDispatched, msgSellerDispatchAck, dispatchMessages, notifyAdminEvent } =
    await import("./communication-hub.js");
  const { advanceShipmentStatus, getEffectiveShipmentStatus } = await import("./shipments.js");
  const { normalizeOrderId } = await import("./orders.js");

  const id = normalizeOrderId(orderId);
  let order = getOrder(id);
  if (!order) return { ok: false, error: "not_found", message: `Order ${orderId} not found.` };

  if (isAdminTakeOver(order) || order.disputeHold) {
    return { ok: false, error: "support_hold", message: "Order is with support." };
  }
  const auth = await authorizeSellerForOrder(order, phone, customerKey);
  order = auth.order || order;
  if (!auth.ok) return { ok: false, error: "forbidden", message: "Not authorized for this order." };
  if (!isPaidHeld(order)) return { ok: false, error: "unpaid", message: "Buyer has not paid into escrow." };

  const ship = getEffectiveShipmentStatus(order);
  if (ship === "delivered") return { ok: false, error: "delivered", message: "Already delivered." };

  const riderTel = String(riderPhone || "").replace(/\D/g, "").slice(0, 15);
  const rider = String(riderName || "").trim().slice(0, 80);

  if (isDispatched(order) && order.sellerDispatchedAt) {
    if (riderTel || rider) {
      updateOrderMeta(id, {
        ...(rider ? { riderName: rider } : {}),
        ...(riderTel ? { riderPhone: riderTel } : {}),
      });
    }
    return {
      ok: true,
      already: true,
      orderId: id,
      message: `Order *${id}* already dispatched. Buyer was notified.`,
    };
  }

  const result = advanceShipmentStatus(id, "in_transit", {
    actor: "seller_dispatch_wa",
    note: "Seller DISPATCH via WhatsApp (+ rider)",
    skipBuyerNotify: true,
    riderName: rider || undefined,
    riderPhone: riderTel || undefined,
  });
  if (result.error) return { ok: false, error: result.error, message: `Could not dispatch (${result.error}).` };

  updateOrderMeta(id, {
    sellerDispatchedAt: Date.now(),
    deliveryMode: order.deliveryMode === "pending" ? "seller_dispatch" : order.deliveryMode,
    ...(rider ? { riderName: rider } : {}),
    ...(riderTel ? { riderPhone: riderTel } : {}),
  });

  const fresh = getOrder(id) || order;
  void notifyAdminEvent("SELLER_DISPATCHED", {
    orderId: fresh.id,
    details: `IN_TRANSIT — rider ${rider || "—"} ${riderTel || ""}`,
    silent: true,
  });
  void dispatchMessages([
    customerKey ? { to: customerKey, message: msgSellerDispatchAck(fresh) } : null,
    fresh.customerKey ? { to: fresh.customerKey, message: msgBuyerDispatched(fresh) } : null,
  ]);

  return {
    ok: true,
    orderId: fresh.id,
    riderName: fresh.riderName || rider || null,
    riderPhone: fresh.riderPhone || riderTel || null,
    message: `Got it — *${fresh.id}* marked Dispatched.` + (riderTel ? ` Rider: ${rider || ""} ${riderTel}.` : "") + ` Buyer notified.`,
  };
}

/** AUP check for proposed listing text (pre-publish / WA inventory). */
export function checkAcceptableUsePolicy({ title = "", description = "" } = {}) {
  const product = {
    name: title,
    title,
    description,
    priceKes: 100,
    images: ["placeholder"],
  };
  const mod = scanListingLocally(product);
  if (mod.flags?.includes("prohibited_item")) {
    return {
      ok: false,
      allowed: false,
      flags: mod.flags,
      message:
        `Listing rejected: ${mod.reason || "prohibited item"}. ` +
        `Medical / regulated products require licensing and cannot be posted as a general merchant listing. Review Vendor Rules.`,
    };
  }
  if (mod.flags?.includes("off_platform_contact")) {
    return {
      ok: false,
      allowed: false,
      flags: mod.flags,
      message: "Listing rejected: remove WhatsApp/phone/social links — all chat stays on Sokoni.",
    };
  }
  return { ok: true, allowed: true, flags: mod.flags || [], message: "Listing text looks OK under current AUP." };
}

/**
 * Abandoned checkout / unpaid order recovery (WhatsApp).
 */
export async function processAbandonedCheckoutRecovery({ olderThanMs = 30 * 60 * 1000 } = {}) {
  const now = Date.now();
  let sent = 0;

  // 1) Disk pending checkouts (browser / WA mid-flow)
  try {
    const entries = listPendingDiskEntries();
    for (const entry of entries) {
      const at = Number(entry.at || 0);
      if (!at || now - at < olderThanMs) continue;
      if (entry.abandonNudgeSent) continue;
      const key = entry.customerKey || entry.phone;
      if (!key) continue;
      const name =
        entry.pendingOrder?.name ||
        entry.pendingCart?.items?.[0]?.name ||
        entry.pendingOrder?.productName ||
        "your item";
      try {
        await sendText(key, cartAbandonmentMessage({ productName: name }));
        markPendingAbandonNudge(key);
        sent += 1;
      } catch (err) {
        console.warn("[commerce-ops] abandon nudge:", err.message);
      }
    }
  } catch (err) {
    console.warn("[commerce-ops] pending disk:", err.message);
  }

  // 2) Unpaid SKN orders awaiting payment > 30m
  const unpaid = listRecentOrders(80).filter(
    (o) =>
      o.status === "awaiting_payment" &&
      o.customerPaymentStatus !== "confirmed" &&
      o.customerKey &&
      !o.abandonNudgeSentAt &&
      now - (o.createdAt || 0) >= olderThanMs &&
      now - (o.createdAt || 0) < 24 * 60 * 60 * 1000
  );
  for (const o of unpaid.slice(0, 15)) {
    try {
      const reminder = formatShortPaymentReminder(o);
      const msg =
        (reminder || cartAbandonmentMessage({ productName: o.productName })) +
        `\n${checkoutUrlForOrder(o.id)}`;
      await sendText(o.customerKey, msg);
      updateOrderMeta(o.id, { abandonNudgeSentAt: now });
      sent += 1;
    } catch (err) {
      console.warn("[commerce-ops] unpaid nudge:", err.message);
    }
  }

  if (sent) console.log(`[commerce-ops] abandon recovery sent: ${sent}`);
  return { sent };
}

/**
 * Optional voice → text via OpenRouter/OpenAI-compatible Whisper.
 * Pass languageHint "sw" | "en" when known (Kiswahili / English); omit for auto.
 */
export async function transcribeWhatsAppAudio({
  buffer,
  mimetype = "audio/ogg",
  languageHint = undefined,
} = {}) {
  if (!config.openai?.apiKey || !buffer?.length) {
    // Primary STT unavailable — optional MAS voice assist (flag off by default)
    try {
      const { tryMasSttAssist } = await import("./mas/assist.js");
      const mas = await tryMasSttAssist({
        audioBuffer: buffer,
        mimeType: mimetype,
        filename: "voice.ogg",
      });
      if (mas?.text) return { ok: true, text: mas.text, model: "mas_stt", language: languageHint || null };
    } catch {
      /* ignore */
    }
    return { ok: false, error: "stt_unavailable", text: "" };
  }
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    });
    const file = new File([buffer], "voice.ogg", { type: mimetype || "audio/ogg" });
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "openai/whisper-large-v3-turbo";
    const lang =
      languageHint === "sw" || languageHint === "en" ? languageHint : undefined;
    const params = { file, model };
    if (lang) params.language = lang;
    const result = await client.audio.transcriptions.create(params);
    const text = String(result?.text || "").trim();
    return { ok: Boolean(text), text, model, language: lang || null };
  } catch (err) {
    console.warn("[commerce-ops] whisper/stt:", err.message);
    try {
      const { tryMasSttAssist } = await import("./mas/assist.js");
      const mas = await tryMasSttAssist({
        audioBuffer: buffer,
        mimeType: mimetype,
        filename: "voice.ogg",
      });
      if (mas?.text) return { ok: true, text: mas.text, model: "mas_stt_fallback", language: languageHint || null };
    } catch (masErr) {
      console.warn("[commerce-ops] MAS STT assist:", masErr.message);
    }
    return { ok: false, error: err.message, text: "" };
  }
}

export function parseCommerceIntent(text) {
  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  const addCart = lower.match(
    /\b(?:add|reserve|buy)\s+(\d+)\s+(?:of\s+)?(?:those\s+|the\s+)?(.+?)\s+(?:to\s+(?:my\s+)?cart|and\s+send|checkout|pay)/i
  ) || lower.match(/\badd\s+(\d+)\s+(.+?)\s+to\s+(?:my\s+)?cart\b/i);

  const stock =
    t.match(
      /\b(?:update\s+(?:my\s+)?inventory|restock)\b[:\s]+(?:I\s+just\s+received\s+)?(\d+)\s+units?\s+(?:of\s+)?(.+?)\s+at\s+KES\s*(\d[\d,]*)/i
    ) ||
    lower.match(
      /\b(?:update\s+(?:my\s+)?inventory|restock)\b[:\s]+(?:i\s+just\s+received\s+)?(\d+)\s+units?\s+(?:of\s+)?(.+)$/i
    ) ||
    lower.match(/\bstock\s+(\S+)\s+(\d+)\b/i);

  const dispatch = t.match(
    /\bDISPATCH\s+(SKN-\d+(?:-\d+)?|SK-\d+)\s*(?:via\s+rider\s+)?([A-Za-z]+)?\s*((?:\+?254|0)?\d{9,12})?/i
  );

  const pop = t.match(
    /\b(?:paid|payment|mpesa|m-pesa|code)\b.*?([A-Z0-9]{8,15})\b/i
  );

  return {
    addToCart: addCart
      ? { quantity: Number(addCart[1]), query: addCart[2].replace(/\s+and\s+send.*$/i, "").trim() }
      : null,
    stockUpdate: stock
      ? stock[3] != null || /\bunits?\b/i.test(t)
        ? {
            quantity: Number(stock[1]),
            query: String(stock[2] || "").replace(/\s+at\s+kes.*$/i, "").trim(),
            priceKes: stock[3] ? Number(String(stock[3]).replace(/,/g, "")) : null,
          }
        : { productId: stock[1], quantity: Number(stock[2]), query: "", priceKes: null }
      : null,
    dispatch: dispatch
      ? {
          orderId: dispatch[1],
          riderName: dispatch[2] || "",
          riderPhone: dispatch[3] || "",
        }
      : null,
    paymentCode: pop ? pop[1] : null,
  };
}
