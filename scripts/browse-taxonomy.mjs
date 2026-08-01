/**
 * Phase 2 — Depop-style browse taxonomy for Sokoni Mall (Kenya).
 * Maps legacy catalog categories → browse paths for gradual migration.
 *
 * Additive Kilimall-gap expansion locked in docs/PHASE0_TAXONOMY_LOCK.md.
 * Optional `resolvesTo: { browse, sub }` = nav alias (filter uses canonical path).
 * Optional `navOnly: true` = hide from seller listing pickers (shortcuts only).
 * `image` = public web thumbnail (Unsplash) — never catalog product photos.
 */

import {
  categoryImageUrl,
  subcategoryImageUrl,
} from "./browse-category-images.mjs";

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

/** Optional mega-menu column groups (presentation only — flat subs stay canonical). */
const MEGA_GROUPS = {
  women: [
    { title: "Clothing", ids: ["tops", "dresses", "skirts", "jumpsuits", "jeans", "outerwear", "activewear", "sleepwear"] },
    { title: "Accessories", ids: ["shoes", "bags", "jewelry", "sunglasses", "beauty"] },
  ],
  men: [
    { title: "Clothing", ids: ["t-shirts", "shirts", "hoodies", "trousers", "shorts", "jeans", "jackets"] },
    { title: "Accessories", ids: ["sneakers", "caps", "watches", "bags"] },
  ],
  kids: [
    { title: "Wear", ids: ["clothing", "school-wear", "shoes"] },
    { title: "Play & care", ids: ["toys", "baby-gear", "kids-accessories"] },
  ],
  "health-beauty": [
    { title: "Face & Skin", ids: ["skincare", "makeup", "nail-care"] },
    { title: "Hair & Scent", ids: ["haircare", "fragrances"] },
    { title: "Care", ids: ["personal-care", "bath-body", "mens-grooming"] },
  ],
  sports: [
    { title: "Wear", ids: ["activewear", "trainers"] },
    { title: "Play", ids: ["equipment", "football", "basketball", "cycling", "swimming"] },
    { title: "Train outdoors", ids: ["gym-fitness", "running", "outdoor"] },
  ],
  electronics: [
    { title: "Mobile & compute", ids: ["phones", "computing", "cameras"] },
    { title: "Home entertainment", ids: ["tvs-audio", "gaming", "smart-home"] },
    { title: "Home power", ids: ["appliances"] },
  ],
  home: [
    { title: "Rooms", ids: ["kitchen", "bedding", "decor", "furniture"] },
    { title: "Utilities", ids: ["lighting", "storage"] },
  ],
  supermarket: [
    { title: "Food & drink", ids: ["food-staples", "beverages"] },
    { title: "Home care", ids: ["household", "personal-grocery"] },
  ],
  automotive: [
    { title: "Vehicle", ids: ["car-accessories", "tyres-wheels", "motorbike"] },
    { title: "Care & fluids", ids: ["oils-fluids", "tools-care"] },
  ],
  pets: [
    { title: "Pets", ids: ["pet-food", "pet-accessories", "pet-care"] },
  ],
  office: [
    { title: "Work", ids: ["stationery", "books", "desk-tech"] },
  ],
  garden: [
    { title: "Outdoors", ids: ["plants", "garden-tools", "outdoor-living"] },
  ],
  restaurant: [
    {
      title: "Kenyan classics",
      ids: ["nyama-choma", "ugali-plates", "pilau-biryani", "chapati-meals", "githeri-stews"],
    },
    { title: "Proteins", ids: ["chicken-dishes", "fish-seafood"] },
    { title: "Street & quick", ids: ["street-bites", "breakfast", "lunch-boxes"] },
    { title: "Diets & wellness", ids: ["vegan-plant", "healthy-bowls", "diet-meals"] },
    { title: "Drinks & more", ids: ["fresh-juices", "desserts", "catering-platters"] },
  ],
};

function withBrowseImages(taxonomy) {
  return taxonomy.map((cat) => {
    const subcategories = (cat.subcategories || []).map((sub) => ({
      ...sub,
      image:
        sub.image ||
        subcategoryImageUrl(sub.id, cat.id) ||
        subcategoryImageUrl(sub.id) ||
        categoryImageUrl(cat.id),
    }));
    const byId = Object.fromEntries(subcategories.map((s) => [s.id, s]));
    const layout = MEGA_GROUPS[cat.id];
    const groups = layout
      ? layout
          .map((g) => ({
            title: g.title,
            subcategories: g.ids.map((id) => byId[id]).filter(Boolean),
          }))
          .filter((g) => g.subcategories.length)
      : cat.groups || undefined;

    return {
      ...cat,
      image: cat.image || categoryImageUrl(cat.id),
      subcategories,
      ...(groups ? { groups } : {}),
    };
  });
}

/** Shared electronics sub lists (canonical under `electronics`). */
const ELECTRONICS_PHONE_SUBS = [
  { id: "phones", label: "All Phones & Tablets", resolvesTo: { browse: "electronics", sub: "phones" } },
  { id: "smartphones", label: "Smartphones", resolvesTo: { browse: "electronics", sub: "phones" } },
  { id: "tablets", label: "Tablets", resolvesTo: { browse: "electronics", sub: "phones" } },
  { id: "phone-accessories", label: "Phone Accessories", resolvesTo: { browse: "electronics", sub: "phones" } },
  { id: "power-banks", label: "Power Banks", resolvesTo: { browse: "electronics", sub: "phones" } },
];

const ELECTRONICS_TV_SUBS = [
  { id: "tvs-audio", label: "All TVs & Audio", resolvesTo: { browse: "electronics", sub: "tvs-audio" } },
  { id: "televisions", label: "Televisions", resolvesTo: { browse: "electronics", sub: "tvs-audio" } },
  { id: "headphones", label: "Headphones", resolvesTo: { browse: "electronics", sub: "tvs-audio" } },
  { id: "speakers", label: "Speakers", resolvesTo: { browse: "electronics", sub: "tvs-audio" } },
  { id: "wearables", label: "Wearables", resolvesTo: { browse: "electronics", sub: "tvs-audio" } },
];

const ELECTRONICS_COMPUTING_SUBS = [
  { id: "computing", label: "All Computing", resolvesTo: { browse: "electronics", sub: "computing" } },
  { id: "laptops", label: "Laptops", resolvesTo: { browse: "electronics", sub: "computing" } },
  { id: "desktops", label: "Desktops", resolvesTo: { browse: "electronics", sub: "computing" } },
  { id: "accessories", label: "Computer Accessories", resolvesTo: { browse: "electronics", sub: "computing" } },
];

const ELECTRONICS_APPLIANCE_SUBS = [
  { id: "appliances", label: "All Appliances", resolvesTo: { browse: "electronics", sub: "appliances" } },
  { id: "kitchen-appliances", label: "Kitchen Appliances", resolvesTo: { browse: "electronics", sub: "appliances" } },
  { id: "laundry", label: "Laundry", resolvesTo: { browse: "electronics", sub: "appliances" } },
  { id: "cooling", label: "Cooling & Fans", resolvesTo: { browse: "electronics", sub: "appliances" } },
];

/** Primary browse navigation (Depop-style drawer + mega menu). */
export const BROWSE_TAXONOMY = [
  {
    id: "women",
    label: "Women",
    emoji: "👗",
    subcategories: [
      { id: "tops", label: "Tops" },
      { id: "dresses", label: "Dresses" },
      { id: "skirts", label: "Skirts" },
      { id: "jumpsuits", label: "Jumpsuits & Sets" },
      { id: "jeans", label: "Jeans & Denim" },
      { id: "outerwear", label: "Outerwear" },
      { id: "activewear", label: "Activewear" },
      { id: "sleepwear", label: "Sleepwear" },
      { id: "shoes", label: "Shoes" },
      { id: "bags", label: "Bags & Purses" },
      { id: "jewelry", label: "Jewelry" },
      { id: "sunglasses", label: "Sunglasses" },
      // Alias after Phase 2 remap — products live under health-beauty/*
      {
        id: "beauty",
        label: "Beauty",
        resolvesTo: { browse: "health-beauty", sub: null },
      },
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
      { id: "trousers", label: "Trousers" },
      { id: "shorts", label: "Shorts" },
      { id: "jeans", label: "Jeans" },
      { id: "jackets", label: "Jackets" },
      { id: "sneakers", label: "Sneakers" },
      { id: "caps", label: "Caps" },
      { id: "watches", label: "Watches" },
      { id: "bags", label: "Bags & Backpacks" },
    ],
  },
  {
    id: "kids",
    label: "Kids",
    emoji: "👶",
    subcategories: [
      { id: "clothing", label: "Clothing" },
      { id: "school-wear", label: "School Wear" },
      { id: "shoes", label: "Shoes" },
      { id: "toys", label: "Toys" },
      { id: "baby-gear", label: "Baby Gear" },
      { id: "kids-accessories", label: "Accessories" },
    ],
  },
  {
    id: "health-beauty",
    label: "Health & Beauty",
    emoji: "💄",
    subcategories: [
      { id: "skincare", label: "Skincare" },
      { id: "makeup", label: "Makeup" },
      { id: "nail-care", label: "Nail Care" },
      { id: "haircare", label: "Haircare" },
      { id: "fragrances", label: "Fragrances" },
      { id: "personal-care", label: "Personal Care" },
      { id: "bath-body", label: "Bath & Body" },
      { id: "mens-grooming", label: "Men's Grooming" },
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
      { id: "gym-fitness", label: "Gym & Fitness" },
      { id: "outdoor", label: "Outdoor" },
      { id: "football", label: "Football" },
      { id: "basketball", label: "Basketball" },
      { id: "cycling", label: "Cycling" },
      { id: "swimming", label: "Swimming" },
      { id: "running", label: "Running" },
    ],
  },
  {
    id: "phones",
    label: "Phones & Accessories",
    emoji: "📱",
    navOnly: true,
    resolvesTo: { browse: "electronics", sub: "phones" },
    subcategories: ELECTRONICS_PHONE_SUBS,
  },
  {
    id: "tv-audio",
    label: "TV & Audio",
    emoji: "📺",
    navOnly: true,
    resolvesTo: { browse: "electronics", sub: "tvs-audio" },
    subcategories: ELECTRONICS_TV_SUBS,
  },
  {
    id: "computers",
    label: "Computers & Accessories",
    emoji: "💻",
    navOnly: true,
    resolvesTo: { browse: "electronics", sub: "computing" },
    subcategories: ELECTRONICS_COMPUTING_SUBS,
  },
  {
    id: "appliances-home",
    label: "Appliances",
    emoji: "🔌",
    navOnly: true,
    resolvesTo: { browse: "electronics", sub: "appliances" },
    subcategories: ELECTRONICS_APPLIANCE_SUBS,
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
      { id: "cameras", label: "Cameras" },
      { id: "smart-home", label: "Smart Home" },
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
      { id: "furniture", label: "Furniture" },
      { id: "lighting", label: "Lighting" },
      { id: "storage", label: "Storage" },
      // Alias after Phase 2 remap — products live under supermarket/*
      {
        id: "supermarket",
        label: "Supermarket",
        resolvesTo: { browse: "supermarket", sub: null },
      },
    ],
  },
  {
    id: "supermarket",
    label: "Supermarket",
    emoji: "🛒",
    subcategories: [
      { id: "food-staples", label: "Food Staples" },
      { id: "beverages", label: "Beverages" },
      { id: "household", label: "Household" },
      { id: "personal-grocery", label: "Personal Care Grocery" },
    ],
  },
  {
    id: "automotive",
    label: "Automotive",
    emoji: "🚗",
    subcategories: [
      { id: "car-accessories", label: "Car Accessories" },
      { id: "oils-fluids", label: "Oils & Fluids" },
      { id: "tyres-wheels", label: "Tyres & Wheels" },
      { id: "motorbike", label: "Motorbike" },
      { id: "tools-care", label: "Tools & Care" },
    ],
  },
  {
    id: "pets",
    label: "Pets",
    emoji: "🐾",
    subcategories: [
      { id: "pet-food", label: "Pet Food" },
      { id: "pet-accessories", label: "Accessories" },
      { id: "pet-care", label: "Pet Care" },
    ],
  },
  {
    id: "office",
    label: "Office & Books",
    emoji: "📚",
    subcategories: [
      { id: "stationery", label: "Stationery" },
      { id: "books", label: "Books" },
      { id: "desk-tech", label: "Desk Tech" },
    ],
  },
  {
    id: "garden",
    label: "Garden & Outdoor",
    emoji: "🌿",
    subcategories: [
      { id: "plants", label: "Plants" },
      { id: "garden-tools", label: "Garden Tools" },
      { id: "outdoor-living", label: "Outdoor Living" },
    ],
  },
  {
    id: "restaurant",
    label: "Restaurant",
    emoji: "🍽️",
    aliases: ["food", "meals", "eats", "dishes", "kibanda", "hotel food", "kenya food"],
    subcategories: [
      { id: "nyama-choma", label: "Nyama Choma" },
      { id: "ugali-plates", label: "Ugali Plates" },
      { id: "pilau-biryani", label: "Pilau & Biryani" },
      { id: "chapati-meals", label: "Chapati Meals" },
      { id: "githeri-stews", label: "Githeri & Stews" },
      { id: "chicken-dishes", label: "Chicken Dishes" },
      { id: "fish-seafood", label: "Fish & Seafood" },
      { id: "street-bites", label: "Street Bites" },
      { id: "breakfast", label: "Breakfast" },
      { id: "lunch-boxes", label: "Lunch Boxes" },
      { id: "vegan-plant", label: "Vegan & Plant" },
      { id: "healthy-bowls", label: "Healthy Bowls" },
      { id: "diet-meals", label: "Diet Meals" },
      { id: "fresh-juices", label: "Fresh Juices" },
      { id: "desserts", label: "Desserts" },
      { id: "catering-platters", label: "Catering Platters" },
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
];

/**
 * legacy category[/subcategory] → { browse, sub }
 * Phase 2: health-beauty → Health & Beauty top-level; supermarket → Supermarket top-level.
 */
export const LEGACY_BROWSE_MAP = {
  fashion: { browse: "women", sub: "tops" },
  "fashion/womens-fashion": { browse: "women", sub: "tops" },
  "fashion/mens-fashion": { browse: "men", sub: "t-shirts" },
  "fashion/shoes": { browse: "women", sub: "shoes" },
  "fashion/bags": { browse: "women", sub: "bags" },
  "fashion/watches": { browse: "men", sub: "watches" },
  "health-beauty": { browse: "health-beauty", sub: "personal-care" },
  "health-beauty/skincare": { browse: "health-beauty", sub: "skincare" },
  "health-beauty/makeup": { browse: "health-beauty", sub: "makeup" },
  "health-beauty/haircare": { browse: "health-beauty", sub: "haircare" },
  "health-beauty/fragrances": { browse: "health-beauty", sub: "fragrances" },
  "health-beauty/perfume-oils": { browse: "health-beauty", sub: "fragrances" },
  "health-beauty/personal-care": { browse: "health-beauty", sub: "personal-care" },
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
  supermarket: { browse: "supermarket", sub: "food-staples" },
  "supermarket/food-staples": { browse: "supermarket", sub: "food-staples" },
  "supermarket/beverages": { browse: "supermarket", sub: "beverages" },
  "supermarket/household": { browse: "supermarket", sub: "household" },
  "supermarket/personal-grocery": { browse: "supermarket", sub: "personal-grocery" },
  "baby-products": { browse: "kids", sub: "baby-gear" },
  "baby-products/toys": { browse: "kids", sub: "toys" },
  // Automotive — ready when catalog uses these legacy ids
  automotive: { browse: "automotive", sub: "car-accessories" },
  "automotive/car-accessories": { browse: "automotive", sub: "car-accessories" },
  "automotive/oils-fluids": { browse: "automotive", sub: "oils-fluids" },
  "automotive/tyres-wheels": { browse: "automotive", sub: "tyres-wheels" },
  "automotive/motorbike": { browse: "automotive", sub: "motorbike" },
  "automotive/tools-care": { browse: "automotive", sub: "tools-care" },
  pets: { browse: "pets", sub: "pet-food" },
  "pets/pet-food": { browse: "pets", sub: "pet-food" },
  "pets/pet-accessories": { browse: "pets", sub: "pet-accessories" },
  "pets/pet-care": { browse: "pets", sub: "pet-care" },
  office: { browse: "office", sub: "stationery" },
  "office/stationery": { browse: "office", sub: "stationery" },
  "office/books": { browse: "office", sub: "books" },
  "office/desk-tech": { browse: "office", sub: "desk-tech" },
  garden: { browse: "garden", sub: "plants" },
  "garden/plants": { browse: "garden", sub: "plants" },
  "garden/garden-tools": { browse: "garden", sub: "garden-tools" },
  "garden/outdoor-living": { browse: "garden", sub: "outdoor-living" },
  "electronics/cameras": { browse: "electronics", sub: "cameras" },
  "electronics/smart-home": { browse: "electronics", sub: "smart-home" },
  "home-office/furniture": { browse: "home", sub: "furniture" },
  "home-office/lighting": { browse: "home", sub: "lighting" },
  restaurant: { browse: "restaurant", sub: "ugali-plates" },
  "restaurant/nyama-choma": { browse: "restaurant", sub: "nyama-choma" },
  "restaurant/ugali-plates": { browse: "restaurant", sub: "ugali-plates" },
  "restaurant/pilau-biryani": { browse: "restaurant", sub: "pilau-biryani" },
  "restaurant/chapati-meals": { browse: "restaurant", sub: "chapati-meals" },
  "restaurant/githeri-stews": { browse: "restaurant", sub: "githeri-stews" },
  "restaurant/chicken-dishes": { browse: "restaurant", sub: "chicken-dishes" },
  "restaurant/fish-seafood": { browse: "restaurant", sub: "fish-seafood" },
  "restaurant/street-bites": { browse: "restaurant", sub: "street-bites" },
  "restaurant/breakfast": { browse: "restaurant", sub: "breakfast" },
  "restaurant/lunch-boxes": { browse: "restaurant", sub: "lunch-boxes" },
  "restaurant/vegan-plant": { browse: "restaurant", sub: "vegan-plant" },
  "restaurant/healthy-bowls": { browse: "restaurant", sub: "healthy-bowls" },
  "restaurant/diet-meals": { browse: "restaurant", sub: "diet-meals" },
  "restaurant/fresh-juices": { browse: "restaurant", sub: "fresh-juices" },
  "restaurant/desserts": { browse: "restaurant", sub: "desserts" },
  "restaurant/catering-platters": { browse: "restaurant", sub: "catering-platters" },
  food: { browse: "restaurant", sub: "ugali-plates" },
  meals: { browse: "restaurant", sub: "lunch-boxes" },
};

export function mapLegacyToBrowse(category, subcategory) {
  const full = subcategory ? `${category}/${subcategory}` : category;
  return (
    LEGACY_BROWSE_MAP[full] ||
    LEGACY_BROWSE_MAP[category] || { browse: "trending", sub: "streetwear" }
  );
}

/** Resolve a nav category/sub (possibly alias) to the product filter path. */
export function resolveNavFilter(categoryId, subcategoryId, taxonomy = BROWSE_TAXONOMY) {
  const cat = taxonomy.find((c) => c.id === categoryId);
  if (!cat) {
    return { browse: categoryId || null, sub: subcategoryId || null, priceTier: null };
  }

  const sub = subcategoryId
    ? (cat.subcategories || []).find((s) => s.id === subcategoryId)
    : null;

  if (sub?.resolvesTo) {
    return {
      browse: sub.resolvesTo.browse,
      sub: sub.resolvesTo.sub ?? null,
      priceTier: sub.priceTier || null,
    };
  }

  if (sub?.priceTier) {
    return { browse: cat.id, sub: sub.id, priceTier: sub.priceTier };
  }

  if (cat.resolvesTo && !subcategoryId) {
    return {
      browse: cat.resolvesTo.browse,
      sub: cat.resolvesTo.sub ?? null,
      priceTier: null,
    };
  }

  if (cat.resolvesTo && subcategoryId && !sub?.resolvesTo) {
    return {
      browse: cat.resolvesTo.browse,
      sub: cat.resolvesTo.sub ?? subcategoryId,
      priceTier: null,
    };
  }

  return {
    browse: cat.id,
    sub: subcategoryId || null,
    priceTier: sub?.priceTier || null,
  };
}

/** Taxonomy entries sellers may assign (excludes nav-only shortcuts). */
export function sellerBrowseTaxonomy(taxonomy = BROWSE_TAXONOMY) {
  return taxonomy.filter((c) => !c.navOnly);
}

export function buildBrowseMenuPayload() {
  return {
    version: 6,
    itemTypes: ITEM_TYPE_FILTERS,
    priceTiers: PRICE_TIERS,
    decades: DECADES,
    aesthetics: AESTHETIC_VIBES,
    themes: CURATED_THEMES,
    categories: withBrowseImages(BROWSE_TAXONOMY),
    legacyMap: LEGACY_BROWSE_MAP,
  };
}

/** Resolve max KES for a price-tier id (e.g. under-5000 → 5000). */
export function priceTierMaxKes(tierId) {
  const tier = PRICE_TIERS.find((t) => t.id === tierId);
  return tier?.maxKes ?? null;
}
