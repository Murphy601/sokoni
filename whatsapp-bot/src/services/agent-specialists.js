/**
 * Agentic specialists — routing, escalation, knowledge RAG-lite, goodwill guardrail.
 * Paired with agent-graph.js (LangGraph-style) + llm-router.js (LiteLLM-style).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge");

/** Goodwill voucher auto-cap (KES) — anything higher needs human admin. */
export const GOODWILL_VOUCHER_CAP_KES = 300;

const ESCALATION_RE =
  /\b(lawyer|police|fraud|scam|sue|court|cid|dci|interpol|threaten|kill|weapon|bomb|lawsuit|suing)\b/i;
const ANGER_RE =
  /\b(useless|idiot|thief|steal(ing)?|ripoff|rip-off|worst|angry|furious|refund now|money back now)\b/i;

export function detectEscalation(text) {
  const t = String(text || "");
  if (ESCALATION_RE.test(t)) {
    return { escalate: true, reason: "sensitive_keyword", severity: "high", priority: "high" };
  }
  if (ANGER_RE.test(t)) {
    return { escalate: true, reason: "angry_language", severity: "medium", priority: "high" };
  }
  return { escalate: false, priority: "normal" };
}

/**
 * Route to a specialist lane (prompt + tool allowlist).
 * @returns {"buyer"|"seller"|"dispute"|"logistics"|"general"}
 */
export function routeSpecialist(text, { isSellerSession = false } = {}) {
  const lower = String(text || "").toLowerCase();
  if (
    /\b(dispute|refund|missing package|not received|wrong item|damaged|chargeback|escrow hold|money back|return)\b/i.test(
      lower
    )
  ) {
    return "dispute";
  }
  if (
    /\b(track|tracking|rider|courier|dispatch|shipment|delivery status|out for delivery|where is my (package|order|parcel))\b/i.test(
      lower
    )
  ) {
    return "logistics";
  }
  if (
    isSellerSession ||
    /\b(payout|withdraw|my shop|list(ing)?|seller|vendor|stock|inventory|promo|till|paybill|commission|fee|register as (a )?seller|onboard|shipping rate|delivery price|upcountry)\b/i.test(
      lower
    )
  ) {
    return "seller";
  }
  if (
    /\b(buy|order|price|kes|dress|shoe|search|find|recommend|under|budget|size|colour|color|headphones|nairobi)\b/i.test(
      lower
    )
  ) {
    return "buyer";
  }
  return "general";
}

const SPECIALIST_HINTS = {
  buyer:
    "SPECIALIST: Buyer Agent — shop, recommend from TOOL RESULTS only, track orders. Never invent stock or prices. Include product links when tools return ids.",
  seller:
    "SPECIALIST: Seller Agent — onboarding SOP, payouts, shipping zones. Use get_seller_* tools. Point to Seller Hub for edits. Never invent balances.",
  dispute:
    "SPECIALIST: Dispute Agent — for damaged/refund use open_return_case when an SKN order id is present. Hold payout; ask for photos. Never invent refunds. Legal/fraud → human.",
  logistics:
    "SPECIALIST: Logistics — use track_order. Share rider/courier/ETA from tools only.",
  general:
    "SPECIALIST: General concierge — short helpful answers; use store_info + catalog tools.",
};

export function specialistSystemHint(lane) {
  return SPECIALIST_HINTS[lane] || SPECIALIST_HINTS.general;
}

const KNOWLEDGE_FILES = [
  "returns-policy.md",
  "seller-payouts.md",
  "buyer-trust.md",
  "vendor-terms.md",
  "seller-onboarding.md",
  "shipping-sop.md",
];

/** Prefer docs by specialist lane. */
const LANE_DOCS = {
  seller: ["seller-onboarding.md", "seller-payouts.md", "shipping-sop.md", "vendor-terms.md"],
  dispute: ["returns-policy.md", "buyer-trust.md"],
  logistics: ["shipping-sop.md", "buyer-trust.md"],
  buyer: ["buyer-trust.md", "returns-policy.md"],
  general: KNOWLEDGE_FILES,
};

/** Load markdown knowledge docs. Fail-soft if missing. */
export function loadKnowledgeDocs({ specialist = "general" } = {}) {
  const prefer = LANE_DOCS[specialist] || KNOWLEDGE_FILES;
  const ordered = [...new Set([...prefer, ...KNOWLEDGE_FILES])];
  const docs = [];
  for (const name of ordered) {
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
 * Chunk docs into ~500-char windows for better keyword / future pgvector recall.
 */
function chunkDoc(doc) {
  const size = 500;
  const chunks = [];
  const text = doc.text;
  if (text.length <= size) return [{ id: doc.id, text }];
  for (let i = 0; i < text.length; i += size - 80) {
    chunks.push({ id: `${doc.id}#${chunks.length}`, text: text.slice(i, i + size) });
  }
  return chunks;
}

/**
 * Keyword RAG-lite (pgvector-ready shape). Optional: swap scoring for embedding cosine later.
 */
export function retrieveKnowledge(query, { limit = 2, specialist = "general" } = {}) {
  const docs = loadKnowledgeDocs({ specialist });
  if (!docs.length) return [];
  const chunks = docs.flatMap(chunkDoc);
  const tokens = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) {
    return chunks.slice(0, 1).map((d) => ({ id: d.id, excerpt: d.text.slice(0, 700) }));
  }

  const scored = chunks.map((d) => {
    const lower = d.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t)) score += 1;
    }
    return { ...d, score };
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
    message: `Goodwill voucher up to KES ${n} is within the auto cap (max ${GOODWILL_VOUCHER_CAP_KES}). Ops must confirm before issuing.`,
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
