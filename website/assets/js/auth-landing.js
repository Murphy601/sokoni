/**
 * Auth landing — centered modals (login / signup / ask AI) + trending rail.
 * Keeps #account-login-form / #account-signup-form IDs for account-auth.js.
 */
(function () {
  const root = document.getElementById("auth-modal-root");
  if (!root) return;

  const panels = {
    login: document.getElementById("auth-panel-login"),
    signup: document.getElementById("auth-panel-signup"),
    ask: document.getElementById("auth-panel-ask"),
  };

  const AGENT_API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/agent"
      : "https://bot.sokonimall.com/api/agent";

  let askSessionId = sessionStorage.getItem("sokoni-ai-session") || "";
  let carouselTimer = null;
  let lastFocus = null;

  function openModal(name) {
    const panel = panels[name];
    if (!panel) return;
    lastFocus = document.activeElement;
    Object.values(panels).forEach((p) => {
      if (p) p.hidden = p !== panel;
    });
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const focusEl =
      panel.querySelector("input, button, textarea, [tabindex]:not([tabindex='-1'])") ||
      panel.querySelector(".auth-modal-close");
    focusEl?.focus?.();
  }

  function closeModal() {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    Object.values(panels).forEach((p) => {
      if (p) p.hidden = true;
    });
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function bindOpeners() {
    document.querySelectorAll("[data-auth-open]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openModal(el.getAttribute("data-auth-open"));
      });
    });
  }

  function bindClosers() {
    root.querySelectorAll("[data-auth-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-open")) closeModal();
    });
  }

  function bindPasswordToggles() {
    document.querySelectorAll("[data-pw-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pw-toggle");
        const input = document.getElementById(id) || document.querySelector(id);
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "Hide" : "Show";
        btn.setAttribute("aria-pressed", show ? "true" : "false");
      });
    });
  }

  function bindRoleToggle() {
    const toggle = document.getElementById("auth-role-toggle");
    if (!toggle) return;
    const buyerFields = document.getElementById("auth-signup-buyer-fields");
    const sellerNote = document.getElementById("auth-signup-seller-note");
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggle.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const role = btn.getAttribute("data-role");
        if (buyerFields) buyerFields.hidden = role === "seller";
        if (sellerNote) sellerNote.hidden = role !== "seller";
      });
    });
  }

  function formatKes(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    return `KES ${Math.round(num).toLocaleString("en-KE")}`;
  }

  function productImage(p) {
    return (
      p.imageUrl ||
      p.image ||
      (Array.isArray(p.images) && p.images[0]) ||
      "assets/images/products/fa-001.jpg"
    );
  }

  async function loadTrending() {
    const rail = document.getElementById("auth-trending-rail");
    if (!rail) return;
    try {
      const res = await fetch(`data/products.json?v=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const list = (Array.isArray(data) ? data : data.products || [])
        .filter((p) => p && (p.imageUrl || p.image || p.images?.length))
        .slice(0, 12);
      if (!list.length) {
        rail.innerHTML = `<p class="text-sm text-zinc-500 px-1">Browse the shop for live drops.</p>`;
        return;
      }
      rail.innerHTML = list
        .map((p) => {
          const title = String(p.title || p.name || "Listing").replace(/</g, "&lt;");
          const handle = String(p.sellerHandle || p.shopHandle || p.sellerName || "seller")
            .replace(/^@/, "")
            .replace(/</g, "&lt;");
          const price = formatKes(p.price ?? p.priceKes);
          const href = `index.html#${encodeURIComponent(p.id || "")}`;
          const img = productImage(p).replace(/"/g, "");
          return `<a class="auth-drop-card" href="${href}">
            <img src="${img}" alt="" loading="lazy" width="168" height="168" />
            <div class="auth-drop-meta">
              ${price ? `<span class="auth-drop-price">${price}</span>` : ""}
              <div class="auth-drop-title">${title}</div>
              <div class="auth-drop-seller">@${handle}</div>
            </div>
          </a>`;
        })
        .join("");
    } catch {
      rail.innerHTML = `<p class="text-sm text-zinc-500 px-1">Couldn’t load drops — open Shop.</p>`;
    }
  }

  function startCarousel() {
    const slides = Array.from(document.querySelectorAll(".auth-carousel li"));
    if (slides.length < 2) return;
    let i = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    carouselTimer = window.setInterval(() => {
      slides[i].classList.remove("is-active");
      i = (i + 1) % slides.length;
      slides[i].classList.add("is-active");
    }, 4200);
  }

  function askBubble(text, role) {
    const log = document.getElementById("auth-ask-log");
    if (!log) return;
    const b = document.createElement("div");
    b.className = `auth-ask-bubble auth-ask-bubble--${role === "user" ? "user" : "bot"}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
  }

  async function sendAsk(message) {
    const msg = String(message || "").trim();
    if (!msg) return;
    askBubble(msg, "user");
    const input = document.getElementById("auth-ask-input");
    if (input) input.value = "";
    try {
      const res = await fetch(`${AGENT_API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, sessionId: askSessionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sessionId) {
        askSessionId = data.sessionId;
        sessionStorage.setItem("sokoni-ai-session", askSessionId);
      }
      askBubble(data.reply || data.message || "Try again in a moment.", "bot");
    } catch {
      askBubble("Sokoni Plug is offline right now — try Ask Plug page or WhatsApp.", "bot");
    }
  }

  function bindAsk() {
    const form = document.getElementById("auth-ask-form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      sendAsk(document.getElementById("auth-ask-input")?.value);
    });
    document.querySelectorAll("[data-ask-chip]").forEach((btn) => {
      btn.addEventListener("click", () => sendAsk(btn.getAttribute("data-ask-chip")));
    });
  }

  function openFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const modal = (params.get("modal") || "").toLowerCase();
    if (modal === "signup" || modal === "register") openModal("signup");
    else if (modal === "ask" || modal === "ai") openModal("ask");
    else if (modal === "login") openModal("login");
  }

  bindOpeners();
  bindClosers();
  bindPasswordToggles();
  bindRoleToggle();
  bindAsk();
  loadTrending();
  startCarousel();
  openFromQuery();

  window.SokoniAuthLanding = { openModal, closeModal };
})();
