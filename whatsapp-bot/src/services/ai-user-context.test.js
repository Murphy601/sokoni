import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUserContextBlock } from "./ai-user-context.js";

describe("ai-user-context Layer 3", () => {
  it("returns a dynamic context block with role and command note", async () => {
    const block = await buildUserContextBlock({
      phone: "254700000000",
      customerKey: "254700000000@c.us",
    });
    assert.match(block, /DYNAMIC USER CONTEXT/);
    assert.match(block, /Role:/);
    assert.match(block, /Layer 1 commands/);
    assert.match(block, /254700000000/);
  });
});
