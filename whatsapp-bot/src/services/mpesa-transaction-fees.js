/**
 * Variable M-Pesa transaction fees by amount band.
 * Sokoni checkout uses Buy Goods Till / Lipa na M-Pesa (STK).
 *
 * Tariffs change — this table is an estimate shown at listing/checkout so buyers
 * see that fees are NOT a flat rate. Update bands when Safaricom publishes new rates.
 *
 * Source shape: Safaricom Lipa na M-Pesa / Paybill Business Bouquet–style customer bands
 * (KES 1–100 free; higher bands step up; capped near KES 108 for large amounts).
 */

/** @typedef {{ min: number, max: number, feeKes: number }} MpesaFeeBand */

/** Inclusive min/max amount bands → customer/merchant pass-through fee in KES. */
export const MPESA_TRANSACTION_FEE_BANDS = [
  { min: 1, max: 100, feeKes: 0 },
  { min: 101, max: 500, feeKes: 5 },
  { min: 501, max: 1000, feeKes: 10 },
  { min: 1001, max: 1500, feeKes: 15 },
  { min: 1501, max: 2500, feeKes: 20 },
  { min: 2501, max: 3500, feeKes: 25 },
  { min: 3501, max: 5000, feeKes: 34 },
  { min: 5001, max: 7500, feeKes: 42 },
  { min: 7501, max: 10000, feeKes: 48 },
  { min: 10001, max: 15000, feeKes: 57 },
  { min: 15001, max: 20000, feeKes: 62 },
  { min: 20001, max: 25000, feeKes: 67 },
  { min: 25001, max: 30000, feeKes: 72 },
  { min: 30001, max: 35000, feeKes: 83 },
  { min: 35001, max: 40000, feeKes: 99 },
  { min: 40001, max: 45000, feeKes: 103 },
  { min: 45001, max: 250000, feeKes: 108 },
];

/**
 * Look up M-Pesa transaction fee for a charge amount (KES).
 * Returns 0 for empty/invalid amounts.
 */
export function mpesaTransactionFeeKes(amountKes) {
  const amount = Math.round(Number(amountKes) || 0);
  if (!Number.isFinite(amount) || amount < 1) return 0;
  for (const band of MPESA_TRANSACTION_FEE_BANDS) {
    if (amount >= band.min && amount <= band.max) return band.feeKes;
  }
  // Above published cap — keep last band fee (Safaricom often caps large Paybill/Till fees).
  return MPESA_TRANSACTION_FEE_BANDS[MPESA_TRANSACTION_FEE_BANDS.length - 1].feeKes;
}

/** Short UI hint so sellers/buyers know the fee moves with amount. */
export function mpesaTransactionFeeHint(amountKes) {
  const fee = mpesaTransactionFeeKes(amountKes);
  if (fee <= 0) return "M-Pesa fee: free for this amount (KES 1–100).";
  return `M-Pesa fee for this amount: KES ${fee.toLocaleString("en-KE")} (varies by band — not a flat rate).`;
}
