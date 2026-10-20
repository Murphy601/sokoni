/**
 * Minimal SigV4 PUT for S3-compatible object storage (Cloudflare R2, AWS S3, B2).
 *
 * Node built-ins only — the bot VM is a 1GB box and off-site backups are not
 * worth an aws-cli or rclone install. scripts/sync/lib/sigv4.mjs is not reusable
 * here: it hardcodes the PA-API header set.
 *
 * Usage (as a CLI, which is how backup-bot-data.sh calls it):
 *   node scripts/lib/s3-put.mjs <localFile> <objectKey>
 *
 * Env:
 *   SOKONI_BACKUP_S3_ENDPOINT    https://<account>.r2.cloudflarestorage.com
 *   SOKONI_BACKUP_S3_BUCKET      sokoni-backups
 *   SOKONI_BACKUP_S3_ACCESS_KEY
 *   SOKONI_BACKUP_S3_SECRET_KEY
 *   SOKONI_BACKUP_S3_REGION      default "auto" (what R2 expects)
 */
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();

/** RFC3986 escaping for a path segment — S3 signs the encoded form. */
export function encodeKey(key) {
  return String(key)
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    )
    .join("/");
}

/**
 * Build the signed headers for a single-shot PUT.
 *
 * @param {{ endpoint: string, bucket: string, key: string, body: Buffer,
 *           accessKey: string, secretKey: string, region?: string,
 *           contentType?: string, now?: Date }} input
 * @returns {{ url: string, headers: Record<string,string> }}
 */
export function signPut({
  endpoint,
  bucket,
  key,
  body,
  accessKey,
  secretKey,
  region = "auto",
  contentType = "application/octet-stream",
  now = new Date(),
}) {
  const base = new URL(endpoint);
  const host = base.host;
  // Path-style: /<bucket>/<key>. R2 and S3 both accept it and it avoids
  // bucket-name-in-hostname rules (dots, length) biting us.
  const uri = `/${encodeKey(bucket)}/${encodeKey(key)}`;

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `content-length:${body.length}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = ["PUT", uri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  let signingKey = hmac(`AWS4${secretKey}`, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    url: `${base.origin}${uri}`,
    headers: {
      "content-length": String(body.length),
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Read the S3 config from env, or say which pieces are missing. */
export function s3ConfigFromEnv(env = process.env) {
  const cfg = {
    endpoint: (env.SOKONI_BACKUP_S3_ENDPOINT || "").trim(),
    bucket: (env.SOKONI_BACKUP_S3_BUCKET || "").trim(),
    accessKey: (env.SOKONI_BACKUP_S3_ACCESS_KEY || "").trim(),
    secretKey: (env.SOKONI_BACKUP_S3_SECRET_KEY || "").trim(),
    region: (env.SOKONI_BACKUP_S3_REGION || "auto").trim() || "auto",
  };
  const missing = ["endpoint", "bucket", "accessKey", "secretKey"].filter((k) => !cfg[k]);
  return { cfg, missing, configured: missing.length === 0 };
}

async function main() {
  const [file, key] = process.argv.slice(2);
  if (!file || !key) {
    console.error("usage: node scripts/lib/s3-put.mjs <localFile> <objectKey>");
    process.exit(2);
  }

  const { cfg, missing, configured } = s3ConfigFromEnv();
  if (!configured) {
    console.error(`[s3-put] not configured — missing: ${missing.join(", ")}`);
    process.exit(3);
  }

  const body = await readFile(path.resolve(file));
  const { url, headers } = signPut({ ...cfg, key, body });

  const res = await fetch(url, { method: "PUT", headers, body });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    console.error(`[s3-put] ${res.status} ${res.statusText} ${detail}`);
    process.exit(1);
  }
  console.log(`[s3-put] uploaded ${key} (${body.length} bytes)`);
}

// Only run the CLI when invoked directly, so tests can import the signer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[s3-put]", err?.message || err);
    process.exit(1);
  });
}
