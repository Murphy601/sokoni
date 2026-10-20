import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hostnameIsLoopback,
  hostnameIsPrivateOrMetadata,
  isAllowlistedOutboundUrl,
  isSellerMediaUrl,
  isOpsMediaUrl,
} from "./outbound-url.js";

describe("outbound URL allowlist", () => {
  it("allows Sokoni Cloudinary and site hosts", () => {
    assert.equal(
      isAllowlistedOutboundUrl("https://res.cloudinary.com/rztynxme/image/upload/v1/cutout.jpg"),
      true
    );
    assert.equal(isAllowlistedOutboundUrl("https://bot.sokonimall.com/catalog-images/pt-1.jpg"), true);
    assert.equal(isAllowlistedOutboundUrl("https://sokonimall.com/assets/images/products/a.jpg"), true);
    assert.equal(isSellerMediaUrl("https://res.cloudinary.com/rztynxme/image/upload/v1/a.jpg"), true);
    assert.equal(isOpsMediaUrl("https://res.cloudinary.com/rztynxme/image/upload/v1/a.jpg"), true);
  });

  it("rejects unknown hosts, credentials, and non-http schemes", () => {
    assert.equal(isAllowlistedOutboundUrl("https://evil.example/itel.jpg"), false);
    assert.equal(isSellerMediaUrl("https://evil.example/itel.jpg"), false);
    assert.equal(isAllowlistedOutboundUrl("https://user:pass@res.cloudinary.com/x.jpg"), false);
    assert.equal(isAllowlistedOutboundUrl("file:///etc/passwd"), false);
    assert.equal(isAllowlistedOutboundUrl("not-a-url"), false);
  });

  it("rejects loopback, RFC1918, link-local, and cloud metadata", () => {
    assert.equal(hostnameIsLoopback("localhost"), true);
    assert.equal(hostnameIsLoopback("127.0.0.1"), true);
    assert.equal(hostnameIsPrivateOrMetadata("10.0.0.5"), true);
    assert.equal(hostnameIsPrivateOrMetadata("192.168.1.1"), true);
    assert.equal(hostnameIsPrivateOrMetadata("172.16.4.1"), true);
    assert.equal(hostnameIsPrivateOrMetadata("169.254.169.254"), true);
    assert.equal(hostnameIsPrivateOrMetadata("metadata.google.internal"), true);
    assert.equal(hostnameIsPrivateOrMetadata("2130706433"), true);

    assert.equal(isAllowlistedOutboundUrl("http://127.0.0.1:5432/"), false);
    assert.equal(isAllowlistedOutboundUrl("http://localhost:3000/secret"), false);
    assert.equal(isAllowlistedOutboundUrl("http://169.254.169.254/latest/meta-data/"), false);
    assert.equal(isAllowlistedOutboundUrl("http://10.0.0.8:8080/"), false);
    assert.equal(isAllowlistedOutboundUrl("http://192.168.0.2/logo.png"), false);
  });

  it("blocks seller loopback in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.equal(isSellerMediaUrl("http://127.0.0.1/admin"), false);
      assert.equal(isSellerMediaUrl("http://localhost:8080/logo.png"), false);
    } finally {
      if (prev == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("does not treat Cloudinary subdomains of an attacker host as allowlisted", () => {
    assert.equal(isAllowlistedOutboundUrl("https://res.cloudinary.com.evil.test/x.jpg"), false);
    assert.equal(isAllowlistedOutboundUrl("https://sokonimall.com.evil.test/x.jpg"), false);
  });
});
