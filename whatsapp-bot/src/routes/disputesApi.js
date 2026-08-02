import { Router } from "express";
import {
  addDisputeEvidence,
  createDispute,
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
    res.status(500).json({ error: "dispute_create_failed", message: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
