/**
 * Map pins, from WhatsApp's native location share or a web map picker.
 *
 * One shape everywhere: sellers pin where they hand parcels over, riders pin
 * their stage, buyers pin the door. Delivery pricing measures between them and
 * the CONFIRM geofence checks against the buyer's, so a pin that is wrong is
 * worse than no pin -- everything here fails closed.
 */

/**
 * Kenya's bounding box, generously drawn. Catches the common failures: a pin
 * that arrived as 0,0, one with lat and lng swapped, or a device reporting a
 * location from somewhere else entirely.
 */
const KE = { minLat: -4.8, maxLat: 5.1, minLng: 33.8, maxLng: 41.95 };

/** @param {unknown} lat @param {unknown} lng */
export function isInKenya(lat, lng) {
  const a = Number(lat);
  const o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return false;
  if (a === 0 && o === 0) return false;
  return a >= KE.minLat && a <= KE.maxLat && o >= KE.minLng && o <= KE.maxLng;
}

/**
 * Normalise a pin from any source into {lat, lng}, or null.
 *
 * Accepts the WAHA location payload, a {latitude, longitude} pair from a web
 * picker, and a "lat,lng" string. Rounds to 6dp -- about 10cm, well past what
 * a phone GPS can justify, and keeps the stored value stable.
 *
 * @param {unknown} raw
 * @returns {{lat:number,lng:number}|null}
 */
export function normalizePin(raw) {
  if (!raw) return null;
  let lat;
  let lng;

  if (typeof raw === "string") {
    const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    lat = Number(m[1]);
    lng = Number(m[2]);
  } else if (typeof raw === "object") {
    lat = Number(raw.lat ?? raw.latitude ?? raw.degreesLatitude);
    lng = Number(raw.lng ?? raw.lon ?? raw.longitude ?? raw.degreesLongitude);
  } else {
    return null;
  }

  if (!isInKenya(lat, lng)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** Google Maps link, for ops and for the rider's job card. */
export function pinLink(pin) {
  const p = normalizePin(pin);
  return p ? `https://maps.google.com/?q=${p.lat},${p.lng}` : "";
}

/** How to send a pin, worded for WhatsApp. */
export const PIN_HOW_TO =
  "Tap 📎 *Attach* → *Location* → *Send your current location*.\n" +
  "_Stand where you want the pin before you send it._";

/**
 * Why we are asking, per role. Someone being asked for their location deserves
 * to know what it is used for.
 */
export function pinReason(role) {
  switch (role) {
    case "seller":
      return "This is where riders collect parcels from you. It sets your delivery prices too, so put it on your actual shop.";
    case "rider":
      return "Jobs are offered to the riders nearest the pickup, so this decides what work reaches you.";
    case "buyer":
      return "The rider needs it to find your door, and it sets your delivery fee.";
    default:
      return "";
  }
}
