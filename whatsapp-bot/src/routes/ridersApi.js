/**
 * Public rider onboarding — multipart POST /api/riders/register (multer).
 * Saves verification docs under data/boda-docs/ and creates a PENDING rider.
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { config } from "../config.js";
import { registerRiderApplication, bodaSupportSummary } from "../services/boda-fleet.js";

const BODA_DOCS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "boda-docs"
);
fs.mkdirSync(BODA_DOCS_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, BODA_DOCS_DIR);
  },
  filename: (_req, file, cb) => {
    const field = String(file.fieldname || "doc").replace(/[^a-zA-Z0-9_-]/g, "");
    let ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      if (String(file.mimetype || "").includes("pdf")) ext = ".pdf";
      else if (String(file.mimetype || "").includes("png")) ext = ".png";
      else if (String(file.mimetype || "").includes("webp")) ext = ".webp";
      else ext = ".jpg";
    }
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${field}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "");
    const name = String(file.originalname || "");
    const ok =
      /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i.test(mime) ||
      /\.(jpe?g|png|webp|gif|pdf)$/i.test(name);
    if (!ok) {
      const err = new Error("invalid_file_type");
      err.code = "INVALID_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  },
});

const uploadFields = upload.fields([
  { name: "idDocument", maxCount: 1 },
  { name: "idDocumentBack", maxCount: 1 },
  { name: "dlDocument", maxCount: 1 },
  { name: "stageLetter", maxCount: 1 },
  { name: "logbookDocument", maxCount: 1 },
  { name: "goodConductDocument", maxCount: 1 },
  { name: "ntsaBadgeDocument", maxCount: 1 },
]);

function publicDocUrl(file) {
  if (!file?.filename) return null;
  const base = (config.botPublicUrl || "https://bot.sokonimall.com").replace(/\/$/, "");
  return `${base}/assets/boda-docs/${encodeURIComponent(file.filename)}`;
}

function firstFile(files, field) {
  return files?.[field]?.[0] || null;
}

const router = Router();

router.get("/info", (_req, res) => {
  res.json({ ok: true, ...bodaSupportSummary() });
});

/**
 * POST /api/riders/register
 * multipart/form-data: fullName, phone, nationalId, operatingTown, stageLocation,
 * motorbikePlate, guarantorName?, guarantorPhone?,
 * idDocument*, dlDocument*, stageLetter*, optional extras.
 */
router.post("/register", (req, res) => {
  uploadFields(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          error: "file_too_large",
          message: "Each document must be under 5 MB (image or PDF).",
        });
      }
      if (err.code === "INVALID_FILE_TYPE" || err.message === "invalid_file_type") {
        return res.status(400).json({
          success: false,
          error: "invalid_file_type",
          message: "Upload images (JPG/PNG/WebP) or PDF only.",
        });
      }
      console.warn("[riders/register] multer:", err.message);
      return res.status(400).json({
        success: false,
        error: "upload_failed",
        message: "Could not process uploads. Try again.",
      });
    }

    try {
      const files = req.files || {};
      const body = req.body || {};
      const idDoc = firstFile(files, "idDocument");
      const dlDoc = firstFile(files, "dlDocument");
      const stageDoc = firstFile(files, "stageLetter");

      if (!idDoc || !dlDoc || !stageDoc) {
        return res.status(400).json({
          success: false,
          error: "docs_required",
          message: "Upload National ID, driving licence (Class A), and stage chairman letter.",
        });
      }

      const result = await registerRiderApplication({
        fullName: body.fullName,
        phone: body.phone,
        nationalId: body.nationalId,
        operatingTown: body.operatingTown,
        stageLocation: body.stageLocation,
        motorbikePlate: body.motorbikePlate,
        guarantorName: body.guarantorName,
        guarantorPhone: body.guarantorPhone,
        nationalIdFrontUrl: publicDocUrl(idDoc),
        nationalIdBackUrl: publicDocUrl(firstFile(files, "idDocumentBack")),
        licenseUrl: publicDocUrl(dlDoc),
        stageLetterUrl: publicDocUrl(stageDoc),
        logbookUrl: publicDocUrl(firstFile(files, "logbookDocument")),
        goodConductUrl: publicDocUrl(firstFile(files, "goodConductDocument")),
        ntsaBadgeUrl: publicDocUrl(firstFile(files, "ntsaBadgeDocument")),
      });

      if (result.error === "database_not_configured") {
        return res.status(503).json({ success: false, ...result });
      }
      if (result.error === "duplicate") {
        return res.status(400).json({ success: false, ...result });
      }
      if (result.error) {
        return res.status(400).json({ success: false, ...result });
      }

      res.status(201).json(result);
    } catch (error) {
      console.error("[Rider Registration Error]", error);
      if (error?.code === "23505") {
        return res.status(400).json({
          success: false,
          error: "duplicate",
          message: "Phone number, National ID, or number plate already registered.",
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error during registration.",
      });
    }
  });
});

export default router;
export { BODA_DOCS_DIR };
