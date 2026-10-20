/**
 * Variable M-Pesa transaction fees by amount band.
 * Sokoni checkout uses Lipa na M-Pesa STK (Paybill / Business Bouquet style).
 *
 * Customer-pays bands (Business Bouquet): KES 1–100 free; from ~KES 150 upward
 * the first paid band is KES 7 (101–500), then steps up. Platform bakes this into
 * the buyer total and retains it when Daraja does not deduct a separate cut.
 *
 * Update when Safaricom publishes new tariffs. Keep the mirror table in
 * website/assets/js/seller-listing.js in sync.
 */

/** @typedef {{ min: number, max: number, feeKes: number }} MpesaFeeBand */

/** Inclusive min/max amount bands → pass-through fee in KES (buyer-funded, platform-retained). */
export const MPESA_TRANSACTION_FEE_BANDS = [
  { min: 1, max: 100, feeKes: 0 },
  { min: 101, max: 500, feeKes: 7 },
  { min: 501, max: 1000, feeKes: 13 },
  { min: 1001, max: 1500, feeKes: 23 },
  { min: 1501, max: 2500, feeKes: 33 },
  { min: 2501, max: 3500, feeKes: 53 },
  { min: 3501, max: 5000, feeKes: 57 },
  { min: 5001, max: 7500, feeKes: 78 },
  { min: 7501, max: 10000, feeKes: 90 },
  { min: 10001, max: 15000, feeKes: 100 },
  { min: 15001, max: 20000, feeKes: 105 },
  { min: 20001, max: 35000, feeKes: 108 },
  { min: 35001, max: 50000, feeKes: 108 },
  { min: 50001, max: 250000, feeKes: 108 },
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
  // Above published cap — keep last band fee.
  return MPESA_TRANSACTION_FEE_BANDS[MPESA_TRANSACTION_FEE_BANDS.length - 1].feeKes;
}

/** Short UI hint so sellers/buyers know the fee moves with amount. */
export function mpesaTransactionFeeHint(amountKes) {
  const fee = mpesaTransactionFeeKes(amountKes);
  if (fee <= 0) return "M-Pesa fee: free for this amount (KES 1–100).";
  return `M-Pesa fee for this amount: KES ${fee.toLocaleString("en-KE")} (banded — e.g. KES 150 band is KES 7, not a flat rate).`;
}
