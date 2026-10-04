import { clientError } from "../lib/public-error.js";
import { Router } from "express";
import {
  addDisputeEvidence,
  createDispute,
  openInspectionClaim,
  getDisputeById,
  listAdminDisputes,
  listDisputesForUser,
  resolveDispute,
  respondToDispute,
} from "../services/disputes.js";
import { resolveAuthenticatedSellerSocialContext } from "../services/seller-social-auth.js";
import {
  applyBuyerIdentityAuth,
  resolveAuthenticatedBuyerSocialContext,
} from "../services/buyer-social-auth.js";
import { config } from "../config.js";
import { getOrder } from "../services/orders.js";
import { buyerCanRelease, releaseFundsNow } from "../services/buyer-release.js";
import { adminTokenFromReq, isAdminTokenValid } from "../lib/admin-auth.js";

const router = Router();

function disputeErrorStatus(error) {
  if (error === "database_not_configured") return 503;
  if (error === "forbidden" || error === "buyer_mismatch" || error === "seller_session_mismatch") return 403;
  if (error === "session_required" || error === "session_invalid" || error === "session_expired") return 401;
  if (error === "dispute_exists" || error === "dispute_not_allowed" || error === "dispute_closed") {
    return 409;
  }
  if (error === "order_not_found" || error === "dispute_not_found" || error === "seller_not_found") return 404;
  return 400;
}

/** POST /api/disputes — buyer opens a ticket + freezes escrow */
router.post("/", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || disputeErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const payload = gated.payload || {};
    const result = await createDispute({
      orderRef: payload.orderId || payload.orderRef || req.body?.orderId || req.body?.orderRef,
      buyerUserId: payload.buyerUserId,
      sellerUserId: payload.sellerUserId || req.body?.sellerUserId,
      reason: payload.reason || req.body?.reason,
      statement: payload.statement || payload.buyerStatement || req.body?.statement,
      buyerPhone: gated.phone || payload.phone,
    });
    if (result.error) {
      return res.status(disputeErrorStatus(result.error)).json(result);
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "dispute_create_failed"));
  }
});

function buyerOwnsOrder(order, buyerUserId, phone) {
  if (!order) return false;
  if (String(order.customerKey || "") === `web:buyer:${buyerUserId}`) return true;
  const phoneDigits = String(phone || "").replace(/\D/g, "");
  const orderPhone = String(order.phone || order.mpesaPhone || "").replace(/\D/g, "");
  return Boolean(phoneDigits && orderPhone && phoneDigits.slice(-9) === orderPhone.slice(-9));
}

/** POST /api/disputes/release-funds — buyer ends the inspection early. */
router.post("/release-funds", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || disputeErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const payload = gated.payload || {};
    const order = getOrder(payload.orderId || payload.orderRef || req.body?.orderId);
    if (!order) return res.status(404).json({ error: "order_not_found", message: "Order not found." });
    if (!buyerOwnsOrder(order, payload.buyerUserId, gated.phone || payload.phone)) {
      return res.status(403).json({ error: "buyer_mismatch", message: "This order does not match your account." });
    }
    if (!buyerCanRelease(order)) {
      return res.status(409).json({ error: "not_ready", message: "That order is not ready to release." });
    }
    const result = await releaseFundsNow(order, { via: "inspection_release" });
    if (result.error) return res.status(409).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "release_failed"));
  }
});

/** POST /api/disputes/inspection-claim — freeze only with an unboxing photo. */
router.post("/inspection-claim", async (req, res) => {
  try {
    const gated = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (gated.error) {
      return res.status(gated.status || disputeErrorStatus(gated.error)).json({
        error: gated.error,
        message: gated.message,
      });
    }
    const payload = gated.payload || {};
    const result = await openInspectionClaim({
      orderRef: payload.orderId || payload.orderRef || req.body?.orderId,
      buyerUserId: payload.buyerUserId,
      buyerPhone: gated.phone || payload.phone,
      statement: payload.statement || req.body?.statement,
      evidenceUrl: payload.evidenceUrl || req.body?.evidenceUrl,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err, "inspection_claim_failed"));
  }
});

/** GET /api/disputes/mine — buyer disputes */
router.get("/mine", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedBuyerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || disputeErrorStatus(auth.error)).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await listDisputesForUser({
      userId: auth.buyerUserId,
      role: "buyer",
      limit: req.query.limit,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/disputes/seller — seller disputes */
router.get("/seller", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await listDisputesForUser({
      userId: auth.sellerUserId,
      role: "seller",
      limit: req.query.limit,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/disputes/admin/list?token= — must be before /:id */
router.get("/admin/list", async (req, res) => {
  if (!isAdminTokenValid(adminTokenFromReq(req))) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const result = await listAdminDisputes({
      status: req.query.status || "open",
      limit: req.query.limit,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/disputes/admin/:id/resolve?token= */
router.post("/admin/:id/resolve", async (req, res) => {
  if (!isAdminTokenValid(adminTokenFromReq(req))) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const result = await resolveDispute({
      disputeId: req.params.id,
      resolution: req.body?.resolution,
      notes: req.body?.notes || req.body?.adminNotes,
      adminLabel: req.body?.adminLabel || "admin",
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** GET /api/disputes/:id */
router.get("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id || ""))) {
      return res.status(404).json({ error: "dispute_not_found", message: "Dispute not found." });
    }
    const result = await getDisputeById(req.params.id);
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);

    const adminOk = isAdminTokenValid(adminTokenFromReq(req));
    if (!adminOk) {
      let allowed = false;
      try {
        const buyer = await resolveAuthenticatedBuyerSocialContext(req);
        if (!buyer.error && buyer.buyerUserId === result.dispute.buyerUserId) allowed = true;
      } catch {
        /* ignore */
      }
      if (!allowed) {
        try {
          const seller = await resolveAuthenticatedSellerSocialContext(req);
          if (!seller.error && seller.sellerUserId === result.dispute.sellerUserId) allowed = true;
        } catch {
          /* ignore */
        }
      }
      if (!allowed) {
        return res.status(403).json({
          error: "forbidden",
          message: "Sign in as the buyer/seller on this dispute, or use an admin token.",
        });
      }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/disputes/:id/evidence */
router.post("/:id/evidence", async (req, res) => {
  try {
    let userId = null;
    const buyerGate = await applyBuyerIdentityAuth(req, req.body || {}, "buyerUserId");
    if (!buyerGate.error) {
      userId = buyerGate.payload?.buyerUserId || buyerGate.payload?.userId;
    } else {
      const seller = await resolveAuthenticatedSellerSocialContext(req);
      if (seller.error) {
        return res.status(seller.status || 403).json({
          error: seller.error,
          message: seller.message,
        });
      }
      userId = seller.sellerUserId;
    }

    const result = await addDisputeEvidence({
      disputeId: req.params.id,
      userId,
      kind: req.body?.kind,
      url: req.body?.url,
      note: req.body?.note,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

/** POST /api/disputes/:id/seller-response */
router.post("/:id/seller-response", async (req, res) => {
  try {
    const auth = await resolveAuthenticatedSellerSocialContext(req);
    if (auth.error) {
      return res.status(auth.status || 403).json({
        error: auth.error,
        message: auth.message,
      });
    }
    const result = await respondToDispute({
      disputeId: req.params.id,
      sellerUserId: auth.sellerUserId,
      response: req.body?.response || req.body?.sellerResponse,
    });
    if (result.error) return res.status(disputeErrorStatus(result.error)).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

export default router;
