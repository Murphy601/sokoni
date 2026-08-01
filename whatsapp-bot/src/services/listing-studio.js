/**
 * AI Photo Studio — background cleanup (+ optional Ken Burns clip).
 *
 * Providers (Phase 1–6):
 *   STUDIO_PROVIDER=auto|rembg|photoroom|off
 *   REMBG_URL=http://127.0.0.1:7000
 *   PHOTOROOM_API_KEY=… (Phase 6 / current paid path)
 *   STUDIO_FALLBACK_REMBG=true — if Photoroom fails, try rembg
 *
 * Failures always fall back to the original image. Bot boot never depends on rembg.
 */
import { generateListingFromImage } from "./listing-generator.js";
import { enqueueMediaJob, awaitMediaJob, mediaJobsSnapshot } from "./media-jobs.js";
import { makeKenBurnsClip } from "./media-clip.js";
import { config } from "../config.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

let rembgHealthCache = { at: 0, ok: false };

function studioCfg() {
  return config.studio || {};
}

/** @returns {"none"|"photoroom"|"rembg"} */
export function resolveStudioProvider() {
  // Prefer live process.env so .env reloads / tests work without restarting the module graph.
  const explicit = String(process.env.STUDIO_PROVIDER || studioCfg().provider || "auto")
    .trim()
    .toLowerCase();
  const hasPhoto = Boolean((process.env.PHOTOROOM_API_KEY || studioCfg().photoroomApiKey || "").trim());
  const rembgUrl = String(process.env.REMBG_URL || studioCfg().rembgUrl || "").trim();

  if (explicit === "off" || explicit === "none") return "none";
  if (explicit === "photoroom") return hasPhoto ? "photoroom" : "none";
  if (explicit === "rembg") return rembgUrl ? "rembg" : "none";
  // auto
  if (hasPhoto) return "photoroom";
  if (rembgUrl) return "rembg";
  return "none";
}

/** @returns {boolean} */
export function isStudioConfigured() {
  return resolveStudioProvider() !== "none";
}

export function getStudioMeta() {
  const provider = resolveStudioProvider();
  return {
    studioEnabled: provider !== "none",
    studioProvider: provider,
    studioClipEnabled: clipEnabled(),
    studioJobs: mediaJobsSnapshot(),
    rembgUrlConfigured: Boolean(String(process.env.REMBG_URL || studioCfg().rembgUrl || "").trim()),
    photoroomConfigured: Boolean(
      (process.env.PHOTOROOM_API_KEY || studioCfg().photoroomApiKey || "").trim()
    ),
    rembgHealthy: rembgHealthCache.ok,
  };
}

export function rembgBaseUrl() {
  return String(process.env.REMBG_URL || studioCfg().rembgUrl || "").replace(/\/$/, "");
}

export async function pingRembgHealth() {
  const base = rembgBaseUrl();
  if (!base) {
    rembgHealthCache = { at: Date.now(), ok: false };
    return false;
  }
  const now = Date.now();
  if (now - rembgHealthCache.at < 30_000) return rembgHealthCache.ok;
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(Number(studioCfg().healthTimeoutMs) || 2500),
    });
    rembgHealthCache = { at: now, ok: res.ok };
  } catch {
    rembgHealthCache = { at: now, ok: false };
  }
  return rembgHealthCache.ok;
}

async function removeViaPhotoroom(buffer, mimeType) {
  const apiKey = (studioCfg().photoroomApiKey || process.env.PHOTOROOM_API_KEY || "").trim();
  if (!apiKey) return { buffer, mimeType, studioApplied: false, reason: "not_configured", provider: "photoroom" };

  try {
    const form = new FormData();
    form.append("image_file", new Blob([buffer], { type: mimeType }), "listing.jpg");
    const res = await fetch(PHOTOROOM_SEGMENT, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(Number(studioCfg().providerTimeoutMs) || 45_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[listing-studio] Photoroom failed:", res.status, errText.slice(0, 200));
      return { buffer, mimeType, studioApplied: false, reason: "api_failed", provider: "photoroom" };
    }
    const clean = Buffer.from(await res.arrayBuffer());
    if (!clean.length) {
      return { buffer, mimeType, studioApplied: false, reason: "empty_result", provider: "photoroom" };
    }
    return { buffer: clean, mimeType: "image/png", studioApplied: true, provider: "photoroom" };
  } catch (err) {
    console.warn("[listing-studio] Photoroom error:", err.message);
    return { buffer, mimeType, studioApplied: false, reason: "api_error", provider: "photoroom" };
  }
}

async function removeViaRembg(buffer, mimeType) {
  const base = rembgBaseUrl();
  if (!base) {
    return { buffer, mimeType, studioApplied: false, reason: "not_configured", provider: "rembg" };
  }

  const maxBytes = Number(studioCfg().maxBytes) || 12 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return { buffer, mimeType, studioApplied: false, reason: "file_too_large", provider: "rembg" };
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType || "image/jpeg" }), "listing.jpg");
    const res = await fetch(`${base}/api/remove`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(Number(studioCfg().providerTimeoutMs) || 55_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[listing-studio] rembg failed:", res.status, errText.slice(0, 200));
      rembgHealthCache = { at: Date.now(), ok: false };
      return {
        buffer,
        mimeType,
        studioApplied: false,
        reason: res.status === 0 ? "worker_down" : "api_failed",
        provider: "rembg",
      };
    }
    const clean = Buffer.from(await res.arrayBuffer());
    if (!clean.length) {
      return { buffer, mimeType, studioApplied: false, reason: "empty_result", provider: "rembg" };
    }
    rembgHealthCache = { at: Date.now(), ok: true };
    return { buffer: clean, mimeType: "image/png", studioApplied: true, provider: "rembg" };
  } catch (err) {
    console.warn("[listing-studio] rembg error:", err.message);
    rembgHealthCache = { at: Date.now(), ok: false };
    return { buffer, mimeType, studioApplied: false, reason: "worker_down", provider: "rembg" };
  }
}

async function removeBackgroundDirect(buffer, mimeType = "image/jpeg") {
  if (!buffer?.length) {
    return { buffer, mimeType, studioApplied: false, reason: "missing_image", provider: resolveStudioProvider() };
  }

  const provider = resolveStudioProvider();
  if (provider === "none") {
    return { buffer, mimeType, studioApplied: false, reason: "not_configured", provider: "none" };
  }

  let result =
    provider === "rembg"
      ? await removeViaRembg(buffer, mimeType)
      : await removeViaPhotoroom(buffer, mimeType);

  const fallback =
    String(process.env.STUDIO_FALLBACK_REMBG || "").toLowerCase() === "true" ||
    studioCfg().fallbackRembg === true;

  if (!result.studioApplied && provider === "photoroom" && fallback) {
    const rembgUrl = String(process.env.REMBG_URL || studioCfg().rembgUrl || "").trim();
    if (rembgUrl) {
      const second = await removeViaRembg(buffer, mimeType);
      if (second.studioApplied) return { ...second, fallbackFrom: "photoroom" };
    }
  }

  return result;
}

/**
 * Queued cleanup (Phase 2) — concurrency-limited; awaits completion with timeout.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const job = enqueueMediaJob("cleanup", () => removeBackgroundDirect(buffer, mimeType));
  const waited = await awaitMediaJob(job, studioCfg().jobWaitMs || 55_000);
  if (waited.ok && job.result) return job.result;
  if (waited.error === "job_timeout") {
    return { buffer, mimeType, studioApplied: false, reason: "job_timeout", provider: resolveStudioProvider() };
  }
  return {
    buffer,
    mimeType,
    studioApplied: false,
    reason: "api_error",
    provider: resolveStudioProvider(),
  };
}

/**
 * Optional Ken Burns clip from a still (usually cleaned cover).
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
function clipEnabled() {
  if (process.env.STUDIO_CLIP_ENABLED != null && process.env.STUDIO_CLIP_ENABLED !== "") {
    return String(process.env.STUDIO_CLIP_ENABLED).toLowerCase() === "true";
  }
  return Boolean(studioCfg().clipEnabled);
}

export async function generateStudioClip(buffer, mimeType = "image/png") {
  if (!clipEnabled()) {
    return { clipStatus: "disabled", clipBase64: null, reason: "clip_disabled", message: "Short clips are off." };
  }
  const job = enqueueMediaJob("clip", () => makeKenBurnsClip(buffer, mimeType));
  const waited = await awaitMediaJob(job, studioCfg().clipTimeoutMs || 45_000);
  if (!waited.ok || !job.result?.ok) {
    const reason = job.result?.reason || waited.error || "ffmpeg_failed";
    return {
      clipStatus: "failed",
      clipBase64: null,
      reason,
      message: "Could not make a short clip — you can still post the photo.",
    };
  }
  return {
    clipStatus: "ready",
    clipBase64: `data:video/mp4;base64,${job.result.buffer.toString("base64")}`,
    reason: null,
    message: "5s clip ready — optional; attach as listing video or skip.",
    ms: job.result.ms,
  };
}

/**
 * Format studio preview response for seller API (no draft generation).
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ wantClip?: boolean }} [opts]
 */
export async function previewStudioClean(buffer, mimeType = "image/jpeg", opts = {}) {
  const cleaned = await removeBackground(buffer, mimeType);
  if (!cleaned.studioApplied) {
    const messages = {
      not_configured: "Background cleanup is not configured on this bot.",
      missing_image: "Add a cover photo first.",
      api_failed: "Background cleanup failed — keep your original photo.",
      empty_result: "Background cleanup returned an empty image — keep your original.",
      api_error: "Background cleanup unavailable right now — keep your original photo.",
      worker_down: "Cleanup worker is offline — keep your original photo. Listing still works.",
      file_too_large: "Cover photo is too large — try a smaller image.",
      job_timeout: "Cleanup took too long — keep your original photo and try again.",
    };
    return {
      studioApplied: false,
      cleanImageBase64: null,
      reason: cleaned.reason || "api_failed",
      message: messages[cleaned.reason] || messages.api_failed,
      provider: cleaned.provider || resolveStudioProvider(),
      clipStatus: "skipped",
      clipBase64: null,
    };
  }

  const base = {
    studioApplied: true,
    cleanImageBase64: `data:image/png;base64,${cleaned.buffer.toString("base64")}`,
    reason: null,
    message: "Background cleaned — toggle below to switch back to the original.",
    provider: cleaned.provider || resolveStudioProvider(),
    clipStatus: "skipped",
    clipBase64: null,
  };

  if (!opts.wantClip || !clipEnabled()) return base;

  const clip = await generateStudioClip(cleaned.buffer, "image/png");
  return {
    ...base,
    clipStatus: clip.clipStatus,
    clipBase64: clip.clipBase64,
    clipMessage: clip.message,
    message:
      clip.clipStatus === "ready"
        ? "Background cleaned + short clip ready — review before posting."
        : base.message,
  };
}

/**
 * Studio clean-up + Gemini listing draft.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [caption]
 * @param {{ skipStudio?: boolean, wantClip?: boolean }} [opts]
 */
export async function processListingWithStudio(buffer, mimeType, caption = "", opts = {}) {
  let workBuffer = buffer;
  let workMime = mimeType;
  let studioApplied = false;
  let provider = resolveStudioProvider();
  let clipStatus = "skipped";
  let clipBase64 = null;

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    workBuffer = cleaned.buffer;
    workMime = cleaned.mimeType;
    studioApplied = cleaned.studioApplied;
    provider = cleaned.provider || provider;
    if (studioApplied && opts.wantClip && clipEnabled()) {
      const clip = await generateStudioClip(workBuffer, workMime);
      clipStatus = clip.clipStatus;
      clipBase64 = clip.clipBase64;
    }
  }

  const draft = await generateListingFromImage(workBuffer, workMime, caption);

  return {
    draft,
    studioApplied,
    cleanImageBase64: studioApplied
      ? `data:image/png;base64,${workBuffer.toString("base64")}`
      : null,
    provider,
    clipStatus,
    clipBase64,
  };
}
