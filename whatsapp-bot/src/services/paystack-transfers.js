/**
 * Paystack Transfers — seller payouts to Kenyan M-Pesa.
 * Buyer checkout stays on Daraja STK; this rail only sends Ready balances out.
 *
 * @see https://paystack.com/docs/transfers/single-transfers/
 * @see https://docs-v2.paystack.com/docs/transfers/creating-transfer-recipients/
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const PAYSTACK_API = "https://api.paystack.co";

/** Safaricom / CBK M-Pesa caps (cannot be raised by Paystack). */
export const MPESA_PER_TX_LIMIT_KES = 250_000;
export const MPESA_DAILY_LIMIT_KES = 500_000;

export function isPaystackReady() {
  return Boolean(String(config.paystack?.secretKey || "").trim());
}

export function paystackMeta() {
  return {
    ready: isPaystackReady(),
    withdrawInstant: Boolean(config.paystack?.withdrawInstant && isPaystackReady()),
    payoutRail: config.paystack?.payoutRail || "auto",
    webhookUrl: config.paystack?.webhookUrl || null,
    hasPublicKey: Boolean(config.paystack?.publicKey),
  };
}

/**
 * auto → Paystack when keyed (no own B2C shortcode needed), else Daraja B2C, else manual.
 */
export function resolvePayoutRail(b2cReady = false) {
  const preferred = config.paystack?.payoutRail || "auto";
  const paystackOn = isPaystackReady() && config.paystack?.withdrawInstant !== false;
  const b2cOn = Boolean(b2cReady && config.mpesa?.withdrawInstantB2c !== false);

  if (preferred === "manual") return "manual";
  if (preferred === "paystack") return paystackOn ? "paystack" : b2cOn ? "b2c" : "manual";
  if (preferred === "b2c") return b2cOn ? "b2c" : paystackOn ? "paystack" : "manual";
  if (paystackOn) return "paystack";
  if (b2cOn) return "b2c";
  return "manual";
}

/** Paystack Kenya mobile_money docs use 07xxxxxxxx (local), not 254. */
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
    const err = new Error(json.message || `Paystack HTTP ${res.status}`);
    err.code = "paystack_http";
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
