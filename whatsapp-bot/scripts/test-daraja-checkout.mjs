#!/usr/bin/env node
/** Unit checks for Phase 5 prepaid checkout / Daraja helpers (no live STK). */
import { formatMpesaPhone, parseStkCallback, isDarajaReady } from "../src/services/daraja-mpesa.js";
import {
  canFulfillOrder,
  checkoutMeta,
  prepaidPaymentLine,
  isDarajaConfigured,
} from "../src/services/prepaid-checkout.js";

function assert(label, cond) {
  if (!cond) throw new Error(label);
}

function main() {
  assert("format 07…", formatMpesaPhone("0712345678") === "254712345678");
  assert("format 254…", formatMpesaPhone("254712345678") === "254712345678");
  assert("format 7…", formatMpesaPhone("712345678") === "254712345678");

  const failBody = {
    Body: {
      stkCallback: {
        MerchantRequestID: "m-1",
        CheckoutRequestID: "ws_CO_1",
        ResultCode: 1032,
        ResultDesc: "Request cancelled by user",
      },
    },
  };
  const failed = parseStkCallback(failBody);
  assert("failed valid", failed.valid && failed.failed && !failed.success);
  assert("failed code", failed.resultCode === 1032);
  assert("failed checkout id", failed.checkoutRequestId === "ws_CO_1");

  const okBody = {
    Body: {
      stkCallback: {
        MerchantRequestID: "m-2",
        CheckoutRequestID: "ws_CO_2",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 450 },
            { Name: "MpesaReceiptNumber", Value: "ABC123XYZ" },
            { Name: "TransactionDate", Value: 20260729153000 },
            { Name: "PhoneNumber", Value: 254712345678 },
            { Name: "AccountReference", Value: "SK-1042" },
          ],
        },
      },
    },
  };
  const ok = parseStkCallback(okBody);
  assert("ok success", ok.valid && ok.success && !ok.failed);
  assert("ok amount", ok.amount === 450);
  assert("ok receipt", ok.mpesaReceiptNumber === "ABC123XYZ");
  assert("ok phone", ok.phoneNumber === "254712345678");
  assert("ok account ref", ok.accountReference === "SK-1042");

  assert("invalid callback", parseStkCallback({}).valid === false);

  assert("cannot fulfill unpaid prepaid", !canFulfillOrder({
    status: "awaiting_payment",
    paymentModel: "prepaid",
    customerPaymentStatus: "pending",
  }));
  assert("can fulfill paid prepaid", canFulfillOrder({
    status: "confirmed",
    paymentModel: "prepaid",
    customerPaymentStatus: "confirmed",
  }));
  assert("cancelled blocked", !canFulfillOrder({ status: "cancelled", customerPaymentStatus: "confirmed" }));

  assert("line unpaid", prepaidPaymentLine({ customerPaymentStatus: "pending" }).includes("Pay upfront"));
  assert("line stk", prepaidPaymentLine({ paymentStatus: "processing" }).includes("STK"));
  assert("line paid", prepaidPaymentLine({ customerPaymentStatus: "confirmed" }).includes("Paid"));

  const meta = checkoutMeta();
  assert("meta prepaid", meta.prepaidOnly === true || meta.prepaidOnly === false);
  assert("meta escrow", meta.escrow === true);
  assert("meta methods", Array.isArray(meta.paymentMethods) && meta.paymentMethods.length >= 1);
  assert("daraja helpers agree", isDarajaConfigured() === isDarajaReady());
  if (!isDarajaReady()) {
    assert("manual fallback when unset", meta.darajaIntegration === "manual_fallback");
    assert("till method when unset", meta.paymentMethods.includes("manual_till"));
  }

  console.log("OK: Phase 5 daraja/checkout helpers");
  console.log("  darajaConfigured:", isDarajaConfigured());
  console.log("  parseStkCallback success + fail paths");
}

main();
