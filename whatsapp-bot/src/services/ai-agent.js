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
      const aisle = r.label || r.browseLabel || "";
      const lines = r.products.slice(0, 3).map(formatProductLine);
      return (
        `${aisle ? `In *${aisle}* — ` : ""}Here's what I found:\n\n${lines.join("\n")}\n\n` +
        (channel === "web"
          ? `Tap *Order on WhatsApp* on any item, or message us on WhatsApp to buy.`
          : `Reply *1* to order, or *menu* to browse.`)
      );
    }
    if (r.tool === "browse_taxonomy" && r.categories?.length) {
      const top = r.categories
        .filter((c) => !c.navOnly)
        .slice(0, 8)
        .map((c) => `${c.emoji || "•"} ${c.label}`)
        .join("\n");
      return (
        `Sokoni Mall aisles:\n\n${top}\n\n` +
        (channel === "web"
          ? `Ask for a category (e.g. "women dresses") or browse sokonimall.com.`
          : `Type a category or *menu* to browse.`)
      );
    }
    if (r.tool === "store_info") {
      const till = r.till ? ` Till *${r.till}*` : "";
      return (
        `💳 Sokoni is *100% prepaid* — pay upfront via M-Pesa${till}, funds held in escrow until delivery. No COD.\n` +
        `${r.deliveryNote || ""}\n` +
        (channel === "web" ? `Track orders at /track.html · Ask more anytime here.` : `_Type *menu* or ask how it works._`)
      );
    }
  }
  return channel === "web"
    ? "Tell me what you're looking for (e.g. party outfit under KES 3,000), ask what categories we have, or paste an SK-#### order number to track."
    : "Type *menu* to browse, ask for a category, tell me what you need, or send your *SK-####* to track an order.";
}

async function callLLM(messages) {
  const openai = getClient();
  if (!openai) throw new Error("No API key");

  let lastError = null;
  for (const model of modelChain()) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 550,
        temperature: 0.35,
      });
      const reply = sanitizeReply(response.choices[0]?.message?.content);
      if (reply) {
        console.log(`[ai-agent] replied via ${model}`);
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

    let reply = await callLLM(messages);

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

    if (persist && channel === "whatsapp" && reply) {
      pushMessage(sessionKey, "assistant", reply);
    }

    const products =
      toolResults.find((r) => r.tool === "browse_products" && r.products?.length)?.products ||
      toolResults.find((r) => r.tool === "search_products" && r.products)?.products ||
      [];

    return {
      reply: reply || offlineReply(toolResults, channel),
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
