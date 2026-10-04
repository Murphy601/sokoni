import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { adminTokenFromReq, isAdminTokenValid, isMasterAdminToken } from "./admin-auth.js";

const ENV_KEYS = [
  "MASTER_ADMIN_SECRET",
  "ADMIN_SETUP_TOKEN",
  "SUPPLIER_ADMIN_TOKEN",
  "TIKTOK_SETUP_TOKEN",
];

const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previous[key] == null) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe("admin token", () => {
  it("accepts a configured secret and rejects a lookalike", () => {
    process.env.MASTER_ADMIN_SECRET = "master-secret-test-xyz";
    process.env.ADMIN_SETUP_TOKEN = "setup-token-test-xyz";
    assert.equal(isAdminTokenValid("master-secret-test-xyz"), true);
    assert.equal(isAdminTokenValid("setup-token-test-xyz"), true);
    assert.equal(isMasterAdminToken("master-secret-test-xyz"), true);
    assert.equal(isMasterAdminToken("setup-token-test-xyz"), false);
    assert.equal(isAdminTokenValid("master-secret-test-xyZ"), false);
    assert.equal(isAdminTokenValid(""), false);
  });

  it("ignores a token left in the query string", () => {
    process.env.MASTER_ADMIN_SECRET = "master-secret-test-xyz";
    const req = {
      headers: {},
      query: { token: "master-secret-test-xyz" },
      body: {},
    };
    assert.equal(adminTokenFromReq(req), "");
    assert.equal(isAdminTokenValid(adminTokenFromReq(req)), false);
  });

  it("reads the header", () => {
    const req = {
      headers: { "x-admin-token": "from-header" },
      query: { token: "from-query" },
      body: { token: "from-body" },
    };
    assert.equal(adminTokenFromReq(req), "from-header");
  });
});
