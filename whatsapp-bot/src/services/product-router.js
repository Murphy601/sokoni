import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getPerfumeVariantsForFamily,
  getPerfumeProductByFamilyAndSize,
  searchProducts,
} from "./catalog.js";
import { looksLikeDeliveryDetails } from "./delivery-details.js";

import { CATALOG_PAGE_SIZE } from "./list-format.js";

function getPagedSlice(items, page = 0, pageSize = CATALOG_PAGE_SIZE) {
  if (!items?.length) return [];
  const start = (page || 0) * (pageSize || CATALOG_PAGE_SIZE);
  return items.slice(start, start + (pageSize || CATALOG_PAGE_SIZE));
}

/** Current page of scent names — pageFamilies is pre-sliced; do not paginate again. */
function getScentPageFamilies(menuState) {
  if (!menuState) return [];
  if (menuState.pageFamilies?.length) return menuState.pageFamilies;
  return getPagedSlice(menuState.scentFamilies, menuState.page, menuState.pageSize);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENTS_FILE = path.join(__dirname, "..", "data", "perfume-oils-scents.txt");

let scentNamesCache = null;

async function loadScentNames() {
  if (scentNamesCache) return scentNamesCache;
  const raw = await readFile(SCENTS_FILE, "utf-8");
  scentNamesCache = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return scentNamesCache;
}

function normalizeForMatch(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse bottle size from free text (e.g. "1 litre", "50ml"). */
export function parseSizeFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b1\s*l(?:itre|iter|trs?)?\b/.test(t) || /\bone\s+litre\b/.test(t)) return 1000;
  const ml = t.match(/\b(\d+)\s*ml\b/);
  if (ml) return Number(ml[1]);
  return null;
}

export function stripPerfumeNoise(text) {
  return String(text || "")
    .replace(/\b\d+\s*ml\b/gi, "")
    .replace(/\b1\s*l(?:itre|iter|trs?)?\b/gi, "")
    .replace(/\bone\s+litre\b/gi, "")
    .replace(/\bperfume\s*oil(s)?\b/gi, "")
    .replace(/\b(perfume|perfumes|cologne|fragrance|fragrances|scent|attar|oil)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreTextMatch(query, target) {
  const q = normalizeForMatch(query);
  const s = normalizeForMatch(target);
  if (!q || !s) return 0;
  if (q === s) return 1000;
  if (s.startsWith(q)) return 850 + q.length;
  if (s.includes(q)) return 700 + q.length;
  if (q.includes(s) && s.length >= 4) return 650;

  const qWords = q.split(" ").filter((w) => w.length > 1);
  const sWords = s.split(" ");
  let overlap = 0;
  for (const w of qWords) {
    if (sWords.some((sw) => sw === w || sw.startsWith(w) || w.startsWith(sw))) {
      overlap += w.length * 15;
    }
  }
  if (overlap > 0) return overlap;

  if (qWords.length === 1 && q.length >= 3) {
    const first = sWords[0] || s;
    const dist = levenshtein(q, first);
    if (dist <= 2) return 450 - dist * 40;
    const distFull = levenshtein(q, s.slice(0, Math.min(s.length, q.length + 8)));
    if (distFull <= 3) return 400 - distFull * 30;
  }
  return 0;
}

function scoreScentMatch(query, scentName) {
  return scoreTextMatch(query, scentName);
}

function scoreProductMatch(query, product) {
  const hay = [product.name, product.category, product.subcategory, ...(product.tags || [])].join(" ");
  const nameScore = scoreTextMatch(query, product.name);
  const hayScore = scoreTextMatch(query, hay) * 0.85;
  return Math.max(nameScore, hayScore);
}

function stripSearchNoise(text) {
  return String(text || "")
    .replace(
      /\b(i|me|my|want|need|looking|for|show|find|get|buy|order|please|can|you|give|a|an|the|do|have|any)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakCatalogQuery(text) {
  const q = stripSearchNoise(text);
  return !q || q.length < 2 || /^(hi|hey|hello|thanks|ok|okay|yes|no|next|more|prev|previous|back)$/i.test(q);
}

export function isCatalogNavCommand(text) {
  return /^(next|more|prev|previous|back)$/i.test(String(text || "").trim());
}

/** Paginate product/scent lists — must run before free-text product search. */
export async function handleCatalogPagination(customerKey, text) {
  if (!isCatalogNavCommand(text)) return false;

  const { getMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { sendProductsForSubcategory, sendPerfumeScentList } = await import("./menu.js");
  const normalized = String(text || "").trim().toLowerCase();
  const menuState = getMenuState(customerKey);

  if (menuState?.type === "product_list_paged" && menuState.rowId) {
    if (/^(next|more)$/i.test(normalized)) {
      const totalPages = Math.ceil((menuState.allProductIds?.length || 0) / (menuState.pageSize || CATALOG_PAGE_SIZE));
      const nextPage = (menuState.page || 0) + 1;
      if (nextPage < totalPages) {
        await sendProductsForSubcategory(customerKey, menuState.rowId, nextPage);
        return true;
      }
      await sendText(customerKey, "You're on the last page. Reply with a number to order, or *menu*.");
      return true;
    }
    if (/^(prev|previous|back)$/i.test(normalized) && (menuState.page || 0) > 0) {
      await sendProductsForSubcategory(customerKey, menuState.rowId, menuState.page - 1);
      return true;
    }
  }

  if (menuState?.type === "scent_list_paged" && menuState.rowId) {
    if (/^(next|more)$/i.test(normalized)) {
      const totalPages = Math.ceil((menuState.scentFamilies?.length || 0) / (menuState.pageSize || CATALOG_PAGE_SIZE));
      const nextPage = (menuState.page || 0) + 1;
      if (nextPage < totalPages) {
        await sendPerfumeScentList(customerKey, { page: nextPage, rowId: menuState.rowId });
        return true;
      }
      await sendText(customerKey, "Last page. Reply with a scent number or type a name (e.g. *BRUT*).");
      return true;
    }
    if (/^(prev|previous|back)$/i.test(normalized) && (menuState.page || 0) > 0) {
      await sendPerfumeScentList(customerKey, { page: menuState.page - 1, rowId: menuState.rowId });
      return true;
    }
  }

  return false;
}

function isPerfumeBrowseIntent(text) {
  return /\b(perfume|perfumes|fragrance|fragrances|cologne|attar|scent)\b/i.test(text);
}

const NON_PERFUME_PRODUCT_HINTS =
  /\b(watch|watches|phone|phones|tablet|tablets|laptop|laptops|tv|television|fridge|refrigerator|console|consoles|gps|smartphone|headphone|headphones|speaker|speakers|camera|cameras|hisense|samsung|iphone|ipad|macbook|playstation|xbox|blender|kettle|washing|washer|dryer|monitor|keyboard|mouse|router|modem|charger|powerbank|power\s*bank|series\s*\d|android|windows|intel|amd|nvidia|mm\b|inch|gb\b|ram\b|smart\s*tv)\b/i;

function isNonPerfumeProductQuery(text) {
  return NON_PERFUME_PRODUCT_HINTS.test(String(text || ""));
}

function shouldTryPerfumeRouting(text) {
  if (isCatalogNavCommand(text)) return false;
  if (isNonPerfumeProductQuery(text)) return false;
  if (isPerfumeBrowseIntent(text)) return true;
  const q = stripPerfumeNoise(text);
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (words.length <= 2) return true;
  return /\b(oil|oils|ml|litre|liter|attar|eau)\b/i.test(text);
}

function isYes(text) {
  return /^(yes|y|yeah|yep|ndio|sawa|ok|okay|1)$/i.test(text.trim());
}

function isNo(text) {
  return /^(no|n|hapana|2)$/i.test(text.trim());
}

function parseNumericChoice(text) {
  const match = String(text || "").trim().match(/^(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

function findScentByNameInput(text, names) {
  const raw = String(text || "").trim();
  if (/^\d{1,2}$/.test(raw)) return null;
  const q = normalizeForMatch(text);
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const name of names) {
    const score = scoreScentMatch(q, name);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return bestScore >= 400 ? best : null;
}

/**
 * Perfume scent resolution (two-step browse + size picker).
 */
async function resolvePerfumeScentQuery(scentQuery, sizeMl) {
  const scents = await loadScentNames();
  const ranked = scents
    .map((name) => ({ name, score: scoreScentMatch(scentQuery, name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { action: "none" };

  const top = ranked[0];
  const second = ranked[1];
  const ambiguous =
    second && second.score >= top.score * 0.88 && top.score < 950 && top.score - second.score < 120;

  if (ambiguous) {
    return {
      action: "disambiguate",
      matches: ranked.slice(0, 5).map((r) => r.name),
      sizeMl,
      kind: "perfume",
    };
  }

  if (sizeMl != null && top.score >= 350) {
    const product = await getPerfumeProductByFamilyAndSize(top.name, sizeMl);
    if (product) {
      return { action: "exact", scentFamily: top.name, sizeMl, product, kind: "perfume" };
    }
  }

  if (top.score >= 750) {
    return { action: "confirm", scentFamily: top.name, sizeMl, matches: [top.name], kind: "perfume" };
  }

  if (ranked.length >= 2 && top.score < 750) {
    return {
      action: "disambiguate",
      matches: ranked.slice(0, Math.min(5, ranked.length)).map((r) => r.name),
      sizeMl,
      kind: "perfume",
    };
  }

  if (top.score >= 400) {
    return { action: "confirm", scentFamily: top.name, sizeMl, matches: [top.name], kind: "perfume" };
  }

  return { action: "none" };
}

function resultConfidence(result, query = "") {
  if (!result || result.action === "none") return 0;
  if (result.action === "browse_perfumes") return 800;
  if (result.action === "exact") return 1000;
  if (result.action === "confirm") {
    if (result.kind === "perfume" && result.scentFamily) {
      return scoreScentMatch(query, result.scentFamily);
    }
    if (result.product) return scoreProductMatch(query, result.product);
    return 700;
  }
  if (result.action === "disambiguate") {
    if (result.matches?.[0]) return scoreScentMatch(query, result.matches[0]);
    if (result.products?.[0]) return scoreProductMatch(query, result.products[0]);
    return 500;
  }
  return 0;
}

/** General catalog search across all store products. */
async function resolveGeneralProductQuery(text) {
  const query = stripSearchNoise(text);
  if (isWeakCatalogQuery(text)) return { action: "none" };

  const searchAll = isNonPerfumeProductQuery(text) || /["'][^"']{4,}["']/.test(text);
  const searchOpts = { keywords: query, limit: 8 };
  if (!searchAll) {
    searchOpts.fulfillment = "store";
    searchOpts.scope = "local";
  }

  const products = await searchProducts(searchOpts);
  if (products.length === 0) return { action: "none" };

  const ranked = products.map((product, index) => {
    const matchScore = scoreProductMatch(query, product);
    return {
      product,
      matchScore,
      score: Math.max(matchScore, 500 - index * 40),
    };
  });

  const top = ranked[0];
  const second = ranked[1];
  const ambiguous =
    second &&
    top.matchScore >= 80 &&
    second.matchScore >= top.matchScore * 0.85 &&
    top.matchScore < 950 &&
    top.matchScore - second.matchScore < 120;

  if (ambiguous) {
    return {
      action: "disambiguate",
      products: ranked.slice(0, 5).map((r) => r.product),
      kind: "product",
    };
  }

  if (top.matchScore >= 500 || (top.matchScore >= 120 && top.matchScore - (second?.matchScore || 0) >= 60)) {
    return { action: "exact", product: top.product, kind: "product" };
  }

  if (top.matchScore >= 250 || top.score >= 450) {
    return { action: "confirm", product: top.product, kind: "product" };
  }

  if (ranked.length >= 2) {
    return {
      action: "disambiguate",
      products: ranked.slice(0, 5).map((r) => r.product),
      kind: "product",
    };
  }

  return { action: "confirm", product: top.product, kind: "product" };
}

/**
 * Catalog-first product resolution (all categories).
 * Perfume oils use scent/size flow; everything else uses general catalog search.
 */
export async function resolveProductQuery(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 2) return { action: "none" };
  if (isCatalogNavCommand(raw)) return { action: "none" };
  if (looksLikeDeliveryDetails(raw)) return { action: "none" };

  const sizeMl = parseSizeFromText(raw);
  const scentQuery = stripPerfumeNoise(raw);

  if ((!scentQuery || scentQuery.length < 2) && isPerfumeBrowseIntent(raw)) {
    return { action: "browse_perfumes" };
  }

  const perfumeResult =
    shouldTryPerfumeRouting(raw) && scentQuery && scentQuery.length >= 2
      ? await resolvePerfumeScentQuery(scentQuery, sizeMl)
      : { action: "none" };
  const generalResult = await resolveGeneralProductQuery(raw);

  if (sizeMl != null && perfumeResult.action !== "none") return perfumeResult;

  const perfumeScore = resultConfidence(perfumeResult, scentQuery);
  const generalScore = resultConfidence(generalResult, raw);

  if (generalScore > perfumeScore && generalResult.action !== "none") return generalResult;
  if (perfumeResult.action !== "none") return perfumeResult;
  if (generalResult.action !== "none") return generalResult;
  return { action: "none" };
}

export async function sendProductConfirm(to, product) {
  const { setMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { formatListNumber } = await import("./list-format.js");
  setMenuState(to, { type: "product_confirm", productId: product.id, productName: product.name });
  return sendText(
    to,
    `Do you mean *${product.name}*?\n\n` +
      `${formatListNumber(1)} *Yes* — view & order\n` +
      `${formatListNumber(2)} *No* — search again\n\n` +
      `_Or type *menu* to browse categories._`
  );
}

export async function sendProductDisambiguation(to, products) {
  const { setMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { formatListNumber, formatKes, CATALOG_PAGE_SIZE } = await import("./list-format.js");
  const picks = products.slice(0, CATALOG_PAGE_SIZE);
  const lines = picks.map(
    (p, i) => `${formatListNumber(i + 1)} *${p.name}*\n   ${formatKes(p.priceKes)} · pay on delivery`
  );
  setMenuState(to, {
    type: "product_pick",
    productIds: picks.map((p) => p.id),
    productNames: picks.map((p) => p.name),
  });
  const more =
    products.length > CATALOG_PAGE_SIZE
      ? `\n_Showing top ${CATALOG_PAGE_SIZE}. Type more of the name to narrow down._\n`
      : "";
  return sendText(
    to,
    `*Do you mean one of these?*\n\n${lines.join("\n\n")}${more}\n` +
      `Reply with the *number* or type more of the product name.`
  );
}

export async function sendScentConfirm(to, scentFamily, sizeMl = null) {
  const { showProductActions } = await import("./menu.js");
  if (sizeMl != null) {
    const product = await getPerfumeProductByFamilyAndSize(scentFamily, sizeMl);
    if (product) return showProductActions(to, product.id);
  }
  const { setMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { formatListNumber } = await import("./list-format.js");
  setMenuState(to, { type: "scent_confirm", scentFamily, sizeMl });
  return sendText(
    to,
    `Do you mean *${scentFamily}* perfume oil?\n\n` +
      `${formatListNumber(1)} *Yes* — pick your size\n` +
      `${formatListNumber(2)} *No* — search again\n\n` +
      `_Or type *menu* to browse the full list._`
  );
}

export async function sendScentDisambiguation(to, matches, sizeMl = null) {
  const { setMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { formatListNumber } = await import("./list-format.js");
  const lines = matches.map((name, i) => `${formatListNumber(i + 1)} *${name}*`);
  setMenuState(to, { type: "scent_pick", matches, sizeMl });
  return sendText(
    to,
    `*Do you mean one of these?*\n\n${lines.join("\n")}\n\n` +
      `Reply with the *number* or type the exact scent name.`
  );
}

function isProductMenuChoice(text) {
  return /^[123]$/.test(String(text || "").trim());
}

/** Handle multi-step catalog flows + free-text product routing (all categories). */
export async function handleProductRouter(customerKey, text) {
  const { getMenuState } = await import("./session.js");
  const { sendText } = await import("./whatsapp.js");
  const { formatListNumber } = await import("./list-format.js");
  const { sendPerfumeSizePicker, sendPerfumeScentList, showProductActions } = await import("./menu.js");

  const normalized = text.toLowerCase().trim();
  if (looksLikeDeliveryDetails(text)) return false;
  if (await handleCatalogPagination(customerKey, text)) return true;
  const choice = parseNumericChoice(text);
  const menuState = getMenuState(customerKey);

  if (menuState?.type === "product" && isProductMenuChoice(text)) {
    const { handleMenuAction, startCodOrder } = await import("./menu.js");
    const choice = parseNumericChoice(text);
    const option = menuState.options?.[choice - 1];
    if (!option) return false;
    if (option.id.startsWith("order_")) {
      return startCodOrder(customerKey, menuState.productId);
    }
    return handleMenuAction(customerKey, option.id);
  }

  if (menuState?.type === "product_confirm") {
    if (isYes(normalized) || choice === 1) {
      return showProductActions(customerKey, menuState.productId);
    }
    if (isNo(normalized) || choice === 2) {
      return sendText(customerKey, "Sawa 👍 Type the product name again (e.g. *Hisense TV*) or *menu* to browse.");
    }
    return sendText(customerKey, `Reply ${formatListNumber(1)} for *Yes* or ${formatListNumber(2)} for *No*.`);
  }

  if (menuState?.type === "product_pick" && menuState.productIds?.length) {
    if (choice && menuState.productIds[choice - 1]) {
      return showProductActions(customerKey, menuState.productIds[choice - 1]);
    }
    const names = menuState.productNames || [];
    let bestId = null;
    let bestScore = 0;
    for (let i = 0; i < names.length; i++) {
      const score = scoreTextMatch(text, names[i]);
      if (score > bestScore) {
        bestScore = score;
        bestId = menuState.productIds[i];
      }
    }
    if (bestScore >= 400 && bestId) return showProductActions(customerKey, bestId);
  }

  if (menuState?.type === "scent_confirm") {
    if (isYes(normalized) || choice === 1) {
      return sendPerfumeSizePicker(customerKey, menuState.scentFamily);
    }
    if (isNo(normalized) || choice === 2) {
      return sendText(customerKey, "Sawa 👍 Type the scent name again (e.g. *Brut 1 litre*) or *menu* → Perfume Oils.");
    }
    return sendText(customerKey, `Reply ${formatListNumber(1)} for *Yes* or ${formatListNumber(2)} for *No*.`);
  }

  if (menuState?.type === "scent_pick" && menuState.matches?.length) {
    if (choice && menuState.matches[choice - 1]) {
      const family = menuState.matches[choice - 1];
      if (menuState.sizeMl != null) {
        const product = await getPerfumeProductByFamilyAndSize(family, menuState.sizeMl);
        if (product) return showProductActions(customerKey, product.id);
      }
      return sendPerfumeSizePicker(customerKey, family);
    }
    const byName = findScentByNameInput(text, menuState.matches);
    if (byName) {
      if (menuState.sizeMl != null) {
        const product = await getPerfumeProductByFamilyAndSize(byName, menuState.sizeMl);
        if (product) return showProductActions(customerKey, product.id);
      }
      return sendPerfumeSizePicker(customerKey, byName);
    }
  }

  if (menuState?.type === "size_pick" && choice && menuState.productIds?.[choice - 1]) {
    return showProductActions(customerKey, menuState.productIds[choice - 1]);
  }

  if (menuState?.type === "scent_list_paged") {
    if (/^(next|more)$/i.test(normalized) && menuState.rowId) {
      const totalPages = Math.ceil((menuState.scentFamilies?.length || 0) / (menuState.pageSize || CATALOG_PAGE_SIZE));
      const nextPage = (menuState.page || 0) + 1;
      if (nextPage < totalPages) {
        return sendPerfumeScentList(customerKey, { page: nextPage, rowId: menuState.rowId });
      }
      return sendText(customerKey, "Last page. Reply with a scent number or type a name (e.g. *BRUT*).");
    }
    if (/^(prev|previous|back)$/i.test(normalized) && menuState.rowId && (menuState.page || 0) > 0) {
      return sendPerfumeScentList(customerKey, { page: menuState.page - 1, rowId: menuState.rowId });
    }
    const pageFamilies = getScentPageFamilies(menuState);
    if (choice) {
      if (pageFamilies[choice - 1]) {
        return sendPerfumeSizePicker(customerKey, pageFamilies[choice - 1]);
      }
      return sendText(
        customerKey,
        `Reply *1–${pageFamilies.length}* from the list above (page ${(menuState.page || 0) + 1}), or type the scent name.`
      );
    }
    if (pageFamilies.length) {
      const byName = findScentByNameInput(text, pageFamilies);
      if (byName) return sendPerfumeSizePicker(customerKey, byName);
    }
    const allMatch = findScentByNameInput(text, menuState.scentFamilies || []);
    if (allMatch) return sendPerfumeSizePicker(customerKey, allMatch);
  }

  const result = await resolveProductQuery(text);
  switch (result.action) {
    case "exact":
      return showProductActions(customerKey, result.product.id);
    case "confirm":
      if (result.kind === "perfume" || result.scentFamily) {
        return sendScentConfirm(customerKey, result.scentFamily, result.sizeMl);
      }
      return sendProductConfirm(customerKey, result.product);
    case "disambiguate":
      if (result.kind === "perfume" || result.matches) {
        return sendScentDisambiguation(customerKey, result.matches, result.sizeMl);
      }
      return sendProductDisambiguation(customerKey, result.products);
    case "browse_perfumes":
      return sendPerfumeScentList(customerKey, { page: 0, rowId: "sub_beauty_perfume-oils" });
    default:
      return false;
  }
}
