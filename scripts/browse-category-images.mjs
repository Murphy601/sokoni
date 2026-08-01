/**
 * Public web thumbnails for browse categories / subcategories.
 * Unsplash product/lifestyle cutouts — NOT catalog product photos.
 * Sized for menu tiles: square crop, modest width.
 */

const u = (id, sig = 1) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&h=400&q=80&sig=${sig}`;

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
  trending: u("photo-1558171813-4c088753af8f", 15),
  sale: u("photo-1607083206869-4c7672e72a8a", 16),
};

/**
 * Subcategory id → image URL.
 * Shared ids (e.g. shoes, jeans) use one curated shot.
 */
export const SUBCATEGORY_IMAGES = {
  // Women / fashion
  tops: u("photo-1523381210434-271e8be1f52b", 21),
  dresses: u("photo-1595777457583-95e059d581b8", 22),
  jeans: u("photo-1542272604-787c3835535d", 23),
  outerwear: u("photo-1551028719-00167b16eac5", 24),
  shoes: u("photo-1543163521-1bf539c55dd2", 25),
  bags: u("photo-1584917865442-de89df76afd3", 26),
  jewelry: u("photo-1611591437281-460bfbe1220a", 27),
  beauty: u("photo-1596462502278-27bfdc403348", 28),

  // Men
  "t-shirts": u("photo-1521572163474-6864f9cf17ab", 31),
  shirts: u("photo-1596755094514-f87e34085b2c", 32),
  hoodies: u("photo-1556821840-3a63f95609a7", 33),
  sneakers: u("photo-1542291026-7eec264c27ff", 34),
  caps: u("photo-1588850561407-ed78c282e89b", 35),
  watches: u("photo-1524592094714-0f0654e20314", 36),

  // Kids
  clothing: u("photo-1519238263530-99bdd11df2ea", 41),
  toys: u("photo-1558060370-d644479cb6f7", 42),
  "baby-gear": u("photo-1522771930-78848d9293e8", 43),

  // Health & beauty
  skincare: u("photo-1556228578-0d85b1a4d571", 51),
  makeup: u("photo-1512496015851-a90fb38ba796", 52),
  haircare: u("photo-1522338242992-e1a54906a8da", 53),
  fragrances: u("photo-1541643600914-78b084683601", 54),
  "personal-care": u("photo-1556228720-195a672e8a03", 55),
  "mens-grooming": u("photo-1621607512214-68297480165e", 56),

  // Brands
  sportswear: u("photo-1556906781-9a412961c28c", 61),
  designer: u("photo-1445205170230-053b83016050", 62),
  "local-labels": u("photo-1558769132-cb1aea458c5e", 63),

  // Sports
  activewear: u("photo-1518611012118-696072aa579a", 71),
  trainers: u("photo-1606107557195-0e29a4b5b4aa", 72),
  equipment: u("photo-1517836357463-d25dfeac3438", 73),
  "gym-fitness": u("photo-1571019614242-c5c5dee9f50b", 74),
  outdoor: u("photo-1478131143081-80f7f84ca84d", 75),
  football: u("photo-1574629810360-7efbbe195018", 76),
  cycling: u("photo-1571068316344-75bc76f77890", 77),

  // Phones / electronics
  phones: u("photo-1511707171634-5f897ff02aa9", 81),
  smartphones: u("photo-1592899677977-9c10ca588bbd", 82),
  tablets: u("photo-1544244015-0df4b3ffc6b0", 83),
  "phone-accessories": u("photo-1606220945770-b5b6c2c55bf1", 84),
  "power-banks": u("photo-1583394838336-acd977736f90", 85),
  "tvs-audio": u("photo-1593359677879-a4bb92f829d1", 86),
  televisions: u("photo-1593359677879-a4bb92f829d1", 87),
  headphones: u("photo-1505740420928-5e560c06d30e", 88),
  speakers: u("photo-1545454675-3531b543be5d", 89),
  wearables: u("photo-1579586337278-3befd40fd17a", 90),
  computing: u("photo-1496181133206-80ce9b88a853", 91),
  laptops: u("photo-1525547719571-a2d4ac8945e2", 92),
  desktops: u("photo-1593640408182-31c70c8268f5", 93),
  accessories: u("photo-1587829741301-dc798b83add3", 94),
  appliances: u("photo-1556911220-bff31c812dba", 95),
  "kitchen-appliances": u("photo-1574269909862-7e1d70bb8078", 96),
  laundry: u("photo-1626806787461-102c1bfaaea1", 97),
  cooling: u("photo-1612198188060-c7c2a3b66eae", 98),
  gaming: u("photo-1493711662062-fa541adb3fc8", 99),

  // Home / supermarket
  kitchen: u("photo-1556909114-f6e7ad7d3136", 101),
  bedding: u("photo-1631049307264-da0ec9d70304", 102),
  decor: u("photo-1513519245088-0e12902e5a38", 103),
  supermarket: u("photo-1542838132-92c53300491e", 104),
  "food-staples": u("photo-1586201375761-83865001e31c", 105),
  beverages: u("photo-1622483767028-3f66f32aef97", 106),
  household: u("photo-1563453392212-326f5e854473", 107),
  "personal-grocery": u("photo-1608571423902-eed4a5ad8108", 108),

  // Automotive
  "car-accessories": u("photo-1486262715619-67b85e0b08d3", 111),
  "oils-fluids": u("photo-1487754180451-c456f719a1fc", 112),
  "tyres-wheels": u("photo-1558618666-fcd25c85cd64", 113),
  motorbike: u("photo-1558981806-ec527fa84c39", 114),
  "tools-care": u("photo-1530124566582-a618bc2615dc", 115),

  // Trending / sale
  "thrift-fits": u("photo-1558769132-cb1aea458c5e", 121),
  "official-wear": u("photo-1507679799987-c73779587ccf", 122),
  streetwear: u("photo-1523398002811-999ca8dec234", 123),
  "party-outfits": u("photo-1515886657613-9f3515b0c78f", 124),
  viral: u("photo-1483985988355-763728e1935b", 125),
  "under-1000": u("photo-1607083206869-4c7672e72a8a", 131),
  "under-2500": u("photo-1607082348824-0a96f2a4b9da", 132),
  "under-5000": u("photo-1556742049-0cfed4f6a45d", 133),
  "under-10000": u("photo-1472851294608-062f824d29cc", 134),
};

export function categoryImageUrl(id) {
  return CATEGORY_IMAGES[id] || null;
}

export function subcategoryImageUrl(id) {
  return SUBCATEGORY_IMAGES[id] || null;
}
