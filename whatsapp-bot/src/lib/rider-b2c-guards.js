/**
 * Rider B2C risk guardrails (KES).
 */
export const RIDER_B2C_MIN_FLOOR_KES = 200;
export const RIDER_B2C_DAILY_CAP_KES = 5000;
export const RIDER_SINGLE_FEE_MANUAL_KES = 1500;
export const RIDER_B2C_FLOAT_ALERT_KES = 10000;
export const RIDER_B2C_RETRY_BASE_MS = 30 * 60 * 1000;
export const RIDER_B2C_RETRY_MAX = 8;

export function nextRetryAt(retryCount = 0) {
  const n = Math.min(Math.max(Number(retryCount) || 0, 0), RIDER_B2C_RETRY_MAX);
  const delay = RIDER_B2C_RETRY_BASE_MS * Math.pow(2, Math.min(n, 4));
  return new Date(Date.now() + delay);
}

export function isInsufficientFloatError(message = "", errorCode = "") {
  const blob = `${errorCode} ${message}`.toLowerCase();
  return (
    /insufficient|float|balance|not enough|2001|0001/.test(blob) ||
    String(errorCode) === "2001" ||
    String(errorCode) === "0001"
  );
}
