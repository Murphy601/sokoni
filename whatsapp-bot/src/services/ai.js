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

const SYSTEM_PROMPT = `You are "Sokoni AI" — the shopping brain of Sokoni Mall (sokonimall.com) on WhatsApp in Kenya.

## What Sokoni is
Sokoni is a pay-on-delivery store PLUS a shopping concierge for international partner stores.
- **Store (default):** Customer orders on WhatsApp, pays cash/M-Pesa on delivery. No upfront payment.
- **International (when asked):** AliExpress, Temu, Amazon via official partner checkout links (affiliate; disclosed once per chat).
You are NOT the seller for international items. For store items, you represent Sokoni's COD fulfillment.

## Your job each turn
1. Understand intent in the user's language (English, Kiswahili, Sheng).
2. Use ONLY the CATALOG block provided — it is pre-searched by the system. You do NOT search yourself.
3. Recommend clearly, compare honestly, and move the user to the next action in one message.
4. Never invent products, prices, stock, links, delivery dates, or specs.

## Conversation loop (internal)
DETECT → (greeting / shop / compare / order intent / track / human / TikTok / international)
ANSWER → lead with the useful conclusion in line 1
PROVE → cite catalog facts only
ACT → one clear CTA (reply *1*, type *menu*, or one clarifying question)
CLOSE → invite them to continue in chat

## Tone
Warm, sharp, trusted local friend — not corporate, not robotic.
2–5 short lines max. Emojis sparingly for scanability.
Mirror the user's language register (formal/casual/Sheng).

## Store orders (primary path)
When CATALOG items are pay-on-delivery:
- Present up to 3 best matches: name, KES price, rating, one honest reason it fits.
- CTA: "Reply *1* to order" or "Type *menu* → Browse Categories".
- If they say nipee/nataka/yes/sawa about the last item → confirm product + reply *1* to start order.
- Never collect payment details in chat.

## TikTok / viral traffic
If user mentions TikTok, reels, viral, "nimeona post", TikTokDeals:
- Match energy immediately ("Ah, hio form ya TikTok! 🔥").
- Prioritize featured/recent items in CATALOG.
- Fast path: name the item + reply *1*.

## International (only when user asks)
If user wants import/abroad/AliExpress/Temu/Amazon/cheaper from outside:
- Say delivery is typically 1–4 weeks.
- Mention Kenya import duty/VAT may apply on arrival (customer pays customs, not a Sokoni fee).
- Direct them: *menu* → Shop International.
- On first partner link in a chat, disclose affiliate commission transparently.

## Product Q&A mode
When user asks specs, battery, size, "is it worth it", comparisons:
- Answer using catalog fields + reasonable general knowledge about the product TYPE.
- If spec not in catalog, say you don't have that detail; offer human help or similar catalog item.
- Compare max 2–3 items on: price/value, rating, fit for stated use.

## Hard rules
- NEVER contradict the CATALOG block.
- NEVER ask for card numbers or M-Pesa PIN.
- NEVER promise exact delivery date unless provided in catalog.
- NEVER pretend to be human; say you're Sokoni AI — human available via menu.
- For track order, cart, cancel, change order, human agent → tell user *menu* (handled outside you).
- If user asks for human/agent/manager → stop selling; say team will reply in this chat.
- "Sasa", "mambo", "habari" are greetings — respond warmly, not as product searches.

## Output format (WhatsApp)
Line 1: direct answer or top pick
Lines 2–4: options or key facts
Final line: single CTA
Examples:
- "Reply *1* kuanza order (pay on delivery)."
- "Type *menu* kuchagua category."
- "Niambie budget yako nikupe options 2 zingine."`;

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
  return `${head}\n\n${lines.join("\n")}\n\nReply *1* to order, or type *menu* to browse all categories.`;
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

function isInternationalIntent(text) {
  return /international|abroad|overseas|aliexpress|temu|amazon|import from|from china|from usa|shop international|cheaper outside/i.test(
    text
  );
}

function isRecommendationQuery(text) {
  return /recommend|best|looking for|what about|do you have|show me|suggest|options/i.test(text);
}

function isProductDetailQuery(text) {
  return /info|detail|spec|battery|size|good for|worth|compare|how long|quality|tell me about|is it/i.test(text);
}

function extractBudgetHint(text) {
  const under = text.match(/(?:under|chini ya|below|less than)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (under) return `under KES ${under[1].replace(/,/g, "")}`;
  const around = text.match(/(?:around|about|kama)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (around) return `around KES ${around[1].replace(/,/g, "")}`;
  return null;
}

function detectLanguageHint(text) {
  if (/[àâäèéêëïîôùûü]/i.test(text)) return "en";
  if (/\b(nataka|nipee|habari|chini|simu|bei|poa|sawa|nimeona|nipe|nataka|kiasi)\b/i.test(text)) return "sw";
  if (/\b(form|mambo|sasa|niko|fit|chap|chapu)\b/i.test(text)) return "sheng";
  return "en";
}

async function gatherProducts(userMessage, phoneNumber) {
  if (isCasualGreeting(userMessage)) {
    return { products: [], focus: null, viral: false, international: false };
  }

  const session = getSession(phoneNumber);
  const existingFocus = session.lastProductContext;

  if (!existingFocus) {
    const routed = await resolveProductQuery(userMessage);
    if (routed.action !== "none") {
      return { products: [], focus: null, viral: false, international: false };
    }
  }

  const quoted = await findProductFromMessage(userMessage);
  if (quoted) setProductContext(phoneNumber, quoted);

  const viral = isViralIntent(userMessage);
  const international = isInternationalIntent(userMessage);
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
  return { products, focus, viral, international };
}

function formatCatalogLine(p, index) {
  const tags = (p.tags || []).slice(0, 3).join(",");
  const cat = [p.category, p.subcategory].filter(Boolean).join("/");
  const fulfillment = p.fulfillment === "store" ? "STORE|pay on delivery" : "INTL|partner checkout";
  return `${index}) id:${p.id} | ${p.name} | KES ${p.priceKes?.toLocaleString()} | ⭐${p.rating} (${p.reviews || 0}) | ${fulfillment} | cat:${cat}${tags ? ` | tags:${tags}` : ""}`;
}

function buildCatalogBlock(products, focus, { userMessage = "", viral = false } = {}) {
  const storeItems = products.filter((p) => p.fulfillment === "store");
  const lines = (storeItems.length ? storeItems : products).slice(0, 5).map((p, i) => formatCatalogLine(p, i + 1));

  const budget = extractBudgetHint(userMessage);
  const lang = detectLanguageHint(userMessage);
  const context = [
    `intent: ${isProductDetailQuery(userMessage) ? "product_qa" : isRecommendationQuery(userMessage) ? "recommend" : "general"}`,
    budget ? `budget_hint: ${budget}` : null,
    `viral_source: ${viral ? "yes" : "no"}`,
    `language: ${lang}`,
    "REQUIRED CTA: reply *1* to order OR *menu* to browse",
  ]
    .filter(Boolean)
    .join("\n");

  if (focus && lines.length > 0) {
    return (
      `CATALOG (authoritative — only use these):\n[STORE | pay on delivery]\n${lines.join("\n")}\n\n` +
      `CUSTOMER CONTEXT:\n${context}\n\n` +
      `FOCUS PRODUCT (answer about this first):\n${lines[0]}`
    );
  }
  if (lines.length === 0) return null;
  return `CATALOG (authoritative — only use these):\n[STORE | pay on delivery]\n${lines.join("\n")}\n\nCUSTOMER CONTEXT:\n${context}`;
}

function buildModeInjection({ viral, focus, userMessage, international }) {
  const modes = [];

  if (viral) {
    modes.push(
      `MODE: TIKTOK_VIRAL\nUser likely came from @SokoniMall TikTok. Be fast and hype-but-honest.\nShow featured catalog items first. Short Sheng welcome OK.\nPrimary CTA: reply *1* to order pay on delivery.`
    );
  }

  if (focus && isProductDetailQuery(userMessage)) {
    modes.push(
      `MODE: PRODUCT_FOCUS\nUser is asking about: "${focus.name}" (id:${focus.id}, KES ${focus.priceKes}).\nAnswer their specific question about THIS item first, then mention 1 related catalog item max.`
    );
  } else if (isRecommendationQuery(userMessage) && !isProductDetailQuery(userMessage)) {
    modes.push(
      `MODE: RECOMMEND\nGive top 3 catalog matches ranked by: fit to request > rating > value within budget.\nDo not overload specs. End with reply *1* or *menu*.`
    );
  }

  if (international) {
    modes.push(
      `MODE: INTERNATIONAL\nUser wants overseas shopping. Clarify budget + item in one question if vague.\nSet expectations: 1–4 weeks shipping, possible customs charges at arrival.\nRoute to *menu* → Shop International; do not promise Sokoni COD for intl items unless catalog says store.`
    );
  }

  return modes.join("\n\n");
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
      "Poa! 😊 Niko fit. Unatafuta nini leo? Type *menu* to browse our store (pay on delivery), or tell me what you need.";
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  const { products, focus, viral, international } = await gatherProducts(userMessage, phoneNumber);

  if (products.length === 0) {
    if (session.lastProductContext) {
      const reply = formatCatalogReply([session.lastProductContext], {
        intro: `About *${session.lastProductContext.name}*:`,
      });
      pushMessage(phoneNumber, "assistant", reply);
      return reply;
    }
    const reply = viral
      ? "Ah, umetoka TikTok! 🔥 Bado hatujapost deal mpya leo — type *menu* kuchagua, au niambie ukitafuta nini."
      : international
        ? "For international shopping (AliExpress, Temu, Amazon), type *menu* → *Shop International*. For local pay-on-delivery items, tell me what you need."
        : "I couldn't find that in our store catalog right now. Type *menu* → *Browse Categories*, or tell me a specific item name (e.g. *Hisense TV*, *Brut perfume*).";
    pushMessage(phoneNumber, "assistant", reply);
    return reply;
  }

  if (viral || (isRecommendationQuery(userMessage) && !isProductDetailQuery(userMessage))) {
    const reply = formatCatalogReply(products, {
      intro: viral
        ? "Ah hio form ya TikTok! 🔥 Hizi ndio deals zetu za hivi karibuni:"
        : focus
          ? `About *${focus.name}* and similar items:`
          : "Here are my top picks from our store:",
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
    const catalog = buildCatalogBlock(products, focus, { userMessage, viral });
    const mode = buildModeInjection({ viral, focus, userMessage, international });
    const focusedQuestion = focus ? `About "${focus.name}": ${userMessage}` : userMessage;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(catalog ? [{ role: "system", content: catalog }] : []),
      ...(mode ? [{ role: "system", content: mode }] : []),
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
