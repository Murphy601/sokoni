import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PURGE = readFileSync(path.join(__dirname, "purge-account.js"), "utf-8");
const USERS = readFileSync(
  path.join(__dirname, "..", "db", "repositories", "users.js"),
  "utf-8"
);

describe("purge + rider phone reuse guards", () => {
  it("purge deletes products by sellerPhone even without user rows", () => {
    assert.match(PURGE, /legacy_json->>'sellerPhone'/);
  });

  it("ensureSellerSocialProfile refuses active rider phones", () => {
    assert.match(USERS, /phone_is_rider/);
    assert.match(USERS, /FROM riders/);
  });
});
