/**
 * Depop-style bulk CSV → seller draft rows (no photos yet).
 * Sellers attach photos later via Continue editing / Post.
 */
import { VALID_CONDITIONS } from "./listing-generator.js";

export const BULK_CSV_MAX_ROWS = 50;

export const BULK_CSV_HEADERS = [
  "title",
  "price_kes",
  "category",
  "size",
  "condition",
  "description",
  "color",
  "brand",
  "shipping_kes",
  "tags",
];

const CATEGORY_ALIASES = {
  fashion: "fashion",
  streetwear: "fashion",
  vintage: "fashion",
  sneakers: "fashion",
  shoes: "fashion",
  clothing: "fashion",
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
  "price (kes)": "price_kes",
  pricekes: "price_kes",
  seller_net: "price_kes",
  sellernet: "price_kes",
  category: "category",
  cat: "category",
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
  tags: "tags",
  hashtags: "tags",
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

export function buildBulkCsvTemplate() {
  const sample = [
    [
      "Vintage Nike Windbreaker",
      "2500",
      "fashion",
      "L",
      "gently_used",
      "90s overhead pullover in classic navy",
      "navy",
      "Nike",
      "275",
      "vintage,streetwear,90s",
    ],
    [
      "Levi's 501 Denim Jeans",
      "1800",
      "fashion",
      "32W/32L",
      "like_new",
      "Original blue wash denim",
      "blue",
      "Levi's",
      "275",
      "denim,vintage",
    ],
    [
      "Adidas Samba OG",
      "4500",
      "fashion",
      "UK 9",
      "brand_new_without_tags",
      "Unworn with original box",
      "white",
      "Adidas",
      "300",
      "sneakers",
    ],
  ];
  const lines = [BULK_CSV_HEADERS.join(",")];
  for (const cols of sample) {
    lines.push(cols.map(csvEscape).join(","));
  }
  lines.push("");
  lines.push("# price_kes = what YOU receive (seller-net). Buyers pay shipping + 10% Sokoni fee on top.");
  lines.push("# condition: brand_new_with_tags | brand_new_without_tags | like_new | gently_used | fair_condition");
  lines.push("# category: fashion | phones-tablets | tvs-audio | appliances | health-beauty | home-office | computing | gaming | supermarket | baby-products");
  lines.push("# Photos are added later — CSV creates drafts only. Max 50 rows per upload.");
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeCategory(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/\s+/g, "-");
  return CATEGORY_ALIASES[key] || null;
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

/**
 * @returns {{ rows: object[], errors: { row: number, message: string }[] }}
 */
export function csvTextToDraftRows(csvText, { maxRows = BULK_CSV_MAX_ROWS } = {}) {
  const table = parseCsv(csvText);
  const errors = [];
  if (!table.length) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty." }] };
  }

  // Skip comment lines starting with #
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
          message: "CSV needs title and price_kes columns (see template).",
        },
      ],
    };
  }

  const body = dataTable.slice(1);
  if (body.length > maxRows) {
    errors.push({
      row: 0,
      message: `Too many rows (${body.length}). Max ${maxRows} per upload — split the file.`,
    });
  }

  const rows = [];
  const limited = body.slice(0, maxRows);
  for (let i = 0; i < limited.length; i += 1) {
    const lineNo = i + 2; // 1-based incl header
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

    const category = normalizeCategory(obj.category) || "fashion";
    const condition = normalizeCondition(obj.condition) || "gently_used";
    const shippingRaw = obj.shipping_kes != null && String(obj.shipping_kes).trim() !== "" ? parseMoney(obj.shipping_kes) : null;

    rows.push({
      sourceRow: lineNo,
      draft: {
        name: title.slice(0, 120),
        description: String(obj.description || "").trim().slice(0, 2000),
        sellerNetKes: price,
        priceKes: price,
        sourcePriceKes: price,
        category,
        size: String(obj.size || "").trim().slice(0, 40) || undefined,
        condition,
        isSecondhand: !String(condition).startsWith("brand_new"),
        color: String(obj.color || "").trim().slice(0, 40) || undefined,
        brand: String(obj.brand || "").trim().slice(0, 60) || undefined,
        tags: parseTags(obj.tags),
        shippingKes: Number.isFinite(shippingRaw) ? Math.max(0, shippingRaw) : undefined,
        freeShipping: Number.isFinite(shippingRaw) && shippingRaw === 0,
      },
    });
  }

  return { rows, errors };
}
