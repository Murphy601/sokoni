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

function sanitizeReply(text) {
  if (!text) return null;
  if (/fruit|vegetable|veggie|produce only|fresh produce/i.test(text)) return null;
  let cleaned = String(text).trim();
  if ((cleaned.match(/\*/g) || []).length % 2 !== 0) {
    cleaned = cleaned.replace(/\*+\s*$/, "");
  }
  return cleaned;
}

const FLUFF_SENTENCE =
  /^(?:hello[!.,]?\s*)?(?:hi[!.,]?\s*)?(?:i hope (?:this|you|that)[^.!?]*[.!?]|thank you for (?:choosing|contacting|reaching out to) sokoni[^.!?]*[.!?]|i(?:'d| would) be delighted[^.!?]*[.!?]|hope (?:this|that) helps[^.!?]*[.!?]|(?:let me know if you need|is there anything else|would you (?:also )?like)[^.!?]*[.!?])\s*/i;

/** Hard brevity guard after the model (WhatsApp notifications must fit one glance). */
export function enforceReplyBrevity(text, channel = "whatsapp") {
  let cleaned = sanitizeReply(text);
  if (!cleaned) return null;

  const maxWords = channel === "web" ? 60 : 40;
  const maxChars = channel === "web" ? 420 : 280;

  // Strip corporate fluff sentences (leading / trailing / mid-stack).
  let sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !FLUFF_SENTENCE.test(s) && !/let me know if you need|is there anything else|would you also like|hope you are having|thank you for choosing sokoni|delighted to assist/i.test(s));

  if (!sentences.length) {
    sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
  }

  cleaned = sentences.slice(0, 3).join(" ").trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    cleaned = words.slice(0, maxWords).join(" ");
    if (!/[.!?…]$/.test(cleaned)) cleaned += "…";
  }
  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars - 1).replace(/\s+\S*$/, "").trim();
    if (!/[.!?…]$/.test(cleaned)) cleaned += "…";
  }
  return cleaned || null;
}

function formatProductLine(p) {
  return `• *${p.name}* — KES ${Number(p.priceKes).toLocaleString()}${p.isSecondhand ? " · pre-loved" : ""} ⭐ ${p.rating || "—"}`;
}

function offlineReply(toolResults, channel) {
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
    if ((r.tool === "search_products" || r.tool === "browse_products") && r.products?.length) {
      const n = Math.min(3, r.products.length);
      // WhatsApp: numbered picker follows — keep text tiny to avoid double walls of text.
      if (channel === "whatsapp") {
        return `Found *${n}* match${n === 1 ? "" : "es"}. Reply with the *number* to view & order, or *menu*.`;
      }
      const aisle = r.label || r.browseLabel || "";
      const lines = r.products.slice(0, 3).map(formatProductLine);
      return (
        `${aisle ? `In *${aisle}* — ` : ""}Found ${n}:\n${lines.join("\n")}\n` +
        `Tap *Order on WhatsApp* on an item.`
      );
    }
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
      return `Sokoni is *100% prepaid* via M-Pesa STK — escrow until you confirm delivery. No COD. Never pay personal numbers.`;
    }
  }
  return channel === "web"
    ? "Tell me what you want (e.g. denim under KES 3,000) or paste an SKN-#### to track."
    : "Type *menu* to browse, or send your *SKN-####* (or older *SK-####*) to track.";
}

async function callLLM(messages, { channel = "whatsapp" } = {}) {
  const openai = getClient();
  if (!openai) throw new Error("No API key");

  // Hard caps: ~40 words WA / ~60 words web — model cannot ramble past this budget.
  const maxTokens = channel === "web" ? 120 : 80;

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
      const reply = enforceReplyBrevity(response.choices[0]?.message?.content, channel);
      if (reply) {
        console.log(`[ai-agent] replied via ${model} (max_tokens=${maxTokens})`);
        return reply;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[ai-agent] ${model} failed:`, err.error?.message || err.message);
    }
  }
  throw lastError || new Error("All models failed");
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

  const session = channel === "whatsapp" ? getSession(sessionKey) : null;
  const hist = history || session?.history || [];

  if (persist && channel === "whatsapp") {
    pushMessage(sessionKey, "user", text);
  }

  if (!getClient()) {
    const reply = offlineReply(toolResults, channel);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return { reply, tools: toolResults, offline: true };
  }

  try {
    const messages = [
      { role: "system", content: channelPrompt(channel) },
      ...(toolBlock ? [{ role: "system", content: toolBlock }] : []),
      ...hist.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    let reply = await callLLM(messages, { channel });

    if (
      !reply &&
      toolResults.some(
        (r) =>
          ((r.tool === "search_products" || r.tool === "browse_products") && r.products?.length) ||
          r.tool === "browse_taxonomy" ||
          r.tool === "store_info"
      )
    ) {
      reply = offlineReply(toolResults, channel);
    }

    reply = enforceReplyBrevity(reply || offlineReply(toolResults, channel), channel);

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
    const reply = offlineReply(toolResults, channel);
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
