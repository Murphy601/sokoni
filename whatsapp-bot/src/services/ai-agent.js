/**
 * Phase 7 — Unified AI agent (WhatsApp + web) with shared tool layer.
 * Chat goes through llm-router (Groq → Gemini → OpenRouter). Never Ollama for WA traffic.
 */
import { config } from "../config.js";
import { getSession, pushMessage, isHumanHandoff, resolveThreadId, getCustomerMeta } from "./session.js";
import { channelPrompt, offTopicRedirect, buildGroundedSystemPrompt } from "./ai-prompts.js";
import { prefersKiswahiliReply } from "./shopper-language.js";
import {
  formatToolResultsForPrompt,
  isGreetingIntent,
  isSupportIntent,
  isGuideIntent,
  isShoppingIntent,
  isSellerTopic,
  isOffTopicIntent,
  isContactInfoIntent,
  isHowItWorksIntent,
} from "./ai-tools.js";
import { formatWhatsAppLink, humanHandoffAck, supportContactCard, howItWorksMessage } from "./trust-copy.js";
import { runAgentGraph } from "./agent-graph.js";
import {
  llmRouterMeta,
  routedChatCompletion,
  chatTemperature,
  buildChatProviderChain,
} from "./llm-router.js";
import { GOODWILL_VOUCHER_CAP_KES } from "./agent-specialists.js";
import { normalizeBotMessageSpacing, formatWhatsAppText } from "./whatsapp.js";

/** Free models sometimes echo planning / system rules instead of answering. */
const INSTRUCTION_LEAK =
  /\b(?:we need to answer|must not add unasked|max(?:imum)?\s*(?:length|of)?\s*2[-–—]?\s*3\s*sentences|under\s*\d+\s*words|no fluff|strict conversational rules|single-message principle|no greeting fluff|provide explanation of escrow|output only the customer|never quote(?:\,| or)? paraphrase|these (?:rules|instructions)|system prompt|as an ai language model)\b/i;

function looksLikeInstructionLeak(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (INSTRUCTION_LEAK.test(t)) return true;
  // Model "tool call" dumps / truncated numbered lists are not shopper answers
  if (/^\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
  if (/^\s*```?(?:json)?\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
  // Meta-planning about how to answer, not the answer itself
  if (/^(?:okay[,.]?\s*)?(?:so[,.]?\s*)?(?:i (?:should|must|need to)|let me|the (?:user|customer) asked)/i.test(t) &&
      /\b(?:concise|brief|sentences?|words?|fluff|follow-?ups?)\b/i.test(t)) {
    return true;
  }
  return false;
}

function sanitizeReply(text) {
  if (!text) return null;
  if (/fruit|vegetable|veggie|produce only|fresh produce/i.test(text)) return null;
  // Unescape literal \n before filtering so paragraph structure survives
  let cleaned = formatWhatsAppText(String(text));
  if (!cleaned) return null;
  // Drop planning / rule-echo lines — keep blank lines between kept paragraphs
  cleaned = cleaned
    .split(/\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // preserve paragraph gaps
      return !looksLikeInstructionLeak(t);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned || looksLikeInstructionLeak(cleaned)) return null;
  if ((cleaned.match(/\*/g) || []).length % 2 !== 0) {
    cleaned = cleaned.replace(/\*+\s*$/, "");
  }
  return cleaned;
}

const FLUFF_SENTENCE =
  /^(?:hello[!.,]?\s*)?(?:hi[!.,]?\s*)?(?:i hope (?:this|you|that)[^.!?]*[.!?]|thank you for (?:choosing|contacting|reaching out to) sokoni[^.!?]*[.!?]|i(?:'d| would) be delighted[^.!?]*[.!?]|hope (?:this|that) helps[^.!?]*[.!?]|(?:let me know if you need|is there anything else|would you (?:also )?like)[^.!?]*[.!?])\s*/i;

const STEP_LEAD = /^([1-9]\uFE0F?\u20E3|[1-9][.)]\s|•\s)/u;
const BOSS_SALUTE = /^(Yes,\s*Boss\.|Right away,\s*Boss\.|On it,\s*Boss\.|Yes,\s*Chief\.)/i;

/**
 * Join sentences for WhatsApp without flattening into a wall of text.
 * - Steps / bullets → blank line
 * - Boss salute → blank line after
 * - allowLonger (admin / escrow answers) → paragraph break between sentences
 * - Short shopper replies → single spaces (still fixed by normalizeBotMessageSpacing)
 */
function joinReplySentences(sentences, channel, { allowLonger = false } = {}) {
  if (channel !== "whatsapp") return sentences.join(" ");
  let out = "";
  for (const s of sentences) {
    if (!out) {
      out = s;
      continue;
    }
    const lastLine = out.split(/\n/).pop() || "";
    if (STEP_LEAD.test(s) || BOSS_SALUTE.test(lastLine) || allowLonger || sentences.length >= 3) {
      out += `\n\n${s}`;
    } else {
      out += ` ${s}`;
    }
  }
  return out;
}

/**
 * Hard brevity guard after the model (WhatsApp notifications must fit one glance).
 * Prefer complete sentences — never slice mid-word / mid-thought (that looked like
 * "unfinished" replies when max_tokens was too low and this guard word-chopped).
 * WhatsApp: preserve / restore paragraph line-breaks (do not mash into one wall).
 */
export function enforceReplyBrevity(text, channel = "whatsapp", { allowLonger = false } = {}) {
  let cleaned = sanitizeReply(text);
  if (!cleaned) return null;

  // Budgets are soft caps after the model finishes; keep them high enough for
  // escrow / logistics answers without mid-sentence cuts.
  const maxWords = allowLonger
    ? channel === "web"
      ? 130
      : 95
    : channel === "web"
      ? 90
      : 60;
  const maxChars = allowLonger
    ? channel === "web"
      ? 900
      : 650
    : channel === "web"
      ? 600
      : 420;
  const maxSentences = allowLonger ? 6 : 4;

  // Prefer paragraph-aware trimming when the model already used blank lines
  const paragraphs = cleaned.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (channel === "whatsapp" && paragraphs.length >= 2) {
    const keptParas = [];
    let wordCount = 0;
    let sentenceCount = 0;
    for (const para of paragraphs) {
      const sents = para
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !FLUFF_SENTENCE.test(s));
      const use = sents.length ? sents.join(" ") : para;
      const words = use.split(/\s+/).filter(Boolean).length;
      const nextSentences = sentenceCount + Math.max(sents.length, 1);
      if (keptParas.length && (wordCount + words > maxWords || nextSentences > maxSentences)) break;
      keptParas.push(use);
      wordCount += words;
      sentenceCount = nextSentences;
      if (wordCount >= maxWords || sentenceCount >= maxSentences) break;
    }
    cleaned = (keptParas.length ? keptParas : [paragraphs[0]]).join("\n\n").trim();
    if (cleaned.length > maxChars) {
      // Trim trailing paragraphs rather than mid-sentence chop
      while (cleaned.length > maxChars && cleaned.includes("\n\n")) {
        cleaned = cleaned.slice(0, cleaned.lastIndexOf("\n\n")).trim();
      }
    }
    if (looksLikeInstructionLeak(cleaned)) return null;
    if (!cleaned) return null;
    return normalizeBotMessageSpacing(cleaned);
  }

  // Strip corporate fluff sentences (leading / trailing / mid-stack).
  let sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(
      (s) =>
        !FLUFF_SENTENCE.test(s) &&
        !/let me know if you need|is there anything else|would you also like|hope you are having|thank you for choosing sokoni|delighted to assist/i.test(
          s
        )
    );

  if (!sentences.length) {
    sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
  }

  cleaned = joinReplySentences(sentences.slice(0, maxSentences), channel, { allowLonger }).trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    // Always cut on a sentence boundary — never mid-phrase word chop.
    const kept = [];
    for (const s of sentences.slice(0, maxSentences)) {
      const next = joinReplySentences([...kept, s], channel, { allowLonger });
      if (next.split(/\s+/).filter(Boolean).length > maxWords) break;
      kept.push(s);
    }
    cleaned = joinReplySentences(kept.length ? kept : [sentences[0] || cleaned], channel, {
      allowLonger,
    });
    if (!/[.!?…]$/.test(cleaned)) cleaned += ".";
  }
  if (cleaned.length > maxChars) {
    const cut = cleaned.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    // Prefer a full sentence; if none fit, keep the first sentence whole.
    if (lastStop > 40) {
      cleaned = cut.slice(0, lastStop + 1).trim();
    } else {
      cleaned = (sentences[0] || cut.replace(/\s+\S*$/, "")).trim();
      if (!/[.!?…]$/.test(cleaned)) cleaned += ".";
    }
  }
  if (looksLikeInstructionLeak(cleaned)) return null;
  if (!cleaned) return null;
  // Fail-safe: restore paragraph / keycap spacing for WhatsApp
  return channel === "whatsapp" ? normalizeBotMessageSpacing(cleaned) : cleaned;
}

function formatProductLine(p, channel = "whatsapp", index = 0) {
  const price = `KES ${Number(p.priceKes).toLocaleString()}`;
  const vibe = p.isSecondhand ? " · pre-loved" : "";
  if (channel === "web") {
    return `${index + 1}. ${p.name} — ${price}${vibe}`;
  }
  return `• *${p.name}* — ${price}${vibe}`;
}

function extractBudgetFromText(text) {
  const under = String(text || "").match(/(?:under|chini ya|below|less than)\s*(?:kes\s*)?(\d[\d,]*)\s*k?/i);
  if (under) return Number(under[1].replace(/,/g, ""));
  return null;
}

function emptyCatalogReply(channel, userMessage = "", toolResult = null) {
  const budget = extractBudgetFromText(userMessage);
  const aisle = toolResult?.label || toolResult?.browseLabel || toolResult?.browseCategory || "";
  const budgetBit = Number.isFinite(budget) ? ` under KES ${budget.toLocaleString()}` : "";
  const aisleBit = aisle ? ` in ${aisle}` : "";
  if (channel === "web") {
    return `No live Sokoni listings match that${aisleBit}${budgetBit} right now. Try another keyword or browse sokonimall.com — I only show current stock.`;
  }
  return `No live listings match that${aisleBit}${budgetBit} right now. Try different words or type *menu* — I only show current stock.`;
}

function storeInfoOffline(r, channel, userMessage = "") {
  const lower = String(userMessage || "").toLowerCase();
  if (/\b(sell|seller hub|listing|payout|withdraw|drop-?off|commission|inventory|stock units?)\b/i.test(lower)) {
    return channel === "web"
      ? `Seller Hub (sokonimall.com/suppliers/list.html) covers Hub Drop-Offs, stock units, WhatsApp promo, orders, and M-Pesa Ledger. ${r?.sellerHub || ""} What do you need — listing, drop-off, or payouts?`.replace(/\s+/g, " ").trim()
      : `*Seller Hub* — drop-offs, stock units, promo, orders, M-Pesa Ledger. Listing, pickup, or payouts?`;
  }
  if (/\b(account|sign ?up|sign ?in|log ?in|register|password)\b/i.test(lower)) {
    return channel === "web"
      ? `Create a free account at sokonimall.com/login — same login works for buyers and sellers. Sellers also use Seller Hub for listings and payouts.`
      : `Sign up free on sokonimall.com/login — buyers and sellers use the same account.`;
  }
  if (/\b(dispute|refund|return|scam|safe|trust)\b/i.test(lower)) {
    return `Your M-Pesa payment stays in Sokoni prepaid escrow until delivery is confirmed. If something goes wrong, open a dispute — never pay personal numbers or private tills.`;
  }
  if (/\b(deliver|shipping|dispatch|courier|pickup|hub|boda|ship)\b/i.test(lower)) {
    const note = String(r?.deliveryNote || "").trim();
    return note
      ? `${note} Checkout stays 100% prepaid M-Pesa escrow — never pay riders for the item itself.`
      : `Sellers dispatch via Sokoni Mashinani hubs countrywide after prepaid M-Pesa escrow. Track with your SKN order ID.`;
  }
  if (/\b(track|tracking|order status|skn-)\b/i.test(lower)) {
    return channel === "web"
      ? `Paste your SKN-#### (or SKN-####-n) and I can check status — or open sokonimall.com/track.html.`
      : `Send your *SKN-####* / *SKN-####-n* to track, or type *track*.`;
  }
  if (/\b(categor|aisle|what (can|do) (i|you) (buy|sell|find)|what do you (sell|have))\b/i.test(lower)) {
    return channel === "web"
      ? `Browse live aisles on sokonimall.com or ask me for a category (e.g. women dresses, thrift, electronics). I only show current Sokoni stock.`
      : `Ask for a category or type *menu* — live Sokoni stock only.`;
  }
  // Escrow / prepaid / how it works / general Sokoni
  if (channel === "web") {
    return `You pay by M-Pesa STK when you order; Sokoni holds that money in prepaid escrow until delivery is confirmed, then releases the seller payout. No COD — never send money to personal tills or numbers. Ask me anything else about Sokoni.`;
  }
  return `Sokoni is *100% prepaid* via M-Pesa STK — escrow until you confirm delivery. No COD. Never pay personal numbers. Ask me anything about Sokoni.`;
}

function conversationalReply(channel, userMessage = "", toolResults = []) {
  const wa = formatWhatsAppLink();
  const store = toolResults.find((r) => r.tool === "store_info");
  const tax = toolResults.find((r) => r.tool === "browse_taxonomy");
  const topAisles = (tax?.categories || [])
    .filter((c) => !c.navOnly)
    .slice(0, 4)
    .map((c) => c.label)
    .filter(Boolean);

  if (isSupportIntent(userMessage)) {
    const handoff = humanHandoffAck(false);
    const card = supportContactCard(channel);
    return channel === "web"
      ? `${handoff}\n\n${card}`
      : `${handoff}\n\n${card}`;
  }

  if (isSellerTopic(userMessage)) {
    return channel === "web"
      ? `Seller Hub (sokonimall.com/suppliers/list.html) covers Hub Drop-Offs, stock units, WhatsApp promo, orders, and M-Pesa Ledger. Are you listing, scheduling a drop-off, or checking payouts?`
      : `*Seller Hub* — drop-offs, stock units, promo, orders, M-Pesa Ledger. Listing, pickup, or payouts?`;
  }

  if (isGuideIntent(userMessage)) {
    const aisleBit = topAisles.length ? ` Popular aisles: ${topAisles.join(", ")}.` : "";
    return channel === "web"
      ? `Here's how to buy on Sokoni: (1) browse live listings on sokonimall.com or ask me for a category, (2) Order on WhatsApp, (3) pay M-Pesa STK — funds stay in prepaid escrow until delivery is confirmed.${aisleBit} What do you want to shop?`
      : `To buy: browse (*menu* or ask me), order on WhatsApp, pay M-Pesa STK — escrow until delivery.${aisleBit} What are you looking for?`;
  }

  if (isGreetingIntent(userMessage)) {
    const lower = String(userMessage || "").toLowerCase();
    if (/\b(how are you|how're you|how are u|uko aje|what'?s up)\b/i.test(lower)) {
      return channel === "web"
        ? `Niko poa — thanks for asking! I'm Sokoni Plug — I can chat about shopping, prepaid escrow, tracking, or selling on Seller Hub. What do you need?`
        : `Niko poa! Ask me to browse, *track* an SKN-####, or help you sell — what's up?`;
    }
    if (/^(thanks|thank you|asante)/i.test(lower)) {
      return channel === "web"
        ? `Karibu! Ask anytime about live stock, escrow, tracking, or selling on Sokoni.`
        : `Karibu! Type *menu* when you're ready, or ask about escrow / track.`;
    }
    return channel === "web"
      ? `Poa! I'm here to chat about Sokoni — live stock, escrow, tracking, or Seller Hub. What are you looking for?`
      : `Poa! Ask for an item or category, *track* an SKN-####, or type *menu* to browse.`;
  }

  if (store) {
    return storeInfoOffline(store, channel, userMessage);
  }
  return null;
}

function offlineReply(toolResults, channel, userMessage = "") {
  const chatty = conversationalReply(channel, userMessage, toolResults);
  if (
    chatty &&
    (isGreetingIntent(userMessage) ||
      isSupportIntent(userMessage) ||
      isGuideIntent(userMessage) ||
      !isShoppingIntent(userMessage))
  ) {
    // Prefer conversational answers unless this is clearly a product hunt with hits.
    const hasLiveHits = toolResults.some(
      (r) =>
        (r.tool === "search_products" || r.tool === "browse_products") &&
        (r.products || []).some((p) => p && p.inStock !== false)
    );
    if (!hasLiveHits) return chatty;
  }

  for (const r of toolResults) {
    if (r.tool === "open_return_case" && r.message) {
      return r.message;
    }
    if (r.tool === "list_seller_orders" && r.message) {
      return r.message;
    }
    if (r.tool === "get_seller_payout" && (r.message || r.ok)) {
      return r.message || `Payout summary ready in Seller Hub.`;
    }
    if (r.tool === "get_seller_onboarding" && r.steps?.length) {
      return (
        `To start selling:\n` +
        r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") +
        (r.note ? `\n${r.note}` : "")
      );
    }
    if (r.tool === "get_shipping_rates" && r.howToSet?.length) {
      return (
        `Set delivery prices in Seller Hub:\n` +
        r.howToSet.map((s, i) => `${i + 1}. ${s}`).join("\n")
      );
    }
    if (r.tool === "track_order" && r.tracking) {
      const t = r.tracking;
      const steps = (t.shipmentTimeline || [])
        .map((s) => `${s.done ? "✅" : s.active ? "🔵" : "⚪"} ${s.label}`)
        .join("\n");
      const rider =
        t.riderName || t.riderPhone
          ? `\nRider: ${t.riderName || "—"} ${t.riderPhone || ""}`
          : "";
      const eta = t.etaNote ? `\nETA: ${t.etaNote}` : "";
      return (
        `📦 *${t.orderId}*\n${t.productName}\n${t.paymentLine}\n\n${steps || t.shipmentStatusLabel}` +
        rider +
        eta +
        `\n\n` +
        (channel === "web" ? `Order on WhatsApp for support.` : `_Type *menu* for help._`)
      );
    }
    if (r.tool === "list_orders" && r.orders?.length) {
      return (
        `📦 *Your orders:*\n\n` +
        r.orders.map((o) => `*${o.id}* · ${o.productName} · ${o.shipmentStatus || o.status}`).join("\n") +
        `\n\nType an order number for details.`
      );
    }
  }

  // Catalog tools (including zero hits) — never invent deleted/old stock.
  for (const r of toolResults) {
    if (r.tool === "get_product") {
      if (r.ok && r.product && r.product.inStock !== false) {
        const p = r.product;
        return (
          `*${p.name}* — KES ${Number(p.priceKes).toLocaleString()}` +
          (p.isSecondhand ? " · pre-loved" : "") +
          (channel === "web" ? `. Order on WhatsApp from the listing.` : `. Reply *order* or open the picker.`)
        );
      }
      return channel === "web"
        ? `That item is not live on Sokoni right now. Search another keyword or browse sokonimall.com.`
        : `That item is not live right now. Type *menu* to browse current stock.`;
    }
    if (r.tool === "search_products" || r.tool === "browse_products") {
      const live = (r.products || []).filter((p) => p && p.inStock !== false);
      if (live.length) {
        const n = Math.min(3, live.length);
        if (channel === "whatsapp") {
          return `Found *${n}* live match${n === 1 ? "" : "es"}. Reply with the *number* to view & order, or *menu*.`;
        }
        const aisle = r.label || r.browseLabel || "";
        const lines = live.slice(0, 3).map((p, i) => formatProductLine(p, channel, i));
        return (
          `${aisle ? `In ${aisle} — ` : ""}Found ${n} live:\n${lines.join("\n")}\n` +
          `Order on WhatsApp from the listing. Current stock only.`
        );
      }
      // Only show empty-stock when the shopper was actually hunting products
      if (isShoppingIntent(userMessage)) {
        return emptyCatalogReply(channel, userMessage, r);
      }
    }
  }

  if (chatty) return chatty;

  for (const r of toolResults) {
    if (r.tool === "browse_taxonomy" && r.categories?.length) {
      const top = r.categories
        .filter((c) => !c.navOnly)
        .slice(0, 3)
        .map((c) => c.label)
        .join(", ");
      return channel === "web"
        ? `Top aisles: ${top}. Ask for one (e.g. "women dresses") or browse sokonimall.com.`
        : `Aisles include ${top}. Type a category or *menu*.`;
    }
    if (r.tool === "store_info") {
      return storeInfoOffline(r, channel, userMessage);
    }
  }
  return channel === "web"
    ? "Tell me what you want (e.g. denim under KES 3,000) or paste an SKN-#### to track. I can also explain escrow, delivery, or how to order."
    : "Type *menu* to browse, send your *SKN-####*, or ask about escrow / delivery.";
}

async function callLLM(messages, { channel = "whatsapp", allowLonger = false } = {}) {
  // Headroom so the model finishes sentences; enforceReplyBrevity trims cleanly after.
  // (Previously 120–180 WhatsApp tokens → frequent mid-sentence stop on free models.)
  const configured = Number(config.aiChat?.maxTokens);
  const maxTokens = Number.isFinite(configured) && configured > 0
    ? Math.min(800, Math.max(200, Math.floor(configured)))
    : allowLonger
      ? channel === "web"
        ? 520
        : 480
      : channel === "web"
        ? 360
        : 320;

  // Low temperature everywhere — consistent buyer/seller replies (no creative drift).
  const temperature = chatTemperature();
  const result = await routedChatCompletion(messages, { maxTokens, temperature });
  const reply = enforceReplyBrevity(result.content, channel, { allowLonger });
  if (!reply) throw new Error("Empty/leaked reply after brevity enforce");
  console.log(
    `[ai-agent] replied via ${result.provider}/${result.model} (temp=${temperature}, max_tokens=${maxTokens}${
      result.finishReason ? `, finish=${result.finishReason}` : ""
    })`
  );
  return reply;
}

function sanitizeHistory(history = []) {
  // Last 6 turns only — enough continuity without bloating TTFT on free models.
  return (history || [])
    .filter((m) => m && m.content && !looksLikeInstructionLeak(m.content))
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: String(m.content).length > 600 ? `${String(m.content).slice(0, 600)}…` : m.content,
    }));
}

/**
 * One agent turn — shared by WhatsApp and web.
 * Default: real LLM conversation for any Sokoni Mall question, with live tools.
 * Catalog search only when shopping; never invent stock. Off-topic → redirect.
 */
export async function runAgentTurn({
  channel = "whatsapp",
  sessionKey,
  userMessage,
  phone = "",
  history = null,
  persist = true,
  isAdmin = false,
}) {
  const text = String(userMessage || "").trim();
  if (!text) return { reply: "Send a message to get started.", tools: [] };

  if (channel === "whatsapp" && isHumanHandoff(sessionKey)) {
    return { reply: null, tools: [], handoff: true };
  }

  let adminSender = Boolean(isAdmin);
  let founderBoss = false;
  let staff = null;
  if (channel === "whatsapp" && (phone || sessionKey)) {
    try {
      const { isAdminSender } = await import("./admin.js");
      const { resolveStaffRole } = await import("./staff-roles.js");
      const { checkIfBoss } = await import("../lib/phone-normalize.js");
      console.log("[ai-agent] Incoming Phone:", phone || "(empty)", "sessionKey:", sessionKey);
      founderBoss = checkIfBoss(phone || sessionKey);
      const isStaffPhone = isAdminSender(sessionKey, phone);
      staff = await resolveStaffRole(phone || sessionKey);
      if (founderBoss && !staff) {
        staff = {
          phone: String(phone || "").replace(/\D/g, ""),
          role: "SUPER_ADMIN",
          displayName: "Boss",
          source: "hardwire",
        };
      }
      // Staff can skip shopper HITL / use tools — but Boss LLM persona is founder-only
      adminSender = Boolean(isAdmin || founderBoss || isStaffPhone || staff);
      console.log(
        "[ai-agent] founderBoss?:",
        founderBoss,
        "staff?:",
        staff?.role || "none",
        staff?.source || ""
      );
    } catch {
      /* ignore */
    }
  }

  const graph = await runAgentGraph({
    text,
    phone,
    customerKey: sessionKey,
    isSellerSession: isSellerTopic(text),
  });
  const { escalation, specialist, specialistHint, tools: toolResults, knowledge, knowledgeBlock, handoffSummary } =
    graph;

  // Boss / staff never hit shopper HITL escalation
  if (adminSender && escalation?.escalate) {
    escalation.escalate = false;
  }

  // High + medium (angry) → human-in-the-loop with priority inbox ticket
  if (escalation.escalate && channel === "whatsapp" && !adminSender) {
    try {
      const { startHumanHandoff } = await import("./handoff.js");
      await startHumanHandoff(sessionKey, {
        chatId: sessionKey,
        phone,
        priority: escalation.priority || "high",
        escalationReason: escalation.reason,
        lastMessage: `[AI escalation:${escalation.reason}] ${text.slice(0, 200)}\n${handoffSummary}`,
      });
    } catch (err) {
      console.warn("[ai-agent] escalation handoff failed:", err.message);
    }
    const wa = formatWhatsAppLink();
    const reply =
      escalation.severity === "high"
        ? `I take this seriously — I've escalated to Sokoni Mall Management.\n` +
          `A senior teammate will review the logs and follow up shortly.\n` +
          (channel === "web" ? `WhatsApp: ${wa}` : `Hang tight — an admin will reply here.`)
        : `I've connected you to a human — this needs the support team.\n` +
          (channel === "web" ? `WhatsApp: ${wa}` : `Hang tight — an admin will reply here.`);
    if (persist) pushMessage(sessionKey, "user", text);
    if (persist) pushMessage(sessionKey, "assistant", reply);
    return {
      reply,
      tools: [],
      handoff: true,
      escalation,
      specialist,
      graph: graph.graph,
    };
  }

  // Boss / staff: never escalate to HITL on ourselves; skip RAG knowledge (causes canned refusals)
  const knowledgeForPrompt = adminSender ? "" : knowledgeBlock;
  const specialistForPrompt = adminSender ? "" : specialistHint;

  const toolBlock = formatToolResultsForPrompt(toolResults);
  let userContextBlock = "";
  try {
    const { buildUserContextBlock } = await import("./ai-user-context.js");
    userContextBlock = await buildUserContextBlock({ phone, customerKey: sessionKey });
  } catch (err) {
    console.warn("[ai-agent] user context skipped:", err.message);
  }

  // Zero-leak safety net: admin probes never reach the public LLM
  if (channel === "whatsapp" && !adminSender) {
    try {
      const { looksLikeAdminProbe, PUBLIC_SHOP_REPLY } = await import("./boss-intercept.js");
      if (looksLikeAdminProbe(text)) {
        if (persist) pushMessage(sessionKey, "user", text);
        if (persist) pushMessage(sessionKey, "assistant", PUBLIC_SHOP_REPLY);
        return {
          reply: PUBLIC_SHOP_REPLY,
          tools: [],
          adminCommand: false,
          specialist,
          graph: graph.graph,
        };
      }
    } catch (err) {
      console.warn("[ai-agent] public admin-probe gate:", err.message);
    }
  }

  // Staff / Boss freeform: intercept master verbs again (safety net if webhook missed)
  if (adminSender && channel === "whatsapp") {
    try {
      const {
        isMasterCommand,
        softMapSpokenToMasterCommand,
        executeMasterAdminCommand,
      } = await import("./admin-override.js");
      const mapped =
        softMapSpokenToMasterCommand(text) || (isMasterCommand(text) ? text : null);
      if (mapped) {
        if (!founderBoss && !staff) {
          const { PUBLIC_SHOP_REPLY } = await import("./boss-intercept.js");
          if (persist) pushMessage(sessionKey, "user", text);
          if (persist) pushMessage(sessionKey, "assistant", PUBLIC_SHOP_REPLY);
          return { reply: PUBLIC_SHOP_REPLY, tools: [], adminCommand: false, specialist, graph: graph.graph };
        }
        const result = await executeMasterAdminCommand(mapped, {
          adminLabel: phone || sessionKey || "boss",
          actorPhone: phone || "",
          requireStaff: true,
          founderBoss,
          source: "ai-agent.safety-net",
        });
        const reply =
          result?.reply || (founderBoss ? "Yes, Boss." : "Done.");
        if (persist) pushMessage(sessionKey, "user", text);
        if (persist) pushMessage(sessionKey, "assistant", reply);
        return { reply, tools: [], adminCommand: true, specialist, graph: graph.graph };
      }
    } catch (err) {
      console.warn("[ai-agent] boss interceptor:", err.message);
    }
  }

  const shopping = isShoppingIntent(text);
  const hasLiveCatalogHits = toolResults.some(
    (r) =>
      (r.tool === "search_products" || r.tool === "browse_products") &&
      (r.products || []).some((p) => p && p.inStock !== false)
  );
  const trackingPayload = toolResults.find((r) => r.tool === "track_order")?.tracking || null;

  const session = channel === "whatsapp" ? getSession(sessionKey) : null;
  const hist = history || session?.history || [];

  if (persist && channel === "whatsapp") {
    pushMessage(sessionKey, "user", text);
  }

  // Clear non-Sokoni world chat only
  if (isOffTopicIntent(text)) {
    const reply = offTopicRedirect(channel);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return {
      reply,
      tools: toolResults,
      offline: true,
      offTopic: true,
      products: [],
      tracking: null,
    };
  }

  // DETERMINISTIC contact card — email / phone / customer care (no LLM guess)
  if (isContactInfoIntent(text)) {
    const reply = supportContactCard(channel);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    console.log("[ai-agent] contact card (no LLM)");
    return {
      reply,
      tools: toolResults,
      products: [],
      tracking: trackingPayload,
      contactCard: true,
      specialist,
      graph: graph.graph,
      threadId: resolveThreadId(phone || sessionKey),
    };
  }

  // DETERMINISTIC how-it-works card — spaced steps (no LLM wall of text)
  if (isHowItWorksIntent(text)) {
    const reply = howItWorksMessage(channel);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    console.log("[ai-agent] how-it-works card (no LLM)");
    return {
      reply,
      tools: toolResults,
      products: [],
      tracking: trackingPayload,
      howItWorksCard: true,
      specialist,
      graph: graph.graph,
      threadId: resolveThreadId(phone || sessionKey),
    };
  }

  // DETERMINISTIC dispute protocol — never let the LLM soften / skip DB + alerts
  const disputeResult = toolResults.find(
    (r) => r.tool === "open_return_case" && r.message && (r.ok || r.needsOrderId || r.deterministic)
  );
  if (disputeResult?.message) {
    const reply = disputeResult.message;
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    console.log(
      `[ai-agent] dispute protocol (no LLM): order=${disputeResult.orderId || "—"} dispute=${
        disputeResult.disputeId || "—"
      } payoutHeld=${Boolean(disputeResult.payoutHeld)}`
    );
    return {
      reply,
      tools: toolResults,
      products: [],
      tracking: trackingPayload,
      specialist,
      disputeProtocol: true,
      payoutHeld: Boolean(disputeResult.payoutHeld),
      disputeId: disputeResult.disputeId || null,
      escalation: escalation.escalate ? escalation : undefined,
      graph: graph.graph,
      threadId: resolveThreadId(phone || sessionKey),
    };
  }

  // DETERMINISTIC seller shop orders — never let the LLM invent SK-#### / fake items
  const sellerOrdersResult = toolResults.find(
    (r) => r.tool === "list_seller_orders" && r.message && r.deterministic
  );
  if (sellerOrdersResult?.message) {
    const reply = sellerOrdersResult.message;
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    console.log(
      `[ai-agent] seller shop orders (no LLM): shop=${sellerOrdersResult.shopHandle || "—"} count=${
        sellerOrdersResult.count ?? 0
      }`
    );
    return {
      reply,
      tools: toolResults,
      products: [],
      tracking: trackingPayload,
      specialist,
      sellerShopOrders: true,
      graph: graph.graph,
      threadId: resolveThreadId(phone || sessionKey),
    };
  }

  const products =
    toolResults.find((r) => r.tool === "browse_products" && r.products?.length)?.products ||
    toolResults.find((r) => r.tool === "search_products" && r.products?.length)?.products ||
    [];

  // No chat provider configured → deterministic fallback (still answers Sokoni topics via tools)
  if (!buildChatProviderChain().length) {
    const reply = offlineReply(toolResults, channel, text);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return {
      reply,
      tools: toolResults,
      offline: true,
      catalog: shopping,
      products,
      tracking: trackingPayload,
    };
  }

  const threadId = resolveThreadId(phone || sessionKey);
  const preferKiswahili =
    Boolean(getCustomerMeta(sessionKey)?.preferKiswahiliReply) || prefersKiswahiliReply(text);

  // Default path: LLM answers every Sokoni question using tool results (site facts, taxonomy, stock, tracking).
  try {
    const messages = [
      {
        role: "system",
        content: founderBoss
          ? `CRITICAL EXCEPTION RULE: You are speaking directly to THE BOSS (+254757764009). DO NOT check any knowledge base. DO NOT say you lack details. DO NOT use public escrow refusals. Start EVERY reply with "Yes, Boss." or "Right away, Boss." After the salute, put a blank line, then short paragraphs (2–3 sentences max) separated by blank lines. Use • bullets for lists — never one wall of text. If they asked for a mutation, tell them the exact command (*FORCE RELEASE SKN-…*, *!help*) — the code interceptor executes mutations, not you.\n\n${buildGroundedSystemPrompt({
              channel,
              contextBlocks: [userContextBlock, toolBlock].filter(Boolean),
              threadId,
              preferKiswahili: false,
              isAdmin: true,
              staff,
              senderPhone: phone || threadId,
            })}`
          : buildGroundedSystemPrompt({
              channel,
              contextBlocks: adminSender
                ? [userContextBlock, toolBlock].filter(Boolean)
                : [
                    specialistForPrompt,
                    userContextBlock,
                    knowledgeForPrompt,
                    toolBlock,
                  ].filter(Boolean),
              threadId,
              preferKiswahili: adminSender ? false : preferKiswahili,
              isAdmin: Boolean(adminSender && !founderBoss),
              staff: founderBoss ? staff : adminSender ? staff : null,
              senderPhone: phone || threadId,
            }),
      },
      ...sanitizeHistory(hist),
      { role: "user", content: text },
    ];

    const allowLonger = true;
    const conversational = !shopping || !hasLiveCatalogHits;
    let reply = await callLLM(messages, {
      channel,
      allowLonger,
    });

    if (!reply) {
      reply = offlineReply(toolResults, channel, text);
    }

    reply =
      enforceReplyBrevity(reply || offlineReply(toolResults, channel, text), channel, {
        allowLonger,
      }) || offlineReply(toolResults, channel, text);

    if (persist && channel === "whatsapp" && reply) {
      pushMessage(sessionKey, "assistant", reply);
    }

    return {
      reply,
      tools: toolResults,
      products,
      converse: conversational,
      shopping,
      tracking: trackingPayload,
      specialist,
      knowledge: knowledge.map((k) => k.id),
      escalation: escalation.escalate ? escalation : undefined,
      graph: graph.graph,
      threadId,
      llm: llmRouterMeta(),
    };
  } catch (err) {
    console.error("[ai-agent] error:", err.message);
    // Phase 3: MAS chat failover only when flag on AND primary LLM path failed
    try {
      const { tryMasChatFailover } = await import("./mas/assist.js");
      const mas = await tryMasChatFailover([
        { role: "user", content: text },
      ]);
      if (mas?.content) {
        const reply =
          enforceReplyBrevity(mas.content, channel, { allowLonger: true }) ||
          offlineReply(toolResults, channel, text);
        if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
        return {
          reply,
          tools: toolResults,
          products,
          tracking: trackingPayload,
          masFailover: true,
          error: err.message,
        };
      }
    } catch (masErr) {
      console.warn("[ai-agent] MAS chat failover skipped:", masErr.message);
    }
    const reply = offlineReply(toolResults, channel, text);
    if (persist && channel === "whatsapp") pushMessage(sessionKey, "assistant", reply);
    return { reply, tools: toolResults, products, tracking: trackingPayload, error: err.message };
  }
}

export function agentMeta() {
  return {
    phase: 7.3,
    name: "Sokoni Plug",
    engine: "node-specialist-router",
    specialists: ["buyer", "seller", "dispute", "logistics", "general"],
    knowledge:
      "chunked knowledge/*.md + optional pgvector platform_knowledge; product search = keyword + optional product_search_embeddings",
    routing: llmRouterMeta(),
    temperature: chatTemperature(),
    guardrails: {
      goodwillCapKes: GOODWILL_VOUCHER_CAP_KES,
      sentimentEscalation: true,
      hitlPriorities: ["normal", "high"],
      grounding: "context_and_tools_only",
    },
    channels: ["whatsapp", "web"],
    tools: [
      "search_products",
      "browse_products",
      "browse_taxonomy",
      "get_product",
      "track_order",
      "list_orders",
      "list_seller_orders",
      "store_info",
      "open_return_case",
      "get_seller_onboarding",
      "get_seller_payout",
      "get_shipping_rates",
      "propose_goodwill",
      "create_checkout_link",
      "update_inventory",
      "dispatch_with_rider",
      "verify_payment_code",
      "check_aup",
    ],
    threadId: "whatsapp_sender_phone",
    commerceOps: true,
    endpoints: {
      chat: "/api/agent/chat",
      meta: "/api/agent/meta",
    },
    configured: Boolean(
      config.groq?.apiKey || config.gemini?.apiKey || config.openai?.apiKey
    ),
  };
}

export { looksLikeInstructionLeak, storeInfoOffline };
