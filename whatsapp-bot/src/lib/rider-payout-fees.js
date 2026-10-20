/**
 * Rider delivery payout split: 10% Sokoni platform cut + Safaricom B2C tariff.
 * Net credit is what lands in rider_payouts.amount / Daraja B2C.
 */

/**
 * Safaricom B2C tariff bands (KES) for BusinessPayment-style payouts.
 * @param {number} amount — amount sent on the B2C request (rider gross after platform cut)
 * @returns {number} fee in KES
 */
export function getMpesaB2CTariff(amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return 0;
  if (n <= 100) return 0;
  if (n <= 1000) return 15;
  if (n <= 5000) return 23;
  if (n <= 20000) return 28;
  return 33;
}

/**
 * Full earnings split for one delivery fee charged to the buyer.
 * @param {number} deliveryFee
 */
export function calculateDeliveryPayoutSplit(deliveryFee) {
  const originalDeliveryFee = Math.max(0, Math.round(Number(deliveryFee) || 0));
  const platformCommissionRate = 0.1;
  const platformCommission = Math.round(originalDeliveryFee * platformCommissionRate);
  const grossRiderAmount = Math.max(0, originalDeliveryFee - platformCommission);
  const mpesaTariff = getMpesaB2CTariff(grossRiderAmount);
  const netRiderPayout = Math.max(0, grossRiderAmount - mpesaTariff);

  return {
    originalDeliveryFee,
    platformCommission,
    mpesaTariff,
    grossRiderAmount,
    netRiderPayout,
  };
}

/**
 * WhatsApp body for cleared / credited balance (itemized).
 */
export function formatPayoutSplitMessage(orderRef, split) {
  const id = String(orderRef || "").trim() || "—";
  return (
    `💰 *DELIVERY EARNINGS CLEARED! (Order ${id})*\n\n` +
    `• Gross Fee: *KES ${split.originalDeliveryFee.toLocaleString()}*\n` +
    `• Platform Cut (10%): *-KES ${split.platformCommission.toLocaleString()}*\n` +
    `• M-Pesa B2C Fee: *-KES ${split.mpesaTariff.toLocaleString()}*\n` +
    `─────────────\n` +
    `• *Net Credit to Balance:* *KES ${split.netRiderPayout.toLocaleString()}*\n\n` +
    `Your balance will be disbursed automatically via M-Pesa B2C.`
  );
}
