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
} from "./ops-tools.js";
import {
  parseToolArguments,
  extractEmbeddedToolCalls,
  runOpsAgentTurn,
  OPS_TOOL_NAMES,
  opsAgentMeta,
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
    } else {
      assert.ok(["database_offline", "list_failed", "database_not_configured"].includes(direct.error));
    }
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
});
