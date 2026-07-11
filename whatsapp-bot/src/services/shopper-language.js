/**
 * Normalizes Kenyan shopper language (English, Kiswahili, Sheng) into
 * catalog-friendly search text. Used before keyword search — not for display.
 */

const PHRASE_REPLACEMENTS = [
  [/\bnataka\b/gi, "want"],
  [/\bnipee?\b/gi, "want"],
  [/\bnipatie\b/gi, "want"],
  [/\bniletee\b/gi, "want"],
  [/\bnaomba\b/gi, "want"],
  [/\bsimu\b/gi, "phone smartphone"],
  [/\bmob(?:i|o)?\b/gi, "phone"],
  [/\bmafuta\b/gi, "perfume oil fragrance"],
  [/\bmarashi\b/gi, "perfume fragrance"],
  [/\bsauti\b/gi, "speaker audio soundbar"],
  [/\bspika\b/gi, "speaker"],
  [/\bnguo\b/gi, "fashion clothing"],
  [/\bviatu\b/gi, "shoes fashion"],
  [/\bchini\s+ya\b/gi, "under"],
  [/\bchini\b/gi, "under"],
  [/\bbei\s+ngapi\b/gi, "price"],
  [/\bbei\s+gani\b/gi, "price"],
  [/\bbei\s+nguu\b/gi, "cheap price"],
  [/\bbora\s+zaidi\b/gi, "best"],
  [/\bpoa\s+zaidi\b/gi, "best good"],
  [/\bform\b/gi, "good quality"],
  [/\bfit\b/gi, "good"],
  [/\bsawa\b/gi, "ok"],
  [/\bchap\s+chap\b/gi, "fast"],
  [/\bharaka\b/gi, "fast"],
  [/\bbei\s+poa\b/gi, "affordable"],
  [/\bbei\s+rahisi\b/gi, "affordable cheap"],
  [/\bbei\s+nguu\b/gi, "cheap"],
  [/\bkiasi\s+gani\b/gi, "price how much"],
  [/\bgani\b/gi, "which"],
  [/\bgania\b/gi, "which"],
];

const STOP_FILLERS = new Set([
  "poa", "sawa", "sasa", "mambo", "habari", "niko", "fit", "buda", "dem", "bro",
  "please", "pls", "kindly", "leo", "saa", "hii", "hiyo", "hizo", "kama", "tu",
  "ndio", "ndiyo", "sio", "siyo", "au", "na", "kwa", "ya", "tu", "bana", "manze",
]);

export function normalizeShopperQuery(text) {
  let q = String(text || "").trim();
  if (!q) return q;
  for (const [re, replacement] of PHRASE_REPLACEMENTS) {
    q = q.replace(re, ` ${replacement} `);
  }
  return q.replace(/\s+/g, " ").trim();
}

export function isShopperFillerOnly(text) {
  const tokens = normalizeShopperQuery(text)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => STOP_FILLERS.has(t));
}
