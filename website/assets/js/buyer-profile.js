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

  function renderSession() {
    const session = window.SokoniBuyerAuth?.readSession?.();
    const card = el("profile-session-card");
    const phoneNode = el("profile-phone");
    const userNode = el("profile-user-id");

    if (!session?.userId) {
      card?.classList.add("hidden");
      setStatus("Verify WhatsApp to sync likes, offers, and chats.");
      return;
    }

    card?.classList.remove("hidden");
    if (phoneNode) phoneNode.textContent = `WhatsApp ${maskPhone(session.phone)}`;
    if (userNode) userNode.textContent = `Buyer #${session.userId}`;
    setStatus("You're signed in. Activity and Inbox use this same session.");
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
