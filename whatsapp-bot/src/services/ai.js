import OpenAI from "openai";
import { config } from "../config.js";
import { searchProducts, getDealOfTheDay } from "./catalog.js";
import { buildAffiliateLink, SOURCE_LABELS } from "./affiliate.js";
import { sendHumanHandoff } from "./menu.js";
import { getSession, pushMessage } from "./session.js";

// Full rationale and example transcripts for this prompt live in
// docs/AI_AGENT_PROMPT.md — keep both in sync when tuning behavior.
const SYSTEM_PROMPT = `You are "${config.brand.name} AI" — a warm, sharp, trustworthy shopping assistant who lives
inside WhatsApp. You work for ${config.brand.name}, an independent affiliate shopping concierge
based in Kenya. You help people find and buy real products from trusted partner stores
(Kilimall, Jumia, and — for international shopping — AliExpress, Temu, and Amazon). You do NOT
hold your own inventory and never take payment directly; you always send the customer to the
partner store's own checkout via your tracked link, and you may earn a small commission when
they buy — this is disclosed, never hidden.

Personality & tone: friendly, fast, human. Match the customer's language and register (English,
Kiswahili, or Sheng). Keep messages short (2-5 lines), use emojis sparingly. Be honest about
trade-offs between products.

Behavior:
- Ask at most ONE short clarifying question at a time if a request is vague.
- Always call the search_products or get_deal_of_the_day tool to find real matches — never invent
  a product, price, or link yourself.
- Present up to 3 options with name, price, source store, and one honest reason it might fit.
- The first time in a conversation you send a purchase link, add a brief affiliate disclosure.
- Never ask for or store payment details; all payment happens on the partner store's site.
- If the user is frustrated, stuck after repeated tries, or asks for a person, call
  escalate_to_human and reassure them a human will follow up in this same chat.
- Stay focused on shopping/customer-support for this business.`;

const tools = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search the curated product catalog for items matching the given filters.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["electronics", "fashion", "home"] },
          keywords: { type: "string", description: "Free-text keywords, e.g. 'camera phone'" },
          max_price_kes: { type: "number" },
          min_price_kes: { type: "number" },
          scope: { type: "string", enum: ["local", "international"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deal_of_the_day",
      description: "Get today's best discounted products.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["local", "international", "all"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description: "Flag this conversation for a human teammate to take over.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
      },
    },
  },
];

function serializeProductsForModel(products, phoneNumber) {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.priceKes ? `KES ${product.priceKes}` : `$${product.priceUsd}`,
    rating: product.rating,
    reviews: product.reviews,
    source: SOURCE_LABELS[product.source] || product.source,
    buy_url: buildAffiliateLink(product, phoneNumber),
  }));
}

async function runTool(name, args, phoneNumber) {
  switch (name) {
    case "search_products": {
      const products = await searchProducts({
        category: args.category,
        keywords: args.keywords,
        maxPriceKes: args.max_price_kes,
        minPriceKes: args.min_price_kes,
        scope: args.scope,
      });
      return serializeProductsForModel(products, phoneNumber);
    }
    case "get_deal_of_the_day": {
      const products = await getDealOfTheDay({ scope: args.scope || "all" });
      return serializeProductsForModel(products, phoneNumber);
    }
    case "escalate_to_human": {
      await sendHumanHandoff(phoneNumber);
      return { escalated: true };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

let client = null;
function getClient() {
  if (!config.openai.apiKey) return null;
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}

/**
 * Runs one turn of the AI agent for a free-text user message, resolving any
 * tool calls, and returns the final assistant text to send back on WhatsApp.
 */
export async function runAiAgent(phoneNumber, userMessage) {
  const openai = getClient();
  const session = getSession(phoneNumber);
  pushMessage(phoneNumber, "user", userMessage);

  if (!openai) {
    // Demo/offline fallback so the bot still works without an API key configured.
    const matches = await searchProducts({ keywords: userMessage, limit: 3 });
    if (matches.length === 0) {
      return "I don't have an OPENAI_API_KEY configured yet, and couldn't find a keyword match in the demo catalog. Try 'menu' to browse categories, or set OPENAI_API_KEY to enable full AI replies.";
    }
    const lines = matches.map(
      (p) => `• ${p.name} — ${p.priceKes ? `KES ${p.priceKes}` : `$${p.priceUsd}`} (${SOURCE_LABELS[p.source]})`
    );
    return `(Demo mode — no AI key set) I found these possible matches:\n${lines.join("\n")}\n\nType 'menu' for the full guided experience.`;
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...session.history,
  ];

  let response = await openai.chat.completions.create({
    model: config.openai.model,
    messages,
    tools,
  });
  let choice = response.choices[0];

  // Resolve tool calls in a loop in case the model chains more than one.
  while (choice.finish_reason === "tool_calls") {
    messages.push(choice.message);
    for (const toolCall of choice.message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const result = await runTool(toolCall.function.name, args, phoneNumber);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    response = await openai.chat.completions.create({
      model: config.openai.model,
      messages,
      tools,
    });
    choice = response.choices[0];
  }

  const reply = choice.message.content?.trim() || "Sorry, could you rephrase that?";
  pushMessage(phoneNumber, "assistant", reply);
  return reply;
}
