/**
 * Auth landing — centered modals (login / signup / ask AI) + editorial sections.
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
    const sellerNote = document.getElementById("auth-signup-seller-note");
    const roleInput = document.getElementById("auth-signup-role");
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggle.querySelectorAll("button").forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        const role = btn.getAttribute("data-role") === "seller" ? "seller" : "buyer";
        // Sellers are shoppers too — keep the same signup form visible.
        if (sellerNote) sellerNote.hidden = role !== "seller";
        if (roleInput) roleInput.value = role;
      });
    });
  }

  function bindModeToggle() {
    const toggle = document.getElementById("auth-mode-toggle");
    const buy = document.getElementById("auth-hero-buy");
    const sell = document.getElementById("auth-hero-sell");
    if (!toggle || !buy || !sell) return;
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggle.querySelectorAll("button").forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        const mode = btn.getAttribute("data-mode");
        buy.hidden = mode !== "buy";
        sell.hidden = mode !== "sell";
      });
    });
  }

  function startEditorialBanner() {
    const slides = Array.from(document.querySelectorAll("#auth-edit-slides > li"));
    const dotsMount = document.getElementById("auth-edit-dots");
    if (slides.length < 2) return;
    let i = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function show(n) {
      slides.forEach((s, idx) => s.classList.toggle("is-active", idx === n));
      dotsMount?.querySelectorAll("button").forEach((d, idx) => {
        d.classList.toggle("is-active", idx === n);
        d.setAttribute("aria-current", idx === n ? "true" : "false");
      });
      i = n;
    }

    if (dotsMount) {
      dotsMount.innerHTML = slides
        .map((_, idx) => `<button type="button" aria-label="Slide ${idx + 1}" ${idx === 0 ? 'class="is-active" aria-current="true"' : ""}></button>`)
        .join("");
      dotsMount.querySelectorAll("button").forEach((btn, idx) => {
        btn.addEventListener("click", () => show(idx));
      });
    }

    if (reduce) return;
    window.setInterval(() => show((i + 1) % slides.length), 5200);
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

  function askLooksBad(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    if (/^\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
    if (/we need to answer|under \d+ words|strict conversational/i.test(t)) return true;
    if (/\n\s*\d+\.\s*$/.test(t)) return true;
    return false;
  }

  function renderAskProducts(products) {
    const log = document.getElementById("auth-ask-log");
    if (!log || !products?.length) return;
    products.slice(0, 3).forEach((p) => {
      const b = document.createElement("div");
      b.className = "auth-ask-bubble auth-ask-bubble--bot";
      b.textContent = `${p.name} — KES ${Number(p.priceKes).toLocaleString()}${p.isSecondhand ? " · pre-loved" : ""}`;
      log.appendChild(b);
    });
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
      const products = Array.isArray(data.products) ? data.products : [];
      let reply = String(data.reply || data.message || "").trim();
      if (askLooksBad(reply)) {
        reply = products.length
          ? `Found ${Math.min(3, products.length)} live listing${products.length === 1 ? "" : "s"} — current stock only.`
          : "No live Sokoni listings match that right now. Try another keyword or browse the shop.";
      }
      askBubble(reply || "Try again in a moment.", "bot");
      renderAskProducts(products);
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

  function bindSearchToSignup() {
    const form = document.getElementById("auth-landing-search");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      openModal("signup");
    });
  }

  const AUTH_IMG_FALLBACK =
    "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=600&q=80";

  function bindImageFallbacks() {
    const imgs = document.querySelectorAll(
      "[data-auth-img], .auth-style-media img, .auth-quiz-card img, .auth-float-card img, .auth-edit-media img"
    );
    imgs.forEach((img) => {
      img.addEventListener("error", () => {
        if (img.dataset.authImgFallbackApplied === "1") return;
        img.dataset.authImgFallbackApplied = "1";
        img.src = AUTH_IMG_FALLBACK;
      });
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
  bindModeToggle();
  bindAsk();
  bindSearchToSignup();
  bindImageFallbacks();
  startEditorialBanner();
  openFromQuery();

  window.SokoniAuthLanding = { openModal, closeModal };
})();
