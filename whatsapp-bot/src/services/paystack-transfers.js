/**
 * Paystack — buyer M-Pesa STK (Charge API) + seller M-Pesa payouts (Transfers).
 *
 * @see https://paystack.com/docs/payments/payment-channels/
 * @see https://paystack.com/docs/transfers/single-transfers/
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const PAYSTACK_API = "https://api.paystack.co";

/** Safaricom / CBK M-Pesa caps (cannot be raised by Paystack). */
export const MPESA_PER_TX_LIMIT_KES = 250_000;
export const MPESA_DAILY_LIMIT_KES = 500_000;

/** Reject placeholders, public keys, and truncated secrets. */
export function isUsablePaystackSecret(raw) {
  const key = String(raw || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!key) return false;
  if (key.includes("...") || key.includes("…")) return false;
  if (/^pk_/i.test(key)) return false;
  return /^sk_(live|test)_[A-Za-z0-9]{16,}$/.test(key);
}

export function isPaystackReady() {
  return isUsablePaystackSecret(config.paystack?.secretKey);
}

export function isPaystackCollectReady() {
  return isPaystackReady() && config.paystack?.collect !== false;
}

/** Paystack Starter Business cannot call Transfers / third-party payouts. */
export function isPaystackStarterPayoutBlock(raw) {
  const text = String(raw || "");
  return /third party payouts as a starter/i.test(text) || /starter business/i.test(text);
}

export function paystackTransfersEnabled() {
  return isPaystackReady() && config.paystack?.transfers !== false && config.paystack?.withdrawInstant !== false;
}

export function paystackMeta() {
  return {
    ready: isPaystackReady(),
    collectReady: isPaystackCollectReady(),
    collectRail: config.paystack?.collectRail || "paystack",
    withdrawInstant: Boolean(paystackTransfersEnabled()),
    payoutRail: config.paystack?.payoutRail || "paystack",
    transfers: config.paystack?.transfers !== false,
    only: config.paystack?.only !== false,
    webhookUrl: config.paystack?.webhookUrl || null,
    hasPublicKey: Boolean(config.paystack?.publicKey),
  };
}

function darajaAllowed() {
  return config.paystack?.only === false;
}

/** paystack (default) — Daraja only if PAYSTACK_ONLY=false. */
export function resolveCollectRail(darajaReady = false) {
  const preferred = config.paystack?.collectRail || "paystack";
  const paystackOn = isPaystackCollectReady();
  const darajaOn = Boolean(darajaReady && darajaAllowed());
  if (preferred === "manual") return "manual";
  if (preferred === "paystack") return paystackOn ? "paystack" : darajaOn ? "daraja" : "manual";
  if (preferred === "daraja") return darajaOn ? "daraja" : paystackOn ? "paystack" : "manual";
  if (paystackOn) return "paystack";
  if (darajaOn) return "daraja";
  return "manual";
}

/** paystack (default) — B2C only if PAYSTACK_ONLY=false. */
export function resolvePayoutRail(b2cReady = false) {
  const preferred = config.paystack?.payoutRail || "paystack";
  const paystackOn = paystackTransfersEnabled();
  const b2cOn = Boolean(b2cReady && config.mpesa?.withdrawInstantB2c !== false && darajaAllowed());

  if (preferred === "manual" || preferred === "admin") return "admin";
  if (preferred === "paystack") return paystackOn ? "paystack" : b2cOn ? "b2c" : "admin";
  if (preferred === "b2c") return b2cOn ? "b2c" : paystackOn ? "paystack" : "admin";
  if (paystackOn) return "paystack";
  if (b2cOn) return "b2c";
  return "admin";
}

/** Charge API wants +2547XXXXXXXX. Transfers recipients use 07xxxxxxxx. */
export function toPaystackChargePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  if (!/^254[17]\d{8}$/.test(d)) return "";
  return `+${d}`;
}

export function buyerChargeEmail(order) {
  const fromOrder = String(order?.email || order?.buyerEmail || "").trim();
  if (fromOrder.includes("@")) return fromOrder.slice(0, 80);
  const configured = String(config.paystack?.chargeEmail || "").trim();
  if (configured.includes("@")) return configured;
  const slug = String(order?.id || "buyer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || "buyer";
  return `${slug}@pay.sokonimall.com`;
}

/** Paystack Kenya mobile_money recipients use 07xxxxxxxx (local), not 254. */
export function toPaystackMpesaAccount(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("254") && d.length >= 12) d = `0${d.slice(3)}`;
  if (d.length === 9) d = `0${d}`;
  if (!/^0[17]\d{8}$/.test(d)) return "";
  return d;
}

export function splitMpesaTransferChunks(amountKes) {
  const total = Math.round(Number(amountKes) || 0);
  if (total <= 0) return [];
  const chunks = [];
  let left = total;
  while (left > 0) {
    const piece = Math.min(left, MPESA_PER_TX_LIMIT_KES);
    chunks.push(piece);
    left -= piece;
  }
  return chunks;
}

export function remainingMpesaDailyKes(sentTodayKes) {
  const sent = Math.max(0, Math.round(Number(sentTodayKes) || 0));
  return Math.max(0, MPESA_DAILY_LIMIT_KES - sent);
}

export function paystackReference({ withdrawId, orderId, chunkIndex = 0 } = {}) {
  const raw = [withdrawId, orderId, `c${chunkIndex}`, Date.now().toString(36)]
    .map((part) =>
      String(part || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "")
        .slice(0, 24)
    )
    .filter(Boolean)
    .join("-");
  return raw.slice(0, 80) || `sknwd-${Date.now().toString(36)}`;
}

export function verifyPaystackSignature(rawBody, signature, secretKey = config.paystack?.secretKey) {
  const key = String(secretKey || "").trim();
  const header = String(signature || "").trim();
  if (!key || !header) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto.createHmac("sha512", key).update(payload).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(header, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function paystackRequest(method, pathname, body) {
  if (!isPaystackReady()) {
    const err = new Error("Paystack secret key is not configured.");
    err.code = "paystack_not_configured";
    throw err;
  }
  const res = await fetch(`${PAYSTACK_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.paystack.secretKey}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    const raw = String(json.message || `Paystack HTTP ${res.status}`);
    const message = /invalid key/i.test(raw)
      ? "Paystack rejected PAYSTACK_SECRET_KEY (Invalid key). Paste the Live Secret Key that starts with sk_live_ — not pk_live_ — then pm2 restart sokoni-bot."
      : isPaystackStarterPayoutBlock(raw)
        ? "Paystack Starter Business cannot send Transfers. Upgrade to Registered Business, or we queue this for admin #paid."
        : raw;
    const err = new Error(message);
    err.code = /invalid key/i.test(raw)
      ? "paystack_invalid_key"
      : isPaystackStarterPayoutBlock(raw)
        ? "paystack_starter"
        : "paystack_http";
    err.status = res.status;
    err.paystack = json;
    throw err;
  }
  return json;
}

export async function createMpesaRecipient({ name, phone, metadata = {} } = {}) {
  const accountNumber = toPaystackMpesaAccount(phone);
  if (!accountNumber) {
    return { ok: false, error: "invalid_mpesa", message: "Enter a valid M-Pesa number (07xx or 2547xx)." };
  }
  const sellerName = String(name || "Sokoni seller").trim().slice(0, 80) || "Sokoni seller";
  try {
    const response = await paystackRequest("POST", "/transferrecipient", {
      type: "mobile_money",
      name: sellerName,
      account_number: accountNumber,
      bank_code: "MPESA",
      currency: "KES",
      metadata: {
        platform: "sokoni",
        ...metadata,
      },
    });
    const recipientCode = response?.data?.recipient_code;
    if (!recipientCode) {
      return { ok: false, error: "no_recipient", message: "Paystack did not return a recipient code." };
    }
    return {
      ok: true,
      recipientCode,
      accountNumber,
      data: response.data,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || "paystack_http",
      message: err.message || "Could not register M-Pesa recipient.",
    };
  }
}

export async function initiateKesTransfer({
  amountKes,
  recipientCode,
  reason = "Sokoni seller payout",
  reference,
} = {}) {
  const amount = Math.round(Number(amountKes) || 0);
  if (amount <= 0) {
    return { ok: false, error: "invalid_amount", message: "Transfer amount must be greater than zero." };
  }
  if (amount > MPESA_PER_TX_LIMIT_KES) {
    return {
      ok: false,
      error: "mpesa_tx_cap",
      message: `M-Pesa cap is KES ${MPESA_PER_TX_LIMIT_KES.toLocaleString()} per send — split first.`,
    };
  }
  if (!recipientCode) {
    return { ok: false, error: "missing_recipient", message: "Paystack recipient is missing." };
  }

  try {
    const response = await paystackRequest("POST", "/transfer", {
      source: "balance",
      reason: String(reason || "Sokoni seller payout").slice(0, 80),
      amount: amount * 100,
      recipient: recipientCode,
      currency: "KES",
      reference: reference || paystackReference({}),
    });
    const data = response?.data || {};
    const status = String(data.status || "").toLowerCase();
    const accepted = ["success", "pending", "otp", "received"].includes(status) || response.status === true;
    return {
      ok: accepted,
      status: status || (accepted ? "pending" : "failed"),
      reference: data.reference || reference || null,
      transferCode: data.transfer_code || null,
      amountKes: amount,
      data,
      message: response.message || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || "paystack_http",
      message: err.message || "Paystack transfer failed.",
      paystack: err.paystack || null,
    };
  }
}

export async function initiatePaystackMpesaCharge({
  email,
  amountKes,
  phone,
  reference,
  metadata = {},
} = {}) {
  const amount = Math.round(Number(amountKes) || 0);
  const chargePhone = toPaystackChargePhone(phone);
  if (amount <= 0) {
    return { ok: false, error: "invalid_amount", message: "Charge amount must be greater than zero." };
  }
  if (!chargePhone) {
    return { ok: false, error: "invalid_mpesa", message: "Enter a valid M-Pesa number (07xx or 2547xx)." };
  }
  const ref = String(reference || paystackReference({ orderId: metadata.orderId || "charge" }))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 80);
  try {
    const response = await paystackRequest("POST", "/charge", {
      email: String(email || buyerChargeEmail({ id: metadata.orderId })).slice(0, 80),
      amount: amount * 100,
      currency: "KES",
      reference: ref,
      mobile_money: {
        phone: chargePhone,
        provider: "mpesa",
      },
      metadata: {
        platform: "sokoni",
        ...metadata,
      },
    });
    const data = response?.data || {};
    const status = String(data.status || "").toLowerCase();
    const accepted = ["pay_offline", "pending", "success", "ongoing"].includes(status) || response.status === true;
    return {
      ok: accepted,
      status: status || (accepted ? "pay_offline" : "failed"),
      reference: data.reference || ref,
      displayText: data.display_text || response.message || null,
      amountKes: amount,
      phone: chargePhone,
      data,
      message: response.message || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || "paystack_http",
      message: err.message || "Paystack charge failed.",
      paystack: err.paystack || null,
    };
  }
}

export function parsePaystackChargeEvent(body) {
  const event = String(body?.event || "").trim().toLowerCase();
  const data = body?.data || {};
  if (!event.startsWith("charge.")) {
    return { valid: false, ignored: true, event };
  }
  const meta = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const amountKes = Number.isFinite(Number(data.amount))
    ? Math.round(Number(data.amount) / 100)
    : 0;
  return {
    valid: true,
    event,
    success: event === "charge.success" || String(data.status || "").toLowerCase() === "success",
    failed: event === "charge.failed" || String(data.status || "").toLowerCase() === "failed",
    reference: data.reference || null,
    amountKes,
    currency: data.currency || "KES",
    phone:
      data.authorization?.mobile_money_number ||
      data.authorization?.account_name ||
      data.customer?.phone ||
      null,
    receipt: data.gateway_response || data.reference || null,
    orderId: meta.orderId || meta.order_id || null,
    status: data.status || null,
    data,
  };
}

export function parsePaystackTransferEvent(body) {
  const event = String(body?.event || "").trim().toLowerCase();
  const data = body?.data || {};
  if (!event.startsWith("transfer.")) {
    return { valid: false, ignored: true, event };
  }
  const amountKes = Number.isFinite(Number(data.amount))
    ? Math.round(Number(data.amount) / 100)
    : 0;
  return {
    valid: true,
    event,
    success: event === "transfer.success",
    failed: event === "transfer.failed" || event === "transfer.reversed",
    reversed: event === "transfer.reversed",
    reference: data.reference || null,
    transferCode: data.transfer_code || null,
    amountKes,
    currency: data.currency || "KES",
    recipientCode: data.recipient?.recipient_code || data.recipient || null,
    status: data.status || null,
    data,
  };
}
