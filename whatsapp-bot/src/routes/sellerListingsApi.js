import { Router } from "express";
import {
  requireApprovedSeller,
  generateSellerListingDraft,
  publishSellerListing,
  saveSellerDraft,
  deleteSellerDraft,
  listSellerListings,
  getSellerListingMeta,
} from "../services/seller-listings.js";
import { previewStudioClean } from "../services/listing-studio.js";
import { sellerSessionFromReq } from "../services/seller-verification.js";

const router = Router();

function sessionAuthStatus(result) {
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return 401;
  }
  if (result.error === "not_onboarded") return 403;
  return 403;
}

/** POST /api/seller/listings/generate — approved seller + photo → AI draft (+ optional studio clean) */
router.post("/generate", async (req, res) => {
  const { phone, imageBase64, mimeType = "image/jpeg", caption = "", skipStudio = false } = req.body || {};
  const sessionToken = sellerSessionFromReq(req);
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) {
    return res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
  }

  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image" });
  }

  try {
    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    const result = await generateSellerListingDraft(buffer, mimeType, caption, { skipStudio });
    res.json({
      draft: result.draft,
      studioApplied: result.studioApplied,
      cleanImageBase64: result.cleanImageBase64,
      seller: { id: check.supplier.id, businessName: check.supplier.businessName },
    });
  } catch (err) {
    res.status(422).json({ error: "generation_failed", message: err.message });
  }
});

/** POST /api/seller/listings/studio — background removal only (no AI draft) */
router.post("/studio", async (req, res) => {
  const { phone, imageBase64, mimeType = "image/jpeg" } = req.body || {};
  const sessionToken = sellerSessionFromReq(req);
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) {
    return res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
  }
  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image", message: "Add a cover photo first." });
  }
  try {
    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    const result = await previewStudioClean(buffer, mimeType);
    res.json({
      studioApplied: result.studioApplied,
      cleanImageBase64: result.cleanImageBase64,
      reason: result.reason,
      message: result.message,
      seller: { id: check.supplier.id, businessName: check.supplier.businessName },
    });
  } catch (err) {
    res.status(422).json({ error: "studio_failed", message: err.message });
  }
});

/** POST /api/seller/listings/publish — instant live (Depop-style) */
router.post("/publish", async (req, res) => {
  const { phone, draft, images, imageBase64, videoBase64, draftId } = req.body || {};
  const imageList = Array.isArray(images)
    ? images
    : imageBase64
      ? [imageBase64]
      : [];
  const result = await publishSellerListing({
    phone,
    draft,
    images: imageList,
    videoBase64,
    draftId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "not_onboarded" || result.error === "not_approved") return res.status(403).json(result);
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

/** POST /api/seller/listings/draft — save / update draft for later */
router.post("/draft", async (req, res) => {
  const { phone, draft, images, imageBase64, videoBase64, draftId } = req.body || {};
  const imageList = Array.isArray(images) ? images : imageBase64 ? [imageBase64] : [];
  const result = await saveSellerDraft({
    phone,
    draft,
    images: imageList,
    videoBase64,
    draftId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "not_onboarded" || result.error === "not_approved" || result.error === "forbidden") {
    return res.status(403).json(result);
  }
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(result.message?.includes("updated") ? 200 : 201).json(result);
});

/** DELETE /api/seller/listings/draft/:draftId — remove a saved draft */
router.delete("/draft/:draftId", async (req, res) => {
  const result = await deleteSellerDraft({
    phone: req.query.phone || req.body?.phone,
    draftId: req.params.draftId,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "not_onboarded" || result.error === "not_approved") return res.status(403).json(result);
  if (result.error === "not_found") return res.status(404).json(result);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/** GET /api/seller/listings?phone=254... — seller drafts + live listings */
router.get("/", async (req, res) => {
  const result = await listSellerListings(req.query.phone, sellerSessionFromReq(req));
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

router.get("/meta", async (_req, res) => {
  res.json(await getSellerListingMeta());
});

export default router;
