/**
 * Depop-style bulk CSV → seller draft rows (no photos yet).
 * Template is data-only — seller instructions live in the web UI, not CSV rows.
 */
import { VALID_CONDITIONS } from "./listing-generator.js";

export const BULK_CSV_MAX_ROWS = 50;

/** Clean data headers for the downloadable template (no instruction rows). */
export const BULK_CSV_HEADERS = [
  "title",
  "price_kes",
  "category",
  "subcategory",
  "size",
  "condition",
  "color",
  "brand",
  "shipping_kes",
  "vibe_tags",
  "description",
  "pit_to_pit_in",
  "length_in",
  "waist_in",
];

/** Catalog category aliases (legacy product.category). */
const CATALOG_CATEGORY_ALIASES = {
  fashion: "fashion",
  streetwear: "fashion",
  vintage: "fashion",
  sneakers: "fashion",
  shoes: "fashion",
  clothing: "fashion",
  thrift: "fashion",
  "phones-tablets": "phones-tablets",
  phones: "phones-tablets",
  phone: "phones-tablets",
  "tvs-audio": "tvs-audio",
  tvs: "tvs-audio",
  audio: "tvs-audio",
  appliances: "appliances",
  "health-beauty": "health-beauty",
  beauty: "health-beauty",
  "home-office": "home-office",
  home: "home-office",
  computing: "computing",
  gaming: "gaming",
  supermarket: "supermarket",
  "baby-products": "baby-products",
  baby: "baby-products",
  restaurant: "restaurant",
  food: "restaurant",
  meals: "restaurant",
  "wines-spirits": "wines-spirits",
  wines: "wines-spirits",
  wine: "wines-spirits",
  spirits: "wines-spirits",
  liquor: "wines-spirits",
  alcohol: "wines-spirits",
  beer: "wines-spirits",
};

/** Browse department aliases (Depop-style). */
const BROWSE_CATEGORY_ALIASES = {
  men: "men",
  mens: "men",
  "men's": "men",
  women: "women",
  womens: "women",
  "women's": "women",
  kids: "kids",
  kid: "kids",
  "health-beauty": "health-beauty",
  beauty: "health-beauty",
  sports: "sports",
  electronics: "electronics",
  phones: "electronics",
  "tv-audio": "electronics",
  computers: "electronics",
  appliances: "electronics",
  home: "home",
  "home-living": "home",
  supermarket: "supermarket",
  grocery: "supermarket",
  automotive: "automotive",
  auto: "automotive",
  pets: "pets",
  pet: "pets",
  office: "office",
  books: "office",
  garden: "garden",
  outdoor: "garden",
  restaurant: "restaurant",
  food: "restaurant",
  meals: "restaurant",
  dishes: "restaurant",
  eats: "restaurant",
  kibanda: "restaurant",
  catering: "restaurant",
  "wines-spirits": "wines-spirits",
  wines: "wines-spirits",
  wine: "wines-spirits",
  spirits: "wines-spirits",
  liquor: "wines-spirits",
  alcohol: "wines-spirits",
  beer: "wines-spirits",
  whisky: "wines-spirits",
  whiskey: "wines-spirits",
  gin: "wines-spirits",
  vodka: "wines-spirits",
  champagne: "wines-spirits",
  bar: "wines-spirits",
  unisex: "trending",
  sneakers: "men",
  streetwear: "trending",
  vintage: "trending",
  fashion: "trending",
  trending: "trending",
};

const SUBCATEGORY_ALIASES = {
  "jackets-coats": "outerwear",
  jackets: "jackets",
  coat: "outerwear",
  coats: "outerwear",
  outerwear: "outerwear",
  jeans: "jeans",
  denim: "jeans",
  "low-tops": "sneakers",
  lowtops: "sneakers",
  sneakers: "sneakers",
  trainers: "trainers",
  tops: "tops",
  "t-shirts": "t-shirts",
  tshirts: "t-shirts",
  tees: "t-shirts",
  hoodies: "hoodies",
  dresses: "dresses",
  skirts: "skirts",
  jumpsuits: "jumpsuits",
  "jumpsuit": "jumpsuits",
  sleepwear: "sleepwear",
  pyjamas: "sleepwear",
  pajamas: "sleepwear",
  trousers: "trousers",
  pants: "trousers",
  shorts: "shorts",
  shoes: "shoes",
  "kids-shoes": "shoes",
  bags: "bags",
  backpack: "bags",
  shirts: "shirts",
  sunglasses: "sunglasses",
  "phone-accessories": "phones",
  "power-banks": "phones",
  "power-bank": "phones",
  televisions: "tvs-audio",
  tv: "tvs-audio",
  gaming: "gaming",
  cameras: "cameras",
  "smart-home": "smart-home",
  cooling: "appliances",
  fans: "appliances",
  furniture: "furniture",
  lighting: "lighting",
  storage: "storage",
  "pet-food": "pet-food",
  stationery: "stationery",
  plants: "plants",
  "nyama-choma": "nyama-choma",
  nyama: "nyama-choma",
  choma: "nyama-choma",
  ugali: "ugali-plates",
  "ugali-plates": "ugali-plates",
  pilau: "pilau-biryani",
  biryani: "pilau-biryani",
  "pilau-biryani": "pilau-biryani",
  chapati: "chapati-meals",
  "chapati-meals": "chapati-meals",
  githeri: "githeri-stews",
  stew: "githeri-stews",
  "githeri-stews": "githeri-stews",
  chicken: "chicken-dishes",
  "chicken-dishes": "chicken-dishes",
  fish: "fish-seafood",
  seafood: "fish-seafood",
  "fish-seafood": "fish-seafood",
  "street-bites": "street-bites",
  "street-food": "street-bites",
  breakfast: "breakfast",
  "lunch-boxes": "lunch-boxes",
  lunch: "lunch-boxes",
  vegan: "vegan-plant",
  "vegan-plant": "vegan-plant",
  "healthy-bowls": "healthy-bowls",
  healthy: "healthy-bowls",
  "diet-meals": "diet-meals",
  diet: "diet-meals",
  juices: "fresh-juices",
  "fresh-juices": "fresh-juices",
  desserts: "desserts",
  dessert: "desserts",
  catering: "catering-platters",
  "catering-platters": "catering-platters",
  "local-beer": "local-beer",
  beer: "local-beer",
  tusker: "local-beer",
  "kenyan-spirits": "kenyan-spirits",
  "kenya-cane": "kenyan-spirits",
  cane: "kenyan-spirits",
  "red-wine": "red-wine",
  "white-wine": "white-wine",
  "sparkling-champagne": "sparkling-champagne",
  champagne: "sparkling-champagne",
  sparkling: "sparkling-champagne",
  whisky: "whisky",
  whiskey: "whisky",
  gin: "gin",
  vodka: "vodka",
  "cognac-brandy": "cognac-brandy",
  cognac: "cognac-brandy",
  brandy: "cognac-brandy",
  rum: "rum",
  "cider-rtd": "cider-rtd",
  cider: "cider-rtd",
  rtd: "cider-rtd",
  liqueurs: "liqueurs",
  liqueur: "liqueurs",
  mixers: "mixers",
  mixer: "mixers",
  "party-packs": "party-packs",
  "party-pack": "party-packs",
  "non-alcoholic": "non-alcoholic",
  "alcohol-free": "non-alcoholic",
};

const CONDITION_ALIASES = {
  brand_new_with_tags: "brand_new_with_tags",
  "brand new with tags": "brand_new_with_tags",
  bnwt: "brand_new_with_tags",
  brand_new_without_tags: "brand_new_without_tags",
  "brand new without tags": "brand_new_without_tags",
  "brand new": "brand_new_without_tags",
  new: "brand_new_without_tags",
  like_new: "like_new",
  "like new": "like_new",
  excellent: "like_new",
  gently_used: "gently_used",
  "gently used": "gently_used",
  "pre-loved": "gently_used",
  preloved: "gently_used",
  "pre loved": "gently_used",
  fair_condition: "fair_condition",
  "fair condition": "fair_condition",
  fair: "fair_condition",
};

const HEADER_ALIASES = {
  title: "title",
  name: "title",
  item: "title",
  product: "title",
  price_kes: "price_kes",
  price: "price_kes",
  "price_(kes)": "price_kes",
  pricekes: "price_kes",
  seller_net: "price_kes",
  sellernet: "price_kes",
  category: "category",
  cat: "category",
  department: "category",
  subcategory: "subcategory",
  sub_category: "subcategory",
  subcat: "subcategory",
  browse_sub: "subcategory",
  "browse_subcategory": "subcategory",
  size: "size",
  condition: "condition",
  description: "description",
  desc: "description",
  details: "description",
  color: "color",
  colour: "color",
  brand: "brand",
  shipping_kes: "shipping_kes",
  shipping: "shipping_kes",
  tags: "vibe_tags",
  hashtags: "vibe_tags",
  vibe_tags: "vibe_tags",
  vibes: "vibe_tags",
  aesthetics: "vibe_tags",
  pit_to_pit_in: "pit_to_pit_in",
  pit_to_pit: "pit_to_pit_in",
  p2p: "pit_to_pit_in",
  chest: "pit_to_pit_in",
  length_in: "length_in",
  length: "length_in",
  waist_in: "waist_in",
  waist: "waist_in",
};

/** Minimal RFC4180-ish CSV parse (quoted fields, commas, newlines). */
export function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") {
      row.push(cell);
      cell = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function mapHeader(raw) {
  const key = normalizeHeader(raw);
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key];
  const spaced = key.replace(/_/g, " ");
  if (HEADER_ALIASES[spaced]) return HEADER_ALIASES[spaced];
  return null;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Data-only template — helpers/tooltips live in the seller Hub UI. */
export function buildBulkCsvTemplate() {
  const sample = [
    [
      "Vintage Nike Windbreaker",
      "2500",
      "Men",
      "Outerwear",
      "L",
      "gently_used",
      "Navy",
      "Nike",
      "275",
      "vintage,streetwear,90s",
      "90s overhead pullover in classic navy",
      "22",
      "28",
      "",
    ],
    [
      "Levi's 501 Denim Jeans",
      "1800",
      "Women",
      "Jeans",
      "32W/32L",
      "like_new",
      "Blue",
      "Levi's",
      "275",
      "denim,vintage,y2k",
      "Original blue wash denim in top shape",
      "",
      "42",
      "32",
    ],
    [
      "Adidas Samba OG",
      "4500",
      "Men",
      "Sneakers",
      "UK 9",
      "brand_new_without_tags",
      "White",
      "Adidas",
      "300",
      "streetwear,retro",
      "Unworn with original box",
      "",
      "",
      "",
    ],
  ];
  const lines = [BULK_CSV_HEADERS.join(",")];
  for (const cols of sample) {
    lines.push(cols.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function slugKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[_/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeCatalogCategory(raw) {
  const key = slugKey(raw);
  return CATALOG_CATEGORY_ALIASES[key] || null;
}

function normalizeBrowseCategory(raw) {
  const key = slugKey(raw).replace(/-/g, "");
  const withDash = slugKey(raw);
  return BROWSE_CATEGORY_ALIASES[withDash] || BROWSE_CATEGORY_ALIASES[key] || null;
}

function normalizeSubcategory(raw) {
  const key = slugKey(raw);
  if (!key) return null;
  if (SUBCATEGORY_ALIASES[key]) return SUBCATEGORY_ALIASES[key];
  return key.slice(0, 40);
}

function normalizeCondition(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const mapped = CONDITION_ALIASES[key] || CONDITION_ALIASES[key.replace(/\s+/g, "_")];
  if (mapped && VALID_CONDITIONS.includes(mapped)) return mapped;
  const snake = key.replace(/\s+/g, "_");
  if (VALID_CONDITIONS.includes(snake)) return snake;
  return null;
}

function parseTags(raw) {
  return String(raw || "")
    .split(/[,;#]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
}

function parseMoney(raw) {
  const n = Number(String(raw || "").replace(/[,\sKES]/gi, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function parseOptionalInches(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 10) / 10;
}

function resolveCategories(categoryRaw, subcategoryRaw) {
  const browse = normalizeBrowseCategory(categoryRaw);
  const catalog = normalizeCatalogCategory(categoryRaw);
  const sub = normalizeSubcategory(subcategoryRaw);

  // Thrift-first defaults: Men/Women/Kids → fashion catalog + browse path
  if (browse && browse !== "trending") {
    return {
      category: catalog && catalog !== "fashion" ? catalog : "fashion",
      browseCategory: browse,
      browseSubCategory: sub || undefined,
    };
  }
  if (catalog) {
    return {
      category: catalog,
      browseCategory: browse || (catalog === "fashion" ? "trending" : undefined),
      browseSubCategory: sub || undefined,
    };
  }
  return {
    category: "fashion",
    browseCategory: "trending",
    browseSubCategory: sub || "streetwear",
  };
}

/**
 * @returns {{ rows: object[], errors: { row: number, message: string }[] }}
 */
export function csvTextToDraftRows(csvText, { maxRows = BULK_CSV_MAX_ROWS } = {}) {
  const table = parseCsv(csvText);
  const errors = [];
  if (!table.length) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty." }] };
  }

  // Ignore leftover comment rows from older templates
  const dataTable = table.filter((r) => !String(r[0] || "").trim().startsWith("#"));
  if (!dataTable.length) {
    return { rows: [], errors: [{ row: 0, message: "CSV has no data rows." }] };
  }

  const headerCells = dataTable[0];
  const headerMap = [];
  for (let i = 0; i < headerCells.length; i += 1) {
    headerMap[i] = mapHeader(headerCells[i]);
  }
  if (!headerMap.includes("title") || !headerMap.includes("price_kes")) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: "CSV needs title and price_kes columns (download the latest template).",
        },
      ],
    };
  }

  const body = dataTable.slice(1).filter((cells) => {
    const first = String(cells[0] || "").trim();
    if (!first || first.startsWith("#")) return false;
    // Skip rows that are entirely empty / NaN-like
    return cells.some((c) => String(c || "").trim() !== "");
  });

  if (body.length > maxRows) {
    errors.push({
      row: 0,
      message: `Too many rows (${body.length}). Max ${maxRows} per upload — split the file.`,
    });
  }

  const rows = [];
  const limited = body.slice(0, maxRows);
  for (let i = 0; i < limited.length; i += 1) {
    const lineNo = i + 2;
    const cells = limited[i];
    const obj = {};
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key) continue;
      obj[key] = cells[c] != null ? String(cells[c]).trim() : "";
    }

    const title = String(obj.title || "").trim();
    if (!title) {
      errors.push({ row: lineNo, message: "Title is required." });
      continue;
    }
    const price = parseMoney(obj.price_kes);
    if (!Number.isFinite(price) || price < 1) {
      errors.push({ row: lineNo, message: "price_kes must be a positive number (what you receive)." });
      continue;
    }

    const cats = resolveCategories(obj.category, obj.subcategory);
    const condition = normalizeCondition(obj.condition) || "gently_used";
    const shippingRaw =
      obj.shipping_kes != null && String(obj.shipping_kes).trim() !== ""
        ? parseMoney(obj.shipping_kes)
        : null;
    const tags = parseTags(obj.vibe_tags || obj.tags);
    const pitToPitIn = parseOptionalInches(obj.pit_to_pit_in);
    const lengthIn = parseOptionalInches(obj.length_in);
    const waistIn = parseOptionalInches(obj.waist_in);

    rows.push({
      sourceRow: lineNo,
      draft: {
        name: title.slice(0, 120),
        description: String(obj.description || "").trim().slice(0, 2000),
        sellerNetKes: price,
        priceKes: price,
        sourcePriceKes: price,
        category: cats.category,
        browseCategory: cats.browseCategory,
        browseSubCategory: cats.browseSubCategory,
        size: String(obj.size || "").trim().slice(0, 40) || undefined,
        condition,
        isSecondhand: !String(condition).startsWith("brand_new"),
        color: String(obj.color || "").trim().slice(0, 40) || undefined,
        brand: String(obj.brand || "").trim().slice(0, 60) || undefined,
        tags,
        shippingKes: Number.isFinite(shippingRaw) ? Math.max(0, shippingRaw) : undefined,
        freeShipping: Number.isFinite(shippingRaw) && shippingRaw === 0,
        pitToPitIn,
        lengthIn,
        waistIn,
      },
    });
  }

  return { rows, errors };
}

/** Help copy for UI (never embedded in CSV data rows). */
export function bulkCsvUiHelp() {
  return {
    maxRows: BULK_CSV_MAX_ROWS,
    headers: BULK_CSV_HEADERS,
    tips: [
      "price_kes is what you receive (seller-net). Buyers pay shipping + 10% Sokoni fee on top.",
      "category: Men, Women, Kids — or fashion / phones-tablets for catalog categories.",
      "subcategory examples: Outerwear, Jeans, Sneakers, Tops, Hoodies, Dresses.",
      "condition: brand_new_with_tags | brand_new_without_tags | like_new | gently_used | fair_condition",
      "vibe_tags: vintage, streetwear, y2k, denim (comma-separated, up to 5).",
      "Flat measurements (inches) cut size disputes: pit_to_pit_in, length_in, waist_in.",
      "CSV creates drafts only — add up to 8 photos, then Post.",
    ],
  };
}
