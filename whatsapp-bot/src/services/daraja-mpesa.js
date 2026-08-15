/**
 * Safaricom Daraja — OAuth, STK Push, B2C payouts, callback parsing.
 * @see https://developer.safaricom.co.ke/
 */
import { createPublicKey, publicEncrypt, constants, X509Certificate } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { config } from "../config.js";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

let tokenCache = { token: null, expiresAt: 0, purpose: "" };
let cachedSecurityCredential = null;

/** Known Buy Goods / C2B-only shortcodes — cannot be B2C PartyA. */
export const C2B_ONLY_SHORTCODES = new Set(["3439153"]);

function baseUrl() {
  return config.mpesa.env === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

/** OAuth only — STK app keys (buyer pay). */
export function isDarajaOAuthReady() {
  const m = config.mpesa;
  return Boolean(m.consumerKey && m.consumerSecret);
}

/** OAuth for B2C — optional dedicated B2C app keys, else STK app keys. */
export function isB2COauthReady() {
  const m = config.mpesa;
  return Boolean(m.b2cConsumerKey && m.b2cConsumerSecret);
}

/** True when shortcode is a dedicated B2C / Bulk / One Account code (not C2B Buy Goods). */
export function isUsableB2cShortcode(code) {
  const c = String(code || "").trim();
  if (!c || !/^\d{5,8}$/.test(c)) return false;
  return !C2B_ONLY_SHORTCODES.has(c);
}

/** STK Push ready (buyer pay). */
export function isDarajaReady() {
  const m = config.mpesa;
  return Boolean(
    isDarajaOAuthReady() && m.passkey && m.shortcode && m.callbackUrl
  );
}

/**
 * Encrypt initiator password with Safaricom public cert (PKCS#1 v1.5 → base64).
 * Cert may be PEM or DER (.cer).
 */
export function buildSecurityCredential(password, certPath) {
  const pwd = String(password || "");
  const path = String(certPath || "");
  if (!pwd || !path) {
    throw new Error("MPESA_INITIATOR_PASSWORD and MPESA_CERT_PATH required to build SecurityCredential");
  }
  if (!existsSync(path)) {
    throw new Error(`M-Pesa cert not found at ${path}`);
  }
  const raw = readFileSync(path);
  let key;
  try {
    // PEM cert or public key
    key = createPublicKey(raw);
  } catch {
    try {
      // DER / .cer X.509 certificate
      key = new X509Certificate(raw).publicKey;
    } catch (err) {
      throw new Error(`Could not load M-Pesa public cert: ${err.message}`);
    }
  }
  const encrypted = publicEncrypt(
    {
      key,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(pwd, "utf8")
  );
  return encrypted.toString("base64");
}

function resolveSecurityCredential() {
  if (config.mpesa.securityCredential) {
    return config.mpesa.securityCredential;
  }
  if (cachedSecurityCredential) return cachedSecurityCredential;
  if (config.mpesa.initiatorPassword && config.mpesa.certPath) {
    cachedSecurityCredential = buildSecurityCredential(
      config.mpesa.initiatorPassword,
      config.mpesa.certPath
    );
    return cachedSecurityCredential;
  }
  return "";
}

/** B2C seller payout ready — needs a real B2C shortcode (not Buy Goods 3439153). */
export function isB2CReady() {
  const m = config.mpesa;
  const credential = resolveSecurityCredential();
  return Boolean(
    isB2COauthReady() &&
      m.initiatorName &&
      credential &&
      isUsableB2cShortcode(m.b2cShortcode) &&
      m.b2cResultUrl &&
      m.b2cTimeoutUrl
  );
}

export function b2cMeta() {
  const m = config.mpesa;
  const blockedC2b = C2B_ONLY_SHORTCODES.has(String(m.b2cShortcode || m.shortcode || "").trim());
  return {
    ready: isB2CReady(),
    auto: Boolean(m.b2cAuto),
    shortcode: isUsableB2cShortcode(m.b2cShortcode) ? m.b2cShortcode : null,
    initiatorName: m.initiatorName || null,
    env: m.env,
    resultUrl: m.b2cResultUrl || null,
    timeoutUrl: m.b2cTimeoutUrl || null,
    blockedReason: !isUsableB2cShortcode(m.b2cShortcode)
      ? blockedC2b || m.shortcode === "3439153"
        ? "Buy Goods shortcode 3439153 is C2B-only. Apply for a B2C/Bulk/One Account shortcode, then set MPESA_B2C_SHORTCODE."
        : "Set MPESA_B2C_SHORTCODE to your B2C / One Account shortcode (not 3439153)."
      : null,
  };
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

async function getAccessToken(purpose = "stk") {
  const useB2c = purpose === "b2c";
  if (useB2c ? !isB2COauthReady() : !isDarajaOAuthReady()) {
    throw new Error(
      useB2c
        ? "Daraja B2C OAuth not configured — set MPESA_B2C_CONSUMER_KEY/SECRET (or STK MPESA_CONSUMER_KEY/SECRET)"
        : "Daraja not configured — set MPESA_CONSUMER_KEY/SECRET"
    );
  }
  if (
    tokenCache.token &&
    tokenCache.purpose === purpose &&
    Date.now() < tokenCache.expiresAt - 60_000
  ) {
    return tokenCache.token;
  }
  const key = String(
    useB2c ? config.mpesa.b2cConsumerKey : config.mpesa.consumerKey || ""
  ).replace(/\s+/g, "");
  const secret = String(
    useB2c ? config.mpesa.b2cConsumerSecret : config.mpesa.consumerSecret || ""
  ).replace(/\s+/g, "");
  const auth = Buffer.from(`${key}:${secret}`, "utf8").toString("base64");
  const url = `${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[daraja] OAuth failed", {
      status: res.status,
      purpose,
      env: config.mpesa.env,
      host: baseUrl(),
      keyLen: key.length,
      secretLen: secret.length,
      body: errText.slice(0, 240),
    });
    throw new Error(
      `Daraja OAuth failed (${res.status}): ${errText.slice(0, 200) || "check MPESA_CONSUMER_KEY/SECRET + MPESA_ENV"}`
    );
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Daraja OAuth: no access_token");
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3599) * 1000,
    purpose,
  };
  return data.access_token;
}

/**
 * Initiate Lipa na M-Pesa STK push.
 * @param {{ phone: string, amount: number, accountReference: string, description?: string }} params
 */
export async function initiateStkPush({ phone, amount, accountReference, description = "Sokoni Mall order" }) {
  if (!isDarajaReady()) {
    throw new Error("Daraja STK not configured — set MPESA_* (passkey, shortcode, callback)");
  }
  const token = await getAccessToken("stk");
  const { password, timestamp: ts } = stkPassword();
  const partyPhone = formatMpesaPhone(phone);
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) throw new Error("Invalid STK amount");

  // Buy Goods STK (Sokoni live mapping):
  //   BusinessShortCode = MPESA_SHORTCODE 3439153 (Daraja / org H.O. — password + passkey)
  //   PartyB            = MPESA_TILL_NUMBER 4775847 (Buy Goods till)
  //   Merchant store shortcode 4421485 is portal hierarchy only — not sent on STK
  // Org portal "Web" operator is for viewing balances — NOT STK auth.
  const businessShortCode = String(config.mpesa.shortcode || "").trim();
  const partyB = String(config.mpesa.partyB || businessShortCode).trim();
  const transactionType = config.mpesa.transactionType || "CustomerBuyGoodsOnline";

  const body = {
    BusinessShortCode: businessShortCode,
    Password: password,
    Timestamp: ts,
    TransactionType: transactionType,
    Amount: amt,
    PartyA: partyPhone,
    PartyB: partyB,
    PhoneNumber: partyPhone,
    CallBackURL: config.mpesa.callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description).slice(0, 13),
  };
  console.log(
    "[daraja] STK request",
    JSON.stringify({
      env: config.mpesa.env,
      transactionType,
      businessShortCode,
      partyB,
      amount: amt,
      phone: partyPhone,
      accountReference: body.AccountReference,
      callbackUrl: body.CallBackURL,
    })
  );

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
    const msg =
      data.errorMessage ||
      data.ResponseDescription ||
      data.errorCode ||
      JSON.stringify(data).slice(0, 300);
    console.error(
      "[daraja] STK failed",
      JSON.stringify({
        http: res.status,
        responseCode: data.ResponseCode ?? null,
        errorCode: data.errorCode ?? null,
        message: msg,
        businessShortCode,
        partyB,
        transactionType,
      })
    );
    throw new Error(`STK push failed: ${msg}`);
  }

  console.log(
    "[daraja] STK accepted",
    JSON.stringify({
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      customerMessage: data.CustomerMessage,
    })
  );

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

/**
 * Build a stable OriginatorConversationID for B2C idempotency (max ~32–36 chars).
 * Prefer settlement/order ids so ResultURL can re-link.
 */
export function b2cOriginatorId({ orderId, attempt = 1 } = {}) {
  const oid = String(orderId || "x")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 20);
  const ts = Date.now().toString(36).slice(-6);
  const a = Math.max(1, Number(attempt) || 1);
  return `sk${oid}-${a}-${ts}`.slice(0, 36);
}

/**
 * Initiate B2C BusinessPayment to a seller phone.
 * @param {{ phone: string, amount: number, remarks?: string, occasion?: string, orderId?: string, originatorConversationId?: string }} params
 */
export async function initiateB2CPayout({
  phone,
  amount,
  remarks = "Sokoni seller payout",
  occasion = "SellerPayout",
  orderId = "",
  originatorConversationId = "",
} = {}) {
  if (!isB2CReady()) {
    const meta = b2cMeta();
    return {
      ok: false,
      stub: false,
      configured: false,
      message:
        meta.blockedReason ||
        "B2C not configured — set MPESA_B2C_SHORTCODE (B2C/One Account, not 3439153) + MPESA_INITIATOR_NAME + MPESA_SECURITY_CREDENTIAL",
    };
  }

  const partyPhone = formatMpesaPhone(phone);
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, message: "Invalid B2C amount" };
  }
  if (!/^2547\d{8}$/.test(partyPhone) && !/^2541\d{8}$/.test(partyPhone)) {
    // Soft check — Safaricom still validates; warn but allow 254 formats.
    console.warn("[daraja] B2C phone unusual format:", partyPhone);
  }

  const securityCredential = resolveSecurityCredential();
  const originator =
    String(originatorConversationId || "").trim() ||
    b2cOriginatorId({ orderId, attempt: 1 });

  const body = {
    OriginatorConversationID: originator,
    InitiatorName: config.mpesa.initiatorName,
    SecurityCredential: securityCredential,
    CommandID: config.mpesa.b2cCommandId || "BusinessPayment",
    Amount: amt,
    PartyA: String(config.mpesa.b2cShortcode).trim(),
    PartyB: partyPhone,
    Remarks: String(remarks).slice(0, 100),
    QueueTimeOutURL: config.mpesa.b2cTimeoutUrl,
    ResultURL: config.mpesa.b2cResultUrl,
    Occassion: String(occasion).slice(0, 100),
  };

  console.log("[daraja] B2C request", {
    env: config.mpesa.env,
    partyA: body.PartyA,
    partyB: partyPhone,
    amount: amt,
    orderId: orderId || null,
    originator,
    commandId: body.CommandID,
  });

  const token = await getAccessToken("b2c");
  // Prod-SOKONIMALL is entitled to B2C v1 (Safaricom go-live URL list).
  // Try v1 first, then v3 for apps that only have the newer path.
  const paths = ["/mpesa/b2c/v1/paymentrequest", "/mpesa/b2c/v3/paymentrequest"];
  let data = {};
  let lastStatus = 0;
  for (const path of paths) {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    lastStatus = res.status;
    data = await res.json().catch(() => ({}));
    if (res.ok && (data.ResponseCode === "0" || data.ConversationID)) {
      console.log("[daraja] B2C accepted via", path, {
        conversationId: data.ConversationID,
        originatorConversationId: data.OriginatorConversationID || originator,
      });
      return {
        ok: true,
        accepted: true,
        conversationId: data.ConversationID || null,
        originatorConversationId: data.OriginatorConversationID || originator,
        responseCode: data.ResponseCode,
        responseDescription: data.ResponseDescription || data.ResponseDesc || "",
        path,
      };
    }
    // 404 on v3 → try v1; other errors stop.
    if (res.status !== 404 && path === paths[0]) {
      break;
    }
  }

  const errCode = data.errorCode || data.ErrorCode || "";
  const rawMsg =
    data.errorMessage ||
    data.ResponseDescription ||
    data.ResponseDesc ||
    data.error ||
    JSON.stringify(data).slice(0, 300) ||
    `HTTP ${lastStatus}`;
  let msg = errCode ? `${rawMsg} (${errCode})` : String(rawMsg);
  // Buy Goods 3439153 cannot do B2C — need a separate B2C/Bulk/One Account shortcode.
  if (
    C2B_ONLY_SHORTCODES.has(String(config.mpesa.b2cShortcode || "").trim()) ||
    C2B_ONLY_SHORTCODES.has(String(config.mpesa.shortcode || "").trim())
  ) {
    msg +=
      " — Shortcode 3439153 is Buy Goods / C2B only and does not support B2C. " +
      "Apply for a B2C/Bulk/One Account shortcode at https://hub.m-pesaforbusiness.co.ke/merchant-onboarding/self-onboarding " +
      "then set MPESA_B2C_SHORTCODE (and optional MPESA_B2C_CONSUMER_KEY/SECRET).";
  } else if (
    String(errCode).includes("404.001.03") ||
    String(errCode).includes("401.002.01") ||
    /invalid access token/i.test(String(rawMsg))
  ) {
    msg +=
      " — Check MPESA_B2C_SHORTCODE is your B2C/One Account code (not Buy Goods 3439153), " +
      "initiator SecurityCredential matches that account, and the Daraja app is entitled for B2C.";
  }
  console.warn("[daraja] B2C rejected:", { status: lastStatus, errCode, msg, data });
  return {
    ok: false,
    accepted: false,
    message: `B2C failed: ${msg}`,
    errorCode: errCode || null,
    originatorConversationId: originator,
    response: data,
  };
}

/**
 * Parse B2C ResultURL / QueueTimeOutURL body.
 * @param {object} body
 */
export function parseB2CResultCallback(body) {
  const result = body?.Result || body?.result || body;
  if (!result || (result.ResultCode == null && result.ResultDesc == null && !result.ConversationID)) {
    return { valid: false, error: "missing_b2c_result" };
  }

  const resultCode = Number(result.ResultCode);
  const params = result.ResultParameters?.ResultParameter;
  const list = Array.isArray(params) ? params : params ? [params] : [];
  const pick = (key) => list.find((i) => i.Key === key || i.Name === key)?.Value;

  const success = resultCode === 0;
  return {
    valid: true,
    success,
    failed: !success,
    resultCode,
    resultDesc: result.ResultDesc || "",
    originatorConversationId: result.OriginatorConversationID
      ? String(result.OriginatorConversationID)
      : null,
    conversationId: result.ConversationID ? String(result.ConversationID) : null,
    transactionId: result.TransactionID ? String(result.TransactionID) : null,
    amount: pick("TransactionAmount") != null ? Number(pick("TransactionAmount")) : null,
    receipt: pick("TransactionReceipt") ? String(pick("TransactionReceipt")) : null,
    receiverPublicName: pick("ReceiverPartyPublicName")
      ? String(pick("ReceiverPartyPublicName"))
      : null,
    transactionCompletedDateTime: pick("TransactionCompletedDateTime")
      ? String(pick("TransactionCompletedDateTime"))
      : null,
    timeout: Boolean(body?.timeout || result.ResultDesc?.toLowerCase?.().includes("timeout")),
  };
}
