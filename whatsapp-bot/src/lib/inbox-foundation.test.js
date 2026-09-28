import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url).pathname.replace(/^\//, "").startsWith("C:") ? new URL("../routes/socialApi.js", import.meta.url) : new URL("../routes/socialApi.js", import.meta.url), "utf8");
const REPO = readFileSync(new URL("../db/repositories/social.js", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../../db/schema-phase37-rich-messages.sql", import.meta.url), "utf8");

describe("a client cannot forge a system card", () => {
  it("strips isSystem from the request body", () => {
    // /chat/send spreads req.body straight into the repository, so anything
    // the client sets, it sets. isSystem is what makes a card read as
    // "Sokoni says this" -- forging it could show escrow that does not exist.
    const route = API.slice(API.indexOf('router.post("/chat/send"'));
    const head = route.slice(0, route.indexOf("const hasSellerContext"));
    assert.match(head, /delete payload\.isSystem;/);
    assert.match(head, /delete payload\.expiresAt;/);
    assert.match(head, /delete payload\.isPinned;/);
  });

  it("refuses system kinds outright at the route", () => {
    const route = API.slice(API.indexOf('router.post("/chat/send"'));
    assert.match(route.slice(0, 1400), /isSystemKind\(payload\.kind\)/);
  });

  it("refuses them again in the repository, not only at the edge", () => {
    // Defence in depth: postSystemCard is not the only caller.
    assert.match(REPO, /isSystemKind\(messageKind\) && !isSystem/);
  });
});

describe("the message model", () => {
  it("defaults every new column, so existing rows stay valid", () => {
    for (const col of ["kind", "payload", "is_system", "is_pinned"]) {
      assert.match(SCHEMA, new RegExp(`${col}[^,]*DEFAULT`), `${col} has no default`);
    }
  });

  it("constrains kind to the list the code knows", () => {
    assert.match(SCHEMA, /messages_kind_known CHECK/);
    for (const k of ["escrow_status", "deal_ledger", "swap_offer", "scratch_card", "fit_check"]) {
      assert.ok(SCHEMA.includes(`'${k}'`), `${k} missing from the CHECK`);
    }
  });

  it("keys reactions so a double tap cannot double count", () => {
    assert.match(SCHEMA, /PRIMARY KEY \(message_id, user_id, emoji\)/);
  });

  it("cascades reactions when a message goes", () => {
    assert.match(SCHEMA, /message_id\s+BIGINT NOT NULL REFERENCES messages\(id\) ON DELETE CASCADE/);
  });
});

describe("reading a thread", () => {
  it("hides expired media but keeps the row", () => {
    assert.match(REPO, /expires_at IS NULL OR expires_at > NOW\(\)/);
  });

  it("loads reactions for the whole page in one query", () => {
    // Per-message queries would be one round trip per bubble.
    assert.match(REPO, /WHERE message_id = ANY\(\$1::bigint\[\]\)/);
  });

  it("returns the pinned card separately from the scroll", () => {
    assert.match(REPO, /pinned,/);
  });

  it("survives a reactions failure rather than losing the thread", () => {
    const fn = REPO.slice(REPO.indexOf("async function attachReactions"));
    assert.match(fn.slice(0, 1200), /catch \(err\)/);
  });
});

describe("pinning", () => {
  it("replaces rather than appends, inside a transaction", () => {
    // Two pinned ledgers would show the buyer two sets of agreed terms --
    // the exact dispute the ledger exists to prevent.
    const fn = REPO.slice(REPO.indexOf("export async function pinMessage"));
    assert.match(fn.slice(0, 1600), /withTransaction/);
    assert.match(fn.slice(0, 1600), /is_pinned = FALSE/);
  });
});

describe("system cards fail soft", () => {
  it("never throws back into the payment that triggered it", () => {
    const fn = REPO.slice(REPO.indexOf("export async function postSystemCard"));
    assert.match(fn.slice(0, 1400), /catch \(err\)/);
    assert.match(fn.slice(0, 1400), /return null/);
  });
});
