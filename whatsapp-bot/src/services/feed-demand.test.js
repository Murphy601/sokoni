import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "feed-events.json");
const BACKUP = `${EVENTS_FILE}.demandtest-bak`;

const NOW = 1_700_000_000_000;
const MIN = 60_000;

/** Newest-first, like the live log. */
function evt(type, productId, sessionId, agoMin) {
  return {
    id: `fe_${type}_${productId}_${sessionId}_${agoMin}`,
    type,
    sessionId,
    productId,
    category: null,
    query: null,
    meta: null,
    at: NOW - agoMin * MIN,
  };
}

const FIXTURE = [
  // hb-1: four distinct viewers inside the hour, one repeat, one stale
  evt("view", "hb-1", "s1", 5),
  evt("view", "hb-1", "s1", 7),
  evt("click", "hb-1", "s2", 10),
  evt("view", "hb-1", "s3", 20),
  evt("view", "hb-1", "s4", 40),
  evt("save", "hb-1", "s2", 12),
  evt("save", "hb-1", "s3", 21),
  evt("view", "hb-1", "s9", 90),
  // hb-2: saved then unsaved by the same session
  evt("save", "hb-2", "s5", 5),
  evt("unsave", "hb-2", "s5", 4),
  evt("view", "hb-2", "s5", 6),
  // hb-3: anonymous views (no sessionId)
  evt("view", "hb-3", null, 3),
  evt("view", "hb-3", null, 4),
  evt("view", "hb-3", null, 5),
  // hb-4: saved, unsaved, then saved again -- newest wins, so it counts
  evt("save", "hb-4", "s6", 10),
  evt("unsave", "hb-4", "s6", 8),
  evt("save", "hb-4", "s6", 3),
].sort((a, b) => b.at - a.at);

let mod;

before(async () => {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(EVENTS_FILE)) renameSync(EVENTS_FILE, BACKUP);
  writeFileSync(EVENTS_FILE, JSON.stringify({ events: FIXTURE }, null, 2));
  mod = await import("./feed-events.js");
});

after(() => {
  try {
    rmSync(EVENTS_FILE, { force: true });
    if (existsSync(BACKUP)) renameSync(BACKUP, EVENTS_FILE);
  } catch {
    /* best effort */
  }
});

describe("product demand signals", () => {
  it("counts distinct sessions, not raw hits", () => {
    const d = mod.getProductDemand("hb-1", { now: NOW });
    // s1 viewed twice but is one viewer; s9 is outside the hour
    assert.equal(d.viewers, 4);
  });

  it("treats a click as a view", () => {
    const d = mod.getProductDemand("hb-1", { now: NOW });
    assert.ok(d.viewers >= 4, "s2 only clicked, still a viewer");
  });

  it("excludes events outside the window", () => {
    const wide = mod.getProductDemand("hb-1", { now: NOW, windowMs: 3 * 60 * MIN });
    assert.equal(wide.viewers, 5, "s9 is inside a 3h window");
  });

  it("nets off an unsave from the same session", () => {
    const d = mod.getProductDemand("hb-2", { now: NOW });
    assert.equal(d.saves, 0);
  });

  it("counts a re-save after an unsave", () => {
    const d = mod.getProductDemand("hb-4", { now: NOW });
    assert.equal(d.saves, 1, "newest event for the session is a save");
  });

  it("counts anonymous views individually", () => {
    const d = mod.getProductDemand("hb-3", { now: NOW });
    assert.equal(d.viewers, 3);
  });

  it("returns zeros for an unknown product", () => {
    const d = mod.getProductDemand("does-not-exist", { now: NOW });
    assert.deepEqual({ viewers: d.viewers, saves: d.saves }, { viewers: 0, saves: 0 });
  });

  it("returns zeros for a blank id rather than throwing", () => {
    const d = mod.getProductDemand("", { now: NOW });
    assert.equal(d.viewers, 0);
  });

  it("batch matches single lookups", () => {
    const batch = mod.getProductDemandBatch(["hb-1", "hb-2", "hb-3", "hb-4"], { now: NOW });
    for (const id of ["hb-1", "hb-2", "hb-3", "hb-4"]) {
      const one = mod.getProductDemand(id, { now: NOW });
      assert.deepEqual(batch[id], { viewers: one.viewers, saves: one.saves }, id);
    }
  });

  it("batch tolerates an empty list", () => {
    assert.deepEqual(mod.getProductDemandBatch([], { now: NOW }), {});
  });
});

describe("demand tags", () => {
  it("stays silent below the floor", () => {
    assert.deepEqual(mod.demandTags({ viewers: 2, saves: 1 }), []);
  });

  it("shows viewers once the floor is cleared", () => {
    const tags = mod.demandTags({ viewers: 12, saves: 0 });
    assert.equal(tags.length, 1);
    assert.equal(tags[0].id, "viewers");
    assert.match(tags[0].label, /12 buyers viewed this in the last hour/);
  });

  it("shows both tags when both clear", () => {
    const ids = mod.demandTags({ viewers: 9, saves: 4 }).map((t) => t.id);
    assert.deepEqual(ids, ["viewers", "saves"]);
  });

  it("never renders a negative or fractional count", () => {
    const tags = mod.demandTags({ viewers: -5, saves: 4.6 });
    assert.equal(tags.find((t) => t.id === "viewers"), undefined);
    assert.match(tags.find((t) => t.id === "saves").label, /5 people/);
  });
});
