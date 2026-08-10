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
    {
      title: "Clothing",
      ids: [
        "tops",
        "dresses",
        "skirts",
        "jumpsuits",
        "jeans",
        "outerwear",
        "activewear",
        "sleepwear",
        "lingerie",
        "maternity",
      ],
    },
    {
      title: "Accessories",
      ids: ["shoes", "heels", "boots", "bags", "jewelry", "sunglasses", "belts", "scarves", "beauty"],
    },
  ],
  men: [
    {
      title: "Clothing",
      ids: [
        "t-shirts",
        "shirts",
        "hoodies",
        "trousers",
        "shorts",
        "jeans",
        "jackets",
        "formal-wear",
        "underwear",
      ],
    },
    { title: "Accessories", ids: ["sneakers", "sandals", "caps", "watches", "bags", "belts", "socks"] },
  ],
  kids: [
    { title: "Wear", ids: ["clothing", "school-wear", "shoes", "kids-accessories"] },
    {
      title: "Bikes & ride-ons",
      ids: ["bikes", "balance-bikes", "scooters", "tricycles", "ride-ons", "helmets-pads"],
    },
    { title: "Play & care", ids: ["toys", "baby-gear", "strollers", "nursery"] },
  ],
  "health-beauty": [
    { title: "Face & Skin", ids: ["skincare", "makeup", "nail-care", "oral-care"] },
    { title: "Hair & Scent", ids: ["haircare", "fragrances", "hair-tools"] },
    { title: "Care", ids: ["personal-care", "bath-body", "mens-grooming", "wellness"] },
  ],
  brands: [
    { title: "Labels", ids: ["sportswear", "designer", "local-labels", "streetwear-brands", "luxury"] },
  ],
  sports: [
    { title: "Wear", ids: ["activewear", "trainers"] },
    {
      title: "Play",
      ids: ["equipment", "football", "basketball", "cycling", "swimming", "tennis", "rugby", "boxing"],
    },
    { title: "Train outdoors", ids: ["gym-fitness", "running", "outdoor", "yoga", "camping", "hiking"] },
  ],
  electronics: [
    { title: "Mobile & compute", ids: ["phones", "computing", "cameras", "drones", "networking"] },
    { title: "Home entertainment", ids: ["tvs-audio", "gaming", "smart-home"] },
    { title: "Home power", ids: ["appliances", "printers"] },
  ],
  home: [
    { title: "Rooms", ids: ["kitchen", "bedding", "decor", "furniture", "bathroom", "curtains"] },
    { title: "Utilities", ids: ["lighting", "storage", "cookware", "tableware", "rugs"] },
  ],
  supermarket: [
    { title: "Food & drink", ids: ["food-staples", "beverages", "snacks", "cooking-oils", "baby-food"] },
    { title: "Home care", ids: ["household", "personal-grocery", "cleaning"] },
  ],
  automotive: [
    { title: "Vehicle", ids: ["car-accessories", "tyres-wheels", "motorbike", "spare-parts", "batteries"] },
    { title: "Care & fluids", ids: ["oils-fluids", "tools-care", "car-electronics", "car-care"] },
  ],
  "power-tools": [
    {
      title: "Drills & sets",
      ids: ["drills", "toolsets-drillsets", "impact-drivers", "hand-tools"],
    },
    {
      title: "Grind & cut",
      ids: ["grinders", "buffing-machines", "jigsaws", "circular-saws", "chain-powersaws", "sanders"],
    },
    {
      title: "Weld & spray",
      ids: ["welding-machines", "welding-generators", "spray-guns", "carwash-spray-guns"],
    },
    {
      title: "Pumps & power",
      ids: ["water-pumps", "generators", "air-compressors", "measuring-tools", "safety-gear"],
    },
  ],
  pets: [
    { title: "By pet", ids: ["dogs", "cats", "fish-aquarium", "birds"] },
    { title: "Care", ids: ["pet-food", "pet-accessories", "pet-care"] },
  ],
  office: [
    { title: "Work", ids: ["stationery", "books", "desk-tech", "school-supplies", "organizers", "printers-ink"] },
  ],
  garden: [
    {
      title: "Outdoors",
      ids: ["plants", "garden-tools", "outdoor-living", "seeds", "irrigation", "bbq-outdoor", "solar-garden"],
    },
  ],
  "musical-instruments": [
    { title: "Play", ids: ["guitars", "keyboards", "drums", "dj-audio", "studio-gear", "instrument-accessories"] },
  ],
  travel: [
    { title: "Go", ids: ["luggage", "backpacks", "travel-accessories", "camping-gear"] },
  ],
  "sokoni-mashinani": [
    {
      title: "Fresh produce",
      ids: ["fruits-vegetables", "tubers-roots", "fresh-herbs", "organic-produce"],
    },
    {
      title: "Farm staples",
      ids: ["grains-cereals", "nuts-legumes", "spices-chilies", "farm-oils"],
    },
    {
      title: "Dairy & protein",
      ids: ["dairy-eggs", "livestock", "poultry", "fish-aquaculture"],
    },
    {
      title: "Farm extras",
      ids: ["honey-bee", "coffee-tea-leaves", "flowers-plants", "farm-tools"],
    },
  ],
  artisans: [
    {
      title: "Furniture & wood",
      ids: ["wood-furniture", "carvings-sculpture", "home-decor"],
    },
    {
      title: "Textiles & wear",
      ids: ["textiles-kitenge", "traditional-wear", "custom-tailoring", "crochet-knit"],
    },
    {
      title: "Handmade goods",
      ids: ["beadwork-jewelry", "baskets-weaving", "pottery-ceramics", "leather-goods"],
    },
    {
      title: "Craft extras",
      ids: ["metalwork", "handmade-shoes", "soap-candles", "local-art", "handmade-toys"],
    },
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
  "wines-spirits": [
    { title: "Local favourites", ids: ["local-beer", "kenyan-spirits"] },
    { title: "Wine", ids: ["red-wine", "white-wine", "sparkling-champagne"] },
    { title: "Spirits", ids: ["whisky", "gin", "vodka", "cognac-brandy", "rum"] },
    { title: "Ready & bar", ids: ["cider-rtd", "liqueurs", "mixers", "party-packs"] },
    { title: "Zero proof", ids: ["non-alcoholic"] },
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
      { id: "lingerie", label: "Lingerie" },
      { id: "maternity", label: "Maternity" },
      { id: "shoes", label: "Shoes" },
      { id: "heels", label: "Heels" },
      { id: "boots", label: "Boots" },
      { id: "bags", label: "Bags & Purses" },
      { id: "jewelry", label: "Jewelry" },
      { id: "sunglasses", label: "Sunglasses" },
      { id: "belts", label: "Belts" },
      { id: "scarves", label: "Scarves & Wraps" },
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
      { id: "formal-wear", label: "Formal Wear" },
      { id: "underwear", label: "Underwear" },
      { id: "sneakers", label: "Sneakers" },
      { id: "sandals", label: "Sandals" },
      { id: "caps", label: "Caps" },
      { id: "watches", label: "Watches" },
      { id: "bags", label: "Bags & Backpacks" },
      { id: "belts", label: "Belts" },
      { id: "socks", label: "Socks" },
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
      { id: "bikes", label: "Bikes" },
      { id: "balance-bikes", label: "Balance Bikes" },
      { id: "scooters", label: "Scooters" },
      { id: "tricycles", label: "Tricycles" },
      { id: "ride-ons", label: "Ride-Ons" },
      { id: "helmets-pads", label: "Helmets & Pads" },
      { id: "toys", label: "Toys" },
      { id: "baby-gear", label: "Baby Gear" },
      { id: "strollers", label: "Strollers" },
      { id: "nursery", label: "Nursery" },
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
      { id: "hair-tools", label: "Hair Tools" },
      { id: "fragrances", label: "Fragrances" },
      { id: "personal-care", label: "Personal Care" },
      { id: "bath-body", label: "Bath & Body" },
      { id: "oral-care", label: "Oral Care" },
      { id: "wellness", label: "Wellness" },
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
      { id: "streetwear-brands", label: "Streetwear Brands" },
      { id: "luxury", label: "Luxury" },
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
      { id: "tennis", label: "Tennis" },
      { id: "rugby", label: "Rugby" },
      { id: "boxing", label: "Boxing" },
      { id: "yoga", label: "Yoga" },
      { id: "camping", label: "Camping" },
      { id: "hiking", label: "Hiking" },
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
      { id: "drones", label: "Drones" },
      { id: "smart-home", label: "Smart Home" },
      { id: "networking", label: "Networking" },
      { id: "printers", label: "Printers" },
      { id: "appliances", label: "Appliances" },
    ],
  },
  {
    id: "home",
    label: "Home & Living",
    emoji: "🏠",
    subcategories: [
      { id: "kitchen", label: "Kitchen" },
      { id: "cookware", label: "Cookware" },
      { id: "tableware", label: "Tableware" },
      { id: "bedding", label: "Bedding" },
      { id: "decor", label: "Decor" },
      { id: "furniture", label: "Furniture" },
      { id: "lighting", label: "Lighting" },
      { id: "storage", label: "Storage" },
      { id: "bathroom", label: "Bathroom" },
      { id: "curtains", label: "Curtains" },
      { id: "rugs", label: "Rugs & Carpets" },
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
      { id: "snacks", label: "Snacks" },
      { id: "cooking-oils", label: "Cooking Oils" },
      { id: "baby-food", label: "Baby Food" },
      { id: "household", label: "Household" },
      { id: "cleaning", label: "Cleaning" },
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
      { id: "spare-parts", label: "Spare Parts" },
      { id: "batteries", label: "Batteries" },
      { id: "car-electronics", label: "Car Electronics" },
      { id: "car-care", label: "Car Care" },
    ],
  },
  {
    id: "power-tools",
    label: "Power Tools",
    emoji: "🛠️",
    aliases: [
      "tools",
      "power tools",
      "hardware",
      "drills",
      "welding",
      "generators",
      "saws",
      "grinders",
    ],
    subcategories: [
      { id: "drills", label: "Drills" },
      { id: "grinders", label: "Grinders" },
      { id: "toolsets-drillsets", label: "Toolsets / Drillsets" },
      { id: "water-pumps", label: "Water Pumps" },
      { id: "welding-machines", label: "Welding Machines" },
      { id: "buffing-machines", label: "Buffing Machines" },
      { id: "carwash-spray-guns", label: "Carwash Spray Guns" },
      { id: "welding-generators", label: "Welding Generators" },
      { id: "spray-guns", label: "Spray Guns" },
      { id: "jigsaws", label: "Jigsaws" },
      { id: "circular-saws", label: "Circular Saws" },
      { id: "chain-powersaws", label: "Chain / Powersaws" },
      { id: "impact-drivers", label: "Impact Drivers" },
      { id: "sanders", label: "Sanders" },
      { id: "air-compressors", label: "Air Compressors" },
      { id: "generators", label: "Generators" },
      { id: "hand-tools", label: "Hand Tools" },
      { id: "measuring-tools", label: "Measuring Tools" },
      { id: "safety-gear", label: "Safety Gear" },
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
      { id: "dogs", label: "Dogs" },
      { id: "cats", label: "Cats" },
      { id: "fish-aquarium", label: "Fish & Aquarium" },
      { id: "birds", label: "Birds" },
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
      { id: "school-supplies", label: "School Supplies" },
      { id: "organizers", label: "Organizers" },
      { id: "printers-ink", label: "Printers & Ink" },
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
      { id: "seeds", label: "Seeds" },
      { id: "irrigation", label: "Irrigation" },
      { id: "bbq-outdoor", label: "BBQ & Outdoor" },
      { id: "solar-garden", label: "Solar Garden" },
    ],
  },
  {
    id: "musical-instruments",
    label: "Musical Instruments",
    emoji: "🎸",
    aliases: ["music", "instruments", "guitar", "drums", "keyboard", "dj"],
    subcategories: [
      { id: "guitars", label: "Guitars" },
      { id: "keyboards", label: "Keyboards" },
      { id: "drums", label: "Drums" },
      { id: "dj-audio", label: "DJ & Audio" },
      { id: "studio-gear", label: "Studio Gear" },
      { id: "instrument-accessories", label: "Accessories" },
    ],
  },
  {
    id: "travel",
    label: "Travel & Luggage",
    emoji: "🧳",
    aliases: ["travel", "luggage", "suitcase", "backpack"],
    subcategories: [
      { id: "luggage", label: "Luggage" },
      { id: "backpacks", label: "Backpacks" },
      { id: "travel-accessories", label: "Travel Accessories" },
      { id: "camping-gear", label: "Camping Gear" },
    ],
  },
  {
    id: "sokoni-mashinani",
    label: "Sokoni Mashinani",
    emoji: "🌾",
    aliases: [
      "farm",
      "farmers",
      "agriculture",
      "produce",
      "mashinani",
      "mama mboga",
      "livestock",
      "farm fresh",
    ],
    subcategories: [
      { id: "fruits-vegetables", label: "Fruits & Vegetables" },
      { id: "dairy-eggs", label: "Dairy & Eggs" },
      { id: "grains-cereals", label: "Grains & Cereals" },
      { id: "livestock", label: "Livestock" },
      { id: "poultry", label: "Poultry" },
      { id: "fresh-herbs", label: "Fresh Herbs" },
      { id: "honey-bee", label: "Honey & Bee Products" },
      { id: "tubers-roots", label: "Tubers & Roots" },
      { id: "farm-oils", label: "Farm Oils" },
      { id: "nuts-legumes", label: "Nuts & Legumes" },
      { id: "spices-chilies", label: "Spices & Chilies" },
      { id: "coffee-tea-leaves", label: "Coffee & Tea Leaves" },
      { id: "fish-aquaculture", label: "Fish & Aquaculture" },
      { id: "flowers-plants", label: "Flowers & Plants" },
      { id: "farm-tools", label: "Farm Tools" },
      { id: "organic-produce", label: "Organic Produce" },
    ],
  },
  {
    id: "artisans",
    label: "Artisans & Crafts",
    emoji: "🪵",
    aliases: [
      "artisans",
      "crafts",
      "makers",
      "handmade",
      "woodwork",
      "kitenge",
      "tailor",
      "mama mboga crafts",
    ],
    subcategories: [
      { id: "wood-furniture", label: "Wood Furniture" },
      { id: "textiles-kitenge", label: "Textiles & Kitenge" },
      { id: "home-decor", label: "Home Decor" },
      { id: "traditional-wear", label: "Traditional Wear" },
      { id: "beadwork-jewelry", label: "Beadwork & Jewelry" },
      { id: "pottery-ceramics", label: "Pottery & Ceramics" },
      { id: "baskets-weaving", label: "Baskets & Weaving" },
      { id: "leather-goods", label: "Leather Goods" },
      { id: "metalwork", label: "Metalwork" },
      { id: "carvings-sculpture", label: "Carvings & Sculpture" },
      { id: "handmade-shoes", label: "Handmade Shoes" },
      { id: "soap-candles", label: "Soap & Candles" },
      { id: "crochet-knit", label: "Crochet & Knit" },
      { id: "custom-tailoring", label: "Custom Tailoring" },
      { id: "local-art", label: "Local Art" },
      { id: "handmade-toys", label: "Handmade Toys" },
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
    id: "wines-spirits",
    label: "Wines & Spirits",
    emoji: "🍷",
    aliases: [
      "wine",
      "wines",
      "spirits",
      "liquor",
      "alcohol",
      "drinks",
      "bar",
      "beer",
      "whisky",
      "whiskey",
      "gin",
      "vodka",
      "kenya cane",
    ],
    subcategories: [
      { id: "local-beer", label: "Local Beer" },
      { id: "kenyan-spirits", label: "Kenyan Spirits" },
      { id: "red-wine", label: "Red Wine" },
      { id: "white-wine", label: "White Wine" },
      { id: "sparkling-champagne", label: "Sparkling & Champagne" },
      { id: "whisky", label: "Whisky" },
      { id: "gin", label: "Gin" },
      { id: "vodka", label: "Vodka" },
      { id: "cognac-brandy", label: "Cognac & Brandy" },
      { id: "rum", label: "Rum" },
      { id: "cider-rtd", label: "Cider & RTDs" },
      { id: "liqueurs", label: "Liqueurs" },
      { id: "mixers", label: "Mixers" },
      { id: "party-packs", label: "Party Packs" },
      { id: "non-alcoholic", label: "Non-Alcoholic" },
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
      { id: "back-to-school", label: "Back to School" },
      { id: "gift-ideas", label: "Gift Ideas" },
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
  "automotive/spare-parts": { browse: "automotive", sub: "spare-parts" },
  "automotive/batteries": { browse: "automotive", sub: "batteries" },
  "automotive/car-electronics": { browse: "automotive", sub: "car-electronics" },
  "automotive/car-care": { browse: "automotive", sub: "car-care" },
  "power-tools": { browse: "power-tools", sub: "drills" },
  "power-tools/drills": { browse: "power-tools", sub: "drills" },
  "power-tools/grinders": { browse: "power-tools", sub: "grinders" },
  "power-tools/toolsets-drillsets": { browse: "power-tools", sub: "toolsets-drillsets" },
  "power-tools/water-pumps": { browse: "power-tools", sub: "water-pumps" },
  "power-tools/welding-machines": { browse: "power-tools", sub: "welding-machines" },
  "power-tools/buffing-machines": { browse: "power-tools", sub: "buffing-machines" },
  "power-tools/carwash-spray-guns": { browse: "power-tools", sub: "carwash-spray-guns" },
  "power-tools/welding-generators": { browse: "power-tools", sub: "welding-generators" },
  "power-tools/spray-guns": { browse: "power-tools", sub: "spray-guns" },
  "power-tools/jigsaws": { browse: "power-tools", sub: "jigsaws" },
  "power-tools/circular-saws": { browse: "power-tools", sub: "circular-saws" },
  "power-tools/chain-powersaws": { browse: "power-tools", sub: "chain-powersaws" },
  "power-tools/impact-drivers": { browse: "power-tools", sub: "impact-drivers" },
  "power-tools/sanders": { browse: "power-tools", sub: "sanders" },
  "power-tools/air-compressors": { browse: "power-tools", sub: "air-compressors" },
  "power-tools/generators": { browse: "power-tools", sub: "generators" },
  "power-tools/hand-tools": { browse: "power-tools", sub: "hand-tools" },
  "power-tools/measuring-tools": { browse: "power-tools", sub: "measuring-tools" },
  "power-tools/safety-gear": { browse: "power-tools", sub: "safety-gear" },
  tools: { browse: "power-tools", sub: "drills" },
  hardware: { browse: "power-tools", sub: "hand-tools" },
  drills: { browse: "power-tools", sub: "drills" },
  welding: { browse: "power-tools", sub: "welding-machines" },
  "kids/bikes": { browse: "kids", sub: "bikes" },
  "kids/balance-bikes": { browse: "kids", sub: "balance-bikes" },
  "kids/scooters": { browse: "kids", sub: "scooters" },
  "kids/tricycles": { browse: "kids", sub: "tricycles" },
  "kids/ride-ons": { browse: "kids", sub: "ride-ons" },
  "kids/helmets-pads": { browse: "kids", sub: "helmets-pads" },
  "musical-instruments": { browse: "musical-instruments", sub: "guitars" },
  "musical-instruments/guitars": { browse: "musical-instruments", sub: "guitars" },
  "musical-instruments/keyboards": { browse: "musical-instruments", sub: "keyboards" },
  "musical-instruments/drums": { browse: "musical-instruments", sub: "drums" },
  "musical-instruments/dj-audio": { browse: "musical-instruments", sub: "dj-audio" },
  "musical-instruments/studio-gear": { browse: "musical-instruments", sub: "studio-gear" },
  "musical-instruments/instrument-accessories": {
    browse: "musical-instruments",
    sub: "instrument-accessories",
  },
  travel: { browse: "travel", sub: "luggage" },
  "travel/luggage": { browse: "travel", sub: "luggage" },
  "travel/backpacks": { browse: "travel", sub: "backpacks" },
  "travel/travel-accessories": { browse: "travel", sub: "travel-accessories" },
  "travel/camping-gear": { browse: "travel", sub: "camping-gear" },
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
  "sokoni-mashinani": { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  "sokoni-mashinani/fruits-vegetables": { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  "sokoni-mashinani/dairy-eggs": { browse: "sokoni-mashinani", sub: "dairy-eggs" },
  "sokoni-mashinani/grains-cereals": { browse: "sokoni-mashinani", sub: "grains-cereals" },
  "sokoni-mashinani/livestock": { browse: "sokoni-mashinani", sub: "livestock" },
  "sokoni-mashinani/poultry": { browse: "sokoni-mashinani", sub: "poultry" },
  "sokoni-mashinani/fresh-herbs": { browse: "sokoni-mashinani", sub: "fresh-herbs" },
  "sokoni-mashinani/honey-bee": { browse: "sokoni-mashinani", sub: "honey-bee" },
  "sokoni-mashinani/tubers-roots": { browse: "sokoni-mashinani", sub: "tubers-roots" },
  "sokoni-mashinani/farm-oils": { browse: "sokoni-mashinani", sub: "farm-oils" },
  "sokoni-mashinani/nuts-legumes": { browse: "sokoni-mashinani", sub: "nuts-legumes" },
  "sokoni-mashinani/spices-chilies": { browse: "sokoni-mashinani", sub: "spices-chilies" },
  "sokoni-mashinani/coffee-tea-leaves": { browse: "sokoni-mashinani", sub: "coffee-tea-leaves" },
  "sokoni-mashinani/fish-aquaculture": { browse: "sokoni-mashinani", sub: "fish-aquaculture" },
  "sokoni-mashinani/flowers-plants": { browse: "sokoni-mashinani", sub: "flowers-plants" },
  "sokoni-mashinani/farm-tools": { browse: "sokoni-mashinani", sub: "farm-tools" },
  "sokoni-mashinani/organic-produce": { browse: "sokoni-mashinani", sub: "organic-produce" },
  farm: { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  agriculture: { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  produce: { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  mashinani: { browse: "sokoni-mashinani", sub: "fruits-vegetables" },
  livestock: { browse: "sokoni-mashinani", sub: "livestock" },
  artisans: { browse: "artisans", sub: "wood-furniture" },
  "artisans/wood-furniture": { browse: "artisans", sub: "wood-furniture" },
  "artisans/textiles-kitenge": { browse: "artisans", sub: "textiles-kitenge" },
  "artisans/home-decor": { browse: "artisans", sub: "home-decor" },
  "artisans/traditional-wear": { browse: "artisans", sub: "traditional-wear" },
  "artisans/beadwork-jewelry": { browse: "artisans", sub: "beadwork-jewelry" },
  "artisans/pottery-ceramics": { browse: "artisans", sub: "pottery-ceramics" },
  "artisans/baskets-weaving": { browse: "artisans", sub: "baskets-weaving" },
  "artisans/leather-goods": { browse: "artisans", sub: "leather-goods" },
  "artisans/metalwork": { browse: "artisans", sub: "metalwork" },
  "artisans/carvings-sculpture": { browse: "artisans", sub: "carvings-sculpture" },
  "artisans/handmade-shoes": { browse: "artisans", sub: "handmade-shoes" },
  "artisans/soap-candles": { browse: "artisans", sub: "soap-candles" },
  "artisans/crochet-knit": { browse: "artisans", sub: "crochet-knit" },
  "artisans/custom-tailoring": { browse: "artisans", sub: "custom-tailoring" },
  "artisans/local-art": { browse: "artisans", sub: "local-art" },
  "artisans/handmade-toys": { browse: "artisans", sub: "handmade-toys" },
  crafts: { browse: "artisans", sub: "wood-furniture" },
  handmade: { browse: "artisans", sub: "home-decor" },
  kitenge: { browse: "artisans", sub: "textiles-kitenge" },
  woodwork: { browse: "artisans", sub: "wood-furniture" },
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
  "wines-spirits": { browse: "wines-spirits", sub: "local-beer" },
  "wines-spirits/local-beer": { browse: "wines-spirits", sub: "local-beer" },
  "wines-spirits/kenyan-spirits": { browse: "wines-spirits", sub: "kenyan-spirits" },
  "wines-spirits/red-wine": { browse: "wines-spirits", sub: "red-wine" },
  "wines-spirits/white-wine": { browse: "wines-spirits", sub: "white-wine" },
  "wines-spirits/sparkling-champagne": { browse: "wines-spirits", sub: "sparkling-champagne" },
  "wines-spirits/whisky": { browse: "wines-spirits", sub: "whisky" },
  "wines-spirits/gin": { browse: "wines-spirits", sub: "gin" },
  "wines-spirits/vodka": { browse: "wines-spirits", sub: "vodka" },
  "wines-spirits/cognac-brandy": { browse: "wines-spirits", sub: "cognac-brandy" },
  "wines-spirits/rum": { browse: "wines-spirits", sub: "rum" },
  "wines-spirits/cider-rtd": { browse: "wines-spirits", sub: "cider-rtd" },
  "wines-spirits/liqueurs": { browse: "wines-spirits", sub: "liqueurs" },
  "wines-spirits/mixers": { browse: "wines-spirits", sub: "mixers" },
  "wines-spirits/party-packs": { browse: "wines-spirits", sub: "party-packs" },
  "wines-spirits/non-alcoholic": { browse: "wines-spirits", sub: "non-alcoholic" },
  wine: { browse: "wines-spirits", sub: "red-wine" },
  spirits: { browse: "wines-spirits", sub: "kenyan-spirits" },
  liquor: { browse: "wines-spirits", sub: "kenyan-spirits" },
  alcohol: { browse: "wines-spirits", sub: "local-beer" },
  beer: { browse: "wines-spirits", sub: "local-beer" },
  whisky: { browse: "wines-spirits", sub: "whisky" },
  whiskey: { browse: "wines-spirits", sub: "whisky" },
  gin: { browse: "wines-spirits", sub: "gin" },
  vodka: { browse: "wines-spirits", sub: "vodka" },
  champagne: { browse: "wines-spirits", sub: "sparkling-champagne" },
  "kenya-cane": { browse: "wines-spirits", sub: "kenyan-spirits" },
  tusker: { browse: "wines-spirits", sub: "local-beer" },
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
    version: 9,
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
