#!/usr/bin/env node
/** Smoke test Gemini vision API (requires GEMINI_API_KEY in whatsapp-bot/.env). */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geminiVisionAvailable, geminiVisionListingJson } from "../src/services/gemini-vision.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!geminiVisionAvailable()) {
    console.error("FAIL: GEMINI_API_KEY not set in whatsapp-bot/.env");
    process.exit(1);
  }

  const samplePath = process.argv[2];
  let buffer;
  let mimeType = "image/jpeg";

  if (samplePath) {
    buffer = await readFile(samplePath);
    if (samplePath.endsWith(".png")) mimeType = "image/png";
  } else {
    // 1×1 red JPEG
    buffer = Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64"
    );
  }

  const prompt =
    'Reply ONLY JSON: {"name":"Test product","sourcePriceKes":100,"category":"fashion","subcategory":"shoes","condition":"brand_new_without_tags","isSecondhand":false,"description":"Test"}';

  console.log("Calling Gemini vision…");
  const { parsed, model } = await geminiVisionListingJson({ prompt, imageBuffer: buffer, mimeType });
  console.log("OK via", model);
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
