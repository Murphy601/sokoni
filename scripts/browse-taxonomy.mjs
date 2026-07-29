/**
 * Phase 2 — Depop-style browse taxonomy for Sokoni Mall (Kenya).
 * Maps legacy catalog categories → browse paths for gradual migration.
 */

export const ITEM_TYPE_FILTERS = [
  { id: "all", label: "All Items" },
  { id: "new", label: "Brand New", isSecondhand: false },
  { id: "secondhand", label: "Pre-Loved / Thrift", isSecondhand: true },
];

export const PRICE_TIERS = [
  { id: "under-1000", label: "Under KES 1,000", maxKes: 1000 },
  { id: "under-2500", label: "Under KES 2,500", maxKes: 2500 },
  { id: "under-5000", label: "Under KES 5,000", maxKes: 5000 },
  { id: "under-10000", label: "Under KES 10,000", maxKes: 10000 },
];

export const DECADES = [
  { id: "80s", label: "'80s" },
  { id: "90s", label: "'90s" },
  { id: "00s", label: "'00s" },
  { id: "10s", label: "'10s" },
];

/** Depop-style aesthetic / vibe chips (search + feed filters). */
export const AESTHETIC_VIBES = [
  { id: "y2k", label: "Y2K", match: ["y2k", "00s", "2000s"] },
  { id: "streetwear", label: "Streetwear", match: ["streetwear", "street", "hype"] },
  { id: "vintage", label: "Vintage", match: ["vintage", "retro", "archive"] },
  { id: "clean-girl", label: "Clean Girl", match: ["clean girl", "clean-girl", "minimal chic"] },
  { id: "cyberpunk", label: "Cyberpunk", match: ["cyberpunk", "cyber", "futuristic"] },
  { id: "goth-punk", label: "Goth / Punk", match: ["goth", "punk", "emo", "alt"] },
  { id: "90s-thrift", label: "90s Thrift", match: ["90s", "90's", "nineties", "thrift"] },
  { id: "minimalist", label: "Minimalist", match: ["minimalist", "minimal", "plain"] },
];

export const CURATED_THEMES = [
  { id: "festival", label: "Festival" },
  { id: "graduation", label: "Graduation" },
  { id: "party-fits", label: "Party Fits" },
  { id: "crochet", label: "Crochet" },
  { id: "linen", label: "Linen" },
  { id: "official-wear", label: "Official Wear" },
  { id: "streetwear", label: "Streetwear" },
  { id: "thrift-fits", label: "Thrift Fits" },
];

/** Primary browse navigation (Depop-style drawer). */
export const BROWSE_TAXONOMY = [
  {
    id: "women",
    label: "Women",
    emoji: "👗",
    subcategories: [
      { id: "tops", label: "Tops" },
      { id: "dresses", label: "Dresses" },
      { id: "jeans", label: "Jeans & Denim" },
      { id: "outerwear", label: "Outerwear" },
      { id: "shoes", label: "Shoes" },
      { id: "bags", label: "Bags & Purses" },
      { id: "jewelry", label: "Jewelry" },
      { id: "beauty", label: "Beauty" },
    ],
  },
  {
    id: "men",
    label: "Men",
    emoji: "👔",
    subcategories: [
      { id: "t-shirts", label: "T-Shirts" },
      { id: "shirts", label: "Shirts" },
      { id: "hoodies", label: "Hoodies" },
      { id: "jeans", label: "Jeans" },
      { id: "sneakers", label: "Sneakers" },
      { id: "caps", label: "Caps" },
      { id: "watches", label: "Watches" },
    ],
  },
  {
    id: "kids",
    label: "Kids",
    emoji: "👶",
    subcategories: [
      { id: "clothing", label: "Clothing" },
      { id: "shoes", label: "Shoes" },
      { id: "toys", label: "Toys" },
      { id: "baby-gear", label: "Baby Gear" },
    ],
  },
  {
    id: "brands",
    label: "Brands",
    emoji: "✨",
    subcategories: [
      { id: "sportswear", label: "Sportswear" },
      { id: "designer", label: "Designer" },
      { id: "local-labels", label: "Local Labels" },
    ],
  },
  {
    id: "sports",
    label: "Sports",
    emoji: "⚽",
    subcategories: [
      { id: "activewear", label: "Activewear" },
      { id: "trainers", label: "Trainers" },
      { id: "equipment", label: "Equipment" },
    ],
  },
  {
    id: "trending",
    label: "Trending in Kenya",
    emoji: "🔥",
    subcategories: [
      { id: "thrift-fits", label: "Thrift Fits" },
      { id: "official-wear", label: "Official Wear" },
      { id: "streetwear", label: "Streetwear" },
      { id: "party-outfits", label: "Party Outfits" },
      { id: "viral", label: "Viral Bargains" },
    ],
  },
  {
    id: "sale",
    label: "Sale & Hot Deals",
    emoji: "🏷️",
    subcategories: PRICE_TIERS.map((t) => ({ id: t.id, label: t.label, priceTier: t.id })),
  },
  {
    id: "electronics",
    label: "Electronics",
    emoji: "📱",
    subcategories: [
      { id: "phones", label: "Phones & Tablets" },
      { id: "tvs-audio", label: "TVs & Audio" },
      { id: "computing", label: "Computing" },
      { id: "gaming", label: "Gaming" },
      { id: "appliances", label: "Appliances" },
    ],
  },
  {
    id: "home",
    label: "Home & Living",
    emoji: "🏠",
    subcategories: [
      { id: "kitchen", label: "Kitchen" },
      { id: "bedding", label: "Bedding" },
      { id: "decor", label: "Decor" },
      { id: "supermarket", label: "Supermarket" },
    ],
  },
];

/** legacy category[/subcategory] → { browse, sub } */
export const LEGACY_BROWSE_MAP = {
  fashion: { browse: "women", sub: "tops" },
  "fashion/womens-fashion": { browse: "women", sub: "tops" },
  "fashion/mens-fashion": { browse: "men", sub: "t-shirts" },
  "fashion/shoes": { browse: "women", sub: "shoes" },
  "fashion/bags": { browse: "women", sub: "bags" },
  "fashion/watches": { browse: "men", sub: "watches" },
  "health-beauty": { browse: "women", sub: "beauty" },
  "health-beauty/skincare": { browse: "women", sub: "beauty" },
  "health-beauty/makeup": { browse: "women", sub: "beauty" },
  "health-beauty/haircare": { browse: "women", sub: "beauty" },
  "health-beauty/fragrances": { browse: "women", sub: "beauty" },
  "health-beauty/perfume-oils": { browse: "women", sub: "beauty" },
  "health-beauty/personal-care": { browse: "women", sub: "beauty" },
  "phones-tablets": { browse: "electronics", sub: "phones" },
  "phones-tablets/smartphones": { browse: "electronics", sub: "phones" },
  "phones-tablets/tablets": { browse: "electronics", sub: "phones" },
  "phones-tablets/power-banks": { browse: "electronics", sub: "phones" },
  "phones-tablets/phone-accessories": { browse: "electronics", sub: "phones" },
  "tvs-audio": { browse: "electronics", sub: "tvs-audio" },
  "tvs-audio/televisions": { browse: "electronics", sub: "tvs-audio" },
  "tvs-audio/headphones": { browse: "electronics", sub: "tvs-audio" },
  "tvs-audio/speakers": { browse: "electronics", sub: "tvs-audio" },
  "tvs-audio/wearables": { browse: "electronics", sub: "tvs-audio" },
  computing: { browse: "electronics", sub: "computing" },
  gaming: { browse: "electronics", sub: "gaming" },
  appliances: { browse: "electronics", sub: "appliances" },
  "home-office": { browse: "home", sub: "decor" },
  "home-office/kitchen-dining": { browse: "home", sub: "kitchen" },
  "home-office/bedding": { browse: "home", sub: "bedding" },
  supermarket: { browse: "home", sub: "supermarket" },
  "baby-products": { browse: "kids", sub: "baby-gear" },
  "baby-products/toys": { browse: "kids", sub: "toys" },
};

export function mapLegacyToBrowse(category, subcategory) {
  const full = subcategory ? `${category}/${subcategory}` : category;
  return (
    LEGACY_BROWSE_MAP[full] ||
    LEGACY_BROWSE_MAP[category] || { browse: "trending", sub: "streetwear" }
  );
}

export function buildBrowseMenuPayload() {
  return {
    version: 3,
    itemTypes: ITEM_TYPE_FILTERS,
    priceTiers: PRICE_TIERS,
    decades: DECADES,
    aesthetics: AESTHETIC_VIBES,
    themes: CURATED_THEMES,
    categories: BROWSE_TAXONOMY,
    legacyMap: LEGACY_BROWSE_MAP,
  };
}

/** Resolve max KES for a price-tier id (e.g. under-5000 → 5000). */
export function priceTierMaxKes(tierId) {
  const tier = PRICE_TIERS.find((t) => t.id === tierId);
  return tier?.maxKes ?? null;
}
