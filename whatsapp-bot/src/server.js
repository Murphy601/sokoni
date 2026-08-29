import express from "express";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { CATALOG_IMAGES_DIR } from "./lib/catalog-images.js";
import { AVATARS_DIR, LEGACY_AVATARS_DIR, migrateLegacyAvatars } from "./services/seller-avatar.js";
import { handleWahaWebhook } from "./handlers/webhookHandler.js";
import { runTiktokPostJob } from "./services/tiktok.js";
import { startTokenRefreshScheduler, getConnectionStatus } from "./services/tiktok-auth.js";
import tiktokOAuthRouter from "./routes/tiktokOAuth.js";
import suppliersApiRouter from "./routes/suppliersApi.js";
import adminSuppliersRouter from "./routes/adminSuppliers.js";
import pickupPointsApiRouter from "./routes/pickupPointsApi.js";
import adminPickupPointsRouter from "./routes/adminPickupPoints.js";
import { listReviews, addReview } from "./services/reviews.js";
import { checkoutMeta } from "./services/prepaid-checkout.js";
import productsApiRouter from "./routes/productsApi.js";
import sellerListingsApiRouter from "./routes/sellerListingsApi.js";
import { stageSellerVideo, stageSellerVideoChunk, VIDEO_UPLOAD_CHUNK_BYTES } from "./services/seller-listings.js";
import sellerOnboardApiRouter from "./routes/sellerOnboardApi.js";
import { sellerBodaRouter, adminBodaRouter } from "./routes/bodaFleetApi.js";
import ridersApiRouter from "./routes/ridersApi.js";
import socialApiRouter from "./routes/socialApi.js";
import buyerAuthApiRouter from "./routes/buyerAuthApi.js";
import accountAuthApiRouter from "./routes/accountAuthApi.js";
import ordersApiRouter from "./routes/ordersApi.js";
import disputesApiRouter from "./routes/disputesApi.js";
import checkoutApiRouter from "./routes/checkoutApi.js";
import cartApiRouter from "./routes/cartApi.js";
import paymentsApiRouter, { handlePaystackWebhook } from "./routes/paymentsApi.js";
import trackingApiRouter from "./routes/trackingApi.js";
import vendorShippingApiRouter from "./routes/vendorShippingApi.js";
import { attachRiderSocket } from "./services/rider-tracking.js";
import adminShipmentsRouter from "./routes/adminShipments.js";
import agentApiRouter from "./routes/agentApi.js";
import adminOpsApiRouter from "./routes/adminOpsApi.js";
import adminCommandApiRouter from "./routes/adminCommandApi.js";
import adminSupportApiRouter from "./routes/adminSupportApi.js";
import whatsappApiRouter from "./routes/whatsappApi.js";
import feedApiRouter from "./routes/feedApi.js";
import searchApiRouter from "./routes/searchApi.js";
import { processDuePayouts, disburseOwedPayoutsViaB2C } from "./services/settlements.js";
import { isB2CReady, b2cMeta } from "./services/daraja-mpesa.js";
import { paystackMeta, resolvePayoutRail } from "./services/paystack-transfers.js";
import { agentMeta } from "./services/ai-agent.js";
import { feedMeta } from "./services/feed-ranking.js";
import { refreshFeedCache } from "./services/feed-ranking.js";
import { pingDb, isDbEnabled } from "./db/pool.js";
import {
  corsAllowlist,
  attachRawBody,
  requireWahaWebhookAuth,
  apiLimiter,
  authLimiter,
  adminLimiter,
  webhookLimiter,
} from "./middleware/security.js";

const app = express();
/** Behind nginx / Cloudflare — needed for express-rate-limit client IP. */
app.set("trust proxy", 1);

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveBuildId() {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT;
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const BUILD_ID = resolveBuildId();

app.use(corsAllowlist);

function sellerVideoAuthStatus(result) {
  if (
    result.error === "session_required" ||
    result.error === "session_invalid" ||
    result.error === "session_expired"
  ) {
    return 401;
  }
  if (result.error === "not_onboarded" || result.error === "not_approved" || result.error === "forbidden") {
    return 403;
  }
  if (result.error === "video_too_large" || result.error === "chunk_too_large") return 413;
  if (
    result.error === "invalid_phone" ||
    result.error === "missing_video" ||
    result.error === "invalid_upload" ||
    result.error === "invalid_chunk" ||
    result.error === "incomplete_upload"
  ) {
    return 400;
  }
  return 0;
}

/**
 * Chunked seller-video staging — works when nginx client_max_body_size is stuck at ~1m.
 * Must run BEFORE express.json. Auth via query phone + sessionToken.
 */
app.post(
  "/api/seller/listings/upload-video-chunk",
  express.raw({
    type: () => true,
    limit: "1mb",
  }),
  async (req, res) => {
    try {
      const phone = String(req.query.phone || req.headers["x-seller-phone"] || "").trim();
      const sessionToken = String(
        req.query.sessionToken || req.headers["x-seller-session"] || ""
      ).trim();
      const chunkBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      const result = await stageSellerVideoChunk({
        phone,
        sessionToken,
        uploadId: req.query.uploadId,
        chunkIndex: req.query.chunkIndex,
        chunkCount: req.query.chunkCount,
        totalBytes: req.query.totalBytes,
        chunkBuffer,
      });
      const authStatus = sellerVideoAuthStatus(result);
      if (authStatus) return res.status(authStatus).json(result);
      if (result.error) return res.status(400).json(result);
      if (result.incomplete) return res.status(200).json(result);
      return res.status(201).json(result);
    } catch (err) {
      console.warn("[upload-video-chunk]", err?.message || err);
      return res.status(500).json({ error: "upload_failed", message: "Video upload failed — try again." });
    }
  }
);

/**
 * Binary seller-video staging — must run BEFORE express.json so the MP4 body
 * is not chewed by the JSON parser (and so we avoid 33% base64 bloat on mobile).
 * Auth: phone + sessionToken query params (same pattern as other seller GETs).
 * Prefer /upload-video-chunk when nginx body limit is low.
 */
app.post(
  "/api/seller/listings/upload-video-bin",
  express.raw({
    type: () => true,
    limit: "16mb",
  }),
  async (req, res) => {
    try {
      const phone = String(req.query.phone || req.headers["x-seller-phone"] || "").trim();
      const sessionToken = String(
        req.query.sessionToken || req.headers["x-seller-session"] || ""
      ).trim();
      const videoBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      const result = await stageSellerVideo({ phone, videoBuffer, sessionToken });
      const authStatus = sellerVideoAuthStatus(result);
      if (authStatus) return res.status(authStatus).json(result);
      if (result.error) return res.status(400).json(result);
      return res.status(201).json(result);
    } catch (err) {
      console.warn("[upload-video-bin]", err?.message || err);
      return res.status(500).json({
        error: "upload_failed",
        message: "Video upload failed — try chunked upload or trim the clip.",
        chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES,
      });
    }
  }
);

app.use(express.json({ limit: "25mb", verify: attachRawBody }));

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: `${config.brand.name} WhatsApp bot (WAHA)`,
    session: config.waha.session,
  });
});

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", build: BUILD_ID });
});

app.get("/health", async (_req, res) => {
  const withTimeout = (promise, ms, fallback) =>
    Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const db = await withTimeout(pingDb(), 3000, { ok: false, reason: "timeout" });
  const checkout = checkoutMeta();
  const agent = agentMeta();
  const feed = feedMeta();
  let ops = { phase: 9, catalog: { paused: false } };
  try {
    const { getOpsStatus } = await import("./services/catalog-ops.js");
    ops = await withTimeout(getOpsStatus(), 5000, ops);
  } catch (err) {
    ops = { phase: 9, catalog: { paused: false }, opsError: err.message };
  }
  let wahaHealth = {
    wahaConfigured: Boolean(config.waha.apiUrl),
    wahaReachable: false,
    wahaLinked: false,
    wahaSessionStatus: null,
  };
  try {
    const { getWahaHealthSummary } = await import("./services/waha-session.js");
    wahaHealth = await withTimeout(getWahaHealthSummary(), 3500, wahaHealth);
  } catch {
    /* keep defaults */
  }

  let studioClipEnabled = false;
  try {
    const { isStudioClipEnabled } = await import("./services/listing-studio.js");
    studioClipEnabled = isStudioClipEnabled();
  } catch {
    studioClipEnabled = false;
  }

  res.json({
    status: "ok",
    build: BUILD_ID,
    aiModel: config.openai.model || null,
    catalogVisionModel: config.catalog.visionModel || null,
    aiConfigured: Boolean(config.openai.apiKey),
    aiAgent: agent.name,
    aiTools: agent.tools,
    feedPhase: feed.phase,
    opsPhase: ops.phase,
    catalogPaused: ops.catalog.paused,
    studioClipEnabled,
    wahaConfigured: wahaHealth.wahaConfigured,
    wahaReachable: wahaHealth.wahaReachable,
    wahaLinked: wahaHealth.wahaLinked,
    wahaSessionStatus: wahaHealth.wahaSessionStatus,
    dbEnabled: isDbEnabled(),
    dbConnected: db.ok,
    dbError: db.ok ? null : db.reason,
    prepaidOnly: checkout.prepaidOnly,
    darajaConfigured: checkout.darajaConfigured,
    paymentRail: checkout.paymentRail || null,
    paystackConfigured: Boolean(checkout.paystackConfigured),
    paystackOnly: checkout.paystackOnly !== false,
    b2c: b2cMeta(),
  });
});

/** Product photos — served from VM disk (no Cloudflare wait). */
const catalogImageStatic = express.static(CATALOG_IMAGES_DIR, {
  maxAge: "1d",
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
  },
});
app.use("/catalog-images", catalogImageStatic);
/** Alias so relative assets/images/products/* URLs also hit the VM when proxied. */
app.use("/assets/images/products", catalogImageStatic);

/** Seller shop avatars — durable data/avatars, then legacy website path. */
const avatarStaticOpts = {
  maxAge: "1d",
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
  },
};
app.use("/assets/images/avatars", express.static(AVATARS_DIR, avatarStaticOpts));
app.use("/assets/images/avatars", express.static(LEGACY_AVATARS_DIR, avatarStaticOpts));

/** Rider verification docs (opaque filenames under data/boda-docs). */
{
  const bodaDocsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "boda-docs");
  app.use(
    "/assets/boda-docs",
    express.static(bodaDocsDir, {
      fallthrough: true,
      maxAge: "1d",
      setHeaders(res) {
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Access-Control-Allow-Origin", "*");
      },
    })
  );
}

app.use("/api/", apiLimiter);
/** OTP only — do NOT throttle session-authed Seller Hub routes (ledger/orders/shipping). */
app.use("/api/seller/onboard/send-code", authLimiter);
app.use("/api/seller/onboard/verify-code", authLimiter);
app.use("/api/buyer/auth", authLimiter);
app.use("/api/account/auth", authLimiter);
app.use("/api/agent", authLimiter);
app.use("/admin/", adminLimiter);

/** Public reviews for website + WhatsApp-collected feedback. */
app.get("/api/reviews", (_req, res) => {
  res.json({ reviews: listReviews(30) });
});

app.post("/api/reviews", (req, res) => {
  const { customerName, productName, stars, comment, orderId } = req.body || {};
  const result = addReview({
    customerName,
    productName,
    stars,
    comment,
    orderId,
    source: "website",
  });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json({ review: result.review });
});

app.use("/api/suppliers", suppliersApiRouter);
app.use("/api/products", productsApiRouter);
app.use("/api/seller/listings", sellerListingsApiRouter);
app.use("/api/seller/onboard", sellerOnboardApiRouter);
app.use("/api/seller/onboard/boda", sellerBodaRouter);
app.use("/api/riders", ridersApiRouter);
app.use("/api/social", socialApiRouter);
app.use("/api/buyer/auth", buyerAuthApiRouter);
app.use("/api/account/auth", accountAuthApiRouter);
app.use("/api/orders", ordersApiRouter);
app.use("/api/disputes", disputesApiRouter);
app.use("/api/checkout", checkoutApiRouter);
app.use("/api/cart", cartApiRouter);
app.use("/api/payments", paymentsApiRouter);
app.post("/api/webhooks/paystack", webhookLimiter, handlePaystackWebhook);
app.use("/api/tracking", trackingApiRouter);
app.use("/api/vendor", vendorShippingApiRouter);
app.use("/api/agent", agentApiRouter);
app.use("/api/feed", feedApiRouter);
app.use("/api/search", searchApiRouter);
app.use("/api/whatsapp", whatsappApiRouter);
app.use("/admin/shipments", adminShipmentsRouter);
app.use("/admin/ops", adminOpsApiRouter);
app.use("/admin/command", adminCommandApiRouter);
app.use("/admin/support", adminSupportApiRouter);
app.use("/admin/suppliers", adminSuppliersRouter);
app.use("/admin/boda", adminBodaRouter);
app.use("/api/pickup-points", pickupPointsApiRouter);
app.use("/admin/pickup-points", adminPickupPointsRouter);

/** Backend-only TikTok OAuth (connect once; tokens auto-refresh). */
app.use("/admin/tiktok", tiktokOAuthRouter);

/** WAHA posts inbound message events here — HMAC when WEBHOOK_HMAC_KEY is set. */
app.post("/webhook", webhookLimiter, requireWahaWebhookAuth, async (req, res) => {
  res.sendStatus(200);
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      await handleWahaWebhook(event);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

const httpServer = app.listen(config.port, "0.0.0.0", () => {
  console.log(`${config.brand.name} WhatsApp bot listening on port ${config.port} (build ${BUILD_ID})`);
  void migrateLegacyAvatars();
  attachRiderSocket(httpServer);
  if (!config.waha.apiUrl) {
    console.log("⚠️ WAHA_API_URL not set — running in dry-run mode (messages will be logged, not sent).");
  } else {
    console.log(`✓ WAHA: ${config.waha.apiUrl} (session: ${config.waha.session})`);
  }
  if (!config.openai.apiKey) {
    console.log("⚠️ OPENAI_API_KEY not set — free-text replies will use a basic keyword-search fallback.");
  }
  try {
    const routing = agentMeta()?.routing || {};
    const providers = (routing.providers || [])
      .map((p) => `${p.name}=[${(p.models || []).join(",")}]`)
      .join(" → ");
    console.log(
      `✓ Chat LLM: ${providers || "(no keys)"} | temp=${routing.temperature ?? "?"} | geminiChat=${
        String(process.env.AI_CHAT_USE_GEMINI || "").toLowerCase() === "true" ||
        String(process.env.AI_CHAT_PROVIDER || "").toLowerCase() === "gemini"
          ? "on"
          : "off"
      }`
    );
  } catch (err) {
    console.warn("[llm-router] meta at startup:", err.message);
  }
  const tiktok = getConnectionStatus();
  if (tiktok.connected) {
    console.log(`✓ TikTok connected (access until ${tiktok.accessExpiresAt})`);
  } else if (config.tiktok.clientKey) {
    console.log("⚠️ TikTok not connected — run: node scripts/tiktok-connect.mjs");
  }
  startTokenRefreshScheduler();
  startTiktokScheduler();
  startPayoutScheduler();
  startOrderCommunicationScheduler();
  startFeedScheduler();
  startBodaDisputeWindowScheduler();
  startRiderB2CScheduler();
  // Ensure platform storefront has a social user id (Make an offer / inbox).
  if (isDbEnabled()) {
    import("./db/repositories/sellers.js")
      .then(({ ensureDefaultSeller }) => ensureDefaultSeller())
      .then(() => import("./services/catalog.js"))
      .then(({ invalidateProductCache }) => invalidateProductCache())
      .catch((err) => console.warn("[sellers] default storefront ensure:", err.message));
  }
});

/** Clear boda rider fees after the 15-min buyer DISPUTE / HOLD_ESCROW window elapses. */
function startBodaDisputeWindowScheduler() {
  const tick = () => {
    import("./services/boda-fleet.js")
      .then(({ processBodaDisputeWindows }) => processBodaDisputeWindows())
      .catch((err) => console.warn("[boda-fleet] dispute window tick:", err.message));
  };
  tick();
  setInterval(tick, 2 * 60 * 1000);
  console.log("✓ Boda HOLD_ESCROW scheduler enabled (every 2 min)");
}

/** Disburse CLEARED rider delivery fees via Daraja B2C (min KES 100). */
function startRiderB2CScheduler() {
  const tick = () => {
    import("./services/rider-b2c.js")
      .then(({ processRiderB2CPayouts, riderB2cConfigured }) => {
        if (!riderB2cConfigured()) return null;
        return processRiderB2CPayouts({ minKes: 100, limit: 10 });
      })
      .then((result) => {
        if (result?.triggered > 0) {
          console.log(`[rider-b2c] triggered ${result.triggered} payout batch(es)`);
        }
      })
      .catch((err) => console.warn("[rider-b2c] tick:", err.message));
  };
  // Offset from hold-window tick; hourly is enough for batch B2C.
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 60 * 60 * 1000);
  console.log("✓ Rider B2C payout scheduler enabled (hourly when B2C ready)");
}

/** Refresh trending / price-tier feed slices hourly. */
function startFeedScheduler() {
  const tick = () => {
    refreshFeedCache().catch((err) => console.error("[feed] refresh:", err.message));
  };
  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log("✓ Feed ranking scheduler enabled (hourly)");
}

/** Move scheduled seller payouts to owed after 2–3 business day escrow hold; optional B2C auto-send. */
function startPayoutScheduler() {
  const tick = async () => {
    try {
      const n = processDuePayouts();
      if (n > 0) console.log(`[settlements] ${n} seller payout(s) now owed`);
      const rail = resolvePayoutRail(isB2CReady());
      if (rail === "b2c" && isB2CReady()) {
        const sent = await disburseOwedPayoutsViaB2C({ includeFailed: false, limit: 10 });
        if (sent > 0) console.log(`[settlements] B2C accepted ${sent} payout(s)`);
      }
    } catch (err) {
      console.error("[settlements] payout cron:", err.message);
    }
  };
  tick();
  setInterval(tick, 60 * 60 * 1000);
  const b2c = b2cMeta();
  const paystack = paystackMeta();
  const rail = resolvePayoutRail(b2c.ready);
  console.log(
    `✓ Seller payout scheduler enabled (hourly) · rail ${rail}` +
      `${paystack.ready ? ` · Paystack ${paystack.collectReady ? "C2B+transfers" : "transfers"}` : ""}` +
      `${b2c.ready ? ` · B2C ${b2c.auto ? "auto" : "manual (#payb2c)"}` : " · B2C not configured"}`
  );
}

/** DISPATCH / YES reminders + overdue buyer-confirm admin flags (communication hub). */
function startOrderCommunicationScheduler() {
  const tick = () => {
    import("./services/communication-hub.js")
      .then(({ processOrderCommunicationReminders }) => processOrderCommunicationReminders())
      .catch((err) => console.error("[communication-hub] reminder cron:", err.message));
    import("./services/commerce-ops.js")
      .then(({ processAbandonedCheckoutRecovery }) => processAbandonedCheckoutRecovery())
      .catch((err) => console.error("[commerce-ops] abandon cron:", err.message));
  };
  // Offset from payout cron so we don't stampede the WAHA API.
  setTimeout(tick, 90_000);
  setInterval(tick, 60 * 60 * 1000);
  console.log("✓ Order communication + abandon-recovery scheduler enabled (hourly)");
}

/** Parse "HH:MM" slots for daily posting. */
function parsePostTimes(times) {
  return times
    .map((t) => {
      const [h, m = "0"] = t.split(":");
      return { hour: Number(h), minute: Number(m) };
    })
    .filter((t) => !Number.isNaN(t.hour) && !Number.isNaN(t.minute));
}

/** Current clock in configured timezone (default EAT / Africa/Nairobi). */
function clockInTimezone(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "0";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** 3× daily at Kenyan peak hours (8:00, 13:00, 19:30 EAT by default). */
function startTiktokScheduler() {
  if (!config.tiktok.cronEnabled) return;
  const slots = parsePostTimes(config.tiktok.postTimes);
  const tz = config.tiktok.timezone;
  let lastRunKey = "";

  setInterval(() => {
    const now = clockInTimezone(tz);
    const match = slots.find((s) => s.hour === now.hour && s.minute === now.minute);
    if (!match) return;
    const runKey = `${now.dateKey}-${match.hour}:${String(match.minute).padStart(2, "0")}`;
    if (runKey === lastRunKey) return;
    lastRunKey = runKey;
    runTiktokPostJob().catch((err) => console.error("[tiktok:cron]", err.message));
  }, 60_000);

  const label = slots.map((s) => `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`).join(", ");
  console.log(`✓ TikTok cron enabled (${tz}): ${label}`);
}
