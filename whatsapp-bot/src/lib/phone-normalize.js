/**
 * Kenya WhatsApp phone normalization.
 * Meta / WAHA deliver international digits (2547…) — never rely on leading-0 national form alone.
 */

/** Strip to digits only. */
export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Normalize to Kenya E.164 without plus: 2547XXXXXXXX.
 * Accepts 254…, 07…, +254…, or bare 9-digit national (7…).
 */
export function normalizeKenyaPhone(value) {
  let d = digitsOnly(value);
  if (!d) return "";
  // Drop leading 00 international prefix
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("254") && d.length >= 12) return d.slice(0, 15);
  if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("7")) return `254${d}`;
  return d;
}

/** Last 9 national digits (e.g. 757764009) — robust Meta vs local matching. */
export function nationalTail9(value) {
  const d = digitsOnly(value);
  return d.length >= 9 ? d.slice(-9) : d;
}

/**
 * True when two Kenya numbers refer to the same line.
 * Matches exact, normalized 254, or shared last-9 national tail.
 */
export function phonesMatchKenya(a, b) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = normalizeKenyaPhone(da);
  const nb = normalizeKenyaPhone(db);
  if (na && nb && na === nb) return true;
  const ta = nationalTail9(da);
  const tb = nationalTail9(db);
  return Boolean(ta && tb && ta.length === 9 && ta === tb);
}

/**
 * Expand a configured admin phone into international + national aliases
 * so env can list either 254757764009 or 0757764009.
 */
export function expandKenyaPhoneAliases(value) {
  const intl = normalizeKenyaPhone(value);
  if (!intl) return [];
  const out = new Set([intl, digitsOnly(value)].filter(Boolean));
  if (intl.startsWith("254") && intl.length >= 12) {
    const national = `0${intl.slice(3)}`; // 0757764009
    out.add(national);
    out.add(intl.slice(3)); // 757764009
    out.add(`+${intl}`);
  }
  return [...out];
}

/**
 * Build Boss / SUPER_ADMIN number set from ADMIN_PHONES (+ optional BOSS_PHONES).
 */
export function buildBossNumberSet(configuredPhones = []) {
  const raw = [
    ...configuredPhones,
    ...(String(process.env.BOSS_PHONES || "").split(",")),
  ];
  const set = new Set();
  for (const p of raw) {
    for (const alias of expandKenyaPhoneAliases(p)) {
      set.add(digitsOnly(alias) || alias);
    }
  }
  return set;
}

/**
 * Is this sender the Boss line?
 * Uses endsWith(last-9) against every configured/expanded Boss number.
 */
export function isBossPhone(senderPhone, configuredPhones = []) {
  const clean = digitsOnly(senderPhone);
  if (!clean || clean.length < 9) return false;
  const bosses = buildBossNumberSet(configuredPhones);
  if (bosses.size === 0) return false;
  const tail = nationalTail9(clean);
  for (const num of bosses) {
    const n = digitsOnly(num);
    if (!n) continue;
    if (phonesMatchKenya(clean, n)) return true;
    if (tail.length === 9 && (clean.endsWith(n.slice(-9)) || n.endsWith(tail))) return true;
  }
  return false;
}
