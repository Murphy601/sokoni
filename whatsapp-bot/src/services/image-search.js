/**
 * WhatsApp buyer image → similar active listings.
 * Uses Gemini vision to extract search keywords, then smartSearch.
 */
import { geminiVisionAvailable, geminiGenerateListingJson } from "./gemini-vision.js";
import { smartSearch } from "./smart-search.js";
import { downloadWahaMedia, sendText } from "./whatsapp.js";

const DESCRIBE_PROMPT = `You help Kenyan shoppers find similar items on Sokoni Mall.
Look at this product photo and return ONLY JSON:
{
  "searchQuery": "short English search keywords (3-8 words)",
  "categoryHint": "fashion|shoes|bags|beauty|home|electronics|other",
  "tags": ["tag1","tag2","tag3"],
  "color": "main color or empty",
  "itemType": "what the item is"
}
Focus on what a buyer would type (e.g. "brown leather kiondo bag"). No markdown.`;

/**
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 */
export async function describeImageForSearch(imageBuffer, mimeType = "image/jpeg") {
  if (!geminiVisionAvailable()) {
    return { error: "vision_unavailable", message: "Image search is offline — describe the item in text instead." };
  }
  try {
    const parsed = await geminiGenerateListingJson({
      prompt: DESCRIBE_PROMPT,
      imageBuffer,
      mimeType,
    });
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map(String) : [];
    const parts = [
      parsed.searchQuery,
      parsed.itemType,
      parsed.color,
      ...tags.slice(0, 4),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    const searchQuery = [...new Set(parts.join(" ").split(/\s+/))].join(" ").trim();
    return {
      ok: true,
      searchQuery: searchQuery || String(parsed.itemType || "fashion item"),
      categoryHint: parsed.categoryHint || null,
      tags,
      itemType: parsed.itemType || null,
      color: parsed.color || null,
    };
  } catch (err) {
    return { error: "vision_failed", message: err.message || "Could not read that photo." };
  }
}

/**
 * Find similar live listings from an image buffer.
 */
export async function findSimilarFromImage(imageBuffer, { mimeType = "image/jpeg", limit = 5 } = {}) {
  const described = await describeImageForSearch(imageBuffer, mimeType);
  if (described.error) return described;
  const hits = await smartSearch({ q: described.searchQuery, limit });
  return {
    ok: true,
    searchQuery: described.searchQuery,
    categoryHint: described.categoryHint,
    tags: described.tags,
    count: hits.count,
    suggestions: hits.suggestions,
    products: hits.products,
  };
}

/**
 * WhatsApp inbound: buyer sent a product photo (not in supplier onboarding).
 * Returns true if handled.
 */
export async function tryHandleBuyerImageSearch(
  customerKey,
  {
    hasMedia = false,
    mediaUrl = null,
    mediaMimetype = null,
    messageId = null,
    chatId = null,
    session = null,
    text = "",
  } = {}
) {
  if (!hasMedia) return false;
  // Ignore obvious document-only or caption-driven seller flows
  const caption = String(text || "").toLowerCase();
  if (/\b(id|passport|kra|license|national id)\b/.test(caption)) return false;

  if (!geminiVisionAvailable()) {
    await sendText(
      customerKey,
      "Got your photo 📷 — image match is warming up. Describe the item in text (e.g. *brown kiondo bag*) and I'll search."
    );
    return true;
  }

  await sendText(customerKey, "📷 Searching Sokoni for similar items…");

  let buffer;
  try {
    buffer = await downloadWahaMedia(mediaUrl, {
      messageId,
      chatId,
      session,
      mimetype: mediaMimetype || "image/jpeg",
    });
  } catch (err) {
    console.warn("[image-search] download failed:", err.message);
    await sendText(
      customerKey,
      "Couldn't download that photo. Send it again, or describe the item in text."
    );
    return true;
  }

  const result = await findSimilarFromImage(buffer, {
    mimeType: mediaMimetype || "image/jpeg",
    limit: 5,
  });

  if (result.error) {
    await sendText(
      customerKey,
      `Couldn't match that photo (${result.message || result.error}). Try a clearer pic or type what you want.`
    );
    return true;
  }

  if (!result.products?.length) {
    await sendText(
      customerKey,
      `No close matches for *${result.searchQuery}*. Try another angle, or type a keyword (e.g. *kiondo*).`
    );
    return true;
  }

  // Hand off product picker to caller via return shape — webhook sends picker.
  return {
    handled: true,
    reply:
      `Found *${result.count}* similar item${result.count === 1 ? "" : "s"} for *${result.searchQuery}*.\n` +
      `Reply with the *number* to view & order.`,
    products: result.products,
    searchQuery: result.searchQuery,
  };
}
