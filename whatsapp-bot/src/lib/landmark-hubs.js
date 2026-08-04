/**
 * Curated Kenyan parcel hubs / landmarks for checkout (Feature 2).
 * Free-text "other" remains allowed — this catalog is the structured option.
 */

export const DELIVERY_TYPES = Object.freeze(["parcel_hub", "landmark", "meetup", "other"]);

/** @type {Record<string, string[]>} */
export const LANDMARK_HUBS = {
  "Nairobi CBD": ["Kencom Bus Stage", "Archways Mall Hub", "Khoja Stage", "Imenti House"],
  "Kilimani / Westlands": [
    "Shell Petrol Station (Kilimani)",
    "Sarit Centre Drop-off",
    "Yaya Centre entrance",
  ],
  Eldoret: ["Uganda Road Hub", "Naivas Supermarket CBD"],
  Mombasa: ["Digo Road Station", "Nyali Centre Drop-off"],
};

/**
 * Flatten hubs for API / dropdowns.
 * @returns {{ towns: string[], hubs: Record<string, string[]>, options: Array<{ town: string, spotName: string, id: string }> }}
 */
export function listLandmarkHubs() {
  const towns = Object.keys(LANDMARK_HUBS);
  const options = [];
  for (const town of towns) {
    for (const spotName of LANDMARK_HUBS[town] || []) {
      options.push({
        town,
        spotName,
        id: landmarkOptionId(town, spotName),
      });
    }
  }
  return { towns, hubs: LANDMARK_HUBS, options };
}

export function landmarkOptionId(town, spotName) {
  const t = String(town || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const s = String(spotName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${t}__${s}`;
}

/**
 * Resolve a structured landmark selection.
 * @param {{ deliveryType?: string, town?: string, spotName?: string, landmarkId?: string, instructions?: string, locationText?: string }} input
 */
export function resolveLandmarkSelection(input = {}) {
  const hubs = listLandmarkHubs();
  const deliveryTypeRaw = String(input.deliveryType || "").trim().toLowerCase();
  const deliveryType = DELIVERY_TYPES.includes(deliveryTypeRaw) ? deliveryTypeRaw : "";
  const instructions = String(input.instructions || "").trim().slice(0, 280);
  const locationText = String(input.locationText || input.location || "").trim();

  let town = String(input.town || "").trim();
  let spotName = String(input.spotName || "").trim();

  if (input.landmarkId) {
    const match = hubs.options.find((o) => o.id === String(input.landmarkId));
    if (match) {
      town = match.town;
      spotName = match.spotName;
    }
  }

  const catalogHit =
    town &&
    spotName &&
    Array.isArray(LANDMARK_HUBS[town]) &&
    LANDMARK_HUBS[town].some((s) => s.toLowerCase() === spotName.toLowerCase());

  if (catalogHit || deliveryType === "parcel_hub") {
    if (!town || !spotName) {
      return { error: "invalid_landmark", message: "Choose a town and drop-off spot." };
    }
    if (!catalogHit) {
      return { error: "unknown_hub", message: "That hub is not on the Sokoni list — pick another or use Other." };
    }
    const composed = [spotName, town, instructions].filter(Boolean).join(" · ");
    return {
      ok: true,
      deliveryType: "parcel_hub",
      landmarkTown: town,
      landmarkSpot: spotName,
      landmarkInstructions: instructions || null,
      landmarkId: landmarkOptionId(town, spotName),
      location: composed,
    };
  }

  // Free-text landmark / meetup / other
  if (locationText.length < 4 && !spotName) {
    return {
      error: "invalid_delivery_details",
      message: "Enter a clearer delivery location (estate/town + landmark).",
    };
  }

  const composed =
    locationText ||
    [spotName, town, instructions].filter(Boolean).join(" · ") ||
    "";

  return {
    ok: true,
    deliveryType: deliveryType || (town || spotName ? "landmark" : "other"),
    landmarkTown: town || null,
    landmarkSpot: spotName || null,
    landmarkInstructions: instructions || null,
    landmarkId: null,
    location: composed,
  };
}

/**
 * Compact landmark summary for WhatsApp / labels.
 */
export function formatLandmarkLine(order) {
  if (!order) return "";
  if (order.landmarkSpot && order.landmarkTown) {
    const extra = order.landmarkInstructions ? ` · ${order.landmarkInstructions}` : "";
    return `${order.landmarkSpot}, ${order.landmarkTown}${extra}`;
  }
  return String(order.location || "").trim();
}
