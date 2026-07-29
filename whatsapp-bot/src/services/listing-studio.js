/**
 * AI Photo Studio — optional Photoroom background removal before listing generation.
 * Falls back to original image when PHOTOROOM_API_KEY is unset or API fails.
 */
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

/** @returns {boolean} */
export function isStudioConfigured() {
  return Boolean(process.env.PHOTOROOM_API_KEY?.trim());
}

/**
 * Background removal only (no AI draft). Safe when Photoroom is unset — returns original.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string, studioApplied: boolean, reason?: string }>}
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const apiKey = process.env.PHOTOROOM_API_KEY?.trim();
  if (!apiKey) {
    return { buffer, mimeType, studioApplied: false, reason: "not_configured" };
  }
  if (!buffer?.length) {
    return { buffer, mimeType, studioApplied: false, reason: "missing_image" };
  }

  try {
    const form = new FormData();
    form.append("image_file", new Blob([buffer], { type: mimeType }), "listing.jpg");

    const res = await fetch(PHOTOROOM_SEGMENT, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[listing-studio] Photoroom failed:", res.status, errText.slice(0, 200));
      return { buffer, mimeType, studioApplied: false, reason: "api_failed" };
    }

    const clean = Buffer.from(await res.arrayBuffer());
    if (!clean.length) return { buffer, mimeType, studioApplied: false, reason: "empty_result" };
    return { buffer: clean, mimeType: "image/png", studioApplied: true };
  } catch (err) {
    console.warn("[listing-studio] Photoroom error:", err.message);
    return { buffer, mimeType, studioApplied: false, reason: "api_error" };
  }
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
      reason: cleaned.reason || "api_failed",
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }
  return {
    studioApplied: true,
    cleanImageBase64: `data:image/png;base64,${cleaned.buffer.toString("base64")}`,
    reason: null,
    message: "Background cleaned — toggle below to switch back to the original.",
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

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    workBuffer = cleaned.buffer;
    workMime = cleaned.mimeType;
    studioApplied = cleaned.studioApplied;
  }

  const draft = await generateListingFromImage(workBuffer, workMime, caption);

  return {
    draft,
    studioApplied,
    cleanImageBase64: studioApplied
      ? `data:image/png;base64,${workBuffer.toString("base64")}`
      : null,
  };
}
