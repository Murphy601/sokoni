/**
 * Multi-seller cart — Parent SKN-#### + child SKN-####-n (one child per line item).
 * Phase 0: commission per line; one M-Pesa txn fee on parent total; orders.json first.
 *
 * Children are also stored in store.orders so existing escrow/shipment/settlement
 * pipelines can operate per line after payment. Parent lives in store.cartOrders.
 */
import {
  computeFeeBreakdown,
  computeProductTotals,
  orderBuyerTotal,
  resolveSellerPayoutKes,
} from "./shipping-tiers.js";
import { mpesaTransactionFeeKes } from "./mpesa-transaction-fees.js";
import { isMultiSellerCartEnabled, isPrepaidOnlyEffective } from "./platform-flags.js";
import {
  loadOrderStore,
  persistOrderStore,
  getOrderStore,
  normalizeOrderId,
  updateOrderMeta,
  updateOrderStatus,
  getOrder,
} from "./orders.js";

export const CART_PARENT_KIND = "cart_parent";
export const CART_CHILD_KIND = "cart_child";

export const PARENT_STATUSES = [
  "awaiting_payment",
  "paid",
  "partially_fulfilled",
  "completed",
  "cancelled",
];

export const CHILD_ESCROW = ["pending", "held", "released", "refunded"];

/** Normalize / validate SKN ids. */
export function isSknParentId(id) {
  return /^SKN-\d+$/i.test(String(id || "").trim());
}

export function isSknChildId(id) {
  return /^SKN-\d+-\d+$/i.test(String(id || "").trim());
}

export function isSknId(id) {
  return isSknParentId(id) || isSknChildId(id);
}

/**
 * Phase 2 — per-line fee ledger WITHOUT M-Pesa txn fee.
 * Commission (10%) applies on each line's (sellerNet + shipping).
 */
export function computeCartLineFees(product, quantity = 1) {
  const qty = Math.max(1, Math.min(20, Math.round(Number(quantity) || 1)));
  const unit = computeProductTotals(product);
  const sellerNetUnit = Math.round(Number(unit.sellerNetKes ?? unit.itemKes) || 0);
  const shippingUnit = Math.round(Number(unit.shippingKes) || 0);
  const deliveryMethod = unit.deliveryMethod || product.deliveryMethod || "seller_express";

  const sellerNetKes = sellerNetUnit * qty;
  const shippingKes = shippingUnit * qty;
  const fees = computeFeeBreakdown(sellerNetKes, shippingKes, {
    freeShipping: Boolean(unit.freeShipping) || shippingKes === 0,
    deliveryMethod,
  });

  // Strip per-line txn fee — parent applies one txn fee on the cart total.
  const lineChargeBeforeTxnKes = fees.chargeBeforeTxnKes;
  return {
    quantity: qty,
    sellerNetKes: fees.sellerNetKes,
    itemKes: fees.itemKes,
    shippingKes: fees.shippingKes,
    platformFeeKes: fees.platformFeeKes,
    platformFeeRate: fees.platformFeeRate,
    /** Always 0 on children — parent holds the single M-Pesa fee. */
    transactionFeeKes: 0,
    chargeBeforeTxnKes: lineChargeBeforeTxnKes,
    /** Buyer share for this line before parent txn fee. */
    lineBuyerKes: lineChargeBeforeTxnKes,
    sellerPayoutKes: fees.sellerPayoutKes,
    deliveryMethod: fees.deliveryMethod,
    shippingRecipient: fees.shippingRecipient,
    freeShipping: fees.freeShipping,
  };
}

/**
 * Aggregate lines → parent totals.
 * Platform commission = sum(line.platformFeeKes)  [per item]
 * M-Pesa txn fee = once on sum(line.chargeBeforeTxnKes)
 */
export function computeCartParentTotals(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const chargeBeforeTxnKes = list.reduce((s, l) => s + Math.round(Number(l.chargeBeforeTxnKes) || 0), 0);
  const platformFeeKes = list.reduce((s, l) => s + Math.round(Number(l.platformFeeKes) || 0), 0);
  const sellerNetKes = list.reduce((s, l) => s + Math.round(Number(l.sellerNetKes) || 0), 0);
  const shippingKes = list.reduce((s, l) => s + Math.round(Number(l.shippingKes) || 0), 0);
  const sellerPayoutKes = list.reduce((s, l) => s + Math.round(Number(l.sellerPayoutKes) || 0), 0);
  const transactionFeeKes = mpesaTransactionFeeKes(chargeBeforeTxnKes);
  const totalKes = chargeBeforeTxnKes + transactionFeeKes;
  return {
    chargeBeforeTxnKes,
    platformFeeKes,
    sellerNetKes,
    shippingKes,
    sellerPayoutKes,
    transactionFeeKes,
    totalKes,
    /** Alias for STK / orderBuyerTotal compatibility */
    priceKes: chargeBeforeTxnKes,
  };
}

function nextSknSeq(store) {
  store.sknSeq = Math.max(1000, Number(store.sknSeq) || 1000) + 1;
  return store.sknSeq;
}

/**
 * Create parent + children from catalog products.
 * @param {object} opts
 * @param {string} opts.customerKey
 * @param {string} [opts.chatId]
 * @param {Array<{product: object, quantity?: number}>} opts.lines
 * @param {object} opts.details — delivery details (name, location, phone, landmark*)
 */
export function createCartOrder({ customerKey, chatId, lines, details }) {
  if (!isMultiSellerCartEnabled()) {
    throw new Error("multi_seller_cart_disabled");
  }
  if (!customerKey) throw new Error("missing_customer");
  if (!Array.isArray(lines) || !lines.length) throw new Error("empty_cart");
  if (!details?.name || !details?.location || !details?.phone) {
    throw new Error("missing_delivery_details");
  }

  loadOrderStore();
  const store = getOrderStore();
  if (!store.cartOrders) store.cartOrders = {};

  const seq = nextSknSeq(store);
  const parentId = `SKN-${seq}`;
  const now = Date.now();
  const prepaid = isPrepaidOnlyEffective();

  const childRows = [];
  const feeLines = [];

  lines.forEach((line, index) => {
    const product = line.product;
    if (!product) throw new Error(`missing_product_line_${index}`);
    const fees = computeCartLineFees(product, line.quantity);
    feeLines.push(fees);
    const childId = `${parentId}-${index + 1}`;
    const productId = product.productId || product.id;
    const sellerUserId = (() => {
      const n = Number(product.sellerUserId ?? product.seller?.id);
      return Number.isInteger(n) && n > 0 ? n : null;
    })();

    const child = {
      id: childId,
      kind: CART_CHILD_KIND,
      parentOrderId: parentId,
      lineIndex: index + 1,
      quantity: fees.quantity,
      customerKey,
      chatId: chatId || customerKey,
      productId,
      productName: product.name,
      priceKes: fees.itemKes,
      shippingKes: fees.shippingKes,
      /** Line charge before parent txn fee (not the STK amount). */
      totalKes: fees.lineBuyerKes,
      platformFeeKes: fees.platformFeeKes,
      transactionFeeKes: 0,
      sellerNetKes: fees.sellerNetKes,
      sellerPayoutKes: fees.sellerPayoutKes ?? resolveSellerPayoutKes(fees),
      deliveryMethod: fees.deliveryMethod,
      shippingRecipient: fees.shippingRecipient,
      supplierId: product.supplierId || null,
      supplierSku: product.supplierSku || null,
      sellerUserId,
      shopHandle: product.shopHandle || product.sellerHandle || null,
      customerName: details.name,
      location: details.location,
      phone: details.phone,
      deliveryType: details.deliveryType || null,
      landmarkTown: details.landmarkTown || null,
      landmarkSpot: details.landmarkSpot || null,
      landmarkInstructions: details.landmarkInstructions || null,
      landmarkId: details.landmarkId || null,
      status: prepaid ? "awaiting_payment" : "received",
      paymentModel: prepaid ? "prepaid" : "cod",
      escrowStatus: prepaid ? "pending" : null,
      deliveryMode: "pending",
      shareCustomerContact: false,
      supplierNotified: false,
      payoutStatus: "pending",
      customerPaymentStatus: "unpaid",
      paymentStatus: "pending",
      checkoutRequestId: null,
      merchantRequestId: null,
      mpesaReceipt: null,
      mpesaPhone: null,
      paidAt: null,
      dropOffCode: null,
      labelUrl: null,
      qrPayload: null,
      shipmentStatus: "pending",
      shipmentHistory: [],
      payoutEligibleAt: null,
      autoPayment: false,
      refundPendingManual: false,
      history: [{ status: prepaid ? "awaiting_payment" : "received", at: now }],
      createdAt: now,
      updatedAt: now,
    };
    childRows.push(child);
    store.orders[childId] = child;
  });

  const parentTotals = computeCartParentTotals(feeLines);
  const parent = {
    id: parentId,
    kind: CART_PARENT_KIND,
    customerKey,
    chatId: chatId || customerKey,
    itemIds: childRows.map((c) => c.id),
    items: childRows.map((c) => ({
      id: c.id,
      productId: c.productId,
      productName: c.productName,
      quantity: c.quantity,
      platformFeeKes: c.platformFeeKes,
      sellerPayoutKes: c.sellerPayoutKes,
      lineBuyerKes: c.totalKes,
      supplierId: c.supplierId,
      shopHandle: c.shopHandle,
    })),
    priceKes: parentTotals.priceKes,
    shippingKes: parentTotals.shippingKes,
    platformFeeKes: parentTotals.platformFeeKes,
    transactionFeeKes: parentTotals.transactionFeeKes,
    sellerNetKes: parentTotals.sellerNetKes,
    sellerPayoutKes: parentTotals.sellerPayoutKes,
    chargeBeforeTxnKes: parentTotals.chargeBeforeTxnKes,
    totalKes: parentTotals.totalKes,
    customerName: details.name,
    location: details.location,
    phone: details.phone,
    deliveryType: details.deliveryType || null,
    landmarkTown: details.landmarkTown || null,
    landmarkSpot: details.landmarkSpot || null,
    landmarkInstructions: details.landmarkInstructions || null,
    landmarkId: details.landmarkId || null,
    status: prepaid ? "awaiting_payment" : "paid",
    paymentModel: prepaid ? "prepaid" : "cod",
    escrowStatus: prepaid ? "pending" : "held",
    customerPaymentStatus: "unpaid",
    paymentStatus: "pending",
    checkoutRequestId: null,
    merchantRequestId: null,
    mpesaReceipt: null,
    mpesaPhone: null,
    paidAt: null,
    productName: `Cart (${childRows.length} items)`,
    history: [{ status: prepaid ? "awaiting_payment" : "paid", at: now }],
    createdAt: now,
    updatedAt: now,
  };

  store.cartOrders[parentId] = parent;
  // Also index parent under orders for getOrder/checkout/track convenience
  store.orders[parentId] = parent;
  persistOrderStore();
  return { parent, children: childRows };
}

export function getCartParent(id) {
  loadOrderStore();
  const key = normalizeOrderId(id);
  if (!key || !isSknParentId(key)) return null;
  const store = getOrderStore();
  return store.cartOrders?.[key] || (store.orders[key]?.kind === CART_PARENT_KIND ? store.orders[key] : null);
}

export function getCartChildren(parentId) {
  const parent = getCartParent(parentId);
  if (!parent?.itemIds?.length) return [];
  return parent.itemIds.map((cid) => getOrder(cid)).filter(Boolean);
}

export function listCartParents(limit = 50) {
  loadOrderStore();
  const store = getOrderStore();
  return Object.values(store.cartOrders || {})
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

/** Roll up parent status from children after fulfillment events. */
export function refreshCartParentStatus(parentId) {
  const parent = getCartParent(parentId);
  if (!parent) return null;
  const children = getCartChildren(parentId);
  if (!children.length) return parent;

  const paid = parent.customerPaymentStatus === "confirmed";
  if (!paid) return parent;

  const terminal = (c) =>
    c.status === "delivered" ||
    c.status === "cancelled" ||
    c.escrowStatus === "refunded";
  const delivered = children.filter((c) => c.status === "delivered").length;
  const allTerminal = children.every(terminal);
  const anyDelivered = delivered > 0;

  let next = parent.status;
  if (allTerminal) next = "completed";
  else if (anyDelivered) next = "partially_fulfilled";
  else next = "paid";

  if (next !== parent.status) {
    updateOrderMeta(parent.id, { status: next });
    const store = getOrderStore();
    if (store.cartOrders?.[parent.id]) {
      store.cartOrders[parent.id].status = next;
      store.cartOrders[parent.id].updatedAt = Date.now();
      persistOrderStore();
    }
  }
  return getCartParent(parentId);
}

/**
 * After parent M-Pesa success — mark parent paid and fan-out hold to children.
 * Seller notify is handled by caller (escrow-automation) per child.
 */
export function markCartParentPaid(parentId, payment = {}) {
  const parent = getCartParent(parentId);
  if (!parent) return { error: "parent_not_found" };
  if (parent.customerPaymentStatus === "confirmed") {
    return { parent, skipped: true, reason: "already_paid" };
  }

  const patch = {
    customerPaymentStatus: "confirmed",
    customerPaidConfirmedAt: Date.now(),
    paymentStatus: "paid",
    escrowStatus: "held",
    status: "paid",
    mpesaReceipt: payment.mpesaReceiptNumber || null,
    mpesaPhone: payment.phoneNumber || parent.phone,
    checkoutRequestId: payment.checkoutRequestId || parent.checkoutRequestId || null,
    paidAt: Date.now(),
    autoPayment: true,
  };
  updateOrderMeta(parent.id, patch);
  loadOrderStore();
  const store = getOrderStore();
  if (store.cartOrders?.[parent.id]) {
    Object.assign(store.cartOrders[parent.id], patch, { updatedAt: Date.now() });
    persistOrderStore();
  }

  const children = getCartChildren(parent.id);
  for (const child of children) {
    if (child.customerPaymentStatus === "confirmed") continue;
    updateOrderMeta(child.id, {
      customerPaymentStatus: "confirmed",
      customerPaidConfirmedAt: Date.now(),
      paymentStatus: "paid",
      escrowStatus: "held",
      mpesaReceipt: payment.mpesaReceiptNumber || null,
      mpesaPhone: payment.phoneNumber || child.phone,
      paidAt: Date.now(),
      autoPayment: true,
      /** Children do not own the STK — parent does */
      parentPaid: true,
    });
    if (child.status === "awaiting_payment") {
      updateOrderStatus(child.id, "confirmed");
    }
  }

  return { parent: getCartParent(parentId), children: getCartChildren(parentId) };
}

/** Manual refund flag on a single child (Phase 0: no auto B2C refund). */
export function markCartChildRefundManual(childId, { reason = "" } = {}) {
  const child = getOrder(childId);
  if (!child || child.kind !== CART_CHILD_KIND) {
    return { error: "not_cart_child" };
  }
  updateOrderMeta(child.id, {
    escrowStatus: "refunded",
    status: "cancelled",
    refundPendingManual: true,
    refundReason: String(reason || "").slice(0, 500),
    refundMarkedAt: Date.now(),
    payoutStatus: "n/a",
  });
  if (child.parentOrderId) refreshCartParentStatus(child.parentOrderId);
  return { ok: true, child: getOrder(childId) };
}

export function parentBuyerTotal(parent) {
  if (!parent) return 0;
  return orderBuyerTotal(parent);
}

/** Parse website WA cart handoff message for product lines. */
export function parseCartHandoffMessage(text) {
  const raw = String(text || "");
  if (!/SOKONI_CART/i.test(raw) && !/NEW SOKONI CART/i.test(raw)) return null;
  const ids = [];
  const re = /\[SKU:([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(raw))) {
    const id = String(m[1] || "").trim();
    if (id) ids.push({ productId: id, quantity: 1 });
  }
  // Fallback: PRODUCT:ID lines
  const re2 = /PRODUCT[_\s:-]+([A-Za-z0-9_-]+)/gi;
  while ((m = re2.exec(raw))) {
    const id = String(m[1] || "").trim();
    if (id && !ids.some((x) => x.productId === id)) ids.push({ productId: id, quantity: 1 });
  }
  if (!ids.length) return null;
  return { lines: ids, raw };
}
