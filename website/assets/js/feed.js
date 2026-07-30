/**
 * Phase 8 — Behavior tracking + personalized feed rails on homepage.
 * Phase 12 — Explore / Following tabs (listings from followed shops).
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/feed"
      : "https://bot.sokonimall.com/api/feed";

  const SESSION_KEY = "sokoni-feed-session";
  let activeMode = "explore";
  /** @type {Map<string, object>} */
  let feedProductById = new Map();

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

  function resolveViewerUserId() {
    const sessionUserId = window.SokoniBuyerAuth?.readSession?.()?.userId;
    if (Number.isInteger(sessionUserId) && sessionUserId > 0) return sessionUserId;
    try {
      const raw = new URLSearchParams(window.location.search).get("viewer") ||
        new URLSearchParams(window.location.search).get("viewerUserId");
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
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
    return local ? { ...apiProduct, ...local } : apiProduct;
  }

  function setModeHint(message, isError = false) {
    const hint = document.getElementById("feed-mode-hint");
    if (!hint) return;
    if (!message) {
      hint.textContent = "";
      hint.classList.add("hidden");
      return;
    }
    hint.textContent = message;
    hint.classList.toggle("text-red-600", isError);
    hint.classList.toggle("dark:text-red-400", isError);
    hint.classList.remove("hidden");
  }

  function syncFeedTabs() {
    const explore = document.getElementById("feed-tab-explore");
    const following = document.getElementById("feed-tab-following");
    const isFollowing = activeMode === "following";
    if (explore) {
      explore.classList.toggle("is-active", !isFollowing);
      explore.classList.toggle("bg-brand-green", !isFollowing);
      explore.classList.toggle("text-brand-purple", !isFollowing);
      explore.classList.toggle("border", isFollowing);
      explore.classList.toggle("border-brand-purple/20", isFollowing);
      explore.setAttribute("aria-selected", (!isFollowing).toString());
    }
    if (following) {
      following.classList.toggle("is-active", isFollowing);
      following.classList.toggle("bg-brand-green", isFollowing);
      following.classList.toggle("text-brand-purple", isFollowing);
      following.classList.toggle("border", !isFollowing);
      following.classList.toggle("border-brand-purple/20", !isFollowing);
      following.classList.toggle("dark:border-white/20", !isFollowing);
      following.setAttribute("aria-selected", isFollowing.toString());
    }
  }

  function renderRail(sectionKey, section, localProducts, renderCard) {
    if (!section?.products?.length) return "";
    const cards = section.products
      .map((p) => {
        const merged = mergeApiProduct(p, localProducts);
        if (merged?.id) feedProductById.set(String(merged.id), merged);
        return merged;
      })
      .filter(Boolean)
      .slice(0, sectionKey === "following" ? 24 : 8)
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

  function bindFeedGrid(container) {
    container.querySelectorAll(".feed-rail-grid").forEach((grid) => {
      grid.addEventListener("click", (e) => {
        const heart = e.target.closest(".depop-card-heart[data-save-id]");
        if (heart) {
          e.preventDefault();
          e.stopPropagation();
          const pid = heart.dataset.saveId;
          const saved = window.SokoniShopShell?.toggleBag?.(pid);
          heart.classList.toggle("is-saved", Boolean(saved));
          heart.textContent = saved ? "♥" : "♡";
          heart.setAttribute("aria-label", saved ? "Remove from saved" : "Save item");
          return;
        }
        const card = e.target.closest(".depop-card[data-product-id]");
        if (!card) return;
        const id = card.dataset.productId;
        track("click", { productId: id });
        const product =
          window.SokoniApp?.getStoreProducts?.()?.find((p) => p.id === id) ||
          feedProductById.get(String(id));
        if (product) {
          window.SokoniProductSheet?.open(product);
          return;
        }
        if (id) window.location.href = `index.html?q=${encodeURIComponent(id)}`;
      });
    });
  }

  async function loadHomeFeed(mode = activeMode) {
    const container = document.getElementById("feed-rails");
    if (!container) return;

    activeMode = mode === "following" ? "following" : "explore";
    syncFeedTabs();

    const localProducts = window.SokoniApp?.getStoreProducts?.() || [];
    const renderCard = window.SokoniApp?.renderDepopCard;
    if (!renderCard) return;

    try {
      feedProductById = new Map();
      const saved = savedIds().join(",");
      const viewer = resolveViewerUserId();
      const params = new URLSearchParams({
        sessionId: sessionId(),
        saved,
        mode: activeMode,
      });
      if (viewer) params.set("viewerUserId", String(viewer));

      if (activeMode === "following" && !viewer) {
        container.innerHTML = "";
        container.classList.add("hidden");
        setModeHint("Verify WhatsApp on any shop page, then come back to see drops from shops you follow.");
        return;
      }

      const res = await fetch(`${API_BASE}/home?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.feed?.sections) {
        setModeHint("Feed is warming up — browse New arrivals below.", true);
        return;
      }

      const { sections, personalized, followingCount } = data.feed;

      if (activeMode === "following") {
        const followingSection = sections.following;
        if (!followingSection?.products?.length) {
          container.innerHTML = "";
          container.classList.add("hidden");
          setModeHint(
            Number(followingCount) > 0
              ? "Shops you follow haven’t posted new items yet. Check Explore in the meantime."
              : "Follow a few shops, then this tab fills with their new drops."
          );
          return;
        }
        const html = renderRail("following", followingSection, localProducts, renderCard);
        if (!html) {
          container.classList.add("hidden");
          return;
        }
        container.innerHTML = html;
        container.classList.remove("hidden");
        setModeHint(`Fresh from ${Number(followingCount || 0).toLocaleString()} shop${Number(followingCount) === 1 ? "" : "s"} you follow.`);
        window.SokoniShopShell?.syncHeartButtons?.();
        bindFeedGrid(container);
        return;
      }

      const order = personalized
        ? ["forYou", "trending", "preloved", "under5000"]
        : ["trending", "under5000", "preloved", "brandNew"];

      const html = order
        .map((key) => renderRail(key, sections[key], localProducts, renderCard))
        .filter(Boolean)
        .join("");

      if (!html) {
        container.classList.add("hidden");
        setModeHint("");
        return;
      }
      container.innerHTML = html;
      container.classList.remove("hidden");
      setModeHint("");
      window.SokoniShopShell?.syncHeartButtons?.();
      bindFeedGrid(container);
    } catch (err) {
      console.warn("[feed] home load failed:", err.message);
      setModeHint("Could not load feed right now.", true);
    }
  }

  function bindTabs() {
    document.getElementById("feed-tab-explore")?.addEventListener("click", () => {
      if (activeMode === "explore") return;
      void loadHomeFeed("explore");
    });
    document.getElementById("feed-tab-following")?.addEventListener("click", () => {
      if (activeMode === "following") return;
      void loadHomeFeed("following");
    });
  }

  function init() {
    bindTabs();
    syncFeedTabs();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(() => loadHomeFeed("explore"), 300));
    } else {
      setTimeout(() => loadHomeFeed("explore"), 300);
    }
  }

  window.SokoniFeed = {
    sessionId,
    track,
    trackView: (productId) => track("view", { productId }),
    trackSave: (productId, saved) => track(saved ? "save" : "unsave", { productId }),
    trackCategory: (category) => track("category", { category }),
    trackSearch: (query) => track("search", { query }),
    refresh: () => loadHomeFeed(activeMode),
    setMode: loadHomeFeed,
    init,
  };

  init();
})();
