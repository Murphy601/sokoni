import { clientError } from "../lib/public-error.js";
import { Router } from "express";
import {
  getOpsStatus,
  pauseCatalog,
  unpauseCatalog,
  syncPublicCatalog,
  publishCatalogToGit,
  setProductStock,
  runDbMigrate,
  runDbSeed,
  updatePlatformFlags,
} from "../services/catalog-ops.js";
import { getWahaSessionStatus } from "../services/waha-session.js";
import { requireAdminToken } from "../lib/admin-auth.js";
import { listFlaggedMessages, resolveFlaggedMessage } from "../agents/flagged-store.js";
import { listAgentActions, resolveAgentAction } from "../agents/agent-actions.js";

const router = Router();

router.use(requireAdminToken);

router.get("/status", async (_req, res) => {
  res.json({ status: await getOpsStatus() });
});

/** GET /admin/ops/waha — WhatsApp session link status (no QR / pairing codes). */
router.get("/waha", async (_req, res) => {
  try {
    const waha = await getWahaSessionStatus();
    res.json({ ok: true, waha });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/catalog/pause", async (req, res) => {
  const status = await pauseCatalog(req.body?.reason || "Paused via admin API");
  res.json({ ok: true, status });
});

router.post("/catalog/live", async (_req, res) => {
  const status = await unpauseCatalog("Live via admin API");
  res.json({ ok: true, status });
});

router.post("/catalog/sync", async (_req, res) => {
  try {
    const status = await syncPublicCatalog();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/catalog/publish", async (_req, res) => {
  try {
    const status = await publishCatalogToGit();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/stock/:productId", async (req, res) => {
  const inStock = req.body?.inStock !== false && req.body?.inStock !== "false";
  const result = await setProductStock(req.params.productId, inStock);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.post("/flags", (req, res) => {
  const flags = updatePlatformFlags(req.body || {});
  res.json({ ok: true, flags });
});

router.post("/db/migrate", async (_req, res) => {
  try {
    const result = await runDbMigrate();
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.get("/flagged-messages", async (req, res) => {
  try {
    const result = await listFlaggedMessages(req.query.status);
    if (result.error === "invalid_status") return res.status(400).json(result);
    if (result.error === "database_not_configured") return res.status(503).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/flagged-messages/:id/resolve", async (req, res) => {
  try {
    const result = await resolveFlaggedMessage(req.params.id, req.body?.action, req.body?.notes);
    if (result.error === "not_found") return res.status(404).json(result);
    if (result.error === "unsupported_action" || result.error === "invalid_flag" || result.error === "already_resolved") {
      return res.status(400).json(result);
    }
    if (result.error === "database_not_configured") return res.status(503).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.get("/agent-actions", async (req, res) => {
  try {
    const result = await listAgentActions(req.query.status);
    if (result.error === "invalid_status") return res.status(400).json(result);
    if (result.error === "database_not_configured") return res.status(503).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/agent-actions/:id/resolve", async (req, res) => {
  try {
    const result = await resolveAgentAction(req.params.id, req.body?.action);
    if (result.error === "not_found") return res.status(404).json(result);
    if (
      result.error === "unsupported_action" ||
      result.error === "invalid_action" ||
      result.error === "already_resolved"
    ) {
      return res.status(400).json(result);
    }
    if (result.error === "database_not_configured") return res.status(503).json(result);
    const status = result.action?.status === "FAILED" ? 409 : 200;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

router.post("/db/seed", async (req, res) => {
  try {
    const result = await runDbSeed(Boolean(req.body?.dryRun));
    res.json(result);
  } catch (err) {
    res.status(500).json(clientError(err));
  }
});

export default router;
