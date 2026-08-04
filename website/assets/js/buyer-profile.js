/**
 * Buyer profile page — WhatsApp session summary, saved bag count, quick links.
 */
(function () {
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const AUTH_API = `${API_BASE}/api/buyer/auth`;
  const BAG_KEY = "sokoni-bag";

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    const node = el("profile-status");
    if (node) node.textContent = message || "";
  }

  function maskPhone(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length < 6) return phone || "—";
    return `+${d.slice(0, 3)}…${d.slice(-3)}`;
  }

  function readBagCount() {
    try {
      const raw = localStorage.getItem(BAG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  function renderSavedCount() {
    const node = el("profile-saved-count");
    if (!node) return;
    const n = readBagCount();
    if (n <= 0) {
      node.textContent = "No saved items yet. Tap ♡ on a listing to keep it in your bag.";
      return;
    }
    node.textContent = `${n} saved item${n === 1 ? "" : "s"} in your bag on this device.`;
  }

  function renderEmailAccount() {
    const account = window.SokoniAccountAuth?.readSession?.();
    const signedOut = el("account-email-signed-out");
    const signedIn = el("account-email-signed-in");
    if (!signedOut || !signedIn) return account;

    if (!account?.userId) {
      signedOut.classList.remove("hidden");
      signedIn.classList.add("hidden");
      return null;
    }

    signedOut.classList.add("hidden");
    signedIn.classList.remove("hidden");
    const name = el("account-email-name");
    const email = el("account-email-address");
    const phone = el("account-email-phone");
    if (name) name.textContent = account.user?.displayName || "Sokoni member";
    if (email) email.textContent = account.email || account.user?.email || "";
    if (phone) {
      const p = account.user?.phone;
      phone.textContent = p ? `WhatsApp on file: ${maskPhone(p)}` : "No phone on file yet — add one when linking orders.";
    }
    return account;
  }

  function renderSession() {
    const account = renderEmailAccount();
    const session = window.SokoniBuyerAuth?.readSession?.();
    const card = el("profile-session-card");
    const phoneNode = el("profile-phone");
    const userNode = el("profile-user-id");

    if (account?.userId) {
      setStatus("Site account signed in. Purchases will show here once phone is linked.");
    } else if (!session?.userId) {
      setStatus("Create a free email account, or verify WhatsApp for social features.");
    }

    if (!session?.userId) {
      card?.classList.add("hidden");
      if (!account?.userId) {
        /* status already set */
      } else {
        setStatus("Site account signed in. Optional: verify WhatsApp for likes & inbox.");
      }
      return;
    }

    card?.classList.remove("hidden");
    if (phoneNode) phoneNode.textContent = `WhatsApp ${maskPhone(session.phone)}`;
    if (userNode) userNode.textContent = `Buyer #${session.userId}`;
    setStatus(
      account?.userId
        ? "Email account + WhatsApp verify both active on this device."
        : "WhatsApp verified. Activity and Inbox use this session."
    );
  }

  async function signOut() {
    const session = window.SokoniBuyerAuth?.readSession?.();
    const btn = el("profile-sign-out-btn");
    if (btn) btn.disabled = true;
    setStatus("Signing out…");
    try {
      if (session?.sessionToken) {
        await fetch(`${AUTH_API}/sign-out`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: session.phone,
            sessionToken: session.sessionToken,
          }),
        }).catch(() => null);
      }
    } finally {
      window.SokoniBuyerAuth?.clearSession?.();
      if (btn) btn.disabled = false;
      renderSession();
      window.SokoniBuyerAuth?.bindPanel?.({
        onVerified: () => {
          renderSession();
          renderSavedCount();
        },
      });
      setStatus("Signed out on this device.");
    }
  }

  function init() {
    window.SokoniBuyerAuth?.bindPanel?.({
      onVerified: () => {
        renderSession();
        renderSavedCount();
      },
    });
    el("profile-sign-out-btn")?.addEventListener("click", () => {
      void signOut();
    });
    renderSession();
    renderSavedCount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
