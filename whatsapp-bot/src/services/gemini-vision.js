/**
 * Google Gemini vision — direct API (backend only, key from GEMINI_API_KEY).
 * Used for seller listing photo → JSON draft; OpenRouter remains fallback.
 */
import { config } from "../config.js";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

export function geminiVisionAvailable() {
  return Boolean(config.gemini.apiKey?.trim());
}

function geminiModelChain() {
  const primary = config.gemini.visionModel?.trim();
  const models = config.gemini.visionModels || [];
  return [...new Set([primary, ...models].filter(Boolean))];
}

/** Map alternate Gemini JSON keys to listing-generator schema. */
export function normalizeGeminiListingJson(parsed) {
  const out = { ...parsed };
  if (!out.name && out.title) out.name = out.title;
  if (!out.sourcePriceKes && out.suggestedPriceKsh != null) {
    out.sourcePriceKes = out.suggestedPriceKsh;
  }
  if (!out.sourcePriceKes && out.priceKes != null) out.sourcePriceKes = out.priceKes;
  if (!out.description && out.desc) out.description = out.desc;
  return out;
}

/**
 * @param {{ prompt: string, imageBuffer: Buffer, mimeType?: string, model?: string }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function geminiGenerateListingJson(opts) {
  const apiKey = config.gemini.apiKey?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const { prompt, imageBuffer, mimeType = "image/jpeg", model } = opts;
  const modelId = model || config.gemini.visionModel || "gemini-2.0-flash";
  const url = `${GEMINI_API}/models/${modelId}:generateContent`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: imageBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 800,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const short = errText.slice(0, 280).replace(/\s+/g, " ");
    if (res.status === 429) throw new Error(`Gemini rate limit — try again in a moment (${short})`);
    throw new Error(`Gemini ${res.status}: ${short || res.statusText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    const block = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
    throw new Error(block ? `Gemini blocked: ${block}` : "Gemini returned empty response");
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini returned no JSON");
  return normalizeGeminiListingJson(JSON.parse(jsonMatch[0]));
}

/** Try configured Gemini models in order. */
export async function geminiVisionListingJson({ prompt, imageBuffer, mimeType }) {
  let lastError = null;
  for (const model of geminiModelChain()) {
    try {
      const parsed = await geminiGenerateListingJson({ prompt, imageBuffer, mimeType, model });
      return { parsed, model };
    } catch (err) {
      lastError = err;
      console.warn(`[gemini-vision] failed (${model}):`, err.message);
    }
  }
  throw lastError || new Error("All Gemini vision models failed");
}
