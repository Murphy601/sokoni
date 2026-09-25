/**
 * Coordinates for Nairobi-metro localities, for pricing boda deliveries.
 *
 * Deliberately a static table rather than a geocoder call: pricing runs on
 * every checkout, and Nominatim caps at one request a second and can time
 * out. A wrong fee is worse than an approximate one, and a checkout that
 * hangs on a map API is worse than both.
 *
 * These are locality centres, so a fee derived from them is accurate to
 * roughly a kilometre or two. Good enough to separate "same suburb" from
 * "across town"; not a substitute for a seller pickup pin, which would
 * sharpen this without changing the tariff.
 */

/** @type {Record<string, [number, number]>} lat, lng */
const METRO = {
  "NAIROBI": [-1.2864, 36.8172],
  "NAIROBI CBD": [-1.2864, 36.8172],
  "CBD": [-1.2864, 36.8172],
  "WESTLANDS": [-1.2673, 36.8065],
  "PARKLANDS": [-1.2622, 36.8156],
  "KILIMANI": [-1.2906, 36.7869],
  "KILELESHWA": [-1.2822, 36.7797],
  "LAVINGTON": [-1.2789, 36.7683],
  "UPPER HILL": [-1.2989, 36.8144],
  "MUTHAIGA": [-1.2533, 36.8356],
  "GIGIRI": [-1.2333, 36.8167],
  "RUNDA": [-1.2167, 36.8167],
  "KAREN": [-1.3191, 36.7062],
  "LANGATA": [-1.3667, 36.7333],
  "DAGORETTI": [-1.2947, 36.7264],
  "SOUTH B": [-1.3092, 36.8347],
  "SOUTH C": [-1.3208, 36.8272],
  "EASTLEIGH": [-1.2764, 36.8506],
  "BURUBURU": [-1.2833, 36.8833],
  "DONHOLM": [-1.2939, 36.8878],
  "EMBAKASI": [-1.3167, 36.9],
  "PIPELINE": [-1.3125, 36.8992],
  "KAYOLE": [-1.275, 36.9153],
  "UTAWALA": [-1.2833, 36.9667],
  "KASARANI": [-1.22, 36.8969],
  "ROYSAMBU": [-1.2167, 36.8833],
  "KAHAWA": [-1.1833, 36.9167],
  "GITHURAI": [-1.1936, 36.92],
  "RUIRU": [-1.15, 36.96],
  "JUJA": [-1.1036, 37.0144],
  "THIKA": [-1.0333, 37.0693],
  "KIAMBU": [-1.1714, 36.8356],
  "KARURI": [-1.2, 36.7667],
  "RUAKA": [-1.2053, 36.7803],
  "KIKUYU": [-1.2464, 36.6631],
  "NGONG": [-1.3592, 36.6558],
  "RONGAI": [-1.3956, 36.7447],
  "ONGATA RONGAI": [-1.3956, 36.7447],
  "SYOKIMAU": [-1.3583, 36.9269],
  "MLOLONGO": [-1.3925, 36.9522],
  "ATHI RIVER": [-1.4564, 36.9781],
  "ATHI-RIVER": [-1.4564, 36.9781],
  "MAVOKO": [-1.4564, 36.9781],
  "KITENGELA": [-1.475, 36.96],
};

/**
 * County-level names. "Shop 4, Ruaka Town, Kiambu" must price from Ruaka, not
 * from the Kiambu county centre, so these are only consulted once no suburb
 * in the string has matched.
 */
const COARSE = new Set(["NAIROBI", "KIAMBU"]);

// Suburbs before counties; within each, more words first so "ONGATA RONGAI"
// beats "RONGAI" and "NAIROBI CBD" beats "NAIROBI".
const BY_LENGTH = Object.keys(METRO).sort((a, b) => {
  const coarse = Number(COARSE.has(a)) - Number(COARSE.has(b));
  if (coarse) return coarse;
  const words = b.split(" ").length - a.split(" ").length;
  return words || b.length - a.length;
});

function tokens(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** True when `needle` appears as a run of whole words inside `hay`. */
function hasRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

// Word-run matching rather than a regex: locality names contain spaces and
// hyphens, and an escaped-string regex is one backslash away from silently
// matching nothing.
const KEY_TOKENS = BY_LENGTH.map((k) => [k, tokens(k)]);

/**
 * Best coordinates for a locality name or a free-text address.
 * @param {unknown} raw e.g. "Westlands", "Shop 4, Ruaka Town, Kiambu"
 * @returns {{lat:number,lng:number,matched:string}|null} null when nothing matches
 */
export function resolveMetroCoords(raw) {
  const t = tokens(raw);
  if (!t.length) return null;
  for (const [key, kt] of KEY_TOKENS) {
    if (hasRun(t, kt)) {
      const c = METRO[key];
      return { lat: c[0], lng: c[1], matched: key };
    }
  }
  return null;
}

/** Localities this table knows, for tests and admin display. */
export function knownLocalities() {
  return Object.keys(METRO).slice().sort();
}
