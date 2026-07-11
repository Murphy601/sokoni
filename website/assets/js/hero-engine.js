/**
 * Hero platform story engine — DOM “videos” from live JSON.
 * Does not modify app.js catalog logic.
 */
(function () {
  const STORY_MS_DEFAULT = 60000;
  const WHATSAPP = "254117422428";

  const CATEGORY_META = {
    "phones-tablets": { label: "Phones & Tablets", emoji: "📱" },
    "tvs-audio": { label: "TVs & Audio", emoji: "📺" },
    appliances: { label: "Appliances", emoji: "🔌" },
    "health-beauty": { label: "Health & Beauty", emoji: "💄" },
    "home-office": { label: "Home & Office", emoji: "🏠" },
    fashion: { label: "Fashion", emoji: "👗" },
    computing: { label: "Computing", emoji: "💻" },
    gaming: { label: "Gaming", emoji: "🎮" },
    supermarket: { label: "Supermarket", emoji: "🛒" },
    "baby-products": { label: "Baby Products", emoji: "🍼" },
  };

  const SUBCATEGORY_LABELS = {
    smartphones: "Smartphones",
    tablets: "Tablets",
    "power-banks": "Power Banks",
    televisions: "TVs",
    headphones: "Headphones",
    speakers: "Speakers",
    "kitchen-appliances": "Kitchen",
    skincare: "Skincare",
    fragrances: "Fragrances",
  };

  let siteStory = {};
  let stories = [];
  let storyDurationMs = STORY_MS_DEFAULT;
  let products = [];
  let featured = null;
  let intlProduct = null;
  let storyIndex = 0;
  let frameTimers = [];
  let reducedMotion = false;
  let filmstripProducts = [];
  let filmstripIdx = 0;
  let filmstripTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatKes(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `KES ${v.toLocaleString()}` : "KES —";
  }

  function vars(extra = {}) {
    const p = featured || {};
    return {
      productName: p.name || "Tecno Spark 20",
      price: formatKes(p.priceKes || 13599),
      orderId: "SK-1042",
      till: siteStory.mpesaTill || "4775847",
      tillName: siteStory.mpesaTillName || "David Thuku Muiruri",
      whatsappDisplay: siteStory.whatsappDisplay || "+254 117 422 428",
      promoCode: siteStory.promoCode || "SOKONI3",
      offerPercent: siteStory.offerPercent || 3,
      storeCount: products.filter((x) => x.fulfillment === "store").length || 1200,
      ...extra,
    };
  }

  function interpolate(text, ctx) {
    return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "");
  }

  async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url);
    return res.json();
  }

  function pickProducts(list) {
    const store = list.filter((p) => p.fulfillment === "store" && p.inStock !== false);
    const intl = list.filter((p) => p.scope === "international");
    featured = store.find((p) => p.imageUrl) || store[0] || null;
    intlProduct = intl[0] || null;
    products = list;
  }

  function buildFilmstrip() {
    const wrap = $("hero-filmstrip");
    if (!wrap) return;
    filmstripProducts = products
      .filter((p) => p.imageUrl && p.fulfillment === "store")
      .slice(0, 12);
    if (!filmstripProducts.length) return;
    wrap.innerHTML = `<div class="hero-filmstrip-single" id="hero-filmstrip-slide"></div>`;
    showFilmstripSlide(0);
    if (filmstripTimer) clearInterval(filmstripTimer);
    if (!reducedMotion) {
      filmstripTimer = setInterval(() => {
        filmstripIdx = (filmstripIdx + 1) % filmstripProducts.length;
        showFilmstripSlide(filmstripIdx);
      }, 3800);
    }
  }

  function showFilmstripSlide(idx) {
    const slide = $("hero-filmstrip-slide");
    const p = filmstripProducts[idx];
    if (!slide || !p) return;
    const name = esc(p.name?.slice(0, 36) || "Product");
    const price = formatKes(p.priceKes);
    slide.classList.remove("is-active");
    slide.innerHTML =
      `<img src="${esc(p.imageUrl)}" alt="${name}" loading="lazy" decoding="async" />` +
      `<div class="hero-filmstrip-caption"><strong>${name}</strong><span>${price} · Pay on delivery</span></div>`;
    requestAnimationFrame(() => slide.classList.add("is-active"));
  }

  function showFilmstrip(show) {
    const film = $("hero-filmstrip");
    const site = $("hero-site-stage");
    if (film) film.classList.toggle("is-hidden", !show);
    if (site) site.classList.toggle("hidden", show);
  }

  function renderSitePanel(frame) {
    const stage = $("hero-site-stage");
    if (!stage) return;

    if (frame.panel === "filmstrip") {
      showFilmstrip(true);
      return;
    }

    showFilmstrip(false);
    const ctx = vars();
    const bar = `<div class="hero-site-bar">🛒 sokonimall.com</div>`;

    if (frame.panel === "categories") {
      const cats = Object.entries(CATEGORY_META)
        .slice(0, 8)
        .map(
          ([id, c], i) =>
            `<div class="hero-site-card${frame.highlight === id ? " is-highlight" : ""}" style="animation-delay:${i * 0.05}s"><span class="emoji">${c.emoji}</span>${esc(c.label)}</div>`
        )
        .join("");
      stage.innerHTML = `${bar}<div class="hero-site-grid">${cats}</div>`;
      return;
    }

    if (frame.panel === "subcategories") {
      const cat = CATEGORY_META[frame.category || "phones-tablets"] || { label: "Phones", emoji: "📱" };
      const subs = ["smartphones", "tablets", "power-banks"]
        .map(
          (s, i) =>
            `<div class="hero-site-list-item${frame.highlight === s ? " is-highlight" : ""}">${i + 1}. ${esc(SUBCATEGORY_LABELS[s] || s)}</div>`
        )
        .join("");
      stage.innerHTML = `${bar}<p class="mb-2 font-bold">${cat.emoji} ${esc(cat.label)}</p><div class="hero-site-list">${subs}</div>`;
      return;
    }

    if (frame.panel === "products") {
      const list = products
        .filter((p) => p.fulfillment === "store" && p.imageUrl)
        .slice(0, 4);
      const rows = list
        .map(
          (p, i) =>
            `<div class="hero-site-product${frame.highlightIndex === i ? " is-highlight" : ""}"><img src="${esc(p.imageUrl)}" alt="" />` +
            `<div><strong>${esc(p.name?.slice(0, 22) || "Product")}</strong><br/>${formatKes(p.priceKes)} · COD</div></div>`
        )
        .join("");
      stage.innerHTML = `${bar}<p class="mb-2 font-bold">📱 Smartphones</p>${rows}`;
      return;
    }

    if (frame.panel === "search") {
      const q = frame.query || "camera phone chini ya 15k";
      stage.innerHTML =
        `${bar}<p class="mb-2">🔍 <strong>${esc(q)}</strong></p>` +
        `<div class="hero-site-list-item is-highlight">${esc(featured?.name || ctx.productName)} — ${ctx.price}</div>` +
        `<div class="hero-site-list-item">…more pay-on-delivery matches</div>`;
      return;
    }

    if (frame.panel === "product-detail") {
      const p = featured;
      stage.innerHTML =
        `${bar}` +
        (p?.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" class="w-full h-16 object-contain rounded-lg mb-2 bg-white/50" />` : "") +
        `<p class="font-bold">${esc(p?.name || ctx.productName)}</p>` +
        `<p class="text-brand-green font-bold">${ctx.price} · Pay on delivery</p>` +
        `<p class="mt-1 rounded-full bg-brand-green/20 text-center py-1 font-bold">💬 Ask on WhatsApp</p>`;
      return;
    }

    if (frame.panel === "pickup-info") {
      stage.innerHTML =
        `${bar}<p class="font-bold mb-1">📍 Pickup point programme</p>` +
        `<p>Earn KES 50+ per parcel · anywhere in Kenya</p>` +
        `<p class="mt-2 rounded-lg bg-brand-green/15 px-2 py-1 font-bold">Apply on site → continue on WhatsApp</p>`;
      return;
    }

    if (frame.panel === "pickup-form") {
      const steps = [
        ["Shop name", "Mama Grace Electronics"],
        ["County / town", "Embu, Embu County"],
        ["Address & hours", "Mama Ngina St · Mon–Sat 8–7"],
        ["Facilities", "Secure storage · M-Pesa OK"],
      ];
      const step = steps[frame.step || 0] || steps[0];
      stage.innerHTML =
        `${bar}<p class="font-bold mb-2">Pickup application (site)</p>` +
        steps
          .map(
            ([label, val], i) =>
              `<div class="hero-site-form-step${i === (frame.step || 0) ? " ring-1 ring-brand-green" : ""}"><strong>${esc(label)}</strong><br/>${esc(val)}</div>`
          )
          .join("");
      return;
    }

    if (frame.panel === "supplier-info") {
      stage.innerHTML =
        `${bar}<p class="font-bold mb-1">🏪 Sell on Sokoni</p>` +
        `<p>Zero listing fees · WhatsApp orders · pay on delivery</p>` +
        `<p class="mt-2 rounded-lg bg-brand-green/15 px-2 py-1 font-bold">Apply on site → prefilled on WhatsApp</p>`;
      return;
    }

    if (frame.panel === "supplier-form") {
      const steps = [
        ["Business", "Nairobi Tech Hub"],
        ["City & delivery", "Nairobi · delivers Westlands"],
        ["Product 1", `${ctx.productName} · supply KES 12,500`],
        ["Documents", "Permit photo (optional)"],
      ];
      stage.innerHTML =
        `${bar}<p class="font-bold mb-2">Supplier application (site)</p>` +
        steps
          .map(
            ([label, val], i) =>
              `<div class="hero-site-form-step${i === (frame.step || 0) ? " ring-1 ring-brand-green" : ""}"><strong>${esc(label)}</strong><br/>${esc(val)}</div>`
          )
          .join("");
      return;
    }

    stage.innerHTML = bar;
  }

  function renderTrustChips() {
    const el = $("hero-trust-chips");
    if (!el || !siteStory.trustChips) return;
    const ctx = vars();
    el.innerHTML = siteStory.trustChips
      .map((c) => {
        const detail = interpolate(c.detail, ctx);
        const href = c.href || "#";
        return `<a class="hero-trust-chip" href="${esc(href)}" title="${esc(detail)}">${esc(c.icon)} ${esc(c.label)}</a>`;
      })
      .join("");
  }

  let kineticIdx = 0;
  function rotateKinetic() {
    const el = $("hero-kinetic-line");
    const lines = siteStory.kineticLines || [];
    if (!el || !lines.length) return;
    el.classList.add("is-fading");
    setTimeout(() => {
      kineticIdx = (kineticIdx + 1) % lines.length;
      el.textContent = interpolate(lines[kineticIdx], vars());
      el.classList.remove("is-fading");
    }, 280);
  }

  function clearTimers() {
    frameTimers.forEach(clearTimeout);
    frameTimers = [];
  }

  function scrollChatToBottom() {
    const stage = $("hero-chat-stage");
    if (stage) stage.scrollTop = stage.scrollHeight;
  }

  function appendBubble(html) {
    const stage = $("hero-chat-stage");
    if (!stage) return;
    const div = document.createElement("div");
    div.innerHTML = html;
    const node = div.firstElementChild;
    if (node) {
      stage.appendChild(node);
      scrollChatToBottom();
    }
  }

  function bubbleHtml(frame, ctx) {
    const side = frame.side === "out" ? "out" : "in";
    const cls = side === "out" ? "wa-bubble-out" : "wa-bubble-in";
    const raw = interpolate(frame.text || "", ctx);
    const text = esc(raw).replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/_([^_]+)_/g, "<em>$1</em>");

    if (frame.kind === "product") {
      const p = frame.productSlot === "intl" ? intlProduct : featured;
      const img = p?.imageUrl
        ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy" decoding="async" />`
        : `<div style="font-size:2.5rem;text-align:center">${esc(p?.emoji || "🛍️")}</div>`;
      const name = esc(p?.name || ctx.productName);
      const price = formatKes(p?.priceKes);
      return `<div class="wa-bubble wa-bubble-product">${img}<p class="font-semibold">${name}</p><p class="text-brand-purple/60 text-xs">${price} · Pay on delivery 💵</p></div>`;
    }

    if (frame.kind === "menu" && frame.lines) {
      const lines = frame.lines.map((l, i) => `${i + 1}. ${esc(l)}`).join("<br/>");
      return `<div class="wa-bubble wa-bubble-menu">${lines}<br/><em>Reply with the number</em></div>`;
    }

    return `<div class="wa-bubble ${cls}">${text}</div>`;
  }

  function runFrame(frame) {
    if (frame.action === "panel") {
      renderSitePanel(frame);
      return;
    }
    const ctx = vars();
    if (frame.action === "clear") {
      const stage = $("hero-chat-stage");
      if (stage) stage.innerHTML = "";
      return;
    }
    appendBubble(bubbleHtml(frame, ctx));
  }

  function playStory(index) {
    clearTimers();
    storyIndex = index % stories.length;
    const story = stories[storyIndex];
    if (!story) return;

    const duration = story.durationMs || storyDurationMs;
    showFilmstrip(true);

    const frames = story.frames || [];
    for (const frame of frames) {
      const t = setTimeout(() => runFrame(frame), frame.at || 0);
      frameTimers.push(t);
    }

    const endTimer = setTimeout(() => playStory(storyIndex + 1), duration);
    frameTimers.push(endTimer);
  }

  function staticFallback() {
    showFilmstrip(true);
    const stage = $("hero-chat-stage");
    if (!stage) return;
    const p = featured;
    stage.innerHTML = `
      <div class="wa-bubble wa-bubble-in">👋 Karibu! Type <strong>menu</strong> to browse — pay on delivery.</div>
      <div class="wa-bubble wa-bubble-out">menu</div>
      <div class="wa-bubble wa-bubble-in">1. 🛍️ Browse Categories<br/>2. 🧾 Track My Order<br/>3. 🙋 Talk to a Human</div>
      ${p ? `<div class="wa-bubble wa-bubble-product">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" />` : ""}<p class="font-semibold">${esc(p.name)}</p><p>${formatKes(p.priceKes)} · COD</p></div>` : ""}`;
  }

  async function init() {
    const stage = $("hero-chat-stage");
    if (!stage) return;

    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    try {
      const [siteStoryData, productsData, heroData] = await Promise.all([
        loadJson("data/site-story.json"),
        loadJson("data/products.json"),
        loadJson("data/hero-stories.json"),
      ]);
      siteStory = siteStoryData;
      stories = heroData.stories || [];
      storyDurationMs = heroData.storyDurationMs || STORY_MS_DEFAULT;
      pickProducts(productsData);
      buildFilmstrip();
      renderTrustChips();

      const kEl = $("hero-kinetic-line");
      if (kEl && siteStory.kineticLines?.[0]) {
        kEl.textContent = interpolate(siteStory.kineticLines[0], vars());
        setInterval(rotateKinetic, 4500);
      }

      const countEl = $("hero-store-count");
      if (countEl) countEl.textContent = String(vars().storeCount);

      if (reducedMotion) {
        staticFallback();
        return;
      }

      playStory(0);
    } catch (err) {
      console.warn("[hero-engine]", err.message);
      staticFallback();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SokoniHero = { replay: () => playStory(0) };
})();
