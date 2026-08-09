import { Router } from "express";
import {
  requireApprovedSeller,
  generateSellerListingDraft,
  publishSellerListing,
  saveSellerDraft,
  deleteSellerDraft,
  listSellerListings,
  getSellerListingMeta,
  stageSellerVideo,
  bulkImportSellerDraftsFromCsv,
  getBulkListingCsvTemplate,
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
  const {
    phone,
    imageBase64,
    mimeType = "image/jpeg",
    caption = "",
    skipStudio = false,
    sellerNetKes,
    priceKes,
  } = req.body || {};
  const sessionToken = sellerSessionFromReq(req);
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) {
    return res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
  }

  if (!imageBase64) {
    return res.status(400).json({ error: "missing_image" });
  }

  // Prefer structured seller-net from the form so AI doesn't fail when the photo has no price sticker.
  let effectiveCaption = String(caption || "").trim();
  const formPrice = Math.round(Number(sellerNetKes ?? priceKes) || 0);
  if (formPrice > 0 && !/\b\d{2,7}\s*(?:ksh|kes)\b/i.test(effectiveCaption) && !/\b(?:ksh|kes)\s*\d{2,7}\b/i.test(effectiveCaption)) {
    effectiveCaption = `${formPrice} ksh ${effectiveCaption}`.trim();
  }

  try {
    const buffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    const result = await generateSellerListingDraft(buffer, mimeType, effectiveCaption, { skipStudio });
    res.json({
      draft: result.draft,
      studioApplied: result.studioApplied,
      cleanImageUrl: result.cleanImageUrl || null,
      cleanImageBase64: result.cleanImageBase64 || null,
      clipApplied: Boolean(result.clipApplied),
      clipVideoUrl: result.clipVideoUrl || null,
      clipVideoBase64: result.clipVideoBase64 || null,
      studioProvider: result.studioProvider || null,
      seller: { id: check.supplier.id, businessName: check.supplier.businessName },
    });
  } catch (err) {
    const { friendlyListingVisionError } = await import("../services/listing-generator.js");
    res.status(422).json({
      error: "generation_failed",
      message: friendlyListingVisionError(err),
    });
  }
});

/** POST /api/seller/listings/studio — cloud BG cleanup (+ single clip or multi-photo reel) */
router.post("/studio", async (req, res) => {
  const { phone, imageBase64, imagesBase64, mimeType = "image/jpeg" } = req.body || {};
  const sessionToken = sellerSessionFromReq(req);
  const check = await requireApprovedSeller(phone, sessionToken);
  if (check.error) {
    return res.status(sessionAuthStatus(check)).json({ error: check.error, message: check.message });
  }

  const rawList = Array.isArray(imagesBase64) && imagesBase64.length
    ? imagesBase64.filter(Boolean).slice(0, 8)
    : imageBase64
      ? [imageBase64]
      : [];
  if (!rawList.length) {
    return res.status(400).json({ error: "missing_image", message: "Add a cover photo first." });
  }

  try {
    const buffers = rawList.map((raw) =>
      Buffer.from(String(raw).replace(/^data:[^;]+;base64,/, ""), "base64")
    );
    // Drop huge request payload from memory before Cloudinary work (1GB VM).
    if (req.body) {
      req.body.imageBase64 = undefined;
      req.body.imagesBase64 = undefined;
    }
    const result = await previewStudioClean(buffers.length === 1 ? buffers[0] : buffers, mimeType);
    res.json({
      studioApplied: result.studioApplied,
      cleanImageUrl: result.cleanImageUrl || null,
      cleanImageBase64: result.cleanImageBase64 || null,
      clipApplied: Boolean(result.clipApplied),
      clipVideoUrl: result.clipVideoUrl || null,
      clipVideoBase64: result.clipVideoBase64 || null,
      imageUrls: Array.isArray(result.imageUrls) ? result.imageUrls : [],
      reason: result.reason,
      message: result.message,
      provider: result.provider || null,
      seller: { id: check.supplier.id, businessName: check.supplier.businessName },
    });
  } catch (err) {
    res.status(422).json({ error: "studio_failed", message: err.message });
  }
});

/**
 * POST /api/seller/listings/upload-video — stage seller phone clip before publish.
 * Keeps the large base64 out of /publish so nginx/timeouts don't fake-fail the listing.
 */
router.post("/upload-video", async (req, res) => {
  const { phone, videoBase64 } = req.body || {};
  const result = await stageSellerVideo({
    phone,
    videoBase64,
    sessionToken: sellerSessionFromReq(req),
  });
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return res.status(401).json(result);
  }
  if (result.error === "not_onboarded" || result.error === "not_approved") {
    return res.status(403).json(result);
  }
  if (result.error === "video_too_large") return res.status(413).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

/** POST /api/seller/listings/publish — instant live (Depop-style) */
router.post("/publish", async (req, res) => {
  try {
    const {
      phone,
      draft,
      images,
      imageBase64,
      imageUrls,
      videoBase64,
      videoUrl,
      videoKind,
      draftId,
      clientPublishId,
    } = req.body || {};
    const imageList = Array.isArray(images)
      ? images
      : imageBase64
        ? [imageBase64]
        : [];
    const result = await publishSellerListing({
      phone,
      draft,
      images: imageList,
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      videoBase64,
      videoUrl: videoUrl || null,
      videoKind,
      draftId,
      clientPublishId: clientPublishId || null,
      sessionToken: sellerSessionFromReq(req),
    });
    if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
      return res.status(401).json(result);
    }
    if (result.error === "not_onboarded" || result.error === "not_approved") return res.status(403).json(result);
    if (result.error === "not_found") return res.status(404).json(result);
    if (result.error) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err) {
    console.error("[seller-listings/publish]", err);
    return res.status(500).json({
      error: "publish_failed",
      message: "Could not finish posting — try again with fewer photos, or post without a long video.",
    });
  }
});

/** POST /api/seller/listings/draft — save / update draft for later */
router.post("/draft", async (req, res) => {
  const {
    phone,
    draft,
    images,
    imageBase64,
    imageUrls,
    videoBase64,
    videoUrl,
    videoKind,
    draftId,
  } = req.body || {};
  const imageList = Array.isArray(images) ? images : imageBase64 ? [imageBase64] : [];
  const result = await saveSellerDraft({
    phone,
    draft,
    images: imageList,
    imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
    videoBase64,
    videoUrl: videoUrl || null,
    videoKind,
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

/** GET /api/seller/listings/bulk/template — Depop-style CSV template download */
router.get("/bulk/template", (req, res) => {
  const tpl = getBulkListingCsvTemplate();
  if (String(req.query?.format || "").toLowerCase() === "json") {
    return res.json({
      filename: tpl.filename,
      maxRows: tpl.maxRows,
      headers: tpl.headers,
      help: tpl.help,
      csv: tpl.body,
    });
  }
  res.setHeader("Content-Type", tpl.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${tpl.filename}"`);
  res.send(tpl.body);
});

/**
 * POST /api/seller/listings/bulk/drafts — CSV text → draft listings (photos later).
 * Body: { phone, csvText } or { phone, csvBase64 }
 */
router.post("/bulk/drafts", async (req, res) => {
  let csvText = req.body?.csvText || req.body?.csv || "";
  if (!csvText && req.body?.csvBase64) {
    try {
      csvText = Buffer.from(String(req.body.csvBase64).replace(/^data:[^;]+;base64,/, ""), "base64").toString(
        "utf8"
      );
    } catch {
      return res.status(400).json({ error: "invalid_csv", message: "Could not decode CSV file." });
    }
  }
  if (!String(csvText || "").trim()) {
    return res.status(400).json({ error: "invalid_csv", message: "Paste CSV text or upload a .csv file." });
  }

  const result = await bulkImportSellerDraftsFromCsv({
    phone: req.body?.phone,
    csvText,
    sessionToken: sellerSessionFromReq(req),
  });
  if (result.error === "session_required" || result.error === "session_invalid" || result.error === "session_expired") {
    return res.status(401).json(result);
  }
  if (result.error === "not_onboarded" || result.error === "not_approved") return res.status(403).json(result);
  if (result.error === "invalid_csv") return res.status(400).json(result);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
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
