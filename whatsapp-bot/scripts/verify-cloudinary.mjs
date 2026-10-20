#!/usr/bin/env node
/**
 * Verify Cloudinary credentials in whatsapp-bot/.env (no image processing).
 * Run on the VM: node scripts/verify-cloudinary.mjs
 */
import "dotenv/config";

const cloud = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const key = String(process.env.CLOUDINARY_API_KEY || "").trim();
const secret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

if (!cloud || !key || !secret) {
  console.error("FAIL: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
  process.exit(1);
}

const auth = Buffer.from(`${key}:${secret}`).toString("base64");
const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/usage`, {
  headers: { Authorization: `Basic ${auth}` },
});
const text = await res.text();
if (!res.ok) {
  console.error(`FAIL: Cloudinary ${res.status}`);
  console.error(text.slice(0, 400));
  if (/api_secret mismatch|Invalid Signature|401/i.test(text) || res.status === 401) {
    console.error("\nFix: Cloudinary Console → Settings → Product Environment Settings → API Keys");
    console.error("Copy Cloud name, API Key, and API Secret (reveal) into whatsapp-bot/.env, then redeploy.");
  }
  process.exit(1);
}

const data = JSON.parse(text);
console.log("OK: Cloudinary credentials valid");
console.log(`  cloud: ${cloud}`);
console.log(`  plan: ${data.plan || "unknown"}`);
console.log(`  credits: ${data.credits?.usage ?? "?"}/${data.credits?.limit ?? "?"}`);
