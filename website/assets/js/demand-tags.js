/**
 * Demand / urgency tags on product cards.
 *
 * Any page can opt in by rendering <div class="product-demand" data-demand-for="ID">.
 * This fills them from GET /api/feed/demand. Progressive enhancement: if the
 * bot API is unreachable the slots stay empty and nothing else changes.
 *
 * The API only returns rows that clear the display floor, so an absent id
 * means "nothing worth saying", not an error.
 */
(() => {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";

  const MAX_IDS_PER_CALL = 60;
  const REFRESH_MS = 5 * 60 * 1000;
  const filled = new Set();

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pendingSlots() {
    return Array.from(document.querySelectorAll("[data-demand-for]")).filter(
      (el) => el.getAttribute("data-demand-for") && !el.dataset.demandDone
    );
  }

  function render(slot, tags) {
    if (!Array.isArray(tags) || !tags.length) {
      slot.innerHTML = "";
      return;
    }
    slot.innerHTML = tags
      .map(
        (t) =>
          `<span class="demand-tag demand-tag--${escapeHtml(t.id)}">` +
          `<span aria-hidden="true">${escapeHtml(t.emoji)}</span> ${escapeHtml(t.label)}` +
          `</span>`
      )
      .join("");
  }

  async function hydrate() {
    const slots = pendingSlots();
    if (!slots.length) return;

    const byId = new Map();
    for (const slot of slots) {
      const id = slot.getAttribute("data-demand-for");
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(slot);
    }

    const ids = Array.from(byId.keys()).slice(0, MAX_IDS_PER_CALL);
    if (!ids.length) return;

    let demand = {};
    try {
      const res = await fetch(`${API_BASE}/api/feed/demand?ids=${encodeURIComponent(ids.join(","))}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return; // leave slots empty; nothing to show is the safe default
      const data = await res.json();
      demand = data?.demand || {};
    } catch {
      return; // offline / bot down — the grid still works
    }

    for (const id of ids) {
      const targets = byId.get(id) || [];
      const row = demand[id];
      for (const slot of targets) {
        slot.dataset.demandDone = "1";
        filled.add(id);
        render(slot, row?.tags);
      }
    }
  }

  function start() {
    void hydrate();
    // Grids render asynchronously — pick up cards added after first paint.
    const observer = new MutationObserver(() => {
      if (pendingSlots().length) void hydrate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Counts move over a session; refresh occasionally without hammering the bot.
    window.setInterval(() => {
      document.querySelectorAll("[data-demand-for]").forEach((el) => {
        delete el.dataset.demandDone;
      });
      void hydrate();
    }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
