import { Router } from "express";
import {
  requireApprovedSeller,
  generateSellerListingDraft,
  publishSellerListing,
  saveSellerDraft,
  listSellerListings,
  getSellerListingMeta,
  VALID_CONDITIONS,
} from "../services/seller-listings.js";

const router = Router();

/** POST /api/seller/listings/generate — approved seller + photo → AI draft (+ optional studio clean) */
router.post("/generate", async (req, res) => {
  const { phone, imageBase64, mimeType = "image/jpeg", caption = "", skipStudio = false } = req.body || {};
  const check = requireApprovedSeller(phone);
  if (check.error) {
    return res.status(403).json({ error: check.error, message: check.message });
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

/** POST /api/seller/listings/studio — background removal only (preview) */
router.post("/studio", async (req, res) => {
  const { phone, imageBase64, mimeType = "image/jpeg" } = req.body || {};
  const check = requireApprovedSeller(phone);
  if (check.error) {
    return res.status(403).json({ error: check.error, message: check.message });
  }
  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image" });
  }
  try {
    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    const result = await generateSellerListingDraft(buffer, mimeType, "", { skipStudio: false });
    res.json({
      studioApplied: result.studioApplied,
      cleanImageBase64: result.cleanImageBase64,
      draft: result.draft,
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
  const result = await publishSellerListing({ phone, draft, images: imageList, videoBase64, draftId });
  if (result.error === "not_approved") return res.status(403).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

/** POST /api/seller/listings/draft — save draft for later */
router.post("/draft", async (req, res) => {
  const { phone, draft, images, imageBase64, videoBase64 } = req.body || {};
  const imageList = Array.isArray(images) ? images : imageBase64 ? [imageBase64] : [];
  const result = await saveSellerDraft({ phone, draft, images: imageList, videoBase64 });
  if (result.error === "not_approved") return res.status(403).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

/** GET /api/seller/listings?phone=254... — seller drafts + live listings */
router.get("/", async (req, res) => {
  const result = await listSellerListings(req.query.phone);
  if (result.error) return res.status(403).json(result);
  res.json(result);
});

router.get("/meta", async (_req, res) => {
  res.json(await getSellerListingMeta());
});

export default router;
