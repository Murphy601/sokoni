/**
 * AI Photo Studio — optional Photoroom background removal before listing generation.
 * Falls back to original image when PHOTOROOM_API_KEY is unset or API fails.
 */
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string, studioApplied: boolean }>}
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const apiKey = process.env.PHOTOROOM_API_KEY?.trim();
  if (!apiKey || !buffer?.length) {
    return { buffer, mimeType, studioApplied: false };
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
      return { buffer, mimeType, studioApplied: false };
    }

    const clean = Buffer.from(await res.arrayBuffer());
    if (!clean.length) return { buffer, mimeType, studioApplied: false };
    return { buffer: clean, mimeType: "image/png", studioApplied: true };
  } catch (err) {
    console.warn("[listing-studio] Photoroom error:", err.message);
    return { buffer, mimeType, studioApplied: false };
  }
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
