/**
 * Multi-seller cart APIs — quote + admin manual child refund.
 */
import { Router } from "express";
import { requireAdminToken } from "../lib/admin-auth.js";
import { getProductById } from "../services/catalog.js";
import {
  computeCartLineFees,
  computeCartParentTotals,
  getCartParent,
  getCartChildren,
  listCartParents,
  markCartChildRefundManual,
  isSknChildId,
} from "../services/cart-orders.js";
import { isMultiSellerCartEnabled, getPlatformFlags } from "../services/platform-flags.js";
import { getOrder } from "../services/orders.js";

const router = Router();

/** GET /api/cart/meta */
router.get("/meta", (_req, res) => {
  res.json({
    multiSellerCart: isMultiSellerCartEnabled(),
    flags: { multiSellerCart: getPlatformFlags().multiSellerCart === true },
    idFormat: "SKN-{seq} parent · SKN-{seq}-{n} child (one per line)",
    commission: "per_line_item",
    mpesaFee: "once_on_parent_total",
    sellerNotify: "paid_only",
    refunds: "manual_first",
  });
});

/**
 * POST /api/cart/quote
 * Body: { lines: [{ productId, quantity? }] }
 * Server-authoritative fee math (frontend estimate is display-only).
 */
router.post("/quote", async (req, res) => {
  if (!isMultiSellerCartEnabled()) {
    return res.status(403).json({ error: "multi_seller_cart_disabled" });
  }
  const linesIn = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!linesIn.length) return res.status(400).json({ error: "empty_cart" });

  const feeLines = [];
  const resolved = [];
  for (const line of linesIn.slice(0, 20)) {
    const product = await getProductById(line.productId);
    if (!product) {
      return res.status(404).json({ error: "product_not_found", productId: line.productId });
    }
    const fees = computeCartLineFees({ ...product, productId: product.id }, line.quantity);
    feeLines.push(fees);
    resolved.push({
      productId: product.id,
      name: product.name,
      quantity: fees.quantity,
      platformFeeKes: fees.platformFeeKes,
      sellerPayoutKes: fees.sellerPayoutKes,
      lineBuyerKes: fees.lineBuyerKes,
      shopHandle: product.shopHandle || product.sellerHandle || null,
      supplierId: product.supplierId || null,
    });
  }
  const parent = computeCartParentTotals(feeLines);
  res.json({
    ok: true,
    lines: resolved,
    totals: {
      chargeBeforeTxnKes: parent.chargeBeforeTxnKes,
      platformFeeKes: parent.platformFeeKes,
      transactionFeeKes: parent.transactionFeeKes,
      totalKes: parent.totalKes,
      note: "Platform commission is per line; M-Pesa fee is once on the parent total.",
    },
  });
});

/** Admin: list recent cart parents — before /:parentId */
router.get("/admin/list", requireAdminToken, (_req, res) => {
  res.json({ carts: listCartParents(100) });
});

/**
 * Admin: mark one child line for manual refund (Phase 0 — no auto B2C).
 * POST /api/cart/admin/refund-child { childId, reason? }
 */
router.post("/admin/refund-child", requireAdminToken, (req, res) => {
  const childId = String(req.body?.childId || "").trim();
  if (!isSknChildId(childId)) {
    return res.status(400).json({ error: "invalid_child_id", hint: "Use SKN-####-n" });
  }
  const result = markCartChildRefundManual(childId, { reason: req.body?.reason || "" });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /api/cart/:parentId — parent + children summary */
router.get("/:parentId", (req, res) => {
  const parent = getCartParent(req.params.parentId) || getOrder(req.params.parentId);
  if (!parent || parent.kind !== "cart_parent") {
    return res.status(404).json({ error: "cart_not_found" });
  }
  res.json({
    parent,
    children: getCartChildren(parent.id),
  });
});

export default router;
