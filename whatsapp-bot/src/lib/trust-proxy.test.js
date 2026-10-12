import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { DEFAULT_TRUST_PROXY, trustedProxySetting } from "./trust-proxy.js";

const require = createRequire(import.meta.url);

describe("trustedProxySetting", () => {
  it("trusts only loopback by default", () => {
    assert.equal(trustedProxySetting({}), DEFAULT_TRUST_PROXY);
    assert.equal(trustedProxySetting({ TRUST_PROXY: "" }), "loopback");
  });

  it("refuses hop counts and true (CVE-2026-90711)", () => {
    assert.equal(trustedProxySetting({ TRUST_PROXY: "1" }), "loopback");
    assert.equal(trustedProxySetting({ TRUST_PROXY: "2" }), "loopback");
    assert.equal(trustedProxySetting({ TRUST_PROXY: "true" }), "loopback");
    assert.equal(trustedProxySetting({ TRUST_PROXY: "TRUE" }), "loopback");
  });

  it("refuses a wildcard internet subnet", () => {
    assert.equal(trustedProxySetting({ TRUST_PROXY: "0.0.0.0/0" }), "loopback");
    assert.equal(trustedProxySetting({ TRUST_PROXY: "::/0" }), "loopback");
  });

  it("allows named hops and explicit loopback CIDR", () => {
    assert.equal(trustedProxySetting({ TRUST_PROXY: "loopback" }), "loopback");
    assert.deepEqual(trustedProxySetting({ TRUST_PROXY: "loopback, uniquelocal" }), [
      "loopback",
      "uniquelocal",
    ]);
    assert.equal(trustedProxySetting({ TRUST_PROXY: "127.0.0.1" }), "127.0.0.1");
  });
});

describe("proxy-addr pin", () => {
  it("is 2.0.8 or newer", () => {
    const { version } = require("proxy-addr/package.json");
    const [major, minor, patch] = String(version)
      .split(".")
      .map((n) => Number(n));
    assert.ok(
      major > 2 || (major === 2 && (minor > 0 || patch >= 8)),
      `proxy-addr@${version} is below 2.0.8`
    );
  });
});
