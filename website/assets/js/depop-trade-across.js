/**
 * Trade Across Kenya — Mashinani + Artisans category boards.
 * Loads browse-menu.json and paints subcategory cards under each banner.
 */
(function () {
  const MENU_URL = "data/browse-menu.json";
  const FALLBACK_IMG =
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&h=600&q=80";

  const BOARDS = [
    {
      categoryId: "sokoni-mashinani",
      gridId: "trade-mashinani-grid",
    },
    {
      categoryId: "artisans",
      gridId: "trade-artisans-grid",
    },
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardHtml(categoryId, sub) {
    const src = sub?.image || FALLBACK_IMG;
    const label = sub?.label || sub?.id || "Category";
    const filter = JSON.stringify({
      category: categoryId,
      subcategory: sub.id,
      scroll: true,
    });
    return `
      <a
        href="#deals"
        class="depop-trade-cat-card"
        data-depop-filter="${escapeHtml(filter)}"
      >
        <span class="depop-trade-cat-card-media">
          <img
            src="${escapeHtml(src)}"
            alt=""
            width="600"
            height="600"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='${FALLBACK_IMG}'"
          />
        </span>
        <span class="depop-trade-cat-card-label">${escapeHtml(label)}</span>
      </a>`;
  }

  function renderBoard(categories, board) {
    const grid = document.getElementById(board.gridId);
    if (!grid) return;
    const cat = (categories || []).find((c) => c.id === board.categoryId);
    const subs = cat?.subcategories || [];
    if (!subs.length) {
      grid.innerHTML = `<p class="text-sm text-zinc-500">Categories coming soon.</p>`;
      return;
    }
    grid.innerHTML = subs.map((sub) => cardHtml(board.categoryId, sub)).join("");
  }

  async function mount() {
    const root = document.getElementById("trade-across-kenya");
    if (!root) return;

    try {
      const res = await fetch(MENU_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`browse-menu ${res.status}`);
      const menu = await res.json();
      BOARDS.forEach((board) => renderBoard(menu.categories, board));
    } catch (err) {
      console.warn("[trade-across]", err);
      BOARDS.forEach((board) => {
        const grid = document.getElementById(board.gridId);
        if (grid && !grid.childElementCount) {
          grid.innerHTML = `<p class="text-sm text-zinc-500">Could not load categories.</p>`;
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
