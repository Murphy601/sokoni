/**
 * Hero platform story engine — 4 × ~60s DOM “videos” from live JSON.
 * Does not modify app.js catalog logic.
 */
(function () {
  const STORY_MS_DEFAULT = 60000;
  const WHATSAPP = "254117422428";

  let siteStory = {};
  let stories = [];
  let storyDurationMs = STORY_MS_DEFAULT;
  let products = [];
  let featured = null;
  let intlProduct = null;
  let storyIndex = 0;
  let frameTimers = [];
  let progressRaf = null;
  let storyStartedAt = 0;
  let reducedMotion = false;

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
    const imgs = products
      .filter((p) => p.imageUrl && p.fulfillment === "store")
      .slice(0, 16);
    if (!imgs.length) return;
    const doubled = [...imgs, ...imgs];
    wrap.innerHTML = `<div class="hero-filmstrip-track">${doubled
      .map(
        (p) =>
          `<div class="hero-filmstrip-item"><img src="${esc(p.imageUrl)}" alt="" loading="lazy" decoding="async" /></div>`
      )
      .join("")}</div>`;
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

  function renderKineticDots() {
    const dots = $("hero-story-progress");
    if (!dots) return;
    dots.innerHTML = stories
      .map((_, i) => `<span class="hero-story-dot${i === storyIndex ? " is-active" : ""}" data-i="${i}"></span>`)
      .join("");
  }

  function updateStoryMeta() {
    const label = $("hero-story-label");
    const titles = siteStory.storyTitles || stories.map((s) => s.subtitle || s.title);
    if (label) {
      label.textContent = titles[storyIndex] || stories[storyIndex]?.subtitle || stories[storyIndex]?.title || "";
    }
    renderKineticDots();
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
    if (progressRaf) cancelAnimationFrame(progressRaf);
    progressRaf = null;
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
    const ctx = vars();
    if (frame.action === "clear") {
      const stage = $("hero-chat-stage");
      if (stage) stage.innerHTML = "";
      return;
    }
    appendBubble(bubbleHtml(frame, ctx));
  }

  function scheduleProgress() {
    const fill = $("hero-story-timer-fill");
    if (!fill) return;
    function tick() {
      const elapsed = Date.now() - storyStartedAt;
      const pct = Math.min(100, (elapsed / storyDurationMs) * 100);
      fill.style.width = `${pct}%`;
      if (elapsed < storyDurationMs) progressRaf = requestAnimationFrame(tick);
    }
    progressRaf = requestAnimationFrame(tick);
  }

  function playStory(index) {
    clearTimers();
    storyIndex = index % stories.length;
    const story = stories[storyIndex];
    if (!story) return;

    updateStoryMeta();
    storyStartedAt = Date.now();
    const fill = $("hero-story-timer-fill");
    if (fill) fill.style.width = "0%";
    scheduleProgress();

    const ctx = vars();
    const frames = story.frames || [];
    for (const frame of frames) {
      const t = setTimeout(() => runFrame(frame), frame.at || 0);
      frameTimers.push(t);
    }

    const endTimer = setTimeout(() => playStory(storyIndex + 1), storyDurationMs);
    frameTimers.push(endTimer);
  }

  function staticFallback() {
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
      renderKineticDots();

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
