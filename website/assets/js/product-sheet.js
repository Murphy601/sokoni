/**
 * Phase 3 — Depop-style product detail bottom sheet.
 */
(function () {
  const WHATSAPP_NUMBER = "254117422428";
  const API_BASE =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:3001"
      : "https://bot.sokonimall.com";
  const SOCIAL_API_BASE = `${API_BASE}/api/social`;
  let currentProduct = null;
  let viewerUserId = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPrice(product) {
    if (window.SokoniApp?.formatPrice) return window.SokoniApp.formatPrice(product);
    if (product.priceKes != null) return `KES ${product.priceKes.toLocaleString()}`;
    if (product.priceUsd != null) return `$${product.priceUsd}`;
    return "";
  }

  function resolveImage(product) {
    if (window.SokoniApp?.resolveProductImage) {
      return window.SokoniApp.resolveProductImage(product);
    }
    const botOrigin =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:3001"
        : "https://bot.sokonimall.com";
    const raw = product?.imageUrl;
    if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);
    if (product?.id) return `${botOrigin}/catalog-images/${encodeURIComponent(product.id)}.jpg`;
    if (raw) return String(raw);
    return null;
  }

  function waLink(message) {
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }

  function orderLink(product) {
    return waLink(
      `Hi Sokoni, I'd like to order "${product.name}" (${formatPrice(product)}) — prepaid. ` +
        `My name, delivery location and phone are:`
    );
  }

  function askInboxLink(product) {
    const sellerUserId = resolveSellerUserId(product);
    const viewerId = resolveViewerUserId();
    if (!sellerUserId) return "";
    const params = new URLSearchParams({
      with: String(sellerUserId),
    });
    if (viewerId) params.set("viewer", String(viewerId));
    if (product?.id) params.set("product", String(product.id));
    const handle = normalizeHandleValue(sellerHandle(product));
    if (handle) params.set("handle", handle);
    return `inbox.html?${params.toString()}`;
  }

  function askLink(product) {
    const inbox = askInboxLink(product);
    if (inbox) return inbox;
    return waLink(`Hi Sokoni, tell me more about "${product.name}" (${formatPrice(product)}).`);
  }

  function browseLabel(product) {
    const path = window.SokoniBrowse?.resolveBrowsePath(product);
    if (!path) return "";
    return window.SokoniBrowse?.labelForBrowse(path.browse, path.sub) || "";
  }

  function normalizeHandleValue(value) {
    const clean = String(value || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    return clean.replace(/[^a-z0-9._-]+/g, "").slice(0, 40);
  }

  function sellerHandle(product) {
    const direct = normalizeHandleValue(
      product?.sellerHandle ||
        product?.shopHandle ||
        product?.seller?.handle ||
        product?.handle
    );
    if (direct) return `@${direct}`;

    const name = product?.businessName || product?.source || "";
    if (!name) return "";
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 18);
    return slug ? `@${slug}` : "";
  }

  function sellerShopLink(product) {
    const handle = normalizeHandleValue(sellerHandle(product));
    if (!handle) return "";
    const params = new URLSearchParams({ handle });
    const viewer = viewerQueryValue();
    if (viewer) params.set("viewer", viewer);
    return `shop.html?${params.toString()}`;
  }

  function parseViewerUserId() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("viewer") || params.get("viewerUserId");
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
  }

  function resolveViewerUserId() {
    const sessionUserId = window.SokoniBuyerAuth?.readSession?.()?.userId;
    if (Number.isInteger(sessionUserId) && sessionUserId > 0) return sessionUserId;
    return parseViewerUserId();
  }

  function viewerQueryValue() {
    const viewerId = resolveViewerUserId();
    return viewerId ? String(viewerId) : "";
  }

  function isBuyerSessionAuthError(payload) {
    const code = String(payload?.error || "")
      .trim()
      .toLowerCase();
    return (
      code === "session_required" ||
      code === "session_invalid" ||
      code === "session_expired" ||
      code === "buyer_session_mismatch"
    );
  }

  function resolveSellerUserId(product) {
    const raw = product?.sellerUserId ?? product?.seller?.id ?? null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
  }

  function resolveListedPriceKes(product) {
    const amount = Number(product?.priceKes ?? product?.priceKsh ?? null);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount);
  }

  function resolveShippingKes(product) {
    if (product?.freeShipping === true) return 0;
    const ship = Math.round(Number(product?.shippingKes ?? product?.shippingKsh ?? 0) || 0);
    return ship > 0 ? Math.max(150, ship) : 0;
  }

  /** Mirror bot computeOfferFeeBreakdown — offer amount is buyer all-in into escrow. */
  function computeOfferEscrowBreakdown(buyerTotalKes, shippingKes) {
    const agreed = Math.round(Number(buyerTotalKes) || 0);
    const shipping = Math.round(Number(shippingKes) || 0) > 0 ? Math.max(150, Math.round(Number(shippingKes))) : 0;
    if (!Number.isFinite(agreed) || agreed < 1) {
      return { error: "invalid_offer_amount", message: "Enter a valid offer amount in KES." };
    }
    const minSellerNet = 1;
    const minSubtotal = minSellerNet + shipping;
    const minBuyerTotalKes = minSubtotal + Math.round(minSubtotal * 0.1);
    const subtotalKes = Math.round(agreed / 1.1);
    const sellerNetKes = subtotalKes - shipping;
    if (sellerNetKes < 1) {
      return {
        error: "offer_too_low_for_shipping",
        message:
          shipping > 0
            ? `Offer must be at least KES ${minBuyerTotalKes.toLocaleString()} to cover shipping (KES ${shipping.toLocaleString()}) and Sokoni's 10% fee.`
            : `Offer must be at least KES ${minBuyerTotalKes.toLocaleString()} after Sokoni's 10% fee.`,
        minBuyerTotalKes,
        shippingKes: shipping,
      };
    }
    const platformFeeKes = agreed - subtotalKes;
    return {
      itemKes: sellerNetKes,
      sellerNetKes,
      shippingKes: shipping,
      platformFeeKes,
      totalKes: agreed,
      freeShipping: shipping === 0,
      minBuyerTotalKes,
    };
  }

  function formatOfferBreakdownLine(breakdown) {
    if (!breakdown || breakdown.error) return "";
    const ship =
      breakdown.freeShipping || !breakdown.shippingKes
        ? "shipping free"
        : `shipping KES ${Number(breakdown.shippingKes).toLocaleString()}`;
    return `You pay KES ${Number(breakdown.totalKes).toLocaleString()} into escrow · seller gets KES ${Number(breakdown.sellerNetKes).toLocaleString()} (${ship} + Sokoni fee KES ${Number(breakdown.platformFeeKes).toLocaleString()})`;
  }

  function minOfferKes(product) {
    const shipping = resolveShippingKes(product);
    const subtotal = 1 + shipping;
    return subtotal + Math.round(subtotal * 0.1);
  }

  function defaultOfferKes(product) {
    const listed = resolveListedPriceKes(product);
    if (!listed) return null;
    const floor = minOfferKes(product);
    const discounted = Math.round((listed * 0.9) / 50) * 50;
    return Math.max(floor, Math.min(listed, discounted || listed));
  }

  function offerAuthBlock() {
    if (viewerUserId) return "";
    return `
      <div id="buyer-auth-panel" class="product-sheet-offer-auth">
        <p class="product-sheet-offer-label">Verify WhatsApp to send this offer</p>
        <label for="buyer-auth-phone" class="product-sheet-offer-label">WhatsApp number</label>
        <input id="buyer-auth-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XXXXXXXX" class="product-sheet-offer-input" />
        <label for="buyer-auth-code" class="product-sheet-offer-label">6-digit code</label>
        <div class="product-sheet-offer-row">
          <input id="buyer-auth-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456" class="product-sheet-offer-input" />
          <button type="button" id="buyer-auth-send-btn" class="product-sheet-offer-submit">Send code</button>
        </div>
        <button type="button" id="buyer-auth-verify-btn" class="product-sheet-save">Verify & continue</button>
        <p id="buyer-auth-status" class="product-sheet-offer-status"></p>
      </div>
    `;
  }

  function offerActionBlock(product) {
    const sellerId = resolveSellerUserId(product);
    const listedPrice = resolveListedPriceKes(product);
    if (!sellerId || !listedPrice) return "";
    if (viewerUserId && viewerUserId === sellerId) return "";
    const suggested = defaultOfferKes(product);
    const shipping = resolveShippingKes(product);
    const preview = suggested ? computeOfferEscrowBreakdown(suggested, shipping) : null;
    const minAttr = preview && !preview.error ? preview.minBuyerTotalKes : 1;
    return `
      <button type="button" id="product-sheet-offer-toggle" class="product-sheet-save">💸 Make an offer</button>
      <form id="product-sheet-offer-form" class="product-sheet-offer-form" hidden>
        ${offerAuthBlock()}
        <label for="product-sheet-offer-amount" class="product-sheet-offer-label">Your total to pay (KES) — includes shipping + Sokoni fee</label>
        <div class="product-sheet-offer-row">
          <input
            id="product-sheet-offer-amount"
            type="number"
            inputmode="numeric"
            min="${minAttr}"
            max="${listedPrice}"
            step="1"
            value="${suggested || ""}"
            class="product-sheet-offer-input"
            required
          />
          <button type="submit" id="product-sheet-offer-submit" class="product-sheet-offer-submit">
            Send
          </button>
        </div>
        <p id="product-sheet-offer-breakdown" class="product-sheet-offer-breakdown">${
          preview && !preview.error ? escapeHtml(formatOfferBreakdownLine(preview)) : ""
        }</p>
      </form>
      <p id="product-sheet-offer-status" class="product-sheet-offer-status"></p>
    `;
  }

  function renderBody(product) {
    const src = resolveImage(product);
    const saved = window.SokoniShopShell?.isHearted?.(product.id) ?? window.SokoniShopShell?.isInBag?.(product.id);
    const condition = product.conditionLabel || product.condition || "";
    const secondhand = product.isSecondhand ? "Pre-Loved" : "Brand New";
    const handle = sellerHandle(product);
    const shopLink = sellerShopLink(product);
    const offerAction = offerActionBlock(product);

    return `
      <div class="product-sheet-gallery">
        ${
          src
            ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" class="product-sheet-image" />`
            : `<div class="product-sheet-image product-sheet-image--empty">Photo coming soon</div>`
        }
      </div>
      <div class="product-sheet-meta">
        <p class="product-sheet-price">${escapeHtml(formatPrice(product))}</p>
        <h2 class="product-sheet-title">${escapeHtml(product.name)}</h2>
        <p class="product-sheet-tags">${escapeHtml([browseLabel(product), secondhand, condition].filter(Boolean).join(" · "))}</p>
        <p class="product-sheet-id">${escapeHtml(product.id || "")}</p>
        ${
          product.description
            ? `<p class="product-sheet-desc">${escapeHtml(product.description)}</p>`
            : ""
        }
        <p class="product-sheet-rating">⭐ ${Number(product.rating) || 0} · ${Number(product.reviews) || 0} reviews</p>
        <p class="product-sheet-escrow text-xs text-brand-purple/60 dark:text-white/60 mt-2">
          Protected by Sokoni escrow — full refund if the item does not match photos/description. Final sale unless misdescribed.
        </p>
      </div>
      <div class="product-sheet-actions">
        <a href="${orderLink(product)}" target="_blank" rel="noopener" class="product-sheet-order btn-whatsapp">
          🛒 Buy — prepaid
        </a>
        <button type="button" id="product-sheet-save" class="product-sheet-save ${saved ? "is-saved" : ""}">
          ${saved ? "♥ Saved" : "♡ Save for later"}
        </button>
        ${offerAction}
        ${
          handle && shopLink
            ? `<a href="${shopLink}" class="product-sheet-ask">🏪 View ${escapeHtml(handle)} shop</a>`
            : ""
        }
        <a href="${askLink(product)}" ${askInboxLink(product) ? "" : 'target="_blank" rel="noopener"'} class="product-sheet-ask">${
          askInboxLink(product) ? "💬 Message seller on Sokoni" : "💬 Ask on WhatsApp"
        }</a>
      </div>`;
  }

  function setOfferStatus(message, tone = "info") {
    const statusNode = document.getElementById("product-sheet-offer-status");
    if (!statusNode) return;
    statusNode.textContent = message || "";
    statusNode.classList.remove("is-error", "is-success");
    if (tone === "error") statusNode.classList.add("is-error");
    if (tone === "success") statusNode.classList.add("is-success");
  }

  async function submitOffer(product) {
    const sellerUserId = resolveSellerUserId(product);
    viewerUserId = resolveViewerUserId();
    const buyerUserId = viewerUserId;
    const amountInput = document.getElementById("product-sheet-offer-amount");
    const submitBtn = document.getElementById("product-sheet-offer-submit");
    const listedPrice = resolveListedPriceKes(product);
    if (!amountInput || !submitBtn || !sellerUserId || !listedPrice) return;
    if (!buyerUserId) {
      setOfferStatus("Verify your WhatsApp above to send an offer.", "error");
      document.getElementById("buyer-auth-phone")?.focus();
      return;
    }

    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      setOfferStatus("Enter a valid offer amount in KES.", "error");
      amountInput.focus();
      return;
    }
    if (amount > listedPrice) {
      setOfferStatus(`Offer must be KES ${listedPrice.toLocaleString()} or below.`, "error");
      amountInput.focus();
      return;
    }
    const localBreakdown = computeOfferEscrowBreakdown(amount, resolveShippingKes(product));
    if (localBreakdown.error) {
      setOfferStatus(localBreakdown.message, "error");
      amountInput.focus();
      return;
    }

    submitBtn.disabled = true;
    setOfferStatus("Sending offer...");
    try {
      const payload = window.SokoniBuyerAuth?.authFields
        ? window.SokoniBuyerAuth.authFields({
            productId: product.id,
            buyerUserId,
            sellerUserId,
            amountKsh: Math.round(amount),
          })
        : {
            productId: product.id,
            buyerUserId,
            sellerUserId,
            amountKsh: Math.round(amount),
          };
      const res = await fetch(`${SOCIAL_API_BASE}/offers/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isBuyerSessionAuthError(data)) {
          setOfferStatus(data?.message || "Verify your WhatsApp below to send an offer.", "error");
          return;
        }
        setOfferStatus(data?.message || data?.error || "Could not send offer right now.", "error");
        return;
      }
      const sent = data.breakdown || data.offer?.breakdown || localBreakdown;
      setOfferStatus(
        sent?.sellerNetKes != null
          ? `Offer sent — you pay KES ${Number(sent.totalKes).toLocaleString()}, seller receives KES ${Number(sent.sellerNetKes).toLocaleString()} after delivery.`
          : "Offer sent. Seller has up to 24 hours to respond.",
        "success"
      );
    } catch {
      setOfferStatus("Network error while sending offer. Please try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  }

  function setupOfferUi(product) {
    const toggle = document.getElementById("product-sheet-offer-toggle");
    const form = document.getElementById("product-sheet-offer-form");
    const amountInput = document.getElementById("product-sheet-offer-amount");
    if (!toggle || !form || !amountInput) return;

    if (!viewerUserId && window.SokoniBuyerAuth?.bindPanel) {
      window.SokoniBuyerAuth.bindPanel({
        onVerified: () => {
          viewerUserId = resolveViewerUserId();
          const body = document.getElementById("product-sheet-body");
          if (body && currentProduct) {
            body.innerHTML = renderBody(currentProduct);
            setupOfferUi(currentProduct);
            const nextForm = document.getElementById("product-sheet-offer-form");
            if (nextForm) nextForm.hidden = false;
            setOfferStatus("WhatsApp verified — send your offer.", "success");
          }
        },
      });
    }

    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) {
        const focusNode = viewerUserId ? amountInput : document.getElementById("buyer-auth-phone");
        focusNode?.focus();
        if (viewerUserId) amountInput.select();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitOffer(product);
    });

    const breakdownNode = document.getElementById("product-sheet-offer-breakdown");
    const refreshBreakdown = () => {
      setOfferStatus("");
      if (!breakdownNode) return;
      const amount = Number(amountInput.value);
      const preview = computeOfferEscrowBreakdown(amount, resolveShippingKes(product));
      if (preview.error) {
        breakdownNode.textContent = preview.message || "";
        breakdownNode.classList.add("is-error");
        return;
      }
      breakdownNode.classList.remove("is-error");
      breakdownNode.textContent = formatOfferBreakdownLine(preview);
    };
    amountInput.addEventListener("input", refreshBreakdown);
    refreshBreakdown();
  }

  function syncSaveButton(productId) {
    if (!currentProduct || currentProduct.id !== productId) return;
    const btn = document.getElementById("product-sheet-save");
    if (!btn) return;
    const saved =
      window.SokoniShopShell?.isHearted?.(productId) ?? window.SokoniShopShell?.isInBag?.(productId);
    btn.classList.toggle("is-saved", saved);
    btn.textContent = saved ? "♥ Saved" : "♡ Save for later";
  }

  function open(product) {
    if (!product) return;
    viewerUserId = resolveViewerUserId();
    currentProduct = product;
    window.SokoniFeed?.trackView?.(product.id);
    const body = document.getElementById("product-sheet-body");
    const sheet = document.getElementById("product-sheet");
    if (!body || !sheet) return;
    body.innerHTML = renderBody(product);
    setupOfferUi(product);
    sheet.classList.add("is-open");
    sheet.removeAttribute("hidden");
    document.body.classList.add("sheet-open");
  }

  function close() {
    document.getElementById("product-sheet")?.classList.remove("is-open");
    document.getElementById("product-sheet")?.setAttribute("hidden", "");
    document.body.classList.remove("sheet-open");
    currentProduct = null;
  }

  function init() {
    viewerUserId = resolveViewerUserId();
    document.getElementById("product-sheet-close")?.addEventListener("click", close);
    document.querySelector("#product-sheet .sheet-backdrop")?.addEventListener("click", close);
    document.getElementById("product-sheet-body")?.addEventListener("click", (e) => {
      if (!e.target.closest("#product-sheet-save")) return;
      if (!currentProduct) return;
      window.SokoniShopShell?.toggleBag(currentProduct.id);
      syncSaveButton(currentProduct.id);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  window.SokoniProductSheet = { open, close, syncSaveButton, init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
