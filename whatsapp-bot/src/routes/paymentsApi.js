import { Router } from "express";
import { parseStkCallback } from "../services/daraja-mpesa.js";
import {
  applyPostPaymentAutomation,
  applyPaymentFailure,
  resolveOrderFromStkCallback,
} from "../services/escrow-automation.js";

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

router.post("/mpesa-callback", handleMpesaStkCallback);
router.post("/daraja/callback", handleMpesaStkCallback);

export default router;
