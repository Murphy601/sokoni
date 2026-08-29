/**
 * Floating Ask Plug — sitewide chat panel + optional browser SpeechRecognition mic.
 * Reuses POST /api/agent/chat (same as ask.html). Fail-soft if API/mic unavailable.
 * Phase 1 of voice: no Vapi/NVIDIA WebRTC required. See docs/VOICE_AI_ROADMAP.md.
 */
(function () {
  if (window.__sokoniAskFabMounted) return;
  window.__sokoniAskFabMounted = true;

  const API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/agent"
      : "https://bot.sokonimall.com/api/agent";
  const WA = "https://wa.me/254117422428?text=" + encodeURIComponent("Hi Sokoni, I need help");
  const SESSION_KEY = "sokoni-ai-session";

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    /* ignore */
  }

  let open = false;
  let listening = false;
  let recognition = null;
  let busy = false;

  function injectCss() {
    if (document.getElementById("sokoni-ask-fab-css")) return;
    const link = document.createElement("link");
    link.id = "sokoni-ask-fab-css";
    link.rel = "stylesheet";
    link.href = "assets/css/ask-voice-fab.css";
    // Subpages under /suppliers/ need a relative climb — prefer absolute from site root
    const path = window.location.pathname || "";
    if (path.includes("/suppliers/") || path.split("/").filter(Boolean).length > 1) {
      link.href = "/assets/css/ask-voice-fab.css";
    }
    document.head.appendChild(link);
  }

  function mountDom() {
    if (document.getElementById("sokoni-ask-fab-root")) return;
    // Skip on ask.html full page (already has chat)
    const path = (window.location.pathname || "").toLowerCase();
    if (path.endsWith("/ask.html") || path.endsWith("/ask")) return;
    // Skip admin desks
    if (path.includes("admin-")) return;

    const root = document.createElement("div");
    root.id = "sokoni-ask-fab-root";
    root.innerHTML = `
      <div id="sokoni-ask-panel" class="sokoni-ask-panel" hidden aria-hidden="true">
        <header class="sokoni-ask-panel__head">
          <div>
            <p class="sokoni-ask-panel__eyebrow">Sokoni Plug</p>
            <h2 class="sokoni-ask-panel__title">Ask · talk · track</h2>
          </div>
          <button type="button" id="sokoni-ask-close" class="sokoni-ask-icon-btn" aria-label="Close">×</button>
        </header>
        <div id="sokoni-ask-log" class="sokoni-ask-log" role="log" aria-live="polite"></div>
        <div class="sokoni-ask-chips" id="sokoni-ask-chips">
          <button type="button" data-ask="Find phones under 15000">Phones under 15k</button>
          <button type="button" data-ask="How does escrow work?">Escrow</button>
          <button type="button" data-ask="Track my order">Track order</button>
        </div>
        <form id="sokoni-ask-form" class="sokoni-ask-form">
          <label class="sr-only" for="sokoni-ask-input">Message</label>
          <input id="sokoni-ask-input" type="text" autocomplete="off" placeholder="Type or tap the mic…" />
          <button type="button" id="sokoni-ask-mic" class="sokoni-ask-mic" aria-label="Speak" title="Speak" ${
            SpeechRecognition ? "" : "hidden"
          }>Mic</button>
          <button type="submit" class="sokoni-ask-send" aria-label="Send">Send</button>
        </form>
        <p class="sokoni-ask-foot">
          <a href="${WA}" target="_blank" rel="noopener">WhatsApp</a>
          · <a href="ask.html">Full Ask</a>
          · Voice notes on WhatsApp already work
        </p>
      </div>
      <button type="button" id="sokoni-ask-fab" class="sokoni-ask-fab" aria-expanded="false" aria-controls="sokoni-ask-panel">
        <span class="sokoni-ask-fab__label">Ask AI</span>
      </button>
    `;
    document.body.appendChild(root);
  }

  function logEl() {
    return document.getElementById("sokoni-ask-log");
  }

  function bubble(text, role) {
    const log = logEl();
    if (!log) return;
    const row = document.createElement("div");
    row.className = `sokoni-ask-bubble sokoni-ask-bubble--${role === "user" ? "user" : "bot"}`;
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(next) {
    open = Boolean(next);
    const panel = document.getElementById("sokoni-ask-panel");
    const fab = document.getElementById("sokoni-ask-fab");
    if (!panel || !fab) return;
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    fab.classList.toggle("is-open", open);
    if (open) {
      document.getElementById("sokoni-ask-input")?.focus();
      if (!logEl()?.childElementCount) {
        bubble(
          "Poa — ask about stock, escrow, delivery, or track an SKN order. Tap the mic if your browser supports it.",
          "bot"
        );
      }
    } else {
      stopMic();
    }
  }

  function looksLikeBadReply(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    if (/^\s*\{[\s\S]*"tool"\s*:/.test(t)) return true;
    if (/we need to answer|under \d+ words|strict conversational/i.test(t)) return true;
    return false;
  }

  async function sendMessage(text) {
    const msg = String(text || "").trim();
    if (!msg || busy) return;
    busy = true;
    bubble(msg, "user");
    const input = document.getElementById("sokoni-ask-input");
    if (input) input.value = "";
    const chips = document.getElementById("sokoni-ask-chips");
    if (chips) chips.hidden = true;

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, sessionId: sessionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not reach Sokoni AI");

      if (data.sessionId) {
        sessionId = data.sessionId;
        try {
          sessionStorage.setItem(SESSION_KEY, sessionId);
        } catch {
          /* ignore */
        }
      }

      let reply = String(data.reply || "").trim();
      const products = Array.isArray(data.products) ? data.products : [];
      if (looksLikeBadReply(reply)) {
        reply = products.length
          ? `Found ${Math.min(3, products.length)} live listing(s) — check Full Ask or WhatsApp to order.`
          : "No live match right now. Try another keyword or WhatsApp.";
      }
      if (reply) bubble(reply, "bot");
      if (products.length) {
        const names = products
          .slice(0, 3)
          .map((p) => `${p.name} — KES ${Number(p.priceKes).toLocaleString()}`)
          .join(" · ");
        bubble(names, "bot");
      }
      // Optional TTS — browser only, fail-soft, respect reduced motion / silent prefer
      maybeSpeak(reply);
    } catch (err) {
      bubble(
        `${err.message || "Offline."} Open WhatsApp or Full Ask instead.`,
        "bot"
      );
    } finally {
      busy = false;
      input?.focus();
    }
  }

  function maybeSpeak(text) {
    try {
      if (!window.speechSynthesis || !text) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (!document.getElementById("sokoni-ask-fab")?.classList.contains("is-open")) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 280));
      u.rate = 1.05;
      u.lang = "en-KE";
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }

  function stopMic() {
    listening = false;
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    document.getElementById("sokoni-ask-mic")?.classList.remove("is-listening");
  }

  function toggleMic() {
    if (!SpeechRecognition) {
      bubble("Voice typing needs Chrome/Edge. Type your question, or use WhatsApp voice notes.", "bot");
      return;
    }
    if (listening) {
      stopMic();
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "en-KE";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      listening = true;
      document.getElementById("sokoni-ask-mic")?.classList.add("is-listening");
    };
    recognition.onerror = () => {
      stopMic();
      bubble("Mic error — type instead, or send a voice note on WhatsApp.", "bot");
    };
    recognition.onend = () => {
      listening = false;
      document.getElementById("sokoni-ask-mic")?.classList.remove("is-listening");
    };
    recognition.onresult = (ev) => {
      const said = ev.results?.[0]?.[0]?.transcript;
      if (said) void sendMessage(said);
    };
    try {
      recognition.start();
    } catch {
      stopMic();
    }
  }

  function bind() {
    document.getElementById("sokoni-ask-fab")?.addEventListener("click", () => setOpen(!open));
    document.getElementById("sokoni-ask-close")?.addEventListener("click", () => setOpen(false));
    document.getElementById("sokoni-ask-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = document.getElementById("sokoni-ask-input")?.value;
      void sendMessage(v);
    });
    document.getElementById("sokoni-ask-mic")?.addEventListener("click", () => toggleMic());
    document.getElementById("sokoni-ask-chips")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ask]");
      if (btn) void sendMessage(btn.getAttribute("data-ask"));
    });
  }

  function boot() {
    injectCss();
    mountDom();
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
