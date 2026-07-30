/**
 * Shared compact shell chrome for buyer subpages (header + mobile bottom nav).
 * Mount targets: #sokoni-shell-header, #sokoni-shell-nav
 * Optional: body[data-shell-page="home|explore|sell|inbox|profile|activity|track|disputes"]
 */
(function () {
  const PAGES = {
    home: { href: "index.html", label: "Home", icon: "🏠" },
    explore: { href: "index.html#deals", label: "Explore", icon: "🧭" },
    sell: { href: "suppliers/list.html", label: "Sell", icon: "➕", sell: true },
    inbox: { href: "inbox.html", label: "Inbox", icon: "💬" },
    profile: { href: "profile.html", label: "Profile", icon: "👤" },
  };

  function detectPage() {
    const forced = document.body?.getAttribute("data-shell-page");
    if (forced) return forced;
    const path = (window.location.pathname || "").toLowerCase();
    if (path.includes("profile")) return "profile";
    if (path.includes("inbox")) return "inbox";
    if (path.includes("disputes")) return "disputes";
    if (path.includes("activity")) return "activity";
    if (path.includes("track")) return "track";
    if (path.includes("ask")) return "ask";
    if (path.includes("shop")) return "shop";
    if (path.includes("suppliers/list")) return "sell";
    return "home";
  }

  function headerLinks(page) {
    if (page === "activity") {
      return [
        { href: "ask.html", label: "Ask" },
        { href: "inbox.html", label: "Inbox" },
      ];
    }
    if (page === "inbox") {
      return [
        { href: "activity.html", label: "Activity" },
        { href: "disputes.html", label: "Disputes" },
      ];
    }
    if (page === "disputes") {
      return [
        { href: "track.html", label: "Track" },
        { href: "inbox.html", label: "Inbox" },
      ];
    }
    if (page === "shop") {
      return [
        { href: "ask.html", label: "Ask" },
        { href: "profile.html", label: "Profile" },
      ];
    }
    if (page === "track") {
      return [
        { href: "disputes.html", label: "Disputes" },
        { href: "profile.html", label: "Profile" },
      ];
    }
    if (page === "ask") {
      return [
        { href: "track.html", label: "Track" },
        { href: "profile.html", label: "Profile" },
      ];
    }
    // profile + default
    return [
      { href: "ask.html", label: "Ask Plug" },
      { href: "disputes.html", label: "Disputes" },
    ];
  }

  function navActiveKey(page) {
    if (page === "activity" || page === "track" || page === "shop" || page === "ask" || page === "disputes") {
      return "profile";
    }
    if (page === "sell") return null;
    return page;
  }

  function renderHeader(page) {
    const mount = document.getElementById("sokoni-shell-header");
    if (!mount) return;
    const links = headerLinks(page)
      .map(
        (l) =>
          `<a href="${l.href}" class="text-xs font-semibold min-h-[44px] inline-flex items-center px-2 hover:opacity-80">${l.label}</a>`
      )
      .join("");
    mount.outerHTML = `
  <header class="depop-shell-header" aria-label="Sokoni Mall">
    <div class="depop-main-bar">
      <a href="index.html" class="depop-logo">SOKONI<span class="depop-logo-dot">.</span><span class="depop-logo-mall"> MALL</span></a>
      <div class="depop-header-actions ml-auto">${links}</div>
    </div>
  </header>`;
  }

  function renderBottomNav(page) {
    const mount = document.getElementById("sokoni-shell-nav");
    if (!mount) return;
    const active = navActiveKey(page);
    const items = Object.entries(PAGES)
      .map(([key, meta]) => {
        const classes = [
          "depop-bottom-nav__item",
          meta.sell ? "depop-bottom-nav__item--sell" : "",
          active === key ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<a href="${meta.href}" class="${classes}" data-depop-nav="${key}">
        <span class="depop-bottom-nav__icon" aria-hidden="true">${meta.icon}</span>
        <span class="depop-bottom-nav__label">${meta.label}</span>
      </a>`;
      })
      .join("");
    mount.outerHTML = `
  <nav class="depop-bottom-nav md:hidden" aria-label="Mobile">
    <div class="depop-bottom-nav-inner">${items}</div>
  </nav>`;
  }

  function ensureShellBody() {
    document.body?.classList.add("has-depop-shell");
  }

  function mount() {
    const page = detectPage();
    ensureShellBody();
    renderHeader(page);
    renderBottomNav(page);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.SokoniShellChrome = { mount, detectPage };
})();
