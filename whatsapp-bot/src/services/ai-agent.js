/**
 * Phase 7 — Unified AI agent (WhatsApp + web) with shared tool layer.
 * Uses OPENAI_MODEL only (free chat). Never uses CATALOG_VISION_MODEL (seller photos).
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { getSession, pushMessage, isHumanHandoff } from "./session.js";
import { channelPrompt } from "./ai-prompts.js";
import { runToolRouter, formatToolResultsForPrompt } from "./ai-tools.js";

const FALLBACK_MODELS = ["google/gemma-4-26b-a4b-it:free"];

let client = null;

function modelChain() {
  const primary = config.openai.model?.trim();
  const configured = config.openai.modelFallbacks || [];
  return [...new Set([primary, ...configured, ...FALLBACK_MODELS].filter(Boolean))];
}

function getClient() {
  if (!config.openai.apiKey) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
      timeout: 35_000,
      defaultHeaders: {
        "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
        "X-Title": config.brand.name,
      },
    });
  }
  return client;
}

/** Free models sometimes echo planning / system rules instead of answering. */
const INSTRUCTION_LEAK =
  /\b(?:we need to answer|must not add unasked|max(?:imum)?\s*(?:length|of)?\s*2[-–—]?\s*3\s*sentences|under\s*\d+\s*words|no fluff|strict conversational rules|single-message principle|no greeting fluff|provide explanation of escrow|output only the customer|never quote(?:\,| or)? paraphrase|these (?:rules|instructions)|system prompt|as an ai language model)\b/i;

function looksLikeInstructionLeak(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (INSTRUCTION_LEAK.test(t)) return true;
  // Model "tool call" dumps / truncated numbered lists are not shopper answers
  if (/^\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
  if (/^\s*```?(?:json)?\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
  // Meta-planning about how to answer, not the answer itself
  if (/^(?:okay[,.]?\s*)?(?:so[,.]?\s*)?(?:i (?:should|must|need to)|let me|the (?:user|customer) asked)/i.test(t) &&
      /\b(?:concise|brief|sentences?|words?|fluff|follow-?ups?)\b/i.test(t)) {
    return true;
  }
  return false;
}

function sanitizeReply(text) {
  if (!text) return null;
  if (/fruit|vegetable|veggie|produce only|fresh produce/i.test(text)) return null;
  let cleaned = String(text).trim();
  // Drop planning / rule-echo lines that free models sometimes emit
  cleaned = cleaned
    .split(/\n+/)
    .filter((line) => !looksLikeInstructionLeak(line))
    .join("\n")
    .trim();
  if (!cleaned || looksLikeInstructionLeak(cleaned)) return null;
  if ((cleaned.match(/\*/g) || []).length % 2 !== 0) {
    cleaned = cleaned.replace(/\*+\s*$/, "");
  }
  return cleaned;
}

const FLUFF_SENTENCE =
  /^(?:hello[!.,]?\s*)?(?:hi[!.,]?\s*)?(?:i hope (?:this|you|that)[^.!?]*[.!?]|thank you for (?:choosing|contacting|reaching out to) sokoni[^.!?]*[.!?]|i(?:'d| would) be delighted[^.!?]*[.!?]|hope (?:this|that) helps[^.!?]*[.!?]|(?:let me know if you need|is there anything else|would you (?:also )?like)[^.!?]*[.!?])\s*/i;

function isPolicyOrTrustQuery(text) {
  return /\b(prepaid|escrow|mpesa|pay(?:ment)?|stk|till|how (?:it|sokoni|does)|delivery|shipping|dispatch|courier|pickup|return|refund|scam|safe|trust|about sokoni|what is sokoni)\b/i.test(
    String(text || "")
  );
}

/**
 * Hard brevity guard after the model (WhatsApp notifications must fit one glance).
 * Policy / trust answers get a slightly larger budget so lists are not sliced mid-point.
 */
export function enforceReplyBrevity(text, channel = "whatsapp", { allowLonger = false } = {}) {
  let cleaned = sanitizeReply(text);
  if (!cleaned) return null;

  const maxWords = allowLonger
    ? channel === "web"
      ? 110
      : 70
    : channel === "web"
      ? 70
      : 45;
  const maxChars = allowLonger
    ? channel === "web"
      ? 720
      : 420
    : channel === "web"
      ? 480
      : 300;
  const maxSentences = allowLonger ? 5 : 3;

  // Strip corporate fluff sentences (leading / trailing / mid-stack).
  let sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(
      (s) =>
        !FLUFF_SENTENCE.test(s) &&
        !/let me know if you need|is there anything else|would you also like|hope you are having|thank you for choosing sokoni|delighted to assist/i.test(
          s
        )
    );

  if (!sentences.length) {
    sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
  }

  cleaned = sentences.slice(0, maxSentences).join(" ").trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    // Prefer cutting on a sentence boundary when possible
    let trimmed = "";
    for (const s of sentences) {
      const next = trimmed ? `${trimmed} ${s}` : s;
      if (next.split(/\s+/).filter(Boolean).length > maxWords) break;
      trimmed = next;
    }
    cleaned = trimmed || words.slice(0, maxWords).join(" ");
    if (!/[.!?…]$/.test(cleaned)) cleaned += ".";
  }
  if (cleaned.length > maxChars) {
    const cut = cleaned.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    cleaned = (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "")).trim();
    if (!/[.!?…]$/.test(cleaned)) cleaned += ".";
  }
  if (looksLikeInstructionLeak(cleaned)) return null;
  return cleaned || null;
}

function formatProductLine(p, channel = "whatsapp", index = 0) {
  const price = `KES ${Number(p.priceKes).toLocaleString()}`;
  const vibe = p.isSecondhand ? " · pre-loved" : "";
  if (channel === "web") {
    return `${index + 1}. ${p.name} — ${price}${vibe}`;
  }
  return `• *${p.name}* — ${price}${vibe}`;
}

function extractBudgetFromText(text) {
  const under = String(text || "").match(/(?:under|chini ya|below|less than)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (under) return Number(under[1].replace(/,/g, ""));
  return null;
}

function emptyCatalogReply(channel, userMessage = "", toolResult = null) {
  const budget = extractBudgetFromText(userMessage);
  const aisle = toolResult?.label || toolResult?.browseLabel || toolResult?.browseCategory || "";
  const budgetBit = Number.isFinite(budget) ? ` under KES ${budget.toLocaleString()}` : "";
  const aisleBit = aisle ? ` in ${aisle}` : "";
  if (channel === "web") {
    return `No live Sokoni listings match that${aisleBit}${budgetBit} right now. Try another keyword or browse sokonimall.com — I only show current stock.`;
  }
  return `No live listings match that${aisleBit}${budgetBit} right now. Try different words or type *menu* — I only show current stock.`;
}

function storeInfoOffline(r, channel, userMessage = "") {
  const lower = String(userMessage || "").toLowerCase();
  if (/\b(deliver|shipping|dispatch|courier|pickup|hub)\b/i.test(lower)) {
    const note = String(r?.deliveryNote || "").trim();
    return note
      ? `${note} Checkout stays 100% prepaid M-Pesa escrow — never pay riders for the item itself.`
      : `Sellers dispatch via Sokoni Mashinani hubs countrywide after prepaid M-Pesa escrow. Track with your SKN order ID.`;
  }
  if (/\b(refund|return|scam|safe|trust)\b/i.test(lower)) {
    return `Your M-Pesa payment stays in Sokoni prepaid escrow until delivery is confirmed. If something goes wrong, open a dispute — never pay personal numbers or private tills.`;
  }
  // Escrow / prepaid / how it works (default)
  if (channel === "web") {
    return `You pay by M-Pesa STK when you order; Sokoni holds that money in prepaid escrow until delivery is confirmed, then releases the seller payout. No COD — never send money to personal tills or numbers.`;
  }
  return `Sokoni is *100% prepaid* via M-Pesa STK — escrow until you confirm delivery. No COD. Never pay personal numbers.`;
}

function offlineReply(toolResults, channel, userMessage = "") {
  for (const r of toolResults) {
    if (r.tool === "track_order" && r.tracking) {
      const t = r.tracking;
      const steps = (t.shipmentTimeline || [])
        .map((s) => `${s.done ? "✅" : s.active ? "🔵" : "⚪"} ${s.label}`)
        .join("\n");
      return (
        `📦 *${t.orderId}*\n${t.productName}\n${t.paymentLine}\n\n${steps || t.shipmentStatusLabel}\n\n` +
        (channel === "web" ? `Order on WhatsApp for support.` : `_Type *menu* for help._`)
      );
    }
    if (r.tool === "list_orders" && r.orders?.length) {
      return (
        `📦 *Your orders:*\n\n` +
        r.orders.map((o) => `*${o.id}* · ${o.productName} · ${o.shipmentStatus || o.status}`).join("\n") +
        `\n\nType an order number for details.`
      );
    }
  }

  // Catalog tools (including zero hits) — never invent deleted/old stock.
  for (const r of toolResults) {
    if (r.tool === "get_product") {
      if (r.ok && r.product && r.product.inStock !== false) {
        const p = r.product;
        return (
          `*${p.name}* — KES ${Number(p.priceKes).toLocaleString()}` +
          (p.isSecondhand ? " · pre-loved" : "") +
          (channel === "web" ? `. Order on WhatsApp from the listing.` : `. Reply *order* or open the picker.`)
        );
      }
      return channel === "web"
        ? `That item is not live on Sokoni right now. Search another keyword or browse sokonimall.com.`
        : `That item is not live right now. Type *menu* to browse current stock.`;
    }
    if (r.tool === "search_products" || r.tool === "browse_products") {
      const live = (r.products || []).filter((p) => p && p.inStock !== false);
      if (live.length) {
        const n = Math.min(3, live.length);
        if (channel === "whatsapp") {
          return `Found *${n}* live match${n === 1 ? "" : "es"}. Reply with the *number* to view & order, or *menu*.`;
        }
        const aisle = r.label || r.browseLabel || "";
        const lines = live.slice(0, 3).map((p, i) => formatProductLine(p, channel, i));
        return (
          `${aisle ? `In ${aisle} — ` : ""}Found ${n} live:\n${lines.join("\n")}\n` +
          `Order on WhatsApp from the listing. Current stock only.`
        );
      }
      return emptyCatalogReply(channel, userMessage, r);
    }
  }

  for (const r of toolResults) {
    if (r.tool === "browse_taxonomy" && r.categories?.length) {
      const top = r.categories
        .filter((c) => !c.navOnly)
        .slice(0, 3)
        .map((c) => c.label)
        .join(", ");
      return channel === "web"
        ? `Top aisles: ${top}. Ask for one (e.g. "women dresses") or browse sokonimall.com.`
        : `Aisles include ${top}. Type a category or *menu*.`;
    }
    if (r.tool === "store_info") {
      return storeInfoOffline(r, channel, userMessage);
    }
  }
  return channel === "web"
    ? "Tell me what you want (e.g. denim under KES 3,000) or paste an SKN-#### to track."
    : "Type *menu* to browse, or send your *SKN-####* (or older *SK-####*) to track.";
}

async function callLLM(messages, { channel = "whatsapp", allowLonger = false } = {}) {
  const openai = getClient();
  if (!openai) throw new Error("No API key");

  // Enough headroom to finish a short trust answer without mid-sentence cutoffs.
  const maxTokens = allowLonger
    ? channel === "web"
      ? 280
      : 180
    : channel === "web"
      ? 200
      : 120;

  let lastError = null;
  for (const model of modelChain()) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        presence_penalty: 0,
        frequency_penalty: 0.5,
      });
      const choice = response.choices[0];
      const raw = choice?.message?.content;
      if (choice?.finish_reason === "length") {
        console.warn(`[ai-agent] ${model} hit max_tokens — preferring complete fallback if needed`);
      }
      const reply = enforceReplyBrevity(raw, channel, { allowLonger });
      if (reply) {
        console.log(`[ai-agent] replied via ${model} (max_tokens=${maxTokens})`);
        return reply;
      }
      console.warn(`[ai-agent] ${model} produced empty/leaked reply — trying next model`);
    } catch (err) {
      lastError = err;
      console.warn(`[ai-agent] ${model} failed:`, err.error?.message || err.message);
    }
  }
  throw lastError || new Error("All models failed");
}

function sanitizeHistory(history = []) {
  return (history || [])
    .filter((m) => m && m.content && !looksLikeInstructionLeak(m.content))
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * One agent turn — shared by WhatsApp and web.
 */
export async function runAgentTurn({
  channel = "whatsapp",
  sessionKey,
  userMessage,
  phone = "",
  history = null,
  persist = true,
}) {
  const text = String(userMessage || "").trim();
  if (!text) return { reply: "Send a message to get started.", tools: [] };

  if (channel === "whatsapp" && isHumanHandoff(sessionKey)) {
    return { reply: null, tools: [], handoff: true };
  }

  const toolResults = await runToolRouter(text, { phone, customerKey: sessionKey });
  const toolBlock = formatToolResultsForPrompt(toolResults);
  const policyTurn =
    isPolicyOrTrustQuery(text) && toolResults.some((r) => r.tool === "store_info");
  const catalogTurn = toolResults.some(
    (r) =>
      r.tool === "search_products" ||
      r.tool === "browse_products" ||
      r.tool === "get_product"
  );

  const session = channel === "whatsapp" ? getSession(sessionKey) : null;
  const hist = history || session?.history || [];

  if (persist && channel === "whatsapp") {
    pushMessage(sessionKey, "user", text);
  }

  // Policy + catalog: deterministic answers from live tools — free models invent deleted stock.
  if (policyTurn || catalogTurn || !getClient()) {
    const reply = offlineReply(toolResults, channel, text);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return {
      reply,
      tools: toolResults,
      offline: true,
      policy: policyTurn,
      catalog: catalogTurn,
      products:
        toolResults.find((r) => r.tool === "browse_products" && r.products?.length)?.products ||
        toolResults.find((r) => r.tool === "search_products" && r.products?.length)?.products ||
        [],
      tracking: toolResults.find((r) => r.tool === "track_order")?.tracking || null,
    };
  }

  try {
    const messages = [
      { role: "system", content: channelPrompt(channel) },
      ...(toolBlock ? [{ role: "system", content: toolBlock }] : []),
      ...sanitizeHistory(hist),
      { role: "user", content: text },
    ];

    let reply = await callLLM(messages, { channel, allowLonger: false });

    if (
      !reply &&
      toolResults.some(
        (r) =>
          ((r.tool === "search_products" || r.tool === "browse_products") && r.products?.length) ||
          r.tool === "browse_taxonomy" ||
          r.tool === "store_info"
      )
    ) {
      reply = offlineReply(toolResults, channel, text);
    }

    reply = enforceReplyBrevity(reply || offlineReply(toolResults, channel, text), channel) ||
      offlineReply(toolResults, channel, text);

    if (persist && channel === "whatsapp" && reply) {
      pushMessage(sessionKey, "assistant", reply);
    }

    const products =
      toolResults.find((r) => r.tool === "browse_products" && r.products?.length)?.products ||
      toolResults.find((r) => r.tool === "search_products" && r.products)?.products ||
      [];

    return {
      reply,
      tools: toolResults,
      products,
      tracking: toolResults.find((r) => r.tool === "track_order")?.tracking || null,
    };
  } catch (err) {
    console.error("[ai-agent] error:", err.message);
    const reply = offlineReply(toolResults, channel, text);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return { reply, tools: toolResults, error: err.message };
  }
}

export function agentMeta() {
  return {
    phase: 7,
    name: "Sokoni Plug",
    channels: ["whatsapp", "web"],
    tools: [
      "search_products",
      "browse_products",
      "browse_taxonomy",
      "get_product",
      "track_order",
      "list_orders",
      "store_info",
    ],
    endpoints: {
      chat: "/api/agent/chat",
      meta: "/api/agent/meta",
    },
    configured: Boolean(config.openai.apiKey),
  };
}

export { looksLikeInstructionLeak, storeInfoOffline };
