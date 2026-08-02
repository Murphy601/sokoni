/**
 * AI Photo Studio — cloud background removal (+ optional short product clip).
 * Providers (zero disk/RAM on the bot VM):
 *   - cloudinary  — clean PNG via e_background_removal + optional MP4 via e_zoompan
 *   - huggingface — image cleanup only (RMBG / Inference)
 *   - photoroom   — image cleanup only (Segment API)
 *   - remote      — POST→PNG microservice (Modal/Render rembg)
 *
 * STUDIO_PROVIDER=auto (default) tries configured providers free-first:
 *   cloudinary → huggingface → photoroom → remote
 * Pin with STUDIO_PROVIDER=cloudinary|huggingface|photoroom|remote|off
 * Optional STUDIO_FALLBACK=<provider> tried if the primary fails.
 *
 * Clips: Cloudinary only (STUDIO_CLIP_ENABLED≠false). HF/Photoroom never produce video.
 * Failures always keep the original image. Bot boot never depends on studio.
 */
import crypto from "node:crypto";
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

const ALL_PROVIDERS = ["cloudinary", "huggingface", "photoroom", "remote"];

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

/** Short Ken Burns clips — Cloudinary zoompan only (not HF/Photoroom). */
export function isStudioClipEnabled() {
  if (env("STUDIO_CLIP_ENABLED") === "false") return false;
  const order = resolveProviderOrder();
  return order.includes("cloudinary") && isCloudinaryConfigured();
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
  return {
    buffer,
    mimeType: "image/png",
    studioApplied: true,
    provider,
    clipBuffer: extras.clipBuffer || null,
    clipMimeType: extras.clipBuffer ? extras.clipMimeType || "video/mp4" : null,
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

/**
 * Upload once → clean PNG (+ optional zoompan MP4) → optional destroy.
 * Clip is best-effort: clean image still returns if zoompan fails.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
async function removeBackgroundCloudinary(buffer, mimeType) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `listing_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;

  const signParams = { folder, public_id: publicId, timestamp };
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "image/jpeg" }), "listing.jpg");
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary upload failed:", uploadRes.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const uploaded = await uploadRes.json().catch(() => ({}));
  const id = uploaded.public_id || `${folder}/${publicId}`;
  // On-the-fly BG removal (transformation billing — works without legacy add-on).
  const bgEffect = env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
  const cleanUrl = `https://res.cloudinary.com/${cloud}/image/upload/${bgEffect}/f_png/${id}`;
  // Image→MP4 Ken Burns. Cream fill so transparent cutouts read well in video.
  // Override full chain with CLOUDINARY_CLIP_TRANS if needed.
  const clipTrans =
    env("CLOUDINARY_CLIP_TRANS") ||
    `${bgEffect}/b_rgb:FFF8F0/e_zoompan:mode_ztc;maxzoom_1.25;du_5;fps_25`;
  const clipUrl = `https://res.cloudinary.com/${cloud}/image/upload/${clipTrans}/f_mp4/${id}.mp4`;
  const wantClip = env("STUDIO_CLIP_ENABLED") !== "false";

  try {
    const cleanRes = await fetch(cleanUrl, { signal: AbortSignal.timeout(90_000) });
    if (!cleanRes.ok) {
      const errText = await cleanRes.text().catch(() => "");
      console.warn("[listing-studio] Cloudinary BG removal failed:", cleanRes.status, errText.slice(0, 200));
      return failResult(buffer, mimeType, "api_failed", "cloudinary");
    }
    const clean = Buffer.from(await cleanRes.arrayBuffer());
    if (!clean.length) return failResult(buffer, mimeType, "empty_result", "cloudinary");

    let clipBuffer = null;
    if (wantClip) {
      try {
        const clipRes = await fetch(clipUrl, { signal: AbortSignal.timeout(120_000) });
        if (clipRes.ok) {
          const clip = Buffer.from(await clipRes.arrayBuffer());
          // MP4 typically starts with ftyp box near the start — reject tiny/empty.
          if (clip.length > 256) clipBuffer = clip;
          else console.warn("[listing-studio] Cloudinary clip too small — skipping");
        } else {
          const errText = await clipRes.text().catch(() => "");
          console.warn("[listing-studio] Cloudinary clip failed:", clipRes.status, errText.slice(0, 200));
        }
      } catch (err) {
        console.warn("[listing-studio] Cloudinary clip error:", err.message);
      }
    }

    return okResult(clean, "cloudinary", { clipBuffer, clipMimeType: "video/mp4" });
  } finally {
    if (env("CLOUDINARY_DELETE_AFTER") !== "false") {
      void cloudinaryDestroy(id, cloud, apiKey, apiSecret).catch((err) =>
        console.warn("[listing-studio] Cloudinary destroy:", err.message)
      );
    }
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
      if (result.studioApplied) return result;
      lastReason = result.reason || lastReason;
      console.warn(`[listing-studio] ${provider} skipped (${result.reason}) — trying next`);
    } catch (err) {
      lastReason = "api_error";
      console.warn(`[listing-studio] ${provider} error:`, err.message);
    }
  }

  return failResult(buffer, mimeType, lastReason);
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
      api_failed: "Background cleanup failed — keep your original photo.",
      empty_result: "Background cleanup returned an empty image — keep your original.",
      api_error: "Background cleanup unavailable right now — keep your original photo.",
    };
    return {
      studioApplied: false,
      cleanImageBase64: null,
      clipVideoBase64: null,
      clipApplied: false,
      reason: cleaned.reason || "api_failed",
      provider: cleaned.provider || null,
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }

  const clipApplied = Boolean(cleaned.clipBuffer?.length);
  const clipVideoBase64 = clipApplied
    ? `data:${cleaned.clipMimeType || "video/mp4"};base64,${cleaned.clipBuffer.toString("base64")}`
    : null;

  let message = "Background cleaned — toggle below to switch back to the original.";
  if (clipApplied) {
    message =
      cleaned.provider === "cloudinary"
        ? "Background cleaned + 5s product clip ready — use the toggles below."
        : message;
  } else if (cleaned.provider === "cloudinary" && isStudioClipEnabled()) {
    message = "Background cleaned — product clip unavailable this time; cover is ready.";
  }

  return {
    studioApplied: true,
    cleanImageBase64: `data:image/png;base64,${cleaned.buffer.toString("base64")}`,
    clipVideoBase64,
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
  let clipApplied = false;

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    workBuffer = cleaned.buffer;
    workMime = cleaned.mimeType;
    studioApplied = cleaned.studioApplied;
    studioProvider = cleaned.provider || null;
    clipApplied = Boolean(cleaned.clipBuffer?.length);
    clipVideoBase64 = clipApplied
      ? `data:${cleaned.clipMimeType || "video/mp4"};base64,${cleaned.clipBuffer.toString("base64")}`
      : null;
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
  };
}
