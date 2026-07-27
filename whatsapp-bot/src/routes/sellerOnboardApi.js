import { Router } from "express";
import {
  onboardSeller,
  getSellerProfile,
  getSellerEscrowLedgerByPhone,
  refreshSellerListing,
} from "../services/seller-onboard.js";

const router = Router();

/** POST /api/seller/onboard — WhatsApp phone + shop + M-Pesa setup */
router.post("/", async (req, res) => {
  const { phone, shopName, shopHandle, mpesaNumber, nationalId } = req.body || {};
  const result = onboardSeller({ phone, shopName, shopHandle, mpesaNumber, nationalId });
  if (result.error === "invalid_mpesa" || result.error === "invalid_phone" || result.error === "missing_shop") {
    return res.status(400).json(result);
  }
  if (result.error) return res.status(400).json(result);
  res.status(result.existing ? 200 : 201).json(result);
});

/** GET /api/seller/onboard?phone= — seller profile */
router.get("/", (req, res) => {
  const result = getSellerProfile(req.query.phone);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

/** GET /api/seller/onboard/ledger?phone= — escrow ledger tabs */
router.get("/ledger", (req, res) => {
  const result = getSellerEscrowLedgerByPhone(req.query.phone);
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

/** POST /api/seller/onboard/refresh — bump listing timestamp */
router.post("/refresh", async (req, res) => {
  const { phone, productId } = req.body || {};
  const result = await refreshSellerListing({ phone, productId });
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

export default router;
