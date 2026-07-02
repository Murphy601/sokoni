import crypto from "node:crypto";

const sha256hex = (data) => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();

/**
 * Signs a POST request for Amazon's Product Advertising API (PA-API 5.0) using
 * AWS Signature Version 4, and returns the full set of headers to send.
 *
 * The header set + signed-header order below is exactly what PA-API expects.
 */
export function signRequest({ host, region, service, uri, target, payload, accessKey, secretKey, method = "POST" }) {
  // e.g. 2026-07-02T22:01:42.571Z -> 20260702T220142Z
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";

  const canonicalRequest = [
    method,
    uri,
    "",
    canonicalHeaders,
    signedHeaders,
    sha256hex(payload),
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  let signingKey = hmac("AWS4" + secretKey, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, service);
  signingKey = hmac(signingKey, "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
    Authorization: authorization,
  };
}
