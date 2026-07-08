const EMOJI_DIGITS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/** WhatsApp-safe highlighted list index (emoji 1–10, then bold). */
export function formatListNumber(n) {
  if (n >= 1 && n <= 10) return EMOJI_DIGITS[n - 1];
  return `*${n}.*`;
}

export function formatKes(amount) {
  return `*KES ${Math.round(Number(amount) || 0).toLocaleString()}*`;
}
