/**
 * Kenya WhatsApp phone normalization + hardwired founder Boss identity.
 * Meta / WAHA deliver international digits (2547…) — never rely on leading-0 alone.
 *
 * IMPORTANT: Only the founder hardwire (757764009) + optional BOSS_PHONES are "Boss".
 * ADMIN_PHONES are staff — they must NOT get the Boss LLM salute or founder palette.
 */

/** Last 9 digits of the founder Boss line (0757764009 / 254757764009). Always checked. */
export const BOSS_HARDWIRE_TAILS = Object.freeze(
  [
    "757764009",
    ...(String(process.env.BOSS_HARDWIRE_TAILS || "")
      .split(",")
      .map((t) => String(t || "").replace(/\D/g, "").slice(-9))
      .filter((t) => t.length === 9)),
  ].filter((v, i, a) => a.indexOf(v) === i)
);

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
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("254") && d.length >= 12) return d.slice(0, 15);
  if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("7")) return `254${d}`;
  return d;
}

/** Last 9 national digits (e.g. 757764009). */
export function nationalTail9(value) {
  const d = digitsOnly(value);
  return d.length >= 9 ? d.slice(-9) : d;
}

/**
 * Founder Boss only — hardwire tails + optional BOSS_PHONES.
 * Does NOT include ADMIN_PHONES (staff ≠ Boss).
 */
export function checkIfBoss(incomingPhone, _configuredPhonesIgnored = []) {
  if (!incomingPhone) return false;
  const clean = digitsOnly(incomingPhone);
  if (!clean || clean.length < 9) return false;

  const tails = new Set(BOSS_HARDWIRE_TAILS);
  for (const p of String(process.env.BOSS_PHONES || "").split(",")) {
    const t = nationalTail9(p);
    if (t.length === 9) tails.add(t);
  }

  for (const tail of tails) {
    if (clean.endsWith(tail)) return true;
  }
  return false;
}

/** Alias — founder Boss only. */
export function isFounderBossPhone(incomingPhone) {
  return checkIfBoss(incomingPhone);
}

/** @deprecated alias — use checkIfBoss / isFounderBossPhone */
export function isBossPhone(senderPhone, configuredPhones = []) {
  // Ignore configuredPhones for founder identity (kept for call-site compat).
  void configuredPhones;
  return checkIfBoss(senderPhone);
}

/**
 * True when two Kenya numbers refer to the same line.
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
 * Expand a configured admin phone into international + national aliases.
 */
export function expandKenyaPhoneAliases(value) {
  const intl = normalizeKenyaPhone(value);
  if (!intl) return [];
  const out = new Set([intl, digitsOnly(value)].filter(Boolean));
  if (intl.startsWith("254") && intl.length >= 12) {
    out.add(`0${intl.slice(3)}`);
    out.add(intl.slice(3));
    out.add(`+${intl}`);
  }
  return [...out];
}

/**
 * Build founder Boss number set (hardwire + BOSS_PHONES only).
 * Ignores configuredPhones so ADMIN_PHONES never become founder identity.
 */
export function buildBossNumberSet(_configuredPhonesIgnored = []) {
  void _configuredPhonesIgnored;
  const raw = [
    ...BOSS_HARDWIRE_TAILS.map((t) => `254${t}`),
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
 * Scan a WAHA/Meta payload object for any digit string that ends with a Boss tail.
 * Last resort when `from` is @lid and phone fields are empty.
 */
export function extractBossPhoneFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  try {
    const blob = JSON.stringify(payload);
    const hits = blob.match(/\d{9,15}/g) || [];
    for (const h of hits) {
      if (checkIfBoss(h)) return normalizeKenyaPhone(h);
    }
  } catch {
    /* ignore */
  }
  return "";
}
