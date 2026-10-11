import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyLeadIntent,
  nextCrmTag,
  customerServiceWindow,
  resolveOutboundBody,
  recordInbound,
  setCrmTag,
  listCrmContacts,
  assignAgent,
  runTaggedBroadcast,
  tagCrmContact,
  resetCrmStoreForTests,
  CRM_WINDOW_MS,
  CRM_TAXONOMY_TAGS,
  approvedTemplate,
} from "./whatsapp-crm.js";

beforeEach(() => resetCrmStoreForTests());

describe("lead intent beyond single keywords", () => {
  it("maps pricing, product, support, and complaints", () => {
    assert.equal(classifyLeadIntent("Bei ngapi hiyo jacket?").intent, "pricing");
    assert.equal(classifyLeadIntent("Do you have viatu size 42?").intent, "product");
    assert.equal(classifyLeadIntent("Where is my order?").intent, "support");
    assert.equal(classifyLeadIntent("This is a scam, I want a refund").intent, "complaint");
    assert.equal(classifyLeadIntent("This is a scam, I want a refund").assignHuman, true);
    assert.equal(classifyLeadIntent("Please talk to a human").assignHuman, true);
    assert.equal(classifyLeadIntent("Hello").intent, "greeting");
    assert.equal(classifyLeadIntent("Hello").assignHuman, false);
  });

  it("does not treat a product help question as a human handoff", () => {
    const intent = classifyLeadIntent("Help me find a charger under 1000");
    assert.equal(intent.assignHuman, false);
    assert.ok(["product", "pricing", "unknown", "support"].includes(intent.intent));
  });
});

describe("CRM tag ranks", () => {
  it("upgrades new_lead → interested → ordering, and reopens closed on shopping", () => {
    assert.equal(nextCrmTag("new_lead", "interested"), "interested");
    assert.equal(nextCrmTag("interested", "new_lead"), "interested");
    assert.equal(nextCrmTag("interested", "ordering"), "ordering");
    assert.equal(nextCrmTag("ordering", "interested"), "ordering");
    assert.equal(nextCrmTag("closed", "interested"), "interested");
    assert.equal(nextCrmTag("closed", "new_lead"), "closed");
    assert.equal(nextCrmTag("interested", "closed"), "closed");
  });

  it("records inbound timestamps and tags", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const { contact, intent } = recordInbound({
      customerKey: "254711111111@c.us",
      text: "How much is the denim jacket?",
      displayName: "Amina",
      phone: "254711111111",
      now,
    });
    assert.equal(intent.intent, "pricing");
    assert.equal(contact.tag, "interested");
    assert.equal(contact.lastInboundAt, now);
    assert.equal(setCrmTag("254711111111@c.us", "closed").contact.tag, "closed");
    assert.ok(contact.tags.includes("hot-lead"));
  });
});

describe("CRM taxonomy tags", () => {
  it("adds and removes hyphenated tags on a phone", async () => {
    recordInbound({
      customerKey: "254733333333@c.us",
      text: "Hello",
      phone: "254733333333",
      now: Date.now(),
    });
    const tagged = await tagCrmContact({
      phone_number: "254733333333",
      tags_to_add: ["hot-lead", "inspection-pending"],
      tags_to_remove: ["new-lead"],
      sync: false,
    });
    assert.equal(tagged.ok, true);
    assert.ok(tagged.tags.includes("hot-lead"));
    assert.ok(tagged.tags.includes("inspection-pending"));
    assert.ok(!tagged.tags.includes("new-lead"));
    assert.equal(tagged.tag, "interested");

    const listed = listCrmContacts({ tag: "hot-lead" });
    assert.ok(listed.some((c) => c.phone === "254733333333" || c.customerKey.includes("254733333333")));
  });

  it("rejects unknown tags and accepts aliases", async () => {
    const bad = await tagCrmContact({
      phone_number: "254733333334",
      tags_to_add: ["world-class-lead"],
      sync: false,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_tag");

    const alias = await tagCrmContact({
      phone_number: "254733333334",
      tags_to_add: ["interested"],
      sync: false,
    });
    assert.equal(alias.ok, true);
    assert.ok(alias.tags.includes("hot-lead"));
    assert.ok(CRM_TAXONOMY_TAGS.includes("vip-buyer"));
  });
});

describe("Meta 24-hour customer service window", () => {
  it("is open inside 24h of last inbound and closed after", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const inside = customerServiceWindow(now - 2 * 60 * 60 * 1000, now);
    const outside = customerServiceWindow(now - CRM_WINDOW_MS - 1000, now);
    const never = customerServiceWindow(0, now);
    assert.equal(inside.open, true);
    assert.equal(inside.reason, "inside_24h");
    assert.equal(outside.open, false);
    assert.equal(outside.reason, "outside_24h");
    assert.equal(never.reason, "no_inbound");
  });

  it("sends free-form inside the window and a template after", () => {
    const free = resolveOutboundBody({
      windowOpen: true,
      message: "Flash 10% off your jacket — reply YES.",
      templateName: "interested_nudge",
    });
    assert.equal(free.mode, "freeform");
    assert.match(free.body, /Flash 10%/);

    const templated = resolveOutboundBody({
      windowOpen: false,
      message: "Flash 10% off your jacket — reply YES.",
      templateName: "interested_nudge",
    });
    assert.equal(templated.mode, "template");
    assert.equal(templated.body, approvedTemplate("interested_nudge"));
    assert.doesNotMatch(templated.body, /Flash 10%/);
  });
});

describe("assign_agent", () => {
  it("opens a handoff once and is idempotent after that", async () => {
    const { setHumanHandoff, clearHumanHandoff } = await import("./session.js");
    clearHumanHandoff("254722222222@c.us");
    const calls = [];
    const first = await assignAgent(
      {
        customerKey: "254722222222@c.us",
        lastMessage: "I want a refund, this is a scam",
        phone: "254722222222",
        reason: "complaint",
      },
      {
        silentAck: true,
        startHandoff: async (args) => {
          calls.push(args);
          return { ok: true, ticket: { id: "SUP-2026-0001" } };
        },
      }
    );
    assert.equal(first.assigned, true);
    assert.equal(first.ticketId, "SUP-2026-0001");
    assert.equal(first.contact.tag, "complaint");
    assert.equal(calls.length, 1);

    setHumanHandoff("254722222222@c.us", {
      startedAt: Date.now(),
      supportTicketId: "SUP-2026-0001",
    });

    const second = await assignAgent(
      {
        customerKey: "254722222222@c.us",
        lastMessage: "hello?",
        reason: "support",
      },
      {
        silentAck: true,
        startHandoff: async (args) => {
          calls.push(args);
          return { ok: true, ticket: { id: "SUP-2026-0002" } };
        },
      }
    );
    assert.equal(second.alreadyAssigned, true);
    assert.equal(second.assigned, false);
    assert.equal(calls.length, 1);
  });
});

describe("tagged broadcast", () => {
  it("splits recipients by the 24h window", async () => {
    const now = Date.parse("2026-10-10T18:00:00Z");
    recordInbound({
      customerKey: "254700000001@c.us",
      text: "Bei ya jacket?",
      now: now - 60 * 60 * 1000,
    });
    recordInbound({
      customerKey: "254700000002@c.us",
      text: "Do you have viatu size 41?",
      now: now - CRM_WINDOW_MS - 60 * 1000,
    });

    const sent = [];
    const result = await runTaggedBroadcast(
      {
        tag: "interested",
        message: "10% off this week — reply YES.",
        templateName: "interested_nudge",
        sinceDays: 14,
        dryRun: false,
      },
      {
        now,
        sender: async (to, body) => {
          sent.push({ to, body });
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.total, 2);
    assert.equal(result.freeform, 1);
    assert.equal(result.templated, 1);
    assert.equal(sent.length, 2);
    assert.ok(sent.some((s) => /10% off/.test(s.body)));
    assert.ok(sent.some((s) => s.body === approvedTemplate("interested_nudge")));
  });

  it("lists only matching tags", () => {
    const now = Date.now();
    recordInbound({ customerKey: "a@c.us", text: "Hello", now });
    recordInbound({ customerKey: "b@c.us", text: "How much is delivery?", now });
    const leads = listCrmContacts({ tag: "new_lead", now });
    const interested = listCrmContacts({ tag: "interested", now });
    assert.ok(leads.some((c) => c.customerKey === "a@c.us"));
    assert.ok(interested.some((c) => c.customerKey === "b@c.us"));
    assert.ok(!leads.some((c) => c.customerKey === "b@c.us"));
  });
});

describe("Groq-first voice notes", () => {
  it("tries Groq Whisper, then Grok, then OpenRouter", () => {
    const src = readFileSync(new URL("./commerce-ops.js", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function transcribeWhatsAppAudio"));
    const groqAt = fn.indexOf("config.groq");
    const grokAt = fn.indexOf("transcribeWithGrok");
    const openrouterAt = fn.indexOf("config.openai");
    assert.ok(groqAt > 0, "Groq STT must be present");
    assert.ok(grokAt > groqAt, "Grok STT must follow Groq");
    assert.ok(openrouterAt > grokAt, "OpenRouter STT must follow Grok");
    assert.match(fn, /whisper-large-v3-turbo/);
    assert.match(fn, /provider:\s*"groq"/);
    assert.match(src, /voiceAudioFilename/);
  });
});

describe("admin CRM routes stay ahead of /:orderId", () => {
  it("registers /crm/* before the orderId catch-all", () => {
    const src = readFileSync(new URL("../routes/adminSupportApi.js", import.meta.url), "utf8");
    const crmAt = src.indexOf('router.get("/crm/contacts"');
    const catchAt = src.indexOf('router.get("/:orderId"');
    assert.ok(crmAt > 0 && catchAt > crmAt);
    assert.match(src, /router\.post\("\/crm\/assign"/);
    assert.match(src, /router\.post\("\/crm\/broadcast"/);
  });
});
