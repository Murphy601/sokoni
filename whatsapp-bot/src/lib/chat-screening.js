/**
 * Screening a chat message for off-platform contact and payment.
 *
 * The existing filter matched literal patterns, so it caught "0712345678" and
 * missed "0 7 1 2 3 4 5 6 7 8", "zero seven one two...", and "o712345678".
 * Anyone who tried twice got through.
 *
 * Two deliberate departures from the obvious approach:
 *
 * 1. Normalisation is done per question, not once globally. Mapping every "o"
 *    to "0" and every "one" to "1" to catch spelled-out numbers turns "phone"
 *    into "ph1" and "good" into "g00d", which then has to be screened for
 *    payment words. So digits are resolved on one copy for the phone check,
 *    and words are normalised on another for the term check.
 *
 * 2. Generic words are not blocked on their own. "number", "direct" and
 *    "mpesa" appear constantly in honest conversation -- "what number size",
 *    "pay with M-Pesa on Sokoni" -- and a filter that blocks those trains
 *    people to take the deal off-platform to get a word in. Generic terms only
 *    count alongside a long digit run; only unambiguous ones stand alone.
 *
 * Blocking a real message is not a smaller mistake than missing a bad one. It
 * is the same mistake pointed at the honest majority.
 */

/** Zero-width and direction marks, used to break up a number invisibly. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­]/g;

/** Latin lookalikes from other alphabets. */
const HOMOGLYPHS = new Map([
  ["а", "a"], ["е", "e"], ["о", "o"], ["р", "p"], ["с", "c"], ["у", "y"], ["х", "x"],
  ["і", "i"], ["ѕ", "s"], ["ԁ", "d"], ["ᴏ", "o"], ["ο", "o"], ["ⲟ", "o"], ["০", "0"],
]);

/** Number words people spell out to dodge a digit filter. English and Swahili. */
const NUMBER_WORDS = new Map([
  ["zero", "0"], ["sifuri", "0"], ["nil", "0"],
  ["one", "1"], ["moja", "1"],
  ["two", "2"], ["mbili", "2"],
  ["three", "3"], ["tatu", "3"],
  ["four", "4"], ["nne", "4"],
  ["five", "5"], ["tano", "5"],
  ["six", "6"], ["sita", "6"],
  ["seven", "7"], ["saba", "7"],
  ["eight", "8"], ["nane", "8"],
  ["nine", "9"], ["tisa", "9"],
]);

/** What may sit between two digits without breaking the number up. */
const SEP = "[\\s.,\\-_/()*|:]*";

/**
 * Kenyan mobile numbers, tolerant of separators between digits.
 *
 * Shape is still required -- 07/01 plus eight digits, or 254 plus nine -- so a
 * price list does not read as a phone number.
 */
const PHONE_SHAPES = [
  // Second digit left open on the 254 form, matching what the old filter
  // blocked. The 0 form keeps 7/1, so a list of prices is not a phone number.
  new RegExp(`(?:\\+?254)${SEP}\\d(?:${SEP}\\d){8}`),
  new RegExp(`0${SEP}[17](?:${SEP}\\d){8}`),
];

/** Terms that mean one thing only. Safe to act on alone. */
const EXPLICIT_TERMS = [
  { re: /\bpay\s*bill\b|\bpaybill\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\bbuy\s*goods\b|\bbuygoods\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\btill\s*(?:number|no|namba)?\s*[#:]?\s*\d{4,}/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\bpay\s*(?:me\s*)?(?:outside|directly|direct)\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  // The old list had this one with no digits required after it.
  { re: /\bdirect\s+till\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\boutside\s+sokoni\b|\bnje\s+ya\s+sokoni\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\bcancel\s+(?:on|the)\s+sokoni\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\bsend\s+cash\b/i, reason: "OFF_PLATFORM_PAYMENT" },
  { re: /\b(?:wa\.me|whatsapp\.com|t\.me|telegram)\b/i, reason: "EXTERNAL_LINK" },
  { re: /\b(?:instagram\.com|facebook\.com|fb\.com|tiktok\.com)\b/i, reason: "EXTERNAL_LINK" },
  { re: /https?:\/\//i, reason: "EXTERNAL_LINK" },
  { re: /\bwww\.\w+/i, reason: "EXTERNAL_LINK" },
  { re: /\b(?:call|text|dm|whatsapp)\s*(?:me|us)\b/i, reason: "CONTACT_DETAILS" },
];

/**
 * Terms that are only suspicious next to a long number.
 *
 * On their own every one of these is ordinary marketplace language.
 */
const CONTEXTUAL_TERMS = /\b(?:mpesa|m-?pesa|namba|number|line|no)\b/i;
const LONG_DIGIT_RUN = new RegExp(`\\d(?:${SEP}\\d){4,}`);

/** Strip invisibles and fold lookalike characters. */
export function foldLookalikes(text) {
  const cleaned = String(text || "").replace(INVISIBLE, "");
  let out = "";
  for (const ch of cleaned) out += HOMOGLYPHS.get(ch) ?? ch;
  return out;
}

/**
 * Resolve spelled-out and letter-substituted digits, for the phone check only.
 *
 * Number words are replaced on word boundaries, so "phone" stays "phone" and
 * "one" becomes "1". The l/o substitutions apply only where a digit already
 * sits beside them, which is what "o712345678" and "07l2345678" look like.
 */
export function resolveDigits(text) {
  let out = foldLookalikes(text).toLowerCase();
  out = out.replace(/\b([a-z]+)\b/g, (word) => NUMBER_WORDS.get(word) ?? word);
  // o/l/i as digits, but only touching another digit -- never inside a word.
  for (let i = 0; i < 3; i += 1) {
    out = out
      .replace(/(?<=\d\s?)o(?=\s?\d)/g, "0")
      .replace(/(?<=\d\s?)[li](?=\s?\d)/g, "1")
      .replace(/\bo(?=\s?\d)/g, "0");
  }
  return out;
}

/** Normalise for word matching: fold lookalikes, collapse whitespace. */
export function normalizeWords(text) {
  return foldLookalikes(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Screen one message.
 *
 * @param {string} text
 * @returns {{blocked: boolean, reason: string|null, matched: string|null}}
 */
export function screenMessage(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { blocked: false, reason: null, matched: null };

  const digits = resolveDigits(raw);
  for (const shape of PHONE_SHAPES) {
    const hit = shape.exec(digits);
    if (hit) return { blocked: true, reason: "PHONE_NUMBER", matched: hit[0].slice(0, 40) };
  }

  const words = normalizeWords(raw);
  for (const { re, reason } of EXPLICIT_TERMS) {
    const hit = re.exec(words);
    if (hit) return { blocked: true, reason, matched: hit[0].slice(0, 40) };
  }

  // Generic payment words only count when a long number is sitting next to
  // them. "pay with M-Pesa" is how the platform works; "mpesa 0712 345 678"
  // is not.
  if (CONTEXTUAL_TERMS.test(words) && LONG_DIGIT_RUN.test(digits)) {
    const hit = LONG_DIGIT_RUN.exec(digits);
    return { blocked: true, reason: "OFF_PLATFORM_PAYMENT", matched: hit[0].slice(0, 40) };
  }

  return { blocked: false, reason: null, matched: null };
}

/** What the sender is told. Never quotes what they wrote back at them. */
export function blockedMessageFor(reason) {
  switch (reason) {
    case "PHONE_NUMBER":
    case "CONTACT_DETAILS":
      return (
        "Message blocked: keep phone numbers out of chat. Sokoni holds your " +
        "money in escrow until delivery is confirmed — that protection ends " +
        "the moment a deal moves off the platform."
      );
    case "OFF_PLATFORM_PAYMENT":
      return (
        "Message blocked: paying outside Sokoni forfeits M-Pesa escrow " +
        "protection. If the item never arrives, there is nothing to refund."
      );
    case "EXTERNAL_LINK":
      return "Message blocked: links to other sites are not allowed in chat.";
    default:
      return "Message blocked: this breaks Sokoni's chat rules.";
  }
}
