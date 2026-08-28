/**
 * Agentic layer for Sokoni Plug — specialist routing + knowledge RAG-lite + guardrails.
 * Keeps the existing tool router; adds buyer/seller/dispute specialists and escalation.
 * Models: OpenRouter (chat) + NVIDIA/Gemini (vision) — no paid LangGraph/Pinecone required.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge");

/** Goodwill voucher auto-cap (KES) — anything higher needs human admin. */
export const GOODWILL_VOUCHER_CAP_KES = 300;

const ESCALATION_RE =
  /\b(lawyer|police|fraud|scam|sue|court|cid|dci|interpol|threaten|kill|weapon|bomb)\b/i;
const ANGER_RE =
  /\b(useless|idiot|thief|steal(ing)?|ripoff|rip-off|worst|angry|furious|refund now|money back now)\b/i;

export function detectEscalation(text) {
  const t = String(text || "");
  if (ESCALATION_RE.test(t)) {
    return { escalate: true, reason: "sensitive_keyword", severity: "high" };
  }
  if (ANGER_RE.test(t)) {
    return { escalate: true, reason: "angry_language", severity: "medium" };
  }
  return { escalate: false };
}

/**
 * Route to a specialist lane (prompt + tool bias). Deterministic — free models OK.
 * @returns {"buyer"|"seller"|"dispute"|"logistics"|"general"}
 */
export function routeSpecialist(text, { isSellerSession = false } = {}) {
  const lower = String(text || "").toLowerCase();
  if (
    /\b(dispute|refund|missing package|not received|wrong item|damaged|chargeback|escrow hold)\b/i.test(
      lower
    )
  ) {
    return "dispute";
  }
  if (
    /\b(track|tracking|rider|courier|dispatch|shipment|delivery status|out for delivery|hub)\b/i.test(
      lower
    )
  ) {
    return "logistics";
  }
  if (
    isSellerSession ||
    /\b(payout|withdraw|my shop|list(ing)?|seller|vendor|stock|inventory|promo|till|paybill|commission|fee)\b/i.test(
      lower
    )
  ) {
    return "seller";
  }
  if (
    /\b(buy|order|price|kes|dress|shoe|search|find|recommend|under|budget|size|colour|color)\b/i.test(
      lower
    )
  ) {
    return "buyer";
  }
  return "general";
}

const SPECIALIST_HINTS = {
  buyer:
    "SPECIALIST: Buyer Agent — help shop, compare, track orders. Use TOOL RESULTS only for stock/prices. Never invent listings.",
  seller:
    "SPECIALIST: Seller Agent — payouts, catalog, stock, promo, shipping zones. Point to Seller Hub (sokonimall.com/suppliers/list.html) for edits. Never invent balances.",
  dispute:
    "SPECIALIST: Dispute Agent — explain escrow hold / HELP flow. Do NOT release payouts or invent refunds. Escalate angry or legal threats to human support.",
  logistics:
    "SPECIALIST: Logistics — use track_order / list_orders. Share rider/hub facts from tools only.",
  general:
    "SPECIALIST: General concierge — short helpful answers; use store_info + catalog tools.",
};

export function specialistSystemHint(lane) {
  return SPECIALIST_HINTS[lane] || SPECIALIST_HINTS.general;
}

/** Load markdown/text knowledge docs (policies). Fail-soft if missing. */
export function loadKnowledgeDocs() {
  const files = [
    "returns-policy.md",
    "seller-payouts.md",
    "buyer-trust.md",
    "vendor-terms.md",
  ];
  const docs = [];
  for (const name of files) {
    const full = path.join(KNOWLEDGE_DIR, name);
    if (!existsSync(full)) continue;
    try {
      const text = readFileSync(full, "utf-8").trim();
      if (text) docs.push({ id: name, text });
    } catch {
      /* skip */
    }
  }
  return docs;
}

/**
 * Tiny keyword RAG — pick top chunks by token overlap (no pgvector required).
 * Swap later for pgvector embeddings when DATABASE_URL has the extension.
 */
export function retrieveKnowledge(query, { limit = 2 } = {}) {
  const docs = loadKnowledgeDocs();
  if (!docs.length) return [];
  const tokens = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return docs.slice(0, 1).map((d) => ({ id: d.id, excerpt: d.text.slice(0, 600) }));

  const scored = docs.map((d) => {
    const lower = d.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t)) score += 1;
    }
    return { id: d.id, text: d.text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((d) => d.score > 0)
    .slice(0, limit)
    .map((d) => ({
      id: d.id,
      excerpt: d.text.slice(0, 800),
    }));
}

export function formatKnowledgeForPrompt(chunks) {
  if (!chunks?.length) return "";
  return (
    "KNOWLEDGE (platform policy — prefer this over guessing):\n" +
    chunks.map((c) => `[${c.id}]\n${c.excerpt}`).join("\n\n")
  );
}

/**
 * Guardrail: AI may propose goodwill ≤ KES 300; higher needs admin.
 */
export function evaluateGoodwillVoucher(amountKes) {
  const n = Math.round(Number(amountKes) || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "invalid_amount", message: "Enter a positive KES amount." };
  }
  if (n > GOODWILL_VOUCHER_CAP_KES) {
    return {
      ok: false,
      requiresHuman: true,
      capKes: GOODWILL_VOUCHER_CAP_KES,
      message: `Goodwill above KES ${GOODWILL_VOUCHER_CAP_KES} needs a human admin — use the support inbox.`,
    };
  }
  return {
    ok: true,
    amountKes: n,
    message: `Goodwill voucher up to KES ${n} is within the auto cap (max ${GOODWILL_VOUCHER_CAP_KES}). Confirm with admin ops before issuing.`,
  };
}

export function summarizeForHandoff({ text, specialist, toolNames = [] } = {}) {
  const clean = String(text || "").trim().slice(0, 280);
  return (
    `Specialist: ${specialist || "general"}\n` +
    (toolNames.length ? `Tools: ${toolNames.join(", ")}\n` : "") +
    `Last message: ${clean || "(empty)"}`
  );
}
