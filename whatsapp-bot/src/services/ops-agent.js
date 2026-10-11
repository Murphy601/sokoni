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
You can look up the live platform and WhatsApp registered contacts. Always call a tool before you say you cannot do something.

Tools:
- list_orders — every order ID (optional status / date_range). Use when staff ask “what are the order IDs”.
- get_order_metrics — totals by status. Use for “how many orders”.
- list_pending_escrow — prepaid orders still held.
- get_order_and_escrow_details / check_escrow_status — one SKN or buyer phone: escrow, 12h dispatch, 2h/24h/48h timers.
- lookup_order_history — recent orders for a phone or name.
- get_platform_snapshot — held KES, pauses, open disputes.
- list_open_disputes — open dispute tickets.
- raise_order_dispute — freeze escrow and flag anti-scam review. Does not refund.
- confirm_item_dispatch — log courier + tracking for a seller drop-off.
- submit_inspection_photos — store buyer inspection photo URLs.
- get_seller_roster / get_rider_roster — name and registered WhatsApp (source directories).
- list_crm_contacts — tagged WhatsApp people. Hydrates verified riders (rider-partner), live sellers (active-seller), and buyers from orders/accounts (new-lead, active-buyer, repeat-buyer, vip-buyer, cart-abandoned) before listing.
- tag_crm_contact — add or remove CRM taxonomy tags on a phone (buyer / seller / escrow / support).
- search_catalog / search_catalog_items — live stock by keywords / max price.
- search_store_policies — escrow / returns / shipping FAQ (markdown if pgvector is empty).
- add_restock_alert — waitlist a buyer for an out-of-stock SKU.
- schedule_reorder_reminder — snooze a consumable re-order WhatsApp.
- create_mpesa_stk_push — STK for an existing SKN only (shipping gate still applies).
- process_incoming_voicenote — transcribe a WAHA audio URL (Groq Whisper).
- escalate_to_human_agent — open a support ticket on the ops desk.
- notify_admin_ops — WhatsApp alert to ADMIN_PHONES.
- send_whatsapp_message / send_whatsapp_voice — reach a registered seller, rider, or known buyer.
- send_whatsapp_buttons / send_whatsapp_list — numbered menus (WAHA tap buttons are unreliable).
- publish_whatsapp_status_or_channel — post a catalog drop to Status AND the official Channel (default BOTH; no till numbers).
- list_whatsapp_channels — GET /api/{session}/channels?role=OWNER to read 111…@newsletter ids.
- send_video_note — circular video note to a known buyer/seller (WAHA or sokonimall.com URL).
- create_mediation_group — buyer + seller + admin WhatsApp group for a disputed SKN. Auto on raise_order_dispute when the order is KES 10,000+.
- send_channel_invite — send the official Channel invite link (https://whatsapp.com/channel/…) when someone asks for updates or new arrivals.

Rules:
- Look the person up first, then send. Quote name + phone from the tool. Never invent contacts or SKN ids.
- When asked for order IDs, call list_orders. Do not say you lack that tool.
- “Text the CRM / broadcast to verified riders” → list_crm_contacts with tag rider-partner, then send_whatsapp_message. Buyers: tag new-lead / active-buyer / repeat-buyer / vip-buyer. Do not say the CRM is empty if riders, sellers, or buyers exist — list_crm_contacts imports them.
- Keep notes short, warm, countrywide Kenya.
- release_escrow_payout and trigger_12h_dispatch_refund are desk-only. Tell staff to use Command Center.
- If a tool errors, explain it in plain language. Do not retry a send that already succeeded.`;

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
      name: "get_order_metrics",
      description: "Platform-wide order counts: total, by status, paid, held in escrow. Use for “how many orders”.",
      parameters: {
        type: "object",
        properties: {
          date_range: { type: "string", description: "all | today | 7d | 30d" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_orders",
      description:
        "Returns live order IDs (SKN-####) with status, buyer name, phone, and total. Use whenever staff ask for order IDs or a list of orders.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "all | pending | paid | held | delivered | cancelled | escrow" },
          date_range: { type: "string", description: "all | today | 7d | 30d" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_platform_snapshot",
      description: "Held escrow KES, paused orders, open disputes. No till numbers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_escrow",
      description: "List prepaid orders still in escrow across the platform.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_open_disputes",
      description: "Open or under-review dispute tickets.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "open | all" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_seller_roster",
      description:
        "Count registered Sokoni sellers and return name, shop, and the WhatsApp number they registered with. Use for “how many sellers” and “what is their number”.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Optional name, shop, or phone filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rider_roster",
      description:
        "Count registered boda riders and return name, WhatsApp phone, town, and verification status.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Optional filter: PENDING | VERIFIED | SUSPENDED | REJECTED",
          },
          q: { type: "string", description: "Optional rider name or phone filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_crm_contacts",
      description:
        "WhatsApp CRM contacts (buyers, sellers, verified riders). Imports buyers from orders/accounts (new-lead, active-buyer, repeat-buyer, vip-buyer), verified riders as rider-partner, and live sellers as active-seller before listing.",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Legacy or hyphenated taxonomy tag" },
          q: { type: "string" },
          window: { type: "string", description: "any | inside | outside" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Search live Sokoni stock by keywords.",
      parameters: {
        type: "object",
        properties: {
          keywords: { type: "string" },
          q: { type: "string" },
          query: { type: "string" },
          max_price: { type: "number", description: "Optional max price in KSh." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_catalog_items",
      description: "Searches Sokoni Mall thrift catalog by keyword, size, price, or category.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms (e.g., 'denim jacket size M')." },
          max_price: { type: "number", description: "Optional max price in KSh." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_store_policies",
      description:
        "Searches the Sokoni Mall FAQ and policy database. Use this WHENEVER staff or a buyer ask about shipping, escrow, refunds, or store rules.",
      parameters: {
        type: "object",
        properties: {
          search_query: {
            type: "string",
            description: "The core question to search for, e.g., 'How long does escrow last?'",
          },
          query: { type: "string", description: "Alias for search_query." },
        },
        additionalProperties: false,
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
          buyer_phone: { type: "string" },
          order_id: { type: "string", description: "SKN-#### or SK-####" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_and_escrow_details",
      description:
        "Fetches full status for an order, including M-Pesa escrow lock, 12h dispatch window, and 2h/24h/48h inspection timers.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "The unique order ID or receipt code." },
          buyer_phone: { type: "string", description: "Optional phone number to look up active orders." },
        },
        additionalProperties: false,
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
        "Send a WhatsApp text via WAHA to a registered seller, rider, or a Kenya number that already has a Sokoni order or chat.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          seller_name: { type: "string", description: "Resolve the seller’s registered WhatsApp" },
          rider_name: { type: "string", description: "Resolve the rider’s registered WhatsApp" },
          text: { type: "string" },
          order_id: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_voice",
      description:
        "Synthesize a short voice note (ElevenLabs / Groq / Grok) and send it via WAHA to a registered seller, rider, or known buyer.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          seller_name: { type: "string" },
          rider_name: { type: "string" },
          text: { type: "string", description: "Spoken script, under 400 characters" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_restock_alert",
      description: "Subscribes a customer to a WhatsApp notification when an out-of-stock product is back.",
      parameters: {
        type: "object",
        properties: {
          customer_phone: { type: "string", description: "Buyer phone, e.g. +254712345678" },
          product_id: { type: "string", description: "Catalog id or exact product name." },
        },
        required: ["customer_phone", "product_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mpesa_stk_push",
      description:
        "Starts an M-Pesa STK for an existing SKN cart/order. Uses the order total after the shipping gate — never an invented amount.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "M-Pesa phone starting with 254." },
          total_amount: { type: "number", description: "Ignored — the order total is used." },
          order_reference: { type: "string", description: "Existing SKN order id." },
        },
        required: ["phone_number", "order_reference"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_item_dispatch",
      description: "Marks an order dispatched with courier/rider name and optional tracking.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          courier_name: { type: "string", description: "Farasi, Rider Direct, or Personal Drop." },
          tracking_reference: { type: "string" },
        },
        required: ["order_id", "courier_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_inspection_photos",
      description: "Stores buyer inspection photo URLs and opens or extends the 2-hour review window.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          photo_urls: { type: "array", items: { type: "string" } },
          buyer_note: { type: "string" },
        },
        required: ["order_id", "photo_urls"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "release_escrow_payout",
      description:
        "Desk-only. Tells staff to release from Command Center. The agent cannot move money.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          release_reason: { type: "string", description: "BUYER_CONFIRMED | AUTO_RELEASE_24H | AUTO_RELEASE_48H" },
        },
        required: ["order_id", "release_reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "raise_order_dispute",
      description: "Freezes escrow immediately and flags the order for anti-scam review.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          dispute_reason: { type: "string" },
          disputed_by: { type: "string", description: "BUYER or SELLER" },
        },
        required: ["order_id", "dispute_reason", "disputed_by"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_12h_dispatch_refund",
      description:
        "Desk-only. Tells staff to run the 12h undispatched refund from Command Center. The agent cannot refund.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
        },
        required: ["order_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_reorder_reminder",
      description: "Schedules a WhatsApp re-order reminder for a consumable (default 30 days).",
      parameters: {
        type: "object",
        properties: {
          customer_phone: { type: "string" },
          product_id: { type: "string" },
          days_delay: { type: "number" },
        },
        required: ["customer_phone", "product_id", "days_delay"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_incoming_voicenote",
      description: "Downloads a WAHA voice note and transcribes it with Groq Whisper.",
      parameters: {
        type: "object",
        properties: {
          media_url: { type: "string", description: "WAHA audio download URL." },
          sender_phone: { type: "string" },
        },
        required: ["media_url", "sender_phone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human_agent",
      description: "Opens a support ticket on the ops desk when the AI cannot resolve the chat.",
      parameters: {
        type: "object",
        properties: {
          customer_phone: { type: "string" },
          summary_reason: { type: "string" },
        },
        required: ["customer_phone", "summary_reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_admin_ops",
      description: "Sends an urgent WhatsApp alert to Sokoni admin phones.",
      parameters: {
        type: "object",
        properties: {
          alert_level: { type: "string", description: "INFO | WARNING | CRITICAL" },
          message_body: { type: "string" },
        },
        required: ["alert_level", "message_body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_buttons",
      description:
        "Sends a numbered quick-reply menu (1–3 options). WAHA tap buttons are unreliable, so buyers reply with the number.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string" },
          message_text: { type: "string" },
          buttons: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
              },
              required: ["id", "title"],
            },
          },
        },
        required: ["phone_number", "message_text", "buttons"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_list",
      description:
        "Sends a numbered list menu (up to 10 rows) for categories, sizes, or FAQ topics. Buyers reply with the number.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string" },
          menu_title: { type: "string" },
          message_text: { type: "string" },
          list_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
              },
              required: ["id", "title"],
            },
          },
        },
        required: ["phone_number", "menu_title", "message_text", "list_items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_crm_contact",
      description:
        "Applies or removes CRM tags for a WhatsApp contact to segment buyers, sellers, escrow, and support. Valid tags: new-lead, hot-lead, cart-abandoned, active-buyer, repeat-buyer, vip-buyer, seller-prospect, active-seller, top-seller, delayed-dispatch, inspection-pending, dispute-open, rider-partner, payout-pending, complaint, follow-up, restock-subscriber, opt-out.",
      parameters: {
        type: "object",
        properties: {
          phone_number: {
            type: "string",
            description: "The contact's phone number in international format (e.g. 254…). ",
          },
          tags_to_add: {
            type: "array",
            items: { type: "string" },
            description: "Tags to apply (e.g. ['hot-lead', 'inspection-pending']).",
          },
          tags_to_remove: {
            type: "array",
            items: { type: "string" },
            description: "Tags to remove (e.g. ['new-lead']).",
          },
        },
        required: ["phone_number", "tags_to_add"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_whatsapp_status_or_channel",
      description:
        "Publishes the same caption to WhatsApp Status AND the official Sokoni Channel. Default destination_type is BOTH. Channel id is resolved from WAHA GET /api/{session}/channels?role=OWNER when omitted. Never include till or paybill numbers.",
      parameters: {
        type: "object",
        properties: {
          destination_type: { type: "string", description: "BOTH (default) | STATUS | CHANNEL" },
          channel_id: {
            type: "string",
            description: "Optional 111…@newsletter. If empty, uses WAHA_CHANNEL_ID or the first OWNER channel.",
          },
          text: { type: "string", description: "Caption or announcement." },
          media_url: { type: "string", description: "Optional image/video URL on WAHA or sokonimall.com." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_channels",
      description:
        "Lists WhatsApp Channels for the active WAHA session (GET /api/{session}/channels). Use role=OWNER to find ids you can post to.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", description: "OWNER | ADMIN | optional filter" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_video_note",
      description: "Sends a native WhatsApp circular video note to a known buyer or seller.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Recipient phone." },
          video_url: { type: "string", description: "WAHA or sokonimall.com video URL." },
        },
        required: ["phone_number", "video_url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mediation_group",
      description:
        "Creates a temporary WhatsApp group for dispute mediation (buyer, seller, admin). Use for a real SKN. The agent still cannot pay out or refund.",
      parameters: {
        type: "object",
        properties: {
          group_name: { type: "string", description: "e.g. Dispute: SKN-1016" },
          participant_phones: {
            type: "array",
            items: { type: "string" },
            description: "Buyer, seller, and admin phones.",
          },
          initial_message: { type: "string", description: "First message explaining the hold." },
        },
        required: ["group_name", "participant_phones", "initial_message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_channel_invite",
      description:
        "Sends the official Sokoni Mall WhatsApp Channel invite link to the user. Use this when users ask for updates, new arrivals, or want to stay connected.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "The user's phone number." },
          context: {
            type: "string",
            description: "A short, personalized intro based on the chat (e.g. 'To catch the next shoe drop, join here:').",
          },
        },
        required: ["phone_number", "context"],
        additionalProperties: false,
      },
      strict: true,
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

export function opsAgentGroqModels() {
  return csvList(
    config.opsAgent?.groqModels,
    config.groq?.model || "openai/gpt-oss-20b"
  );
}

export function buildOpsProviderChain() {
  const chain = [];
  const openrouterKey = config.openai?.apiKey?.trim();
  const groqKey = config.groq?.apiKey?.trim();
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
  if (groqKey) {
    chain.push({
      name: "groq",
      client: new OpenAI({
        apiKey: groqKey,
        baseURL: config.groq.baseUrl || "https://api.groq.com/openai/v1",
        timeout: 28_000,
      }),
      models: opsAgentGroqModels(),
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
    throw new Error("No ops-agent key (set OPENAI_API_KEY, GROQ_API_KEY, and/or NVIDIA_API_KEY)");
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
