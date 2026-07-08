import OpenAI from "openai";
import { config } from "../config.js";
import { searchProducts, findProductFromMessage } from "./catalog.js";
import { resolveProductQuery } from "./product-router.js";
import { getFeaturedProductIds } from "./tiktok.js";
import { getSession, pushMessage, setProductContext, isHumanHandoff } from "./session.js";

const FALLBACK_MODELS = [
  "nvidia/nemotron-nano-9b-v2:free",
  "openai/gpt-oss-20b:free",
];

const SYSTEM_PROMPT = `You are "Sokoni AI" — a witty, sharp, and deeply helpful shopping concierge on WhatsApp in Kenya.

Sokoni runs a pay-on-delivery store (phones, TVs, appliances, fashion, home, beauty, gaming, supermarket, baby products) and helps shoppers find deals from partner platforms (Jumia, Kilimall, AliExpress, Temu, Amazon) via tracked affiliate links when asked.

## TikTok & viral traffic awareness
- Many users arrive from automated TikTok posts (@SokoniMall). They may say "Nimeona form flani TikTok", "TikTokDeals", "ile item ya video", or "viral bargain".
- Match their energy immediately (e.g. "Ah, hio form ya TikTok! Kuom nikufe kizie chap chap...").
- Prioritize the product they describe using the CATALOG below — match by name, category, or price. If unclear, ask which item they saw in one short line.
- Recent TikTok featured items appear in CATALOG when relevant — help them confirm and order fast.
- Store items: guide them to reply *1* to order (pay on delivery). Or type *menu* to browse all categories.

## Tone & communication
- Trusted local friend who "knows a guy" and gets the best prices.
- Match English, Kiswahili, or casual Sheng depending on how they text. Never stiff, academic, or robotic.
- Short and punchy for mobile: 2–5 lines max. Emojis naturally for scannability.

## Strict operational rules
- Use ONLY products and prices from the CATALOG section. NEVER guess or invent prices, stock, delivery times, or links.
- If the item is not in CATALOG, say so honestly and offer a similar alternative from CATALOG only.
- First time you mention buying via a partner/affiliate link in a chat, disclose transparently: Sokoni may earn a small commission at no extra cost to them.
- NEVER ask for or store card numbers, M-Pesa PINs, or direct payments — store orders are pay-on-delivery; partner buys go to official checkout links.
- "Sasa", "mambo", "uko aje", "habari" are greetings — respond warmly, not as product searches.
- "Nipee" / "nataka" = they want the last discussed item → tell them to reply *1* or type *menu*.
- For cart, cancel, track order, or human agent → type *menu* (handled outside this reply).
- If they asked for a human, stop selling — say the team will reply shortly.

## System capabilities (you do not call APIs — routing is automatic)
- **Product search:** You receive matches in the CATALOG block — cite only those.
- **TikTok / viral deals:** Keywords like TikTokDeals or "viral" trigger featured recent posts; help user pick the right item.
- **Human escalation:** Direct them to *menu* → Talk to a Human for a real person.`;

function modelChain() {
  const primary = config.openai.model?.trim();
  return [...new Set([primary, ...FALLBACK_MODELS].filter(Boolean))];
}

function formatProductLine(p) {
  return `• *${p.name}* — KES ${p.priceKes?.toLocaleString()} (pay on delivery) ⭐ ${p.rating}`;
}

function formatCatalogReply(products, { intro } = {}) {
  const head = intro || "Here's what I found in our store:";
  const lines = products.slice(0, 3).map(formatProductLine);
  return `${head}\n\n${lines.join("\n")}\n\nType *menu* → *1* to browse all categories, or tell me the exact item name (e.g. "Hisense 43 TV").`;
}

function isCasualGreeting(text) {
  const t = text.toLowerCase().trim();
  return /^(sasa|mambo|habari|uko aje|poa|hujambo|hello|hi|hey)[\s!?.]*$/i.test(t);
}

function isViralIntent(text) {
  return /tik\s*tok|tiktok|viral|reels?|nimeona.*(?:post|video|deal)|saw (?:your|the) (?:post|video|deal)|tiktokdeals/i.test(
    text
  );
}

async function gatherProducts(userMessage, phoneNumber) {
  if (isCasualGreeting(userMessage)) {
    return { products: [], focus: null, viral: false };
  }

  const session = getSession(phoneNumber);
  const existingFocus = session.lastProductContext;

  if (!existingFocus) {
    const routed = await resolveProductQuery(userMessage);
    if (routed.action !== "none") {
      return { products: [], focus: null, viral: false };
    }
  }

  const quoted = await findProductFromMessage(userMessage);
  if (quoted) setProductContext(phoneNumber, quoted);

  const viral = isViralIntent(userMessage);
  let matches = await searchProducts({
    keywords: userMessage,
    fulfillment: "store",
    scope: "local",
    limit: 5,
  });

  if (viral && matches.length === 0) {
    const featuredIds = getFeaturedProductIds();
    const { getProductById } = await import("./catalog.js");
    for (const id of featuredIds.slice(0, 5)) {
      const p = await getProductById(id);
      if (p) matches.push(p);
    }
  }

  const products = [];
  const focus = session.lastProductContext || quoted;
  if (focus) products.push(focus);
  for (const p of matches) {
    if (!products.some((x) => x.id === p.id)) products.push(p);
  }
  return { products, focus, viral };
}

function buildCatalogBlock(products, focus) {
  const lines = products.slice(0, 5).map(
    (p) =>
      `- ${p.name} | KES ${p.priceKes?.toLocaleString()} | pay on delivery | ⭐ ${p.rating} | id:${p.id}`
  );

  if (focus && lines.length > 0) {
    return (
      `CUSTOMER IS ASKING ABOUT THIS PRODUCT:\n${lines[0]}\n\n` +
      (lines.length > 1 ? `Related items:\n${lines.slice(1).join("\n")}` : "")
    );
  }
  if (lines.length === 0) return null;
  return lines.join("\n");
}

function isRecommendationQuery(text) {
  return /recommend|best|looking for|what about|do you have|show me|suggest|options/i.test(text);
}

function isProductDetailQuery(text) {
  return /info|detail|spec|battery|size|good for|worth|compare|how long|quality/i.test(text);
}

function extractReply(message) {
  return message?.content?.trim() || null;
}

function sanitizeReply(text) {
  if (!text) return null;
  if (/fruit|vegetable|veggie|produce only|fresh produce/i.test(text)) {
    return null;
  }
  let cleaned = text.trim();
  if (/\bType \*?\s*$/i.test(cleaned) || /\*Type \*?\s*$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\bType \*?\s*$/i, "Type *menu* to browse.");
  }
  if ((cleaned.match(/\*/g) || []).length % 2 !== 0) {
    cleaned = cleaned.replace(/\*+\s*$/, "");
    if (!/type \*menu\*/i.test(cleaned)) cleaned += "\nType *menu* to browse.";
  }
  return cleaned;
}

let client = null;
function getClient() {
  if (!config.openai.apiKey) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
        "X-Title": config.brand.name,
      },
    });
  }
  return client;
}

async function callOpenRouter(messages) {
  const openai = getClient();
  if (!openai) throw new Error("No API key");

  let lastError = null;
  for (const model of modelChain()) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 350,
        temperature: 0.3,
      });
      const reply = sanitizeReply(extractReply(response.choices[0]?.message));
      if (reply) {
        console.log(`[ai] replied via ${model}`);
        return reply;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ai] ${model} failed:`, err.error?.message || err.message);
    }
  }
  throw lastError || new Error("All models failed");
}

/**
 * Runs one turn of the AI agent. Never throws — always returns text for WhatsApp.
 */
export async function runAiAgent(phoneNumber, userMessage) {
  if (isHumanHandoff(phoneNumber)) return null;

  const session = getSession(phoneNumber);
  pushMessage(phoneNumber, "user", userMessage);

  const lower = userMessage.toLowerCase();
  if (/human|agent|person|call me|speak to someone|managers?|talk to a human/i.test(lower)) {
    return null;
  }

  if (isCasualGreeting(userMessage)) {
    const reply =
      "Poa! 😊 Niko fit. Unatafuta nini leo? Type *menu* to browse, or tell me what you need.";
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  const { products, focus, viral } = await gatherProducts(userMessage, phoneNumber);

  if (products.length === 0) {
    const session = getSession(phoneNumber);
    if (session.lastProductContext) {
      const reply = formatCatalogReply([session.lastProductContext], {
        intro: `About *${session.lastProductContext.name}*:`,
      });
      pushMessage(phoneNumber, "assistant", reply);
      return reply;
    }
    const reply = viral
      ? "Ah, umetoka TikTok! 🔥 Bado hatujapost deal mpya leo — type *menu* kuchagua, au niambie ukitafuta nini."
      : "I couldn't find that in our catalog right now. Type *menu* → *1* to browse categories (phones, TVs, appliances, fashion & more), or tell me a specific item name.";
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  if (viral || (isRecommendationQuery(userMessage) && !isProductDetailQuery(userMessage))) {
    const reply = formatCatalogReply(products, {
      intro: viral
        ? "Ah hio form ya TikTok! 🔥 Hizi ndio deals zetu za hivi karibuni:"
        : focus
          ? `About *${focus.name}* and similar items:`
          : "Here are my top picks:",
    });
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  if (!getClient()) {
    const reply = formatCatalogReply(products);
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  try {
    const catalog = buildCatalogBlock(products, focus);
    const focusedQuestion = focus
      ? `About "${focus.name}": ${userMessage}`
      : userMessage;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `CATALOG (only use these — never contradict this list):\n${catalog}` },
      ...session.history.slice(-14, -1),
      { role: "user", content: focusedQuestion },
    ];

    let reply = await callOpenRouter(messages);
    if (!reply) {
      reply = formatCatalogReply(products, { intro: focus ? `About *${focus.name}*:` : undefined });
    }
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  } catch (err) {
    console.error("[ai] fallback after error:", err.error?.message || err.message);
    const reply = formatCatalogReply(products);
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }
}
