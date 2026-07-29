/**
 * Safaricom Daraja — OAuth, STK Push, callback parsing.
 * @see https://developer.safaricom.co.ke/
 */
import { config } from "../config.js";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

let tokenCache = { token: null, expiresAt: 0 };

function baseUrl() {
  return config.mpesa.env === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

export function isDarajaReady() {
  const m = config.mpesa;
  return Boolean(m.consumerKey && m.consumerSecret && m.passkey && m.shortcode && m.callbackUrl);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function stkPassword() {
  const shortcode = config.mpesa.shortcode;
  const passkey = config.mpesa.passkey;
  const ts = timestamp();
  const raw = shortcode + passkey + ts;
  return { password: Buffer.from(raw).toString("base64"), timestamp: ts };
}

/** Normalize to 2547XXXXXXXX for Daraja. */
export function formatMpesaPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  if (!d.startsWith("254")) d = `254${d}`;
  return d;
}

async function getAccessToken() {
  if (!isDarajaReady()) {
    throw new Error("Daraja not configured — set MPESA_* env vars");
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const auth = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Daraja OAuth failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Daraja OAuth: no access_token");
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3599) * 1000,
  };
  return data.access_token;
}

/**
 * Initiate Lipa na M-Pesa STK push.
 * @param {{ phone: string, amount: number, accountReference: string, description?: string }} params
 */
export async function initiateStkPush({ phone, amount, accountReference, description = "Sokoni Mall order" }) {
  const token = await getAccessToken();
  const { password, timestamp: ts } = stkPassword();
  const partyPhone = formatMpesaPhone(phone);
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) throw new Error("Invalid STK amount");

  const body = {
    BusinessShortCode: config.mpesa.shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: config.mpesa.transactionType || "CustomerBuyGoodsOnline",
    Amount: amt,
    PartyA: partyPhone,
    PartyB: config.mpesa.shortcode,
    PhoneNumber: partyPhone,
    CallBackURL: config.mpesa.callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description).slice(0, 13),
  };

  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ResponseCode !== "0") {
    const msg = data.errorMessage || data.ResponseDescription || JSON.stringify(data).slice(0, 300);
    throw new Error(`STK push failed: ${msg}`);
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage,
    responseDescription: data.ResponseDescription,
  };
}

/**
 * Parse STK callback body from Safaricom.
 * @param {object} body
 */
export function parseStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb) return { valid: false, error: "missing_stk_callback" };

  const resultCode = Number(cb.ResultCode);
  const base = {
    valid: true,
    resultCode,
    resultDesc: cb.ResultDesc || "",
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    success: resultCode === 0,
  };

  if (resultCode !== 0) {
    return { ...base, failed: true };
  }

  const items = cb.CallbackMetadata?.Item || [];
  const pick = (name) => items.find((i) => i.Name === name)?.Value;

  return {
    ...base,
    failed: false,
    amount: pick("Amount") != null ? Number(pick("Amount")) : null,
    mpesaReceiptNumber: pick("MpesaReceiptNumber") ? String(pick("MpesaReceiptNumber")) : null,
    transactionDate: pick("TransactionDate") ? String(pick("TransactionDate")) : null,
    phoneNumber: pick("PhoneNumber") ? formatMpesaPhone(String(pick("PhoneNumber"))) : null,
    // Rarely present on STK callbacks; kept for opportunistic order resolve.
    accountReference: pick("AccountReference") ? String(pick("AccountReference")) : null,
  };
}

/** B2C payout stub — Phase 5.2 auto seller disbursement. */
export async function initiateB2CPayout({ phone, amount, remarks = "Sokoni seller payout" }) {
  if (!isDarajaReady()) throw new Error("Daraja not configured");
  console.log("[daraja] B2C payout stub:", { phone: formatMpesaPhone(phone), amount, remarks });
  return { ok: false, stub: true, message: "B2C payout API wiring pending — manual seller transfer for now" };
}
