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
  "power-tools": u("photo-1518709414768-a88981a4515d", 401),
  pets: u("photo-1548199973-03cce0bbc87b", 15),
  office: u("photo-1497366216548-37526070297c", 16),
  garden: u("photo-1416879595882-3373a0480b5b", 17),
  "musical-instruments": u("photo-1511379938547-c1f69419868d", 402),
  travel: u("photo-1488646953014-85cb44e25828", 403),
  restaurant: u("photo-1517248135467-4c7edcad34c4", 18),
  "wines-spirits": u("photo-1510812431401-41d2bd2722f3", 21),
  "sokoni-mashinani": u("photo-1464226184884-fa280b87c399", 22),
  artisans: u("photo-1452860606245-08befc0ff44b", 23),
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
  heels: u("photo-1543163521-1bf539c55dd2", 431),
  boots: u("photo-1549298916-b41d501d3772", 432),
  bags: u("photo-1584917865442-de89df76afd3", 30),
  jewelry: u("photo-1611591437281-460bfbe1220a", 31),
  sunglasses: u("photo-1572635196237-14b3f281503f", 32),
  beauty: u("photo-1596462502278-27bfdc403348", 33),
  lingerie: u("photo-1612817288484-6f916006741a", 433),
  maternity: u("photo-1496747611176-843222e1e57c", 434),
  "women/belts": u("photo-1553062407-98eeb64c6a62", 435),
  scarves: u("photo-1520903920243-00d872a2d1c9", 436),

  // Men
  "t-shirts": u("photo-1521572163474-6864f9cf17ab", 41),
  shirts: u("photo-1596755094514-f87e34085b2c", 42),
  hoodies: u("photo-1556821840-3a63f95609a7", 43),
  trousers: u("photo-1473966968600-fa801b869a1a", 44),
  shorts: u("photo-1591195853828-11db59a44f6b", 45),
  jackets: u("photo-1551028719-00167b16eac5", 46),
  "formal-wear": u("photo-1507679799987-c73779587ccf", 437),
  underwear: u("photo-1586790170083-2f9ceadc732d", 438),
  sneakers: u("photo-1542291026-7eec264c27ff", 47),
  sandals: u("photo-1606107557195-0e29a4b5b4aa", 439),
  caps: u("photo-1588850561407-ed78c282e89b", 48),
  watches: u("photo-1524592094714-0f0654e20314", 49),
  "men/bags": u("photo-1553062407-98eeb64c6a62", 50),
  "men/belts": u("photo-1553062407-98eeb64c6a62", 440),
  socks: u("photo-1586790170083-2f9ceadc732d", 441),
  belts: u("photo-1553062407-98eeb64c6a62", 442),

  // Kids — path-scoped shoes (must NOT reuse women's heels)
  clothing: u("photo-1519238263530-99bdd11df2ea", 61),
  "kids/shoes": u("photo-1560769629-975ec94e6a86", 62),
  "school-wear": u("photo-1503454537195-1dcabb73ffb9", 63),
  toys: u("photo-1558060370-d644479cb6f7", 64),
  "baby-gear": u("photo-1522771930-78848d9293e8", 65),
  "kids-accessories": u("photo-1572635196237-14b3f281503f", 66),
  "kids/bikes": u("photo-1571068316344-75bc76f77890", 411),
  bikes: u("photo-1571068316344-75bc76f77890", 411),
  "balance-bikes": u("photo-1515488764276-beab7607c1e6", 412),
  scooters: u("photo-1703131104663-446936b776b9", 413),
  "kids/scooters": u("photo-1703131104663-446936b776b9", 413),
  tricycles: u("photo-1535572290543-960a8046f5af", 414),
  "ride-ons": u("photo-1596461404969-9ae70f2830c1", 415),
  "helmets-pads": u("photo-1576435728678-68d0fbf94e91", 416),
  strollers: u("photo-1522771930-78848d9293e8", 417),
  nursery: u("photo-1515488764276-beab7607c1e6", 418),

  // Health & beauty
  skincare: u("photo-1556228578-0d85b1a4d571", 71),
  makeup: u("photo-1512496015851-a90fb38ba796", 72),
  haircare: u("photo-1522338242992-e1a54906a8da", 73),
  fragrances: u("photo-1541643600914-78b084683601", 74),
  "personal-care": u("photo-1556228720-195a672e8a03", 75),
  "mens-grooming": u("photo-1621607512214-68297480165e", 76),
  "nail-care": u("photo-1604654894610-df63bc536371", 77),
  "bath-body": u("photo-1584622650111-993a426fbf0a", 78),
  "hair-tools": u("photo-1522335789203-aabd1fc54bc9", 79),
  "oral-care": u("photo-1556228720-195a672e8a03", 80),
  wellness: u("photo-1544367567-0f2fcb009e0b", 421),

  // Brands
  sportswear: u("photo-1556906781-9a412961c28c", 81),
  designer: u("photo-1445205170230-053b83016050", 82),
  "local-labels": u("photo-1558769132-cb1aea458c5e", 83),
  "streetwear-brands": u("photo-1523398002811-999ca8dec234", 84),
  luxury: u("photo-1445205170230-053b83016050", 85),

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
  tennis: u("photo-1626224583764-f87db24ac4ea", 422),
  rugby: u("photo-1517649763962-0c623066013b", 423),
  boxing: u("photo-1549719386-74dfcbf7dbed", 424),
  yoga: u("photo-1544367567-0f2fcb009e0b", 425),
  camping: u("photo-1478131143081-80f7f84ca84d", 426),
  hiking: u("photo-1551632811-561732d1e306", 427),

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
  drones: u("photo-1579829366248-204fe8413f31", 451),
  networking: u("photo-1558494949-ef010cbdcc31", 452),
  printers: u("photo-1486312338219-ce68d2c6f44d", 453),

  // Home / supermarket
  kitchen: u("photo-1556909114-f6e7ad7d3136", 141),
  cookware: u("photo-1556911220-bff31c812dba", 454),
  tableware: u("photo-1513519245088-0e12902e5a38", 455),
  bedding: u("photo-1631049307264-da0ec9d70304", 142),
  decor: u("photo-1513519245088-0e12902e5a38", 143),
  furniture: u("photo-1586023492125-27b2c045efd7", 144),
  lighting: u("photo-1524484485831-a92ffc0de03f", 145),
  storage: u("photo-1595428774223-ef52624120d2", 146),
  bathroom: u("photo-1584622650111-993a426fbf0a", 456),
  curtains: u("photo-1524484485831-a92ffc0de03f", 457),
  rugs: u("photo-1586023492125-27b2c045efd7", 458),
  supermarket: u("photo-1542838132-92c53300491e", 147),
  "food-staples": u("photo-1586201375761-83865001e31c", 148),
  beverages: u("photo-1622483767028-3f66f32aef97", 149),
  snacks: u("photo-1622483767028-3f66f32aef97", 459),
  "cooking-oils": u("photo-1474979266404-7eaacbcd87c5", 460),
  "baby-food": u("photo-1522771930-78848d9293e8", 461),
  household: u("photo-1563453392212-326f5e854473", 150),
  cleaning: u("photo-1563453392212-326f5e854473", 462),
  "personal-grocery": u("photo-1608571423902-eed4a5ad8108", 151),

  // Automotive
  "car-accessories": u("photo-1486262715619-67b85e0b08d3", 161),
  "oils-fluids": u("photo-1487754180451-c456f719a1fc", 162),
  "tyres-wheels": u("photo-1558618666-fcd25c85cd64", 163),
  motorbike: u("photo-1558981806-ec527fa84c39", 164),
  "tools-care": u("photo-1530124566582-a618bc2615dc", 165),
  "spare-parts": u("photo-1486262715619-67b85e0b08d3", 463),
  batteries: u("photo-1606676539940-12768ce0e762", 464),
  "car-electronics": u("photo-1492144534655-ae79c964c9d7", 465),
  "car-care": u("photo-1606676539940-12768ce0e762", 466),

  // Power Tools (Saratech-style + extras)
  drills: u("photo-1518709414768-a88981a4515d", 501),
  grinders: u("photo-1504148455328-c376907d081c", 502),
  "toolsets-drillsets": u("photo-1572981779307-38b8cabb2407", 503),
  "water-pumps": u("photo-1621905252507-b35492cc74b4", 504),
  "welding-machines": u("photo-1504328345606-18bbc8c9d7d1", 505),
  "buffing-machines": u("photo-1581092918056-0c4c3acd3789", 506),
  "carwash-spray-guns": u("photo-1606676539940-12768ce0e762", 507),
  "welding-generators": u("photo-1621905251189-08b45d6a269e", 508),
  "spray-guns": u("photo-1590635023142-73c3d34f2805", 509),
  jigsaws: u("photo-1540103711724-ebf833bde8d1", 510),
  "circular-saws": u("photo-1513467535987-fd81bc7d62f8", 511),
  "chain-powersaws": u("photo-1505855796860-aa05646cbf1f", 512),
  "impact-drivers": u("photo-1518709414768-a88981a4515d", 513),
  sanders: u("photo-1546827209-a218e99fdbe9", 514),
  "air-compressors": u("photo-1585201731775-0597e1be4bfb", 515),
  generators: u("photo-1621905251189-08b45d6a269e", 516),
  "hand-tools": u("photo-1530124566582-a618bc2615dc", 517),
  "measuring-tools": u("photo-1503387762-592deb58ef4e", 518),
  "safety-gear": u("photo-1592054286113-649ba108e968", 519),

  // Pets
  "pet-food": u("photo-1548199973-03cce0bbc87b", 171),
  "pet-accessories": u("photo-1450778869180-41d0601e046e", 172),
  "pet-care": u("photo-1548199973-03cce0bbc87b", 173),
  dogs: u("photo-1548199973-03cce0bbc87b", 471),
  cats: u("photo-1514888286974-6c03e2ca1dba", 472),
  "fish-aquarium": u("photo-1519708227418-c8fd9a32b7a2", 473),
  birds: u("photo-1552728089-57bdde30beb3", 474),

  // Office
  stationery: u("photo-1586281380349-632531db7ed4", 181),
  books: u("photo-1457369804613-52c61a468e7d", 182),
  "desk-tech": u("photo-1587829741301-dc798b83add3", 183),
  "school-supplies": u("photo-1586281380349-632531db7ed4", 475),
  organizers: u("photo-1595428774223-ef52624120d2", 476),
  "printers-ink": u("photo-1612817288484-6f916006741a", 477),

  // Garden
  plants: u("photo-1416879595882-3373a0480b5b", 191),
  "garden-tools": u("photo-1416879595882-3373a0480b5b", 192),
  "outdoor-living": u("photo-1478131143081-80f7f84ca84d", 193),
  seeds: u("photo-1464226184884-fa280b87c399", 478),
  irrigation: u("photo-1621905252507-b35492cc74b4", 479),
  "bbq-outdoor": u("photo-1555939594-58d7cb561ad1", 480),
  "solar-garden": u("photo-1509391366360-2e959784a276", 481),

  // Musical Instruments
  guitars: u("photo-1511379938547-c1f69419868d", 521),
  keyboards: u("photo-1520523839897-bd0b52f945a0", 522),
  drums: u("photo-1511671782779-c97d3d27a1d4", 523),
  "dj-audio": u("photo-1470225620780-dba8ba36b745", 524),
  "studio-gear": u("photo-1598488035139-bdbb2231ce04", 525),
  "instrument-accessories": u("photo-1564186763535-ebb21ef5277f", 526),

  // Travel & Luggage
  luggage: u("photo-1563729784474-d77dbb933a9e", 531),
  backpacks: u("photo-1553062407-98eeb64c6a62", 532),
  "travel-accessories": u("photo-1488646953014-85cb44e25828", 533),
  "camping-gear": u("photo-1478131143081-80f7f84ca84d", 534),

  // Sokoni Mashinani — farm-fresh produce & agri goods
  "fruits-vegetables": u("photo-1610348725531-843dff563e2c", 301),
  "dairy-eggs": u("photo-1628088062854-d1870b4553da", 302),
  "grains-cereals": u("photo-1574323347407-f5e1ad6d020b", 303),
  livestock: u("photo-1570042225831-d98fa7577f1e", 304),
  poultry: u("photo-1548550023-2bdb3c5beed7", 305),
  "fresh-herbs": u("photo-1501004318641-b39e6451bec6", 306),
  "honey-bee": u("photo-1558642452-9d2a7deb7f62", 307),
  "tubers-roots": u("photo-1518977676601-b53f82aba655", 308),
  "farm-oils": u("photo-1474979266404-7eaacbcd87c5", 309),
  "nuts-legumes": u("photo-1599599810769-bcde5a160d32", 310),
  "spices-chilies": u("photo-1506368083636-6defb67639a7", 311),
  "coffee-tea-leaves": u("photo-1447933601403-0c6688de566e", 312),
  "fish-aquaculture": u("photo-1519708227418-c8fd9a32b7a2", 313),
  "flowers-plants": u("photo-1490750967868-88aa4486c946", 314),
  "farm-tools": u("photo-1416879595882-3373a0480b5b", 315),
  "organic-produce": u("photo-1540420773420-3366772f4999", 316),

  // Artisans & Crafts — makers, woodwork, textiles, handmade
  "wood-furniture": u("photo-1616486338812-3dadae4b4ace", 331),
  "textiles-kitenge": u("photo-1766107349536-c6de9ab38dcd", 332),
  "home-decor": u("photo-1513519245088-0e12902e5a38", 333),
  "traditional-wear": u("photo-1648328168368-3a25f2152802", 334),
  "beadwork-jewelry": u("photo-1535632066927-ab7c9ab60908", 335),
  "pottery-ceramics": u("photo-1565193566173-7a0ee3dbe261", 336),
  "baskets-weaving": u("photo-1777566131330-8f2c8b497847", 337),
  "leather-goods": u("photo-1473187983305-f615310e7daa", 338),
  metalwork: u("photo-1504328345606-18bbc8c9d7d1", 339),
  "carvings-sculpture": u("photo-1549497538-303791108f95", 340),
  "handmade-shoes": u("photo-1460353581641-37baddab0fa2", 341),
  "soap-candles": u("photo-1608571423902-eed4a5ad8108", 342),
  "crochet-knit": u("photo-1584992236310-6edddc08acff", 343),
  "custom-tailoring": u("photo-1556905055-8f358a7a47b2", 344),
  "local-art": u("photo-1541961017774-22349e4a1262", 345),
  "handmade-toys": u("photo-1596461404969-9ae70f2830c1", 346),

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
  "back-to-school": u("photo-1503454537195-1dcabb73ffb9", 541),
  "gift-ideas": u("photo-1513885535751-8b9238bd345a", 542),
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
