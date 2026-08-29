import { Router } from "express";
import { parseStkCallback, parseB2CResultCallback } from "../services/daraja-mpesa.js";
import {
  applyPostPaymentAutomation,
  applyPaymentFailure,
  resolveOrderFromStkCallback,
  resolveOrderFromPaystackCharge,
} from "../services/escrow-automation.js";
import { applyB2CResult, applyPaystackTransferEvent } from "../services/settlements.js";
import { applyRiderB2CResult } from "../services/rider-b2c.js";
import {
  parsePaystackChargeEvent,
  parsePaystackTransferEvent,
  verifyPaystackSignature,
} from "../services/paystack-transfers.js";
import { config } from "../config.js";

const router = Router();

/** Safaricom Daraja STK callback — auto-confirms payment, no admin needed. */
async function handleMpesaStkCallback(req, res) {
  try {
    const parsed = parseStkCallback(req.body);
    if (!parsed.valid) {
      console.warn("[mpesa-callback] invalid payload");
      return res.status(200).json({ ResponseCode: "0", ResponseDesc: "Accepted" });
    }

    if (parsed.success) {
      const order = resolveOrderFromStkCallback(parsed);
      if (!order) {
        console.warn("[mpesa-callback] order not found for", parsed.checkoutRequestId);
      } else {
        await applyPostPaymentAutomation(order, {
          mpesaReceiptNumber: parsed.mpesaReceiptNumber,
          phoneNumber: parsed.phoneNumber,
          amount: parsed.amount,
          checkoutRequestId: parsed.checkoutRequestId,
        });
      }
    } else {
      await applyPaymentFailure(parsed.checkoutRequestId, parsed.resultDesc);
    }

    res.status(200).json({ ResponseCode: "0", ResponseDesc: "Callback accepted successfully" });
  } catch (err) {
    console.error("[mpesa-callback] error:", err.message);
    res.status(200).json({ ResponseCode: "0", ResponseDesc: "Accepted with processing error" });
  }
}

/** Safaricom B2C ResultURL — seller + rider payouts completed or failed. */
async function handleB2CResult(req, res) {
  try {
    const parsed = parseB2CResultCallback(req.body);
    if (!parsed.valid) {
      console.warn("[b2c-result] invalid payload", JSON.stringify(req.body || {}).slice(0, 300));
    } else {
      applyB2CResult(parsed);
      try {
        await applyRiderB2CResult(parsed);
      } catch (err) {
        console.warn("[b2c-result] rider apply:", err.message);
      }
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[b2c-result] error:", err.message);
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted with processing error" });
  }
}

/** Safaricom B2C QueueTimeOutURL. */
async function handleB2CTimeout(req, res) {
  try {
    const parsed = parseB2CResultCallback({ ...(req.body || {}), timeout: true });
    if (parsed.valid) {
      const failed = {
        ...parsed,
        success: false,
        failed: true,
        timeout: true,
        resultDesc: parsed.resultDesc || "B2C queue timeout",
      };
      applyB2CResult(failed);
      try {
        await applyRiderB2CResult(failed);
      } catch (err) {
        console.warn("[b2c-timeout] rider apply:", err.message);
      }
    } else {
      console.warn("[b2c-timeout] payload", JSON.stringify(req.body || {}).slice(0, 300));
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[b2c-timeout] error:", err.message);
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted with processing error" });
  }
}

router.post("/mpesa-callback", handleMpesaStkCallback);
router.post("/daraja/callback", handleMpesaStkCallback);
router.post("/daraja/b2c/result", handleB2CResult);
router.post("/daraja/b2c/timeout", handleB2CTimeout);
router.post("/paystack", handlePaystackWebhook);
router.post("/paystack/webhook", handlePaystackWebhook);

/** Paystack charge (C2B) + transfer (payout) events on one webhook URL. */
export async function handlePaystackWebhook(req, res) {
  try {
    const signature = req.headers["x-paystack-signature"];
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyPaystackSignature(raw, signature, config.paystack?.secretKey)) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const charge = parsePaystackChargeEvent(req.body);
    if (charge.valid) {
      const order = resolveOrderFromPaystackCharge(charge);
      if (charge.success) {
        if (!order) {
          console.warn("[paystack-webhook] charge.success unmatched", charge.reference);
        } else {
          await applyPostPaymentAutomation(order, {
            mpesaReceiptNumber: charge.receipt || charge.reference,
            phoneNumber: charge.phone || order.phone,
            amount: charge.amountKes,
            checkoutRequestId: charge.reference,
          });
        }
      } else if (charge.failed) {
        await applyPaymentFailure(charge.reference, charge.status || "charge.failed", order);
      }
    }

    const transfer = parsePaystackTransferEvent(req.body);
    if (transfer.valid) {
      applyPaystackTransferEvent(transfer);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paystack-webhook] error:", err.message);
    res.status(200).json({ received: true, error: "processing_error" });
  }
}

export default router;
