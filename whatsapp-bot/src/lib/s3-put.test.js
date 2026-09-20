import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signPut, encodeKey, s3ConfigFromEnv } from "../../../scripts/lib/s3-put.mjs";

const FIXED = new Date("2026-09-20T03:04:05.000Z");
const BASE = {
  endpoint: "https://acct123.r2.cloudflarestorage.com",
  bucket: "sokoni-backups",
  key: "sokoni-data-20260920-030405.tar.gz.enc",
  body: Buffer.from("pretend archive bytes"),
  accessKey: "AKIAEXAMPLE",
  secretKey: "secretExampleKey",
  now: FIXED,
};

describe("encodeKey", () => {
  it("keeps path separators but escapes the segments", () => {
    assert.equal(encodeKey("a/b c/d"), "a/b%20c/d");
  });

  it("escapes the characters encodeURIComponent leaves alone", () => {
    assert.equal(encodeKey("file(1)!*'.txt"), "file%281%29%21%2A%27.txt");
  });
});

describe("signPut", () => {
  it("builds a path-style URL", () => {
    const { url } = signPut(BASE);
    assert.equal(
      url,
      "https://acct123.r2.cloudflarestorage.com/sokoni-backups/sokoni-data-20260920-030405.tar.gz.enc"
    );
  });

  it("sets the SigV4 header set it claims to sign", () => {
    const { headers } = signPut(BASE);
    assert.equal(headers["x-amz-date"], "20260920T030405Z");
    assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260920\/auto\/s3\/aws4_request/);
    assert.match(
      headers.Authorization,
      /SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date/
    );
    assert.equal(headers["content-length"], String(BASE.body.length));
  });

  it("hashes the real payload, not a placeholder", () => {
    const { headers } = signPut(BASE);
    // sha256 of the body, not UNSIGNED-PAYLOAD
    assert.match(headers["x-amz-content-sha256"], /^[0-9a-f]{64}$/);
    const other = signPut({ ...BASE, body: Buffer.from("different") });
    assert.notEqual(headers["x-amz-content-sha256"], other.headers["x-amz-content-sha256"]);
  });

  it("is deterministic for the same inputs", () => {
    assert.equal(signPut(BASE).headers.Authorization, signPut(BASE).headers.Authorization);
  });

  it("changes the signature when the body changes", () => {
    const a = signPut(BASE).headers.Authorization;
    const b = signPut({ ...BASE, body: Buffer.from("tampered") }).headers.Authorization;
    assert.notEqual(a, b);
  });

  it("changes the signature when the secret changes", () => {
    const a = signPut(BASE).headers.Authorization;
    const b = signPut({ ...BASE, secretKey: "other" }).headers.Authorization;
    assert.notEqual(a, b);
  });

  it("honours a non-default region", () => {
    const { headers } = signPut({ ...BASE, region: "us-east-1" });
    assert.match(headers.Authorization, /\/20260920\/us-east-1\/s3\//);
  });
});

describe("s3ConfigFromEnv", () => {
  it("reports every missing piece rather than just the first", () => {
    const { configured, missing } = s3ConfigFromEnv({});
    assert.equal(configured, false);
    assert.deepEqual(missing, ["endpoint", "bucket", "accessKey", "secretKey"]);
  });

  it("defaults region to auto for R2", () => {
    const { cfg } = s3ConfigFromEnv({
      SOKONI_BACKUP_S3_ENDPOINT: "https://x.r2.cloudflarestorage.com",
      SOKONI_BACKUP_S3_BUCKET: "b",
      SOKONI_BACKUP_S3_ACCESS_KEY: "k",
      SOKONI_BACKUP_S3_SECRET_KEY: "s",
    });
    assert.equal(cfg.region, "auto");
  });

  it("treats whitespace-only values as missing", () => {
    const { configured, missing } = s3ConfigFromEnv({
      SOKONI_BACKUP_S3_ENDPOINT: "  ",
      SOKONI_BACKUP_S3_BUCKET: "b",
      SOKONI_BACKUP_S3_ACCESS_KEY: "k",
      SOKONI_BACKUP_S3_SECRET_KEY: "s",
    });
    assert.equal(configured, false);
    assert.deepEqual(missing, ["endpoint"]);
  });

  it("is configured when all four are present", () => {
    const { configured } = s3ConfigFromEnv({
      SOKONI_BACKUP_S3_ENDPOINT: "https://x.r2.cloudflarestorage.com",
      SOKONI_BACKUP_S3_BUCKET: "b",
      SOKONI_BACKUP_S3_ACCESS_KEY: "k",
      SOKONI_BACKUP_S3_SECRET_KEY: "s",
    });
    assert.equal(configured, true);
  });
});
