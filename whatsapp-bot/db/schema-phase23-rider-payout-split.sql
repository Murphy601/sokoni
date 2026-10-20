-- Phase 23: Transparent 10% platform cut + M-Pesa B2C tariff on rider payouts

ALTER TABLE rider_payouts
  ADD COLUMN IF NOT EXISTS gross_delivery_fee NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS platform_commission NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS transaction_fee NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS net_amount_paid NUMERIC(12, 2);

COMMENT ON COLUMN rider_payouts.gross_delivery_fee IS 'Buyer-facing delivery fee before Sokoni cut';
COMMENT ON COLUMN rider_payouts.platform_commission IS '10% Sokoni platform cut';
COMMENT ON COLUMN rider_payouts.transaction_fee IS 'Estimated Safaricom B2C tariff deducted from rider';
COMMENT ON COLUMN rider_payouts.net_amount_paid IS 'Net credit / B2C transfer amount (also stored in amount)';
COMMENT ON COLUMN rider_payouts.amount IS 'Net rider credit (after 10% + B2C tariff); used for CLEARED B2C aggregation';
