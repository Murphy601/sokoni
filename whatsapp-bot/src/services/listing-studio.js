/**
 * AI Photo Studio — cloud background removal (+ optional short product clip).
 * Providers (zero disk/RAM on the bot VM):
 *   - cloudinary  — clean PNG via e_background_removal
 *   - huggingface — image cleanup only (RMBG / Inference)
 *   - photoroom   — image cleanup only (Segment API)
 *   - remote      — POST→PNG microservice (Modal/Render rembg)
 *
 * Product clips: always built from the *cleaned* cutout (second Cloudinary upload),
 * never from the raw phone photo. Default motion: pad + soft shadow + zoompan
 * (Photoroom-style product spin/zoom feel). HF/Photoroom clean → Cloudinary clip when configured.
 *
 * STUDIO_PROVIDER=auto (default) tries configured providers free-first:
 *   cloudinary → huggingface → photoroom → remote
 * Pin with STUDIO_PROVIDER=cloudinary|huggingface|photoroom|remote|off
 * Optional STUDIO_FALLBACK=<provider> tried if the primary fails.
 *
 * Clips return a CDN URL by default (avoids huge base64 JSON / OOM on 1GB VMs).
 * Set STUDIO_CLIP_INLINE=true to also embed data:video base64 (tests / special cases).
 * Failures always keep the original image. Bot boot never depends on studio.
 */
import crypto from "node:crypto";
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

const ALL_PROVIDERS = ["cloudinary", "huggingface", "photoroom", "remote"];

/** Photoroom-like clip from a transparent cutout — no background_removal here. */
/** 3–5s teaser for grid hover — longer makes a still look stretched. */
const DEFAULT_CLIP_TRANS =
  "c_pad,w_1080,h_1080,b_rgb:FFF8F0/e_shadow:45/e_zoompan:du_4;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264";

function env(name) {
  return String(process.env[name] || "").trim();
}

function isCloudinaryConfigured() {
  return Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET"));
}

function isHuggingFaceConfigured() {
  return Boolean(env("HUGGINGFACE_API_KEY") || env("HF_TOKEN") || env("HUGGINGFACE_RMBG_URL"));
}

function isPhotoroomConfigured() {
  return Boolean(env("PHOTOROOM_API_KEY"));
}

function isRemoteConfigured() {
  return Boolean(env("STUDIO_REMOTE_URL"));
}

const PROVIDER_READY = {
  cloudinary: isCloudinaryConfigured,
  huggingface: isHuggingFaceConfigured,
  photoroom: isPhotoroomConfigured,
  remote: isRemoteConfigured,
};

/** @returns {string[]} configured provider ids */
export function listConfiguredProviders() {
  return ALL_PROVIDERS.filter((id) => PROVIDER_READY[id]());
}

/** @returns {boolean} */
export function isStudioConfigured() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase();
  if (pinned === "off" || pinned === "none") return false;
  if (pinned && ALL_PROVIDERS.includes(pinned)) return PROVIDER_READY[pinned]();
  return listConfiguredProviders().length > 0;
}

/**
 * Resolve try-order for this request.
 * @returns {string[]}
 */
export function resolveProviderOrder() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase() || "auto";
  if (pinned === "off" || pinned === "none") return [];

  const fallback = env("STUDIO_FALLBACK").toLowerCase();
  const configured = listConfiguredProviders();

  if (pinned !== "auto" && ALL_PROVIDERS.includes(pinned)) {
    const order = [pinned];
    if (fallback && fallback !== pinned && ALL_PROVIDERS.includes(fallback) && PROVIDER_READY[fallback]()) {
      order.push(fallback);
    } else {
      for (const id of configured) {
        if (id !== pinned) order.push(id);
      }
    }
    return order.filter((id) => PROVIDER_READY[id]());
  }

  // auto — free-first defaults
  return configured;
}

/** Short Ken Burns clips — Cloudinary zoompan on the cleaned cutout. */
export function isStudioClipEnabled() {
  if (env("STUDIO_CLIP_ENABLED") === "false") return false;
  return isCloudinaryConfigured();
}

export function getStudioMeta() {
  const providers = listConfiguredProviders();
  const order = resolveProviderOrder();
  return {
    studioEnabled: isStudioConfigured(),
    studioProvider: order[0] || "none",
    studioProviders: providers,
    studioProviderOrder: order,
    studioClipEnabled: isStudioClipEnabled(),
  };
}

function okResult(buffer, provider, extras = {}) {
  const hasClip = Boolean(extras.clipBuffer?.length || extras.clipUrl);
  return {
    buffer,
    mimeType: "image/png",
    studioApplied: true,
    provider,
    clipBuffer: extras.clipBuffer || null,
    clipUrl: extras.clipUrl || null,
    clipMimeType: hasClip ? extras.clipMimeType || "video/mp4" : null,
  };
}

function failResult(buffer, mimeType, reason, provider = null) {
  return {
    buffer,
    mimeType,
    studioApplied: false,
    reason,
    provider,
    clipBuffer: null,
    clipUrl: null,
    clipMimeType: null,
  };
}

/** Cloudinary signed upload signature (sha1). */
function cloudinarySign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/** Sleep helper for Cloudinary 423 (derived still generating). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clip transform applied to the cleaned cutout only.
 * Strips legacy e_background_removal from CLOUDINARY_CLIP_TRANS (old one-shot chains).
 */
export function resolveClipTransform() {
  let t =
    env("CLOUDINARY_CLIP_TRANS") ||
    DEFAULT_CLIP_TRANS;
  t = t
    .replace(/(^|\/)e_background_removal(\/|$)/gi, "$1")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
  if (!t) t = DEFAULT_CLIP_TRANS;
  return t;
}

/**
 * Fetch a Cloudinary derived URL. Retries 420/423 while BG removal / zoompan builds.
 * @param {string} url
 * @param {{ timeoutMs?: number, attempts?: number, label?: string }} [opts]
 */
async function fetchCloudinaryDerived(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    lastStatus = res.status;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length) return buf;
      lastText = "empty body";
    } else {
      lastText = await res.text().catch(() => "");
      // 423 = still generating derived; 420 = pending incoming transform.
      if (res.status !== 420 && res.status !== 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} failed:`,
          res.status,
          lastText.slice(0, 200)
        );
        return null;
      }
      console.warn(
        `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
      );
    }
    await sleep(1500 + i * 500);
  }

  console.warn(
    `[listing-studio] Cloudinary ${label} gave up:`,
    lastStatus,
    lastText.slice(0, 200)
  );
  return null;
}

/**
 * Wait until a derived URL is ready without keeping the body in RAM (1GB VM safe).
 */
async function waitCloudinaryDerivedReady(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";

  for (let i = 0; i < attempts; i += 1) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
      });
      if (head.ok) return true;
      if (head.status !== 420 && head.status !== 423 && head.status !== 405) {
        // Fall through to GET for CDNs that dislike HEAD
      } else if (head.status === 420 || head.status === 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} pending (${head.status}) — retry ${i + 1}/${attempts}`
        );
        await sleep(1500 + i * 500);
        continue;
      }
    } catch {
      // HEAD unsupported / network — try GET
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      return true;
    }
    if (res.status !== 420 && res.status !== 423) {
      const lastText = await res.text().catch(() => "");
      console.warn(
        `[listing-studio] Cloudinary ${label} failed:`,
        res.status,
        lastText.slice(0, 200)
      );
      return false;
    }
    console.warn(
      `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
    );
    await sleep(1500 + i * 500);
  }
  return false;
}

function scheduleCloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  if (env("CLOUDINARY_DELETE_AFTER") === "false") return;
  const ms = Number(env("CLOUDINARY_DELETE_MS")) || 180_000;
  setTimeout(() => {
    void cloudinaryDestroy(publicId, cloud, apiKey, apiSecret).catch((err) =>
      console.warn("[listing-studio] Cloudinary destroy:", err.message)
    );
  }, ms);
}

/**
 * Signed image upload with optional eager transforms.
 * @returns {Promise<{ ok: true, publicId: string, uploaded: object } | { ok: false, authFailed?: boolean, status: number, errText: string }>}
 */
async function cloudinaryUploadImage(buffer, mimeType, { publicId, folder, eager, filename }) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const signParams = { folder, public_id: publicId, timestamp };
  if (eager) signParams.eager = eager;
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: mimeType || "image/jpeg" }),
    filename || "listing.jpg"
  );
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);
  if (eager) form.append("eager", eager);

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary upload failed:", uploadRes.status, errText.slice(0, 200));
    const authFailed =
      uploadRes.status === 401 ||
      /api_secret mismatch|invalid signature|unauthorized/i.test(errText);
    return { ok: false, authFailed, status: uploadRes.status, errText };
  }

  const uploaded = await uploadRes.json().catch(() => ({}));
  return {
    ok: true,
    publicId: uploaded.public_id || `${folder}/${publicId}`,
    uploaded,
    cloud,
    apiKey,
    apiSecret,
  };
}

/**
 * Build a short product MP4 from an already-cleaned cutout PNG.
 * @param {Buffer} cleanPng
 * @returns {Promise<{ clipUrl: string, clipBuffer: Buffer|null }|null>}
 */
async function renderProductClipFromClean(cleanPng) {
  if (!cleanPng?.length || !isCloudinaryConfigured()) return null;
  if (env("STUDIO_CLIP_ENABLED") === "false") return null;

  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const publicId = `clip_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
  const clipTrans = resolveClipTransform();
  const eager = `${clipTrans}/f_mp4`;

  const up = await cloudinaryUploadImage(cleanPng, "image/png", {
    publicId,
    folder,
    eager,
    filename: "clean.png",
  });
  if (!up.ok) return null;

  const id = up.publicId;
  const clipUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${eager}/${id}.mp4`;

  scheduleCloudinaryDestroy(id, cloud, up.apiKey, up.apiSecret);

  const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 10;
  const inline = env("STUDIO_CLIP_INLINE") === "true";

  if (inline) {
    const clipBuffer = await fetchCloudinaryDerived(clipUrl, {
      label: "clip",
      timeoutMs: 120_000,
      attempts: Math.max(4, Math.min(derivedAttempts, 8)),
    });
    if (!clipBuffer || clipBuffer.length <= 256) {
      console.warn("[listing-studio] Cloudinary clip too small / missing — skipping");
      return null;
    }
    return { clipUrl, clipBuffer };
  }

  const ready = await waitCloudinaryDerivedReady(clipUrl, {
    label: "clip",
    timeoutMs: 120_000,
    attempts: Math.max(4, Math.min(derivedAttempts, 8)),
  });
  if (!ready) {
    console.warn("[listing-studio] Cloudinary clip not ready — skipping");
    return null;
  }
  return { clipUrl, clipBuffer: null };
}

/**
 * After any provider cleans the cover, optionally render a Cloudinary clip from that PNG.
 */
async function maybeAttachProductClip(result) {
  if (!result?.studioApplied) return result;
  if (result.clipUrl || result.clipBuffer?.length) return result;
  if (!isStudioClipEnabled()) return result;
  try {
    const clip = await renderProductClipFromClean(result.buffer);
    if (!clip?.clipUrl && !clip?.clipBuffer?.length) return result;
    return okResult(result.buffer, result.provider, {
      clipUrl: clip.clipUrl || null,
      clipBuffer: clip.clipBuffer || null,
      clipMimeType: "video/mp4",
    });
  } catch (err) {
    console.warn("[listing-studio] clip from clean failed:", err.message);
    return result;
  }
}

/**
 * Upload original → clean PNG only (clip is a second pass on the cutout).
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
async function removeBackgroundCloudinary(buffer, mimeType) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `listing_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
  const bgEffect = env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
  const eagerClean = `${bgEffect}/f_png`;

  const up = await cloudinaryUploadImage(buffer, mimeType, {
    publicId,
    folder,
    eager: eagerClean,
    filename: "listing.jpg",
  });
  if (!up.ok) {
    if (up.authFailed) return failResult(buffer, mimeType, "auth_failed", "cloudinary");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const id = up.publicId;
  const cleanUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${eagerClean}/${id}`;

  try {
    const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 10;
    const clean = await fetchCloudinaryDerived(cleanUrl, {
      label: "bg-removal",
      timeoutMs: 90_000,
      attempts: derivedAttempts,
    });
    if (!clean?.length) return failResult(buffer, mimeType, "api_failed", "cloudinary");
    return okResult(clean, "cloudinary");
  } finally {
    scheduleCloudinaryDestroy(id, cloud, up.apiKey, up.apiSecret);
  }
}

async function cloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinarySign({ public_id: publicId, timestamp }, apiSecret);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
}

/**
 * Hugging Face Inference / router — or a full custom RMBG URL (Space / dedicated endpoint).
 * Note: many Hub models (incl. briaai/RMBG-1.4) are not on free serverless anymore;
 * set HUGGINGFACE_RMBG_URL to a working Inference Endpoint or Space proxy if needed.
 */
async function removeBackgroundHuggingFace(buffer, mimeType) {
  const token = env("HUGGINGFACE_API_KEY") || env("HF_TOKEN");
  const customUrl = env("HUGGINGFACE_RMBG_URL");
  const model = env("HUGGINGFACE_RMBG_MODEL") || "briaai/RMBG-1.4";
  const url = customUrl || `https://router.huggingface.co/hf-inference/models/${model}`;

  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Hugging Face RMBG failed:", res.status, errText.slice(0, 240));
    // Cold-start / loading
    if (res.status === 503 && /loading/i.test(errText)) {
      return failResult(buffer, mimeType, "api_error", "huggingface");
    }
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }

  const contentType = String(res.headers.get("content-type") || "");
  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "huggingface");
  // Some endpoints return JSON errors with 200 — reject obvious non-images.
  if (contentType.includes("application/json") || (clean[0] === 0x7b && clean[1] === 0x22)) {
    console.warn("[listing-studio] Hugging Face returned JSON, not PNG:", clean.toString("utf8").slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }
  return okResult(clean, "huggingface");
}

async function removeBackgroundPhotoroom(buffer, mimeType) {
  const apiKey = env("PHOTOROOM_API_KEY");
  const form = new FormData();
  form.append("image_file", new Blob([buffer], { type: mimeType }), "listing.jpg");

  const res = await fetch(PHOTOROOM_SEGMENT, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Photoroom failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "photoroom");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "photoroom");
  return okResult(clean, "photoroom");
}

/** Generic remote microservice: POST raw bytes → PNG (Modal/Render rembg, etc.). */
async function removeBackgroundRemote(buffer, mimeType) {
  const url = env("STUDIO_REMOTE_URL");
  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  const remoteKey = env("STUDIO_REMOTE_KEY");
  if (remoteKey) headers.Authorization = `Bearer ${remoteKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] remote studio failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "remote");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "remote");
  return okResult(clean, "remote");
}

const PROVIDER_FN = {
  cloudinary: removeBackgroundCloudinary,
  huggingface: removeBackgroundHuggingFace,
  photoroom: removeBackgroundPhotoroom,
  remote: removeBackgroundRemote,
};

/**
 * Background removal only (no AI draft). Tries provider chain; keeps original on failure.
 * When clips are enabled, builds the MP4 from the cleaned cutout via Cloudinary.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string, studioApplied: boolean, reason?: string, provider?: string|null }>}
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const order = resolveProviderOrder();
  if (!order.length) {
    return failResult(buffer, mimeType, "not_configured");
  }
  if (!buffer?.length) {
    return failResult(buffer, mimeType, "missing_image");
  }

  let lastReason = "api_failed";
  for (const provider of order) {
    const fn = PROVIDER_FN[provider];
    if (!fn) continue;
    try {
      const result = await fn(buffer, mimeType);
      if (result.studioApplied) {
        return maybeAttachProductClip(result);
      }
      lastReason = result.reason || lastReason;
      console.warn(`[listing-studio] ${provider} skipped (${result.reason}) — trying next`);
    } catch (err) {
      lastReason = "api_error";
      console.warn(`[listing-studio] ${provider} error:`, err.message);
    }
  }

  return failResult(buffer, mimeType, lastReason);
}

function formatClipPayload(cleaned) {
  const clipUrl = cleaned.clipUrl || null;
  const hasBuffer = Boolean(cleaned.clipBuffer?.length);
  const clipApplied = Boolean(clipUrl || hasBuffer);
  const inline = env("STUDIO_CLIP_INLINE") === "true";
  let clipVideoBase64 = null;
  if (inline && hasBuffer) {
    clipVideoBase64 = `data:${cleaned.clipMimeType || "video/mp4"};base64,${cleaned.clipBuffer.toString("base64")}`;
  }
  return { clipApplied, clipVideoUrl: clipUrl, clipVideoBase64 };
}

/**
 * Format studio preview response for seller API (no draft generation).
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function previewStudioClean(buffer, mimeType = "image/jpeg") {
  const cleaned = await removeBackground(buffer, mimeType);
  if (!cleaned.studioApplied) {
    const messages = {
      not_configured: "Background cleanup is not configured on this bot.",
      missing_image: "Add a cover photo first.",
      auth_failed:
        "Cloudinary API secret doesn’t match — open Cloudinary → Settings → API Keys, copy the API secret again into whatsapp-bot/.env, then redeploy.",
      api_failed: "Background cleanup failed — keep your original photo.",
      empty_result: "Background cleanup returned an empty image — keep your original.",
      api_error: "Background cleanup unavailable right now — keep your original photo.",
    };
    return {
      studioApplied: false,
      cleanImageBase64: null,
      clipVideoBase64: null,
      clipVideoUrl: null,
      clipApplied: false,
      reason: cleaned.reason || "api_failed",
      provider: cleaned.provider || null,
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }

  const { clipApplied, clipVideoUrl, clipVideoBase64 } = formatClipPayload(cleaned);

  let message = "Background cleaned — toggle below to switch back to the original.";
  if (clipApplied) {
    message = "Background cleaned + product clip from your cutout — use the toggles below.";
  } else if (isStudioClipEnabled()) {
    message = "Background cleaned — product clip unavailable this time; cover is ready.";
  }

  return {
    studioApplied: true,
    cleanImageBase64: `data:image/png;base64,${cleaned.buffer.toString("base64")}`,
    clipVideoBase64,
    clipVideoUrl,
    clipApplied,
    reason: null,
    provider: cleaned.provider || null,
    message,
  };
}

/**
 * Studio clean-up + Gemini listing draft.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [caption]
 * @param {{ skipStudio?: boolean }} [opts]
 */
export async function processListingWithStudio(buffer, mimeType, caption = "", opts = {}) {
  let workBuffer = buffer;
  let workMime = mimeType;
  let studioApplied = false;
  let studioProvider = null;
  let clipVideoBase64 = null;
  let clipVideoUrl = null;
  let clipApplied = false;

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    workBuffer = cleaned.buffer;
    workMime = cleaned.mimeType;
    studioApplied = cleaned.studioApplied;
    studioProvider = cleaned.provider || null;
    const clip = formatClipPayload(cleaned);
    clipApplied = clip.clipApplied;
    clipVideoBase64 = clip.clipVideoBase64;
    clipVideoUrl = clip.clipVideoUrl;
  }

  const draft = await generateListingFromImage(workBuffer, workMime, caption);

  return {
    draft,
    studioApplied,
    studioProvider,
    cleanImageBase64: studioApplied
      ? `data:image/png;base64,${workBuffer.toString("base64")}`
      : null,
    clipApplied,
    clipVideoBase64,
    clipVideoUrl,
  };
}
