/**
 * Public web thumbnails for browse categories / subcategories.
 * Unsplash lifestyle/product shots — NOT catalog product photos.
 * Every ID must return image/* (verified via scripts/verify-browse-images.mjs).
 */

const u = (id, sig = 1) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&h=600&q=80&sig=${sig}`;

/** Top-level browse category → image URL */
export const CATEGORY_IMAGES = {
  women: u("photo-1483985988355-763728e1935b", 1),
  men: u("photo-1490578474895-699cd4e2cf59", 2),
  kids: u("photo-1503454537195-1dcabb73ffb9", 3),
  "health-beauty": u("photo-1596462502278-27bfdc403348", 4),
  brands: u("photo-1441986300917-64674bd600d8", 5),
  sports: u("photo-1517836357463-d25dfeac3438", 6),
  phones: u("photo-1511707171634-5f897ff02aa9", 7),
  "tv-audio": u("photo-1593359677879-a4bb92f829d1", 8),
  computers: u("photo-1496181133206-80ce9b88a853", 9),
  "appliances-home": u("photo-1556911220-bff31c812dba", 10),
  electronics: u("photo-1468495244123-6c6c332eeece", 11),
  home: u("photo-1586023492125-27b2c045efd7", 12),
  supermarket: u("photo-1542838132-92c53300491e", 13),
  automotive: u("photo-1492144534655-ae79c964c9d7", 14),
  pets: u("photo-1548199973-03cce0bbc87b", 15),
  office: u("photo-1497366216548-37526070297c", 16),
  garden: u("photo-1416879595882-3373a0480b5b", 17),
  restaurant: u("photo-1517248135467-4c7edcad34c4", 18),
  "wines-spirits": u("photo-1510812431401-41d2bd2722f3", 21),
  trending: u("photo-1558171813-4c088753af8f", 19),
  sale: u("photo-1607083206869-4c7672e72a8a", 20),
};

/**
 * Subcategory id → image URL.
 * Prefer path-scoped keys `category/sub` when the same sub id means different things
 * (e.g. women/shoes vs kids/shoes).
 */
export const SUBCATEGORY_IMAGES = {
  // Women
  tops: u("photo-1523381210434-271e8be1f52b", 21),
  dresses: u("photo-1595777457583-95e059d581b8", 22),
  jeans: u("photo-1542272604-787c3835535d", 23),
  outerwear: u("photo-1551028719-00167b16eac5", 24),
  skirts: u("photo-1594633312681-425c7b97ccd1", 25),
  jumpsuits: u("photo-1617019114583-affb34d1b3cd", 26),
  activewear: u("photo-1518611012118-696072aa579a", 27),
  sleepwear: u("photo-1522771739844-6a9f6d5f14af", 28),
  shoes: u("photo-1543163521-1bf539c55dd2", 29),
  "women/shoes": u("photo-1543163521-1bf539c55dd2", 29),
  bags: u("photo-1584917865442-de89df76afd3", 30),
  jewelry: u("photo-1611591437281-460bfbe1220a", 31),
  sunglasses: u("photo-1572635196237-14b3f281503f", 32),
  beauty: u("photo-1596462502278-27bfdc403348", 33),

  // Men
  "t-shirts": u("photo-1521572163474-6864f9cf17ab", 41),
  shirts: u("photo-1596755094514-f87e34085b2c", 42),
  hoodies: u("photo-1556821840-3a63f95609a7", 43),
  trousers: u("photo-1473966968600-fa801b869a1a", 44),
  shorts: u("photo-1591195853828-11db59a44f6b", 45),
  jackets: u("photo-1551028719-00167b16eac5", 46),
  sneakers: u("photo-1542291026-7eec264c27ff", 47),
  caps: u("photo-1588850561407-ed78c282e89b", 48),
  watches: u("photo-1524592094714-0f0654e20314", 49),
  "men/bags": u("photo-1553062407-98eeb64c6a62", 50),

  // Kids — path-scoped shoes (must NOT reuse women's heels)
  clothing: u("photo-1519238263530-99bdd11df2ea", 61),
  "kids/shoes": u("photo-1560769629-975ec94e6a86", 62),
  "school-wear": u("photo-1503454537195-1dcabb73ffb9", 63),
  toys: u("photo-1558060370-d644479cb6f7", 64),
  "baby-gear": u("photo-1522771930-78848d9293e8", 65),
  "kids-accessories": u("photo-1572635196237-14b3f281503f", 66),

  // Health & beauty
  skincare: u("photo-1556228578-0d85b1a4d571", 71),
  makeup: u("photo-1512496015851-a90fb38ba796", 72),
  haircare: u("photo-1522338242992-e1a54906a8da", 73),
  fragrances: u("photo-1541643600914-78b084683601", 74),
  "personal-care": u("photo-1556228720-195a672e8a03", 75),
  "mens-grooming": u("photo-1621607512214-68297480165e", 76),
  "nail-care": u("photo-1604654894610-df63bc536371", 77),
  "bath-body": u("photo-1584622650111-993a426fbf0a", 78),

  // Brands
  sportswear: u("photo-1556906781-9a412961c28c", 81),
  designer: u("photo-1445205170230-053b83016050", 82),
  "local-labels": u("photo-1558769132-cb1aea458c5e", 83),

  // Sports
  trainers: u("photo-1606107557195-0e29a4b5b4aa", 91),
  equipment: u("photo-1517836357463-d25dfeac3438", 92),
  "gym-fitness": u("photo-1571019614242-c5c5dee9f50b", 93),
  outdoor: u("photo-1478131143081-80f7f84ca84d", 94),
  football: u("photo-1574629810360-7efbbe195018", 95),
  cycling: u("photo-1571068316344-75bc76f77890", 96),
  swimming: u("photo-1530549387789-4c1017266635", 97),
  running: u("photo-1476480862126-209bfaa8edc8", 98),
  basketball: u("photo-1546519638-68e109498ffc", 99),

  // Phones / electronics (canonical + nav alias ids)
  phones: u("photo-1511707171634-5f897ff02aa9", 111),
  smartphones: u("photo-1592899677977-9c10ca588bbd", 112),
  tablets: u("photo-1544244015-0df4b3ffc6b0", 113),
  // Charger / cable — not the boutique store fallback
  "phone-accessories": u("photo-1583863788434-e58a36330cf0", 114),
  // Portable charging case / power accessory
  "power-banks": u("photo-1606220945770-b5b6c2c55bf1", 115),
  "tvs-audio": u("photo-1593359677879-a4bb92f829d1", 116),
  televisions: u("photo-1593359677879-a4bb92f829d1", 117),
  headphones: u("photo-1505740420928-5e560c06d30e", 118),
  speakers: u("photo-1545454675-3531b543be5d", 119),
  wearables: u("photo-1579586337278-3befd40fd17a", 120),
  computing: u("photo-1496181133206-80ce9b88a853", 121),
  laptops: u("photo-1525547719571-a2d4ac8945e2", 122),
  desktops: u("photo-1593640408182-31c70c8268f5", 123),
  accessories: u("photo-1587829741301-dc798b83add3", 124),
  gaming: u("photo-1493711662062-fa541adb3fc8", 125),
  cameras: u("photo-1516035069371-29a1b244cc32", 126),
  "smart-home": u("photo-1558002038-1055907df827", 127),
  appliances: u("photo-1556911220-bff31c812dba", 128),
  "kitchen-appliances": u("photo-1574269909862-7e1d70bb8078", 129),
  laundry: u("photo-1626806787461-102c1bfaaea1", 130),
  // Fridge / cold appliance stand-in for Cooling & Fans (verified JPEG)
  cooling: u("photo-1574269909862-7e1d70bb8078", 131),

  // Home / supermarket
  kitchen: u("photo-1556909114-f6e7ad7d3136", 141),
  bedding: u("photo-1631049307264-da0ec9d70304", 142),
  decor: u("photo-1513519245088-0e12902e5a38", 143),
  furniture: u("photo-1586023492125-27b2c045efd7", 144),
  lighting: u("photo-1524484485831-a92ffc0de03f", 145),
  storage: u("photo-1595428774223-ef52624120d2", 146),
  supermarket: u("photo-1542838132-92c53300491e", 147),
  "food-staples": u("photo-1586201375761-83865001e31c", 148),
  beverages: u("photo-1622483767028-3f66f32aef97", 149),
  household: u("photo-1563453392212-326f5e854473", 150),
  "personal-grocery": u("photo-1608571423902-eed4a5ad8108", 151),

  // Automotive
  "car-accessories": u("photo-1486262715619-67b85e0b08d3", 161),
  "oils-fluids": u("photo-1487754180451-c456f719a1fc", 162),
  "tyres-wheels": u("photo-1558618666-fcd25c85cd64", 163),
  motorbike: u("photo-1558981806-ec527fa84c39", 164),
  "tools-care": u("photo-1530124566582-a618bc2615dc", 165),

  // Pets
  "pet-food": u("photo-1548199973-03cce0bbc87b", 171),
  "pet-accessories": u("photo-1450778869180-41d0601e046e", 172),
  "pet-care": u("photo-1548199973-03cce0bbc87b", 173),

  // Office
  stationery: u("photo-1586281380349-632531db7ed4", 181),
  books: u("photo-1457369804613-52c61a468e7d", 182),
  "desk-tech": u("photo-1587829741301-dc798b83add3", 183),

  // Garden
  plants: u("photo-1416879595882-3373a0480b5b", 191),
  "garden-tools": u("photo-1416879595882-3373a0480b5b", 192),
  "outdoor-living": u("photo-1478131143081-80f7f84ca84d", 193),

  // Restaurant — Kenya meals / diets / dishes (local vibes, not foreign chains)
  "nyama-choma": u("photo-1555939594-58d7cb561ad1", 221),
  "ugali-plates": u("photo-1596797038530-2c107229654b", 222),
  "pilau-biryani": u("photo-1589302168068-964664d93dc0", 223),
  "chapati-meals": u("photo-1601050690597-df0568f70950", 224),
  "githeri-stews": u("photo-1547592166-23ac45744acd", 225),
  "chicken-dishes": u("photo-1603133872878-684f208fb84b", 226),
  "fish-seafood": u("photo-1519708227418-c8fd9a32b7a2", 227),
  "street-bites": u("photo-1529042410759-befb1204b468", 228),
  breakfast: u("photo-1482049016688-2d3e1b311543", 229),
  "lunch-boxes": u("photo-1476224203421-9ac39bcb3327", 230),
  "vegan-plant": u("photo-1512621776951-a57141f2eefd", 231),
  "healthy-bowls": u("photo-1546069901-ba9599a7e63c", 232),
  "diet-meals": u("photo-1490645935967-10de6ba17061", 233),
  "fresh-juices": u("photo-1613478223719-2ab802602423", 234),
  desserts: u("photo-1565958011703-44f9829ba187", 235),
  "catering-platters": u("photo-1555244162-803834f70033", 236),

  // Wines & Spirits — Kenya liquor aisle (local beer/spirits + common bar stock)
  "local-beer": u("photo-1608270586620-248524c67de9", 261),
  "kenyan-spirits": u("photo-1527281400683-1aae777175f8", 262),
  "red-wine": u("photo-1506377247377-2a5b3b417ebb", 263),
  "white-wine": u("photo-1568213816046-0ee1c42bd559", 264),
  "sparkling-champagne": u("photo-1595981267035-7b04ca84a82d", 265),
  whisky: u("photo-1527281400683-1aae777175f8", 266),
  gin: u("photo-1551538827-9c037cb4f32a", 267),
  vodka: u("photo-1607623814075-e51df1bdc82f", 268),
  "cognac-brandy": u("photo-1605276374104-dee2a0ed3cd6", 269),
  rum: u("photo-1571613316887-6f8d5cbf7ef7", 270),
  "cider-rtd": u("photo-1618885472179-5e474019f2a9", 271),
  liqueurs: u("photo-1574096079513-d8259312b785", 272),
  mixers: u("photo-1556679343-c7306c1976bc", 273),
  "party-packs": u("photo-1436076863939-06870fe779c2", 274),
  "non-alcoholic": u("photo-1622597467836-f3285f2131b8", 275),

  // Trending / sale
  "thrift-fits": u("photo-1558769132-cb1aea458c5e", 241),
  "official-wear": u("photo-1507679799987-c73779587ccf", 242),
  streetwear: u("photo-1523398002811-999ca8dec234", 243),
  "party-outfits": u("photo-1515886657613-9f3515b0c78f", 244),
  viral: u("photo-1483985988355-763728e1935b", 245),
  "under-1000": u("photo-1607083206869-4c7672e72a8a", 251),
  "under-2500": u("photo-1607082348824-0a96f2a4b9da", 252),
  "under-5000": u("photo-1556742049-0cfed4f6a45d", 253),
  "under-10000": u("photo-1472851294608-062f824d29cc", 254),
};

export function categoryImageUrl(id) {
  return CATEGORY_IMAGES[id] || null;
}

/** Resolve image for a subcategory; pass categoryId for path-scoped overrides. */
export function subcategoryImageUrl(id, categoryId = null) {
  if (categoryId) {
    const scoped = SUBCATEGORY_IMAGES[`${categoryId}/${id}`];
    if (scoped) return scoped;
  }
  return SUBCATEGORY_IMAGES[id] || null;
}
