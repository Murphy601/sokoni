/**
 * Admin ops agent — native OpenAI-style tool calling over Postgres + WAHA.
 * Separate from Sokoni Plug (which must keep tool_choice=none for shopper chat).
 *
 * Provider order:
 *   OpenRouter free (inkling-small → inkling → nemotron-super → gemma-4)
 *   NVIDIA NIM (nemotron-3-nano-omni → muse-glimmer → glm-5-3-flash)
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { executeOpsTool, OPS_TOOL_NAMES } from "./ops-tools.js";

export { OPS_TOOL_NAMES };

export const OPS_SYSTEM_PROMPT = `You are the Sokoni Mall ops assistant for staff only.
You help check prepaid M-Pesa escrow, order history, rider roster, and buyer-seller inquiry volume, then you may send a WhatsApp follow-up.

Rules:
- Always look up the customer with check_escrow_status or lookup_order_history before sending WhatsApp.
- Use get_rider_roster for questions about registered / verified / available boda riders. Do not invent rider counts.
- Never invent a phone number, SKN id, or escrow state. Use tool results only.
- send_whatsapp_message is for known Sokoni buyers/sellers only. Keep notes short, warm, and countrywide Kenya — no city-only marketing.
- Do not release escrow, refund, or change payouts. Those stay on the admin desk.
- If a tool returns an error, explain it in plain language. Do not retry a send that already succeeded.
- Reply to the staff operator with what you found and what you sent.`;

export const OPS_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_inquiry_metrics",
      description: "Count buyer-to-seller inbox messages and unique shoppers for a date range.",
      parameters: {
        type: "object",
        properties: {
          date_range: {
            type: "string",
            description: "today | 24h | 7d | this_week | 30d",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rider_roster",
      description:
        "Count registered boda riders by verification status (PENDING, VERIFIED, SUSPENDED, REJECTED) and list a short sample.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Optional filter: PENDING | VERIFIED | SUSPENDED | REJECTED",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_escrow_status",
      description:
        "Look up prepaid escrow, 2-hour inspection, and 24/48-hour auto-release for a customer or SKN order.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string" },
          phone_number: { type: "string" },
          order_id: { type: "string", description: "SKN-#### or SK-####" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_order_history",
      description: "List recent Sokoni orders for a phone, name, or order id.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string" },
          phone_number: { type: "string" },
          order_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description:
        "Send a WhatsApp text via WAHA to a Kenya number that already has a Sokoni order or chat.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          text: { type: "string" },
          order_id: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
];

function csvList(value, fallback) {
  const raw = String(value || "").trim();
  const src = raw || fallback;
  return [...new Set(src.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function opsAgentOpenRouterModels() {
  return csvList(
    config.opsAgent?.openrouterModels,
    "thinkingmachines/inkling-small:free,thinkingmachines/inkling:free,nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free"
  );
}

export function opsAgentNvidiaModels() {
  return csvList(
    config.opsAgent?.nvidiaModels,
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning,meta/muse-glimmer-30b,z.ai/glm-5-3-flash"
  );
}

export function buildOpsProviderChain() {
  const chain = [];
  const openrouterKey = config.openai?.apiKey?.trim();
  const nvidiaKey = config.nvidia?.apiKey?.trim();

  if (openrouterKey) {
    chain.push({
      name: "openrouter",
      client: new OpenAI({
        apiKey: openrouterKey,
        baseURL: config.openai.baseUrl || "https://openrouter.ai/api/v1",
        timeout: 28_000,
        defaultHeaders: {
          "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
          "X-Title": `${config.brand.name} ops agent`,
        },
      }),
      models: opsAgentOpenRouterModels(),
    });
  }
  if (nvidiaKey) {
    chain.push({
      name: "nvidia",
      client: new OpenAI({
        apiKey: nvidiaKey,
        baseURL: config.nvidia.baseUrl || "https://integrate.api.nvidia.com/v1",
        timeout: 28_000,
      }),
      models: opsAgentNvidiaModels(),
    });
  }
  return chain;
}

export function parseToolArguments(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { _parse_error: "invalid_json", raw: text.slice(0, 200) };
  }
}

/** Free models sometimes dump a tool call as JSON in content instead of tool_calls. */
export function extractEmbeddedToolCalls(content) {
  const text = String(content || "").trim();
  if (!text) return [];
  const blobs = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(candidate);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      const name = row?.name || row?.tool || row?.function;
      if (!name || !OPS_TOOL_NAMES.includes(String(name))) continue;
      blobs.push({
        id: `embedded_${name}_${blobs.length}`,
        type: "function",
        function: {
          name: String(name),
          arguments: JSON.stringify(row.arguments || row.args || row.parameters || {}),
        },
      });
    }
  } catch {
    return [];
  }
  return blobs;
}

function normalizeToolCalls(message) {
  const official = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (official.length) return official;
  return extractEmbeddedToolCalls(message?.content);
}

export function opsAgentMeta() {
  const chain = buildOpsProviderChain();
  return {
    style: "openai_tool_calling",
    tools: OPS_TOOL_NAMES.slice(),
    providers: chain.map((p) => ({ name: p.name, models: p.models })),
    primaryProvider: chain[0]?.name || null,
    primaryModel: chain[0]?.models?.[0] || null,
    dryRunDefault: !config.waha?.apiUrl || Boolean(config.opsAgent?.dryRun),
    note: "Admin-only. Plug shopper chat is unchanged (no tools to the LLM).",
  };
}

async function completeWithTools(messages, { completeFn } = {}) {
  if (typeof completeFn === "function") {
    return completeFn(messages);
  }
  const chain = buildOpsProviderChain();
  if (!chain.length) {
    throw new Error("No ops-agent key (set OPENAI_API_KEY and/or NVIDIA_API_KEY)");
  }
  let lastError = null;
  for (const provider of chain) {
    for (const model of provider.models) {
      try {
        const response = await provider.client.chat.completions.create({
          model,
          messages,
          tools: OPS_TOOLS,
          tool_choice: "auto",
          temperature: 0.15,
          max_tokens: 700,
        });
        const choice = response.choices?.[0];
        const message = choice?.message;
        if (!message) continue;
        return {
          message,
          model,
          provider: provider.name,
          finishReason: choice.finish_reason || null,
        };
      } catch (err) {
        lastError = err;
        console.warn(`[ops-agent] ${provider.name}/${model} failed:`, err?.error?.message || err?.message);
      }
    }
  }
  throw lastError || new Error("All ops-agent providers failed");
}

export async function runOpsAgentTurn({
  message,
  history = [],
  completeFn,
  sender,
  dryRun,
  now,
  allowUnknown = false,
  maxRounds = 6,
} = {}) {
  const userMessage = String(message || "").trim();
  if (!userMessage) {
    return { ok: false, error: "missing_message", reply: "Ask about an order, escrow, or inquiry volume." };
  }

  const messages = [
    { role: "system", content: OPS_SYSTEM_PROMPT },
    ...((Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-8)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))),
    { role: "user", content: userMessage.slice(0, 4000) },
  ];

  const trace = [];
  let modelUsed = null;
  let providerUsed = null;
  const forceDry = dryRun != null ? Boolean(dryRun) : Boolean(config.opsAgent?.dryRun);

  for (let round = 0; round < maxRounds; round += 1) {
    let completion;
    try {
      completion = await completeWithTools(messages, { completeFn });
    } catch (err) {
      return {
        ok: false,
        error: "llm_failed",
        reply: "The ops model is unavailable right now. Escrow checks still work from the holding tank.",
        message: String(err?.message || err).slice(0, 200),
        tools: trace,
        meta: opsAgentMeta(),
      };
    }
    modelUsed = completion.model || modelUsed;
    providerUsed = completion.provider || providerUsed;
    const assistant = completion.message || {};
    const toolCalls = normalizeToolCalls(assistant);

    if (!toolCalls.length) {
      const reply = String(assistant.content || "").trim();
      return {
        ok: true,
        reply: reply || "Done — nothing else to look up.",
        tools: trace,
        model: modelUsed,
        provider: providerUsed,
        meta: opsAgentMeta(),
      };
    }

    messages.push({
      role: "assistant",
      content: assistant.content || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call?.function?.name || call?.name;
      const args = parseToolArguments(call?.function?.arguments ?? call?.arguments);
      const started = Date.now();
      let result;
      if (args._parse_error) {
        result = { ok: false, error: "bad_arguments", message: "That tool call had invalid JSON arguments." };
      } else {
        result = await executeOpsTool(name, args, { sender, dryRun: forceDry, now, allowUnknown });
      }
      trace.push({
        tool: name,
        arguments: args._parse_error ? {} : args,
        result,
        ms: Date.now() - started,
      });
      messages.push({
        role: "tool",
        tool_call_id: String(call.id || name || "tool"),
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  return {
    ok: true,
    reply: "Stopped after too many tool rounds. Check the tool trace.",
    tools: trace,
    model: modelUsed,
    provider: providerUsed,
    truncated: true,
    meta: opsAgentMeta(),
  };
}
