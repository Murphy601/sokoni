/**
 * WhatsApp buyer image → similar active listings.
 * Free vision only: OpenRouter (:free / openrouter/free) → NVIDIA NIM → optional Gemini.
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { geminiVisionAvailable, geminiVisionListingJson } from "./gemini-vision.js";
import { nvidiaVisionAvailable, nvidiaVisionListingJson } from "./nvidia-vision.js";
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

let openrouterClient = null;

function getOpenRouterClient() {
  const apiKey = config.openai?.apiKey?.trim();
  if (!apiKey) return null;
  if (!openrouterClient) {
    openrouterClient = new OpenAI({
      apiKey,
      baseURL: config.openai.baseUrl || "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
        "X-Title": `${config.brand?.name || "Sokoni"} image-search`,
      },
    });
  }
  return openrouterClient;
}

/** Reject paid / non-free OpenRouter slugs for buyer match. */
function isFreeOpenRouterModel(model) {
  const m = String(model || "").trim().toLowerCase();
  if (!m) return false;
  if (m === "openrouter/free") return true;
  if (m.endsWith(":free")) return true;
  // Explicit allow for known zero-cost routers
  if (m.startsWith("openrouter/free")) return true;
  return false;
}

function freeOpenRouterModelChain() {
  const configured = config.imageSearch?.openrouterModels || [];
  const chain = [...new Set(configured.filter(isFreeOpenRouterModel))];
  if (!chain.length) {
    return [
      "openrouter/free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    ];
  }
  return chain;
}

export function imageSearchVisionAvailable() {
  if (getOpenRouterClient()) return true;
  if (nvidiaVisionAvailable()) return true;
  if (config.imageSearch?.allowGemini !== false && geminiVisionAvailable()) return true;
  return false;
}

function normalizeSearchDescription(parsed) {
  const tags = Array.isArray(parsed?.tags) ? parsed.tags.map(String) : [];
  const parts = [parsed?.searchQuery, parsed?.itemType, parsed?.color, ...tags.slice(0, 4)]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const searchQuery = [...new Set(parts.join(" ").split(/\s+/))].join(" ").trim();
  return {
    ok: true,
    searchQuery: searchQuery || String(parsed?.itemType || "fashion item"),
    categoryHint: parsed?.categoryHint || null,
    tags,
    itemType: parsed?.itemType || null,
    color: parsed?.color || null,
  };
}

async function describeViaOpenRouterFree(imageBuffer, mimeType) {
  const client = getOpenRouterClient();
  if (!client) throw new Error("OPENAI_API_KEY not set — OpenRouter unavailable");

  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: DESCRIBE_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  let lastError = null;
  for (const model of freeOpenRouterModelChain()) {
    if (/^krea\//i.test(model) || /image-gen|flux|dall-e|stable-diffusion|embed|rerank/i.test(model)) {
      continue;
    }
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 600,
        temperature: 0.05,
      });
      const raw = response.choices[0]?.message?.content?.trim() || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Vision model returned no JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[image-search] ok via openrouter/${model}`);
      return { parsed, provider: "openrouter", model };
    } catch (err) {
      lastError = err;
      console.warn(`[image-search] openrouter failed (${model}):`, err.message);
    }
  }
  throw lastError || new Error("All free OpenRouter vision models failed");
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 */
export async function describeImageForSearch(imageBuffer, mimeType = "image/jpeg") {
  if (!imageSearchVisionAvailable()) {
    return {
      error: "vision_unavailable",
      message: "Image search is offline — describe the item in text instead.",
    };
  }

  const errors = [];

  // 1) Free OpenRouter VLMs / free router
  if (getOpenRouterClient()) {
    try {
      const { parsed } = await describeViaOpenRouterFree(imageBuffer, mimeType);
      return normalizeSearchDescription(parsed);
    } catch (err) {
      errors.push(`openrouter: ${err.message}`);
    }
  }

  // 2) NVIDIA NIM free VLM pool
  if (nvidiaVisionAvailable()) {
    try {
      const { parsed, model } = await nvidiaVisionListingJson({
        prompt: DESCRIBE_PROMPT,
        imageBuffer,
        mimeType,
      });
      console.log(`[image-search] ok via nvidia/${model}`);
      return normalizeSearchDescription(parsed);
    } catch (err) {
      errors.push(`nvidia: ${err.message}`);
      console.warn("[image-search] NVIDIA vision failed:", err.message);
    }
  }

  // 3) Optional Gemini (keys often expire weekly — off with IMAGE_SEARCH_ALLOW_GEMINI=false)
  if (config.imageSearch?.allowGemini !== false && geminiVisionAvailable()) {
    try {
      const { parsed, model } = await geminiVisionListingJson({
        prompt: DESCRIBE_PROMPT,
        imageBuffer,
        mimeType,
      });
      console.log(`[image-search] ok via gemini/${model}`);
      return normalizeSearchDescription(parsed);
    } catch (err) {
      errors.push(`gemini: ${err.message}`);
      console.warn("[image-search] Gemini vision failed:", err.message);
    }
  }

  return {
    error: "vision_failed",
    message: errors.length
      ? `Could not read that photo (${errors[errors.length - 1]})`
      : "Could not read that photo.",
  };
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
 * Returns true if handled, or { handled, reply, products } for picker handoff.
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
    phone = "",
  } = {}
) {
  if (!hasMedia) return false;
  // Ignore obvious document-only or caption-driven seller flows
  const caption = String(text || "").toLowerCase();
  if (/\b(id|passport|kra|license|national id)\b/.test(caption)) return false;

  // HARD GATE: waybill pre-shipment photos must never become catalog search
  try {
    const { isAwaitingWaybillPhotos, tryHandleWaybillEvidencePhoto } = await import(
      "./upcountry-shipments.js"
    );
    if (isAwaitingWaybillPhotos(customerKey, phone)) {
      console.log("[image-search] blocked — waybill photo session");
      return tryHandleWaybillEvidencePhoto(customerKey, {
        hasMedia,
        mediaUrl,
        mediaMimetype,
        messageId,
        chatId,
        session,
        phone,
      });
    }
  } catch (err) {
    console.warn("[image-search] waybill gate skipped:", err.message);
  }

  // HARD GATE: dispute evidence must never become catalog search
  try {
    const {
      shouldBlockCatalogImageSearch,
      tryHandleDisputeEvidencePhoto,
    } = await import("./dispute-protocol.js");
    if (shouldBlockCatalogImageSearch(customerKey, phone, text)) {
      console.log("[image-search] blocked — dispute evidence context (not catalog search)");
      const evidenceHit = await tryHandleDisputeEvidencePhoto(customerKey, {
        hasMedia,
        mediaUrl,
        mediaMimetype,
        messageId,
        chatId,
        session,
        text,
        phone,
      });
      if (evidenceHit) return true;
      await sendText(
        customerKey,
        "📷 Got your photo for the dispute thread. Reply with your *SKN-####* if we don't have the order number yet."
      );
      return true;
    }
  } catch (err) {
    console.warn("[image-search] dispute gate skipped:", err.message);
  }

  if (!imageSearchVisionAvailable()) {
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
