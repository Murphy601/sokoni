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

  function resolveVideo(product) {
    if (window.SokoniApp?.resolveProductVideo) {
      return window.SokoniApp.resolveProductVideo(product);
    }
    const raw = product?.videoUrl;
    if (raw && /^https?:\/\//i.test(String(raw))) return String(raw);
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
    const handle = normalizeHandleValue(sellerHandle(product));
    if (!sellerUserId && !handle) return "";
    const viewerId = resolveViewerUserId();
    const params = new URLSearchParams();
    if (sellerUserId) params.set("with", String(sellerUserId));
    if (viewerId) params.set("viewer", String(viewerId));
    if (product?.id) params.set("product", String(product.id));
    if (handle) params.set("handle", handle);
    return `inbox.html?${params.toString()}`;
  }

  async function resolveSellerUserIdFromHandle(product) {
    const existing = resolveSellerUserId(product);
    if (existing) return existing;
    const handle = normalizeHandleValue(sellerHandle(product));
    if (!handle) return null;
    try {
      const res = await fetch(`${SOCIAL_API_BASE}/shop/${encodeURIComponent(handle)}?limit=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const n = Number(data?.shop?.userId);
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
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

  /** Platform no longer charges shipping — sellers arrange dispatch after payment. */
  function resolveShippingKes(_product) {
    return 0;
  }

  /** Mirror bot computeOfferFeeBreakdown — offer amount is buyer all-in into escrow. */
  function computeOfferEscrowBreakdown(buyerTotalKes, shippingKes = 0) {
    const agreed = Math.round(Number(buyerTotalKes) || 0);
    const shipping = 0;
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
        error: "offer_too_low",
        message: `Offer must be at least KES ${minBuyerTotalKes.toLocaleString()} after Sokoni's 10% fee.`,
        minBuyerTotalKes,
        shippingKes: 0,
      };
    }
    const platformFeeKes = agreed - subtotalKes;
    return {
      itemKes: sellerNetKes,
      sellerNetKes,
      shippingKes: 0,
      platformFeeKes,
      totalKes: agreed,
      freeShipping: true,
      minBuyerTotalKes,
    };
  }

  function formatOfferBreakdownLine(breakdown) {
    if (!breakdown || breakdown.error) return "";
    return `You pay KES ${Number(breakdown.totalKes).toLocaleString()} into escrow · seller gets KES ${Number(breakdown.sellerNetKes).toLocaleString()} (Sokoni fee KES ${Number(breakdown.platformFeeKes).toLocaleString()}) · seller handles dispatch`;
  }

  function minOfferKes(_product) {
    const subtotal = 1;
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
    const handle = normalizeHandleValue(sellerHandle(product));
    const listedPrice = resolveListedPriceKes(product);
    // Show offer UI when we have a price and either a social seller id or a shop handle
    // (handle is resolved to sellerUserId before submit).
    if (!listedPrice || (!sellerId && !handle)) return "";
    if (viewerUserId && sellerId && viewerUserId === sellerId) return "";
    const suggested = defaultOfferKes(product);
    const shipping = resolveShippingKes(product);
    const preview = suggested ? computeOfferEscrowBreakdown(suggested, shipping) : null;
    const minAttr = preview && !preview.error ? preview.minBuyerTotalKes : 1;
    return `
      <button type="button" id="product-sheet-offer-toggle" class="product-sheet-save">💸 Make an offer</button>
      <form id="product-sheet-offer-form" class="product-sheet-offer-form" hidden>
        ${offerAuthBlock()}
        <label for="product-sheet-offer-amount" class="product-sheet-offer-label">Your total to pay (KES) — item + Sokoni fee (seller handles dispatch)</label>
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

  function measurementsLine(product) {
    const bits = [
      product.pitToPitIn != null ? `Pit-to-pit ${product.pitToPitIn}"` : null,
      product.lengthIn != null ? `Length ${product.lengthIn}"` : null,
      product.waistIn != null ? `Waist ${product.waistIn}"` : null,
    ].filter(Boolean);
    if (product.size) bits.unshift(`Size ${product.size}`);
    return bits.join(" · ");
  }

  function galleryHtml(product) {
    const urls = [];
    const primary = resolveImage(product);
    const videoSrc = resolveVideo(product);
    if (primary) urls.push(primary);
    if (Array.isArray(product.images)) {
      for (const img of product.images) {
        if (!img) continue;
        const resolved =
          window.SokoniApp?.resolveProductImage?.({ ...product, imageUrl: img }) ||
          (/^https?:\/\//i.test(String(img)) ? String(img) : null);
        if (resolved && !urls.includes(resolved)) urls.push(resolved);
        if (urls.length >= 8) break;
      }
    }
    if (!urls.length && !videoSrc) {
      return `<div class="product-sheet-image product-sheet-image--empty">Photo coming soon</div>`;
    }

    const poster = primary || urls[0] || "";
    const isSellerClip = product.videoKind === "seller";
    let main;
    if (videoSrc) {
      // Seller showcase: controls + muted autoplay. AI preview: muted loop like a GIF.
      main = `<video
        class="product-sheet-video"
        src="${escapeHtml(videoSrc)}"
        ${poster ? `poster="${escapeHtml(poster)}"` : ""}
        ${isSellerClip ? "controls" : ""}
        muted
        loop
        playsinline
        autoplay
        data-sheet-main-video
      ></video>`;
    } else {
      main = `<img src="${escapeHtml(urls[0])}" alt="${escapeHtml(
        product.name
      )}" class="product-sheet-image" data-sheet-main-image />`;
    }

    const thumbBits = [];
    if (videoSrc) {
      thumbBits.push(`<button type="button" class="product-sheet-thumb is-active" data-sheet-media="video" data-sheet-thumb="${escapeHtml(
        videoSrc
      )}" data-sheet-poster="${escapeHtml(poster)}" aria-label="Video">
            ${poster ? `<img src="${escapeHtml(poster)}" alt="" />` : `<span class="product-sheet-thumb-label">▶</span>`}
          </button>`);
    }
    urls.forEach((url, i) => {
      const active = !videoSrc && i === 0 ? " is-active" : "";
      thumbBits.push(`<button type="button" class="product-sheet-thumb${active}" data-sheet-media="image" data-sheet-thumb="${escapeHtml(
        url
      )}" aria-label="Photo ${i + 1}">
            <img src="${escapeHtml(url)}" alt="" />
          </button>`);
    });
    if (thumbBits.length <= 1 && !videoSrc) return main;
    if (thumbBits.length <= 1) return main;
    return `${main}<div class="product-sheet-thumbs">${thumbBits.join("")}</div>`;
  }

  function productShareUrl(product) {
    const id = encodeURIComponent(product.id || "");
    const origin = window.location.origin || "https://sokonimall.com";
    return `${origin}/index.html?q=${id}`;
  }

  function renderBody(product) {
    const saved = window.SokoniShopShell?.isHearted?.(product.id) ?? window.SokoniShopShell?.isInBag?.(product.id);
    const condition = product.conditionLabel || product.condition || "";
    const secondhand = product.isSecondhand ? "Pre-Loved" : "Brand New";
    const handle = sellerHandle(product);
    const shopLink = sellerShopLink(product);
    const offerAction = offerActionBlock(product);
    const measures = measurementsLine(product);

    return `
      <div class="product-sheet-gallery">
        ${galleryHtml(product)}
      </div>
      <div class="product-sheet-meta">
        <p class="product-sheet-price">${escapeHtml(formatPrice(product))}${
          (() => {
            const onPromo =
              product.onPromo ||
              product.promo?.active ||
              (product.originalPriceKes &&
                Math.round(Number(product.originalPriceKes)) >
                  Math.round(Number(product.priceKes || product.totalKes) || 0));
            if (!onPromo) return "";
            const original = Math.round(Number(product.originalPriceKes) || 0);
            const pct =
              product.discountPct != null
                ? Math.round(Number(product.discountPct))
                : original
                  ? Math.max(
                      1,
                      Math.round(
                        (1 - Math.round(Number(product.priceKes || product.totalKes) || 0) / original) * 100
                      )
                    )
                  : 0;
            return `${
              original > 0
                ? ` <span class="text-sm font-medium text-brand-purple/40 line-through">KES ${original.toLocaleString()}</span>`
                : ""
            } <span class="inline-flex items-center text-[11px] font-bold uppercase tracking-wide text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">${
              pct ? `-${pct}% promo` : "Promo"
            }</span>`;
          })()
        }</p>
        ${
          product.onPromo ||
          product.promo?.active ||
          (product.originalPriceKes &&
            Math.round(Number(product.originalPriceKes)) > Math.round(Number(product.priceKes) || 0))
            ? `<p class="text-xs font-semibold text-emerald-700 mt-1">Seller promo — M-Pesa STK uses this price</p>`
            : ""
        }
        <p class="product-sheet-dispatch text-xs font-semibold mt-1">Seller handles dispatch (direct delivery)</p>
        <h2 class="product-sheet-title">${escapeHtml(product.name)}</h2>
        ${
          window.SokoniSellerTrust?.badgesHtml?.(product, {
            max: 3,
            className: "seller-trust-badges product-sheet-trust",
          }) || ""
        }
        <p class="product-sheet-tags">${escapeHtml([browseLabel(product), secondhand, condition].filter(Boolean).join(" · "))}</p>
        ${
          measures
            ? `<p class="product-sheet-measures text-sm text-brand-purple/70 dark:text-white/70 mt-2">${escapeHtml(
                measures
              )}</p>`
            : ""
        }
        <p class="product-sheet-id">${escapeHtml(product.id || "")}</p>
        ${
          product.description
            ? `<p class="product-sheet-desc">${escapeHtml(product.description)}</p>`
            : ""
        }
        <p class="product-sheet-rating">${(() => {
          const trust = product.sellerTrust || {};
          const count = Number(trust.totalReviews ?? product.reviews) || 0;
          const avg = Number(trust.avgRating ?? product.rating) || 0;
          const sales = Number(trust.salesCount ?? product.sellerSalesCount) || 0;
          if (count > 0) return `★ ${avg.toFixed(1)} · ${count} review${count === 1 ? "" : "s"}`;
          if (sales > 0) return `★ 5.0 · ${sales} completed sale${sales === 1 ? "" : "s"}`;
          return "New seller";
        })()}</p>
        <p class="product-sheet-escrow text-xs text-brand-purple/60 dark:text-white/60 mt-2">
          Protected by Sokoni escrow — full refund if the item does not match photos/description. Final sale unless misdescribed.
        </p>
      </div>
      <div class="product-sheet-actions">
        <a href="${orderLink(product)}" target="_blank" rel="noopener" class="product-sheet-order btn-whatsapp">
          🛒 Buy — prepaid
        </a>
        <button type="button" id="product-sheet-save" class="product-sheet-save ${saved ? "is-saved" : ""}">
          ${saved ? "✓ In cart" : "🛒 Add to cart"}
        </button>
        <button type="button" id="product-sheet-share" class="product-sheet-ask">
          Share card
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

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function buildShareCardBlob(product) {
    const width = 1080;
    const height = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#1B1035");
    gradient.addColorStop(1, "#2E1B57");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const src = resolveImage(product);
    if (src) {
      try {
        const img = await loadImage(src);
        const boxX = 80;
        const boxY = 220;
        const boxW = width - 160;
        const boxH = 1080;
        ctx.fillStyle = "#FFF8F0";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        const scale = Math.max(boxW / img.width, boxH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = boxX + (boxW - dw) / 2;
        const dy = boxY + (boxH - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.clip();
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      } catch {
        /* keep solid card if photo blocked by CORS */
      }
    }

    ctx.fillStyle = "#25D366";
    ctx.font = "bold 54px DM Sans, sans-serif";
    ctx.fillText("Sokoni", 80, 140);
    ctx.fillStyle = "#FFF8F0";
    ctx.font = "600 64px Fraunces, Georgia, serif";
    const title = String(product.name || "Item on Sokoni").slice(0, 42);
    ctx.fillText(title, 80, 1420);
    ctx.font = "bold 72px DM Sans, sans-serif";
    ctx.fillStyle = "#25D366";
    ctx.fillText(formatPrice(product) || "KES —", 80, 1520);
    ctx.fillStyle = "rgba(255,248,240,0.85)";
    ctx.font = "36px DM Sans, sans-serif";
    ctx.fillText("Prepaid escrow · sokonimall.com", 80, 1600);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("share_card_failed"));
        else resolve(blob);
      }, "image/jpeg", 0.92);
    });
  }

  async function shareProductCard(product) {
    const statusNode = document.getElementById("product-sheet-offer-status");
    const setMsg = (msg) => {
      if (statusNode) statusNode.textContent = msg || "";
    };
    try {
      setMsg("Building share card…");
      const blob = await buildShareCardBlob(product);
      const file = new File([blob], `sokoni-${product.id || "item"}.jpg`, { type: "image/jpeg" });
      const shareUrl = productShareUrl(product);
      const text = `${product.name || "Item"} — ${formatPrice(product)} on Sokoni\n${shareUrl}`;

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Sokoni", text });
        setMsg("Shared.");
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(objectUrl);
      window.open(waLink(text), "_blank", "noopener");
      setMsg("Card downloaded — WhatsApp opened with the caption.");
    } catch (err) {
      const shareUrl = productShareUrl(product);
      window.open(
        waLink(`${product.name || "Item"} — ${formatPrice(product)} on Sokoni\n${shareUrl}`),
        "_blank",
        "noopener"
      );
      setMsg(err?.message === "share_card_failed" ? "Opened WhatsApp share." : "Opened WhatsApp share.");
    }
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
    viewerUserId = resolveViewerUserId();
    const buyerUserId = viewerUserId;
    const amountInput = document.getElementById("product-sheet-offer-amount");
    const submitBtn = document.getElementById("product-sheet-offer-submit");
    const listedPrice = resolveListedPriceKes(product);
    if (!amountInput || !submitBtn || !listedPrice) return;
    if (!buyerUserId) {
      setOfferStatus("Verify your WhatsApp above to send an offer.", "error");
      document.getElementById("buyer-auth-phone")?.focus();
      return;
    }
    setOfferStatus("Checking shop…");
    const sellerUserId = await resolveSellerUserIdFromHandle(product);
    if (!sellerUserId) {
      setOfferStatus("Could not find this shop’s seller account yet. Try Message seller, or Ask on WhatsApp.", "error");
      return;
    }
    if (buyerUserId === sellerUserId) {
      setOfferStatus("You cannot offer on your own listing.", "error");
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
    btn.textContent = saved ? "✓ In cart" : "🛒 Add to cart";
  }

  function open(product) {
    if (!product) return;
    viewerUserId = resolveViewerUserId();
    currentProduct = product;
    window.SokoniFeed?.trackView?.(product.id);
    window.SokoniRecentlyViewed?.record?.(product);
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
    const vid = document.querySelector("[data-sheet-main-video]");
    if (vid) {
      try {
        vid.pause();
      } catch {
        /* ignore */
      }
    }
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
      const thumb = e.target.closest("[data-sheet-thumb]");
      if (thumb) {
        const gallery = thumb.closest(".product-sheet-gallery");
        const url = thumb.getAttribute("data-sheet-thumb");
        const media = thumb.getAttribute("data-sheet-media") || "image";
        const poster = thumb.getAttribute("data-sheet-poster") || "";
        if (gallery && url) {
          const existingVideo = gallery.querySelector("[data-sheet-main-video]");
          const existingImage = gallery.querySelector("[data-sheet-main-image]");
          if (media === "video") {
            if (existingImage) existingImage.remove();
            let vid = existingVideo;
            if (!vid) {
              vid = document.createElement("video");
              vid.className = "product-sheet-video";
              vid.setAttribute("data-sheet-main-video", "");
              vid.muted = true;
              vid.loop = true;
              vid.playsInline = true;
              vid.autoplay = true;
              if (currentProduct?.videoKind === "seller") vid.controls = true;
              gallery.insertBefore(vid, gallery.firstChild);
            }
            if (poster) vid.poster = poster;
            vid.src = url;
            void vid.play?.().catch?.(() => {});
          } else {
            if (existingVideo) {
              try {
                existingVideo.pause();
              } catch {
                /* ignore */
              }
              existingVideo.remove();
            }
            let img = existingImage;
            if (!img) {
              img = document.createElement("img");
              img.className = "product-sheet-image";
              img.setAttribute("data-sheet-main-image", "");
              img.alt = currentProduct?.name || "";
              gallery.insertBefore(img, gallery.firstChild);
            }
            img.src = url;
          }
        }
        document.querySelectorAll("[data-sheet-thumb]").forEach((node) => {
          node.classList.toggle("is-active", node === thumb);
        });
        return;
      }
      if (e.target.closest("#product-sheet-share")) {
        if (!currentProduct) return;
        void shareProductCard(currentProduct);
        return;
      }
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
