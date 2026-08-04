import { Router } from "express";
import { parseStkCallback, parseB2CResultCallback } from "../services/daraja-mpesa.js";
import {
  applyPostPaymentAutomation,
  applyPaymentFailure,
  resolveOrderFromStkCallback,
} from "../services/escrow-automation.js";
import { applyB2CResult } from "../services/settlements.js";

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

/** Safaricom B2C ResultURL — seller payout completed or failed. */
async function handleB2CResult(req, res) {
  try {
    const parsed = parseB2CResultCallback(req.body);
    if (!parsed.valid) {
      console.warn("[b2c-result] invalid payload", JSON.stringify(req.body || {}).slice(0, 300));
    } else {
      applyB2CResult(parsed);
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
      applyB2CResult({
        ...parsed,
        success: false,
        failed: true,
        timeout: true,
        resultDesc: parsed.resultDesc || "B2C queue timeout",
      });
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

export default router;
