import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-json.js";

function scratch() {
  return mkdtempSync(path.join(tmpdir(), "sokoni-atomic-"));
}

describe("writeJsonAtomic", () => {
  it("writes parseable JSON and leaves no temp behind", () => {
    const dir = scratch();
    const file = path.join(dir, "orders.json");
    try {
      assert.equal(writeJsonAtomic(file, { seq: 3, orders: [{ id: "SKN-1001" }] }), true);
      const back = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(back.seq, 3);
      assert.equal(back.orders[0].id, "SKN-1001");
      assert.deepEqual(
        readdirSync(dir).filter((f) => f.endsWith(".tmp")),
        []
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces an existing file without truncating it first", () => {
    const dir = scratch();
    const file = path.join(dir, "settlements.json");
    try {
      writeJsonAtomic(file, { payouts: ["a", "b", "c"] });
      writeJsonAtomic(file, { payouts: ["z"] });
      const back = JSON.parse(readFileSync(file, "utf8"));
      assert.deepEqual(back.payouts, ["z"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the parent directory", () => {
    const dir = scratch();
    const file = path.join(dir, "nested", "deep", "store.json");
    try {
      assert.equal(writeJsonAtomic(file, { ok: true }), true);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false instead of throwing when the value is not serialisable", () => {
    const dir = scratch();
    const file = path.join(dir, "cyclic.json");
    try {
      const cyclic = { name: "loop" };
      cyclic.self = cyclic;
      assert.equal(writeJsonAtomic(file, cyclic), false);
      assert.deepEqual(
        readdirSync(dir).filter((f) => f.endsWith(".tmp")),
        []
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the previous file readable when a write fails", () => {
    const dir = scratch();
    const file = path.join(dir, "orders.json");
    try {
      writeJsonAtomic(file, { orders: [{ id: "SKN-1002" }] });
      const cyclic = {};
      cyclic.self = cyclic;
      writeJsonAtomic(file, cyclic);
      // Old content survives — this is the whole point versus writeFileSync.
      const back = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(back.orders[0].id, "SKN-1002");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites a half-written file from a previous crash", () => {
    const dir = scratch();
    const file = path.join(dir, "orders.json");
    try {
      writeFileSync(file, '{"orders":[{"id":"SKN-10');
      assert.throws(() => JSON.parse(readFileSync(file, "utf8")));
      writeJsonAtomic(file, { orders: [] });
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).orders, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
