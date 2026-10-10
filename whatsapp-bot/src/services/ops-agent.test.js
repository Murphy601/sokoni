import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseDateRange,
  executeOpsTool,
  sendWhatsAppMessage,
  resetOpsSendLimiter,
  checkEscrowStatus,
  getInquiryMetrics,
  getRiderRoster,
  getSellerRoster,
  sendWhatsAppVoice,
} from "./ops-tools.js";
import {
  parseToolArguments,
  extractEmbeddedToolCalls,
  runOpsAgentTurn,
  OPS_TOOL_NAMES,
  opsAgentMeta,
  opsAgentGroqModels,
} from "./ops-agent.js";

beforeEach(() => resetOpsSendLimiter());

describe("ops tool argument guards", () => {
  it("parses date ranges and clamps wild values", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    assert.equal(parseDateRange("this_week", now).label, "this_week");
    assert.equal(parseDateRange("today", now).untilMs - parseDateRange("today", now).sinceMs, 24 * 60 * 60 * 1000);
    const huge = parseDateRange("999d", now);
    assert.ok(huge.untilMs - huge.sinceMs <= 90 * 24 * 60 * 60 * 1000);
  });

  it("does not crash on a missing lookup or unknown tool", async () => {
    const missing = await checkEscrowStatus({});
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "missing_lookup");

    const unknown = await executeOpsTool("drop_database", {});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error, "unknown_tool");
  });

  it("refuses a WhatsApp send with bad or unknown numbers", async () => {
    const noPhone = await sendWhatsAppMessage({ text: "Habari" });
    assert.equal(noPhone.error, "missing_phone");

    const bad = await sendWhatsAppMessage({ phone: "123", text: "Habari" });
    assert.equal(bad.error, "invalid_phone");

    const stranger = await sendWhatsAppMessage({ phone: "254700000000", text: "Habari" });
    assert.equal(stranger.error, "unknown_recipient");
  });

  it("dry-runs a valid send without calling WAHA", async () => {
    const sent = [];
    const result = await sendWhatsAppMessage(
      { phone: "254711111111", text: "Habari John — how does the jacket fit?" },
      {
        allowUnknown: true,
        dryRun: true,
        sender: async (to, text) => {
          sent.push({ to, text });
          return { dryRun: true };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(sent.length, 0);
    assert.match(result.phone, /^254711111111$/);
  });

  it("inquiry metrics always return a safe object", async () => {
    const metrics = await getInquiryMetrics({ dateRange: "7d" });
    assert.equal(metrics.ok, true);
    assert.equal(metrics.tool, "get_inquiry_metrics");
    assert.ok(["postgres", "file_store"].includes(metrics.source) || metrics.source);
  });

  it("rider roster is a named tool and fails soft without Postgres", async () => {
    const viaName = await executeOpsTool("get_rider_roster", {});
    assert.equal(viaName.tool, "get_rider_roster");
    assert.ok(viaName.ok === true || viaName.error === "database_offline" || viaName.error === "list_failed");

    const direct = await getRiderRoster({ status: "VERIFIED" });
    assert.equal(direct.tool, "get_rider_roster");
    if (direct.ok) {
      assert.equal(typeof direct.registered, "number");
      assert.ok(direct.counts);
      if (direct.riders?.length) {
        assert.ok("phone" in direct.riders[0]);
        assert.ok("name" in direct.riders[0]);
      }
    } else {
      assert.ok(["database_offline", "list_failed", "database_not_configured"].includes(direct.error));
    }
  });

  it("order metrics and pending escrow are named tools", async () => {
    const metrics = await executeOpsTool("get_order_metrics", { date_range: "all" });
    assert.equal(metrics.ok, true);
    assert.equal(metrics.tool, "get_order_metrics");
    assert.equal(typeof metrics.total, "number");

    const escrow = await executeOpsTool("list_pending_escrow", { limit: 5 });
    assert.equal(escrow.ok, true);
    assert.equal(escrow.tool, "list_pending_escrow");
    assert.ok(Array.isArray(escrow.orders));
    assert.equal(escrow.till, undefined);
  });

  it("policy search falls back to markdown when pgvector is missing", async () => {
    const result = await executeOpsTool("search_store_policies", { query: "When is escrow released after a dispute?" });
    assert.equal(result.tool, "search_store_policies");
    assert.ok(result.ok === true || result.hits);
    if (result.ok) assert.ok(result.hits.length >= 1);
  });

  it("voice send needs a known recipient and dry-runs without WAHA", async () => {
    const missing = await sendWhatsAppVoice({ text: "Habari" });
    assert.equal(missing.error, "missing_phone");
    const dry = await sendWhatsAppVoice(
      { phone: "254711111111", text: "Habari, checking the jacket." },
      { allowUnknown: true, dryRun: true }
    );
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.tool, "send_whatsapp_voice");
  });

  it("seller roster returns a count and name/phone fields", async () => {
    const viaName = await executeOpsTool("get_seller_roster", {});
    assert.equal(viaName.tool, "get_seller_roster");
    assert.equal(viaName.ok, true);
    assert.equal(typeof viaName.registered, "number");
    const direct = await getSellerRoster({});
    assert.ok(Array.isArray(direct.sellers));
    if (direct.sellers.length) {
      assert.ok("name" in direct.sellers[0]);
      assert.ok("phone" in direct.sellers[0]);
      assert.ok("shop" in direct.sellers[0]);
    }
  });

  it("lists order IDs instead of only counts", async () => {
    const listed = await executeOpsTool("list_orders", { status: "all", limit: 10 });
    assert.equal(listed.ok, true);
    assert.equal(listed.tool, "list_orders");
    assert.ok(Array.isArray(listed.orders));
    assert.equal(typeof listed.count, "number");
    if (listed.orders.length) {
      assert.ok(listed.orders[0].orderId);
      assert.ok("status" in listed.orders[0]);
    }
  });

  it("accepts search_query and catalog item aliases", async () => {
    const policy = await executeOpsTool("search_store_policies", { search_query: "How long does escrow last?" });
    assert.equal(policy.tool, "search_store_policies");
    assert.ok(policy.ok === true || policy.hits);

    const catalog = await executeOpsTool("search_catalog_items", { query: "jacket", max_price: 5000 });
    assert.equal(catalog.tool, "search_catalog");
    assert.ok(Array.isArray(catalog.products));
  });

  it("keeps payout and 12h refund on the desk", async () => {
    const release = await executeOpsTool("release_escrow_payout", {
      order_id: "SKN-1016",
      release_reason: "BUYER_CONFIRMED",
    });
    assert.equal(release.ok, false);
    assert.equal(release.error, "desk_only");

    const refund = await executeOpsTool("trigger_12h_dispatch_refund", { order_id: "SKN-1016" });
    assert.equal(refund.ok, false);
    assert.equal(refund.error, "desk_only");
  });

  it("refuses STK without a real SKN order", async () => {
    const missing = await executeOpsTool("create_mpesa_stk_push", {
      phone_number: "254712345678",
      total_amount: 999,
      order_reference: "NOT-AN-ORDER",
    });
    assert.equal(missing.ok, false);
    assert.ok(["missing_order", "order_not_found"].includes(missing.error));
  });

  it("sends interactive choices as numbered menus", async () => {
    const buttons = await executeOpsTool(
      "send_whatsapp_buttons",
      {
        phone_number: "254711111111",
        message_text: "Did your package arrive?",
        buttons: [
          { id: "confirm_yes", title: "Yes, it arrived" },
          { id: "speak_human", title: "Speak to Human" },
        ],
      },
      { dryRun: true }
    );
    assert.equal(buttons.ok, true);
    assert.equal(buttons.channel, "numbered_menu");
    assert.match(buttons.body, /1\. Yes, it arrived/);

    const list = await executeOpsTool(
      "send_whatsapp_list",
      {
        phone_number: "254711111111",
        menu_title: "View Categories",
        message_text: "What are you looking for today?",
        list_items: [
          { id: "cat_shoes", title: "Vintage Shoes" },
          { id: "cat_denim", title: "Denim" },
        ],
      },
      { dryRun: true }
    );
    assert.equal(list.ok, true);
    assert.equal(list.channel, "numbered_menu");
    assert.match(list.body, /Vintage Shoes/);
  });

  it("validates waitlist, dispute, and voicenote args", async () => {
    const wait = await executeOpsTool("add_restock_alert", { customer_phone: "2547" });
    assert.equal(wait.ok, false);

    const dispute = await executeOpsTool("raise_order_dispute", {
      order_id: "SKN-0000",
      dispute_reason: "empty parcel",
      disputed_by: "BUYER",
    });
    assert.equal(dispute.ok, false);
    assert.ok(["not_found", "missing_args"].includes(dispute.error));

    const voice = await executeOpsTool(
      "process_incoming_voicenote",
      { media_url: "https://example.com/audio.ogg", sender_phone: "254711111111" },
      { dryRun: true }
    );
    assert.equal(voice.ok, true);
    assert.equal(voice.dryRun, true);
  });
});

describe("free-model tool call parsing", () => {
  it("treats empty or broken JSON as an empty object", () => {
    assert.deepEqual(parseToolArguments(""), {});
    assert.equal(parseToolArguments("{nope")._parse_error, "invalid_json");
    assert.deepEqual(parseToolArguments('{"phone":"2547"}').phone, "2547");
  });

  it("recovers a tool dump from model content", () => {
    const calls = extractEmbeddedToolCalls(
      '```json\n{"tool":"check_escrow_status","arguments":{"customer_name":"John"}}\n```'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "check_escrow_status");
    assert.match(calls[0].function.arguments, /John/);
  });

  it("ignores random JSON that is not an allowed tool", () => {
    assert.deepEqual(extractEmbeddedToolCalls('{"tool":"rm_rf","arguments":{}}'), []);
  });
});

describe("ops agent execution loop", () => {
  it("looks up escrow then sends WhatsApp from tool results", async () => {
    const sent = [];
    let round = 0;
    const completeFn = async () => {
      round += 1;
      if (round === 1) {
        return {
          provider: "test",
          model: "mock",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "check_escrow_status",
                  arguments: JSON.stringify({ customer_name: "John", order_id: "SKN-1002" }),
                },
              },
            ],
          },
        };
      }
      if (round === 2) {
        return {
          provider: "test",
          model: "mock",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "c2",
                type: "function",
                function: {
                  name: "send_whatsapp_message",
                  arguments: JSON.stringify({
                    phone: "254722000111",
                    text: "Habari John — did the jacket arrive? How does it fit?",
                    order_id: "SKN-1002",
                  }),
                },
              },
            ],
          },
        };
      }
      return {
        provider: "test",
        model: "mock",
        message: {
          role: "assistant",
          content: "John’s order is in escrow. I asked him how the jacket fits.",
        },
      };
    };

    const result = await runOpsAgentTurn({
      message: "Did John get his order? Ask him how the jacket fits.",
      completeFn,
      dryRun: true,
      allowUnknown: true,
      sender: async (to, text) => {
        sent.push({ to, text });
        return { dryRun: true };
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.reply, /jacket/i);
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].tool, "check_escrow_status");
    assert.equal(result.tools[1].tool, "send_whatsapp_message");
    assert.equal(result.tools[1].result.ok, true);
    assert.equal(sent.length, 0);
  });

  it("returns a staff-facing error when the model is down", async () => {
    const result = await runOpsAgentTurn({
      message: "How many buyers messaged sellers this week?",
      completeFn: async () => {
        throw new Error("429 rate limit");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "llm_failed");
    assert.match(result.reply, /unavailable/i);
  });

  it("publishes the tool list without sending tools to Plug", () => {
    const meta = opsAgentMeta();
    assert.deepEqual(meta.tools, OPS_TOOL_NAMES);
    assert.equal(meta.style, "openai_tool_calling");
    assert.match(meta.note, /Plug/);
  });

  it("lists a Groq chat model for the ops agent", () => {
    const models = opsAgentGroqModels();
    assert.ok(models.length >= 1);
    assert.match(models[0], /gpt-oss|llama|groq/i);
  });
});
