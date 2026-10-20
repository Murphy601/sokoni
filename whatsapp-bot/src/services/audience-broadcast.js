/**
 * Audience WhatsApp broadcasts — Sellers / Riders / Buyers.
 * Boss: BROADCAST SELLERS: … | BROADCAST RIDERS: … | BROADCAST BUYERS: …
 */
import { config } from "../config.js";
import { isDbEnabled, query } from "../db/pool.js";

export const AUDIENCE_PREFIXES = Object.freeze({
  sellers: "🛍️ Notice to Sellers: ",
  riders: "🛵 Rider Bonus: ",
  buyers: "🛒 Sokoni Deal: ",
});

export function normalizeAudience(raw) {
  const a = String(raw || "")
    .trim()
    .toLowerCase();
  if (a === "seller" || a === "sellers") return "sellers";
  if (a === "rider" || a === "riders") return "riders";
  if (a === "buyer" || a === "buyers" || a === "customer" || a === "customers") return "buyers";
  return null;
}

/** Build the outbound body with the fixed audience prefix (idempotent if already prefixed). */
export function formatAudienceMessage(audience, body) {
  const aud = normalizeAudience(audience);
  const text = String(body || "").trim();
  if (!aud || !text) return "";
  const prefix = AUDIENCE_PREFIXES[aud];
  if (text.startsWith(prefix)) return text;
  const bare = prefix.replace(/:\s*$/, "").trim();
  if (text.toLowerCase().startsWith(bare.toLowerCase())) return text;
  return `${prefix}${text}`;
}

function digitsOnly(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function nationalTail(raw) {
  const d = digitsOnly(raw);
  return d.length >= 9 ? d.slice(-9) : d;
}

function toE164Kenya(phone) {
  let d = digitsOnly(phone);
  if (!d || d.length < 9) return "";
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d;
}

function isBusinessOrAdminPhone(phone) {
  const tail = nationalTail(phone);
  if (!tail || tail.length < 9) return true;
  const business = nationalTail(config.store?.businessNumber);
  if (business && tail === business) return true;
  const adminList = [
    ...(config.admin?.phones || []),
    config.admin?.primary,
    config.contact?.founderPhone,
  ].filter(Boolean);
  return adminList.some((p) => nationalTail(p) === tail);
}

/**
 * @returns {Promise<Array<{ chatId: string, phone?: string, label?: string }>>}
 */
export async function collectAudienceRecipients(audience) {
  const aud = normalizeAudience(audience);
  if (!aud) return [];
  if (aud === "sellers") return collectSellerRecipients();
  if (aud === "riders") return collectRiderRecipients();
  return collectBuyerRecipients();
}

async function collectSellerRecipients() {
  const seen = new Set();
  const out = [];
  try {
    const { listSuppliers } = await import("./suppliers.js");
    for (const s of listSuppliers() || []) {
      if (!(s?.peerSeller || s?.role === "SELLER")) continue;
      const e164 = toE164Kenya(s.phone || s.mpesaNumber);
      if (!e164) continue;
      const tail = e164.slice(-9);
      if (seen.has(tail) || isBusinessOrAdminPhone(e164)) continue;
      seen.add(tail);
      out.push({
        chatId: `${e164}@c.us`,
        phone: e164,
        label: s.shopHandle || s.businessName || s.id,
      });
    }
  } catch (err) {
    console.warn("[audience-broadcast] sellers:", err.message);
  }
  return out;
}

async function collectRiderRecipients() {
  const seen = new Set();
  const out = [];
  if (!isDbEnabled()) return out;
  try {
    const { rows } = await query(
      `SELECT phone, full_name, verification_status
         FROM riders
        WHERE phone IS NOT NULL AND TRIM(phone) <> ''
          AND UPPER(COALESCE(verification_status, '')) NOT IN ('SUSPENDED', 'REJECTED', 'BANNED')
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 2000`
    );
    for (const r of rows) {
      const e164 = toE164Kenya(r.phone);
      if (!e164) continue;
      const tail = e164.slice(-9);
      if (seen.has(tail) || isBusinessOrAdminPhone(e164)) continue;
      seen.add(tail);
      out.push({
        chatId: `${e164}@c.us`,
        phone: e164,
        label: r.full_name || e164,
      });
    }
  } catch (err) {
    console.warn("[audience-broadcast] riders:", err.message);
  }
  return out;
}

async function collectBuyerRecipients() {
  const seen = new Set();
  const out = [];
  try {
    const { getAllContacts, listRecentOrders } = await import("./orders.js");
    const { isBroadcastOptedOut } = await import("./customer-automations.js");
    const { isAdminSender } = await import("./admin.js");

    const push = (customerKey, phone, displayName) => {
      if (!customerKey) return;
      if (seen.has(customerKey)) return;
      if (isBusinessOrAdminPhone(phone || customerKey)) return;
      try {
        if (isAdminSender(customerKey, phone)) return;
      } catch {
        /* ignore */
      }
      if (isBroadcastOptedOut(customerKey)) return;
      seen.add(customerKey);
      out.push({
        chatId: customerKey,
        phone: phone || "",
        label: displayName || customerKey,
      });
    };

    for (const c of getAllContacts()) {
      push(c.customerKey, c.phone, c.displayName);
    }
    for (const o of listRecentOrders(500)) {
      push(o.customerKey, o.phone, o.customerName);
    }
  } catch (err) {
    console.warn("[audience-broadcast] buyers:", err.message);
  }
  return out;
}

/**
 * Send audience broadcast.
 * @returns {Promise<{ ok: boolean, audience?: string, sent?: number, failed?: number, total?: number, preview?: string, message?: string, error?: string }>}
 */
export async function runAudienceBroadcast(audience, body, { dryRun = false } = {}) {
  const aud = normalizeAudience(audience);
  if (!aud) {
    return { ok: false, error: "invalid_audience", message: "Use SELLERS, RIDERS, or BUYERS." };
  }
  const preview = formatAudienceMessage(aud, body);
  if (!preview) {
    return {
      ok: false,
      error: "empty_message",
      message: `Usage: BROADCAST ${aud.toUpperCase()}: Your message here`,
    };
  }

  const recipients = await collectAudienceRecipients(aud);
  if (!recipients.length) {
    return {
      ok: true,
      audience: aud,
      sent: 0,
      failed: 0,
      total: 0,
      preview,
      message: `No ${aud} recipients found.`,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      audience: aud,
      sent: 0,
      failed: 0,
      total: recipients.length,
      preview,
      message: `Dry run — would send to *${recipients.length}* ${aud}.\n\nPreview:\n${preview}`,
    };
  }

  const { sendText } = await import("./whatsapp.js");
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await sendText(r.chatId, preview);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.warn("[audience-broadcast] send failed", aud, r.chatId, err.message);
    }
  }

  const label =
    aud === "sellers" ? "seller(s)" : aud === "riders" ? "rider(s)" : "buyer(s)";
  return {
    ok: true,
    audience: aud,
    sent,
    failed,
    total: recipients.length,
    preview,
    message:
      `📣 Broadcast to *${aud.toUpperCase()}*: sent *${sent}* / ${recipients.length} ${label}.` +
      (failed ? `\n⚠️ ${failed} failed.` : "") +
      `\n\nPreview:\n${preview}`,
  };
}
