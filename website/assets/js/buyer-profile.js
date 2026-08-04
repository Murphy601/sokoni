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

  function formatKes(n) {
    return `KES ${Math.round(Number(n) || 0).toLocaleString()}`;
  }

  function statusLabel(p) {
    const pay = String(p.paymentStatus || "").toLowerCase();
    if (pay === "confirmed" || pay === "paid") return p.status || "paid";
    if (pay === "unpaid" || pay === "pending") return "awaiting payment";
    return p.status || "—";
  }

  async function renderPurchases() {
    const needLogin = el("account-purchases-need-login");
    const body = el("account-purchases-body");
    const list = el("account-purchases-list");
    const empty = el("account-purchases-empty");
    const hint = el("account-purchases-hint");
    const account = window.SokoniAccountAuth?.readSession?.();

    if (!account?.userId) {
      needLogin?.classList.remove("hidden");
      body?.classList.add("hidden");
      return;
    }
    needLogin?.classList.add("hidden");
    body?.classList.remove("hidden");

    const phoneInput = el("account-phone-input");
    if (phoneInput && account.user?.phone) {
      phoneInput.value = account.user.phone.startsWith("254")
        ? `0${account.user.phone.slice(3)}`
        : account.user.phone;
    }

    if (!list) return;
    list.innerHTML = `<li class="text-sm text-zinc-500">Loading purchases…</li>`;
    const result = await window.SokoniAccountAuth.fetchPurchases();
    if (!result.ok) {
      list.innerHTML = `<li class="text-sm text-red-400">${result.data?.message || "Could not load purchases."}</li>`;
      return;
    }
    if (hint) hint.textContent = result.data?.hint || "";
    const purchases = result.data?.purchases || [];
    if (!purchases.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }
    empty?.classList.add("hidden");
    list.innerHTML = purchases
      .slice(0, 30)
      .map((p) => {
        const paid = String(p.paymentStatus || "").toLowerCase() === "confirmed";
        const href = paid ? p.trackUrl || `track.html?order=${p.id}` : p.checkoutUrl || `checkout.html?order=${p.id}`;
        return `<li class="rounded-2xl border border-zinc-800 bg-black/60 p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <div>
            <p class="text-sm font-semibold text-white">${p.id} · ${p.productName || "Order"}</p>
            <p class="text-xs text-zinc-400">${formatKes(p.totalKes)} · ${statusLabel(p)}</p>
          </div>
          <a href="${href}" class="depop-btn-ghost text-center">${paid ? "Track" : "Pay / open"}</a>
        </li>`;
      })
      .join("");
  }

  function bindPurchaseForms() {
    el("account-phone-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = el("account-phone-status");
      const phone = el("account-phone-input")?.value || "";
      if (status) status.textContent = "Saving…";
      const result = await window.SokoniAccountAuth?.updateProfile?.({ phone });
      if (!result?.ok) {
        if (status) status.textContent = result?.data?.message || "Could not save phone.";
        return;
      }
      if (status) status.textContent = "Phone saved — refreshing purchases…";
      renderEmailAccount();
      await renderPurchases();
    });

    el("account-claim-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = el("account-claim-status");
      const orderId = el("account-claim-order")?.value || "";
      if (status) status.textContent = "Linking…";
      const result = await window.SokoniAccountAuth?.claimOrder?.(orderId);
      if (!result?.ok) {
        if (status) status.textContent = result?.data?.message || "Could not link order.";
        return;
      }
      if (status) status.textContent = `Linked ${result.data?.order?.id || orderId}.`;
      await renderPurchases();
    });
  }

  function init() {
    window.SokoniBuyerAuth?.bindPanel?.({
      onVerified: async (buyerSession) => {
        if (window.SokoniAccountAuth?.isSignedIn?.() && buyerSession?.sessionToken) {
          setStatus("Linking WhatsApp to your email account…");
          const linked = await window.SokoniAccountAuth.linkWhatsApp({
            phone: buyerSession.phone,
            whatsappSessionToken: buyerSession.sessionToken,
            role: "buyer",
          });
          if (!linked.ok) {
            setStatus(linked.data?.message || "WhatsApp verified, but could not link to email account.");
          } else {
            setStatus(linked.data?.message || "WhatsApp linked to your account.");
          }
        }
        renderSession();
        renderSavedCount();
        void renderPurchases();
      },
    });
    el("profile-sign-out-btn")?.addEventListener("click", () => {
      void signOut();
    });
    bindPurchaseForms();
    renderSession();
    renderSavedCount();
    void renderPurchases();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
