/**
 * Phase 8 — Behavior tracking + personalized feed rails on homepage.
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/feed"
      : "https://bot.sokonimall.com/api/feed";

  const SESSION_KEY = "sokoni-feed-session";

  function sessionId() {
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      return "web_anon";
    }
  }

  function savedIds() {
    try {
      const raw = localStorage.getItem("sokoni-bag");
      const arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async function track(type, payload = {}) {
    try {
      await fetch(`${API_BASE}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId(),
          type,
          ...payload,
        }),
        keepalive: true,
      });
    } catch {
      /* non-blocking */
    }
  }

  function mergeApiProduct(apiProduct, localProducts) {
    const local = localProducts.find((p) => p.id === apiProduct.id);
    return local || apiProduct;
  }

  function renderRail(sectionKey, section, localProducts, renderCard) {
    if (!section?.products?.length) return "";
    const cards = section.products
      .map((p) => mergeApiProduct(p, localProducts))
      .filter(Boolean)
      .slice(0, 8)
      .map((p) => renderCard(p))
      .join("");
    if (!cards) return "";
    return `
      <section class="feed-rail" data-feed-section="${sectionKey}">
        <div class="flex items-end justify-between mb-4">
          <h2 class="depop-section-heading">${section.title}</h2>
        </div>
        <div class="depop-product-grid feed-rail-grid">${cards}</div>
      </section>`;
  }

  async function loadHomeFeed() {
    const container = document.getElementById("feed-rails");
    if (!container) return;

    const localProducts = window.SokoniApp?.getStoreProducts?.() || [];
    const renderCard = window.SokoniApp?.renderDepopCard;
    if (!renderCard || !localProducts.length) return;

    try {
      const saved = savedIds().join(",");
      const url = `${API_BASE}/home?sessionId=${encodeURIComponent(sessionId())}&saved=${encodeURIComponent(saved)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.feed?.sections) return;

      const { sections, personalized } = data.feed;
      const order = personalized
        ? ["forYou", "trending", "preloved", "under5000"]
        : ["trending", "under5000", "preloved", "brandNew"];

      const html = order
        .map((key) => renderRail(key, sections[key], localProducts, renderCard))
        .filter(Boolean)
        .join("");

      if (!html) return;
      container.innerHTML = html;
      container.classList.remove("hidden");

      container.querySelectorAll(".feed-rail-grid").forEach((grid) => {
        grid.addEventListener("click", (e) => {
          const card = e.target.closest(".depop-card[data-product-id]");
          if (!card) return;
          track("click", { productId: card.dataset.productId });
        });
      });
    } catch (err) {
      console.warn("[feed] home load failed:", err.message);
    }
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(loadHomeFeed, 300));
    } else {
      setTimeout(loadHomeFeed, 300);
    }
  }

  window.SokoniFeed = {
    sessionId,
    track,
    trackView: (productId) => track("view", { productId }),
    trackSave: (productId, saved) => track(saved ? "save" : "unsave", { productId }),
    trackCategory: (category) => track("category", { category }),
    trackSearch: (query) => track("search", { query }),
    refresh: loadHomeFeed,
    init,
  };

  init();
})();
