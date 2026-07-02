import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Turns a WhatsApp phone number into a short, non-reversible tag we can attach
 * to affiliate links as a "sub id" / sub-tag. This lets you see, inside each
 * affiliate program's dashboard, which conversations are converting — without
 * sending the customer's real phone number to a third-party site.
 */
export function subIdFor(phoneNumber) {
  return crypto
    .createHash("sha256")
    .update(String(phoneNumber))
    .digest("hex")
    .slice(0, 10);
}

/**
 * Builds a trackable affiliate URL for a given product + customer.
 *
 * NOTE: every program has its own real query-param convention for sub-ids
 * (Kilimall/Jumia give you a generated tracking link from their dashboard,
 * AliExpress/Temu/Amazon use `aff_sub`/`ascsubtag`/`tag`-style params). The
 * exact param names below are placeholders — swap them for the real ones
 * from your affiliate dashboard once you're approved on each program.
 */
export function buildAffiliateLink(product, phoneNumber) {
  const subId = subIdFor(phoneNumber);
  const url = new URL(product.sourceUrl);
  switch (product.source) {
    case "kilimall":
      url.searchParams.set("aff_id", config.affiliates.kilimall);
      url.searchParams.set("sub_id", subId);
      break;
    case "jumia":
      url.searchParams.set("affid", config.affiliates.jumia);
      url.searchParams.set("subid", subId);
      break;
    case "aliexpress":
      url.searchParams.set("aff_id", config.affiliates.aliexpress);
      url.searchParams.set("aff_sub", subId);
      break;
    case "temu":
      url.searchParams.set("aff_id", config.affiliates.temu);
      url.searchParams.set("aff_sub", subId);
      break;
    case "amazon":
      url.searchParams.set("tag", config.affiliates.amazon);
      url.searchParams.set("ascsubtag", subId);
      break;
    default:
      break;
  }
  return url.toString();
}

export const SOURCE_LABELS = {
  kilimall: "Kilimall",
  jumia: "Jumia",
  aliexpress: "AliExpress",
  temu: "Temu",
  amazon: "Amazon",
};
