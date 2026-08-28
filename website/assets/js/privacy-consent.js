/**
 * Soft Kenya Data Protection Act notice — once per browser.
 * Links Privacy + Terms; never blocks shopping. Fail-soft if DOM is odd.
 */
(function () {
  const KEY = "sokoni-privacy-ack-v1";
  const MARKER = "data-sokoni-privacy-consent";

  function alreadyAcked() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  }

  function ack() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function basePrefix() {
    const path = String(location.pathname || "");
    if (path.includes("/suppliers/") || path.includes("/pickup-points/")) return "../";
    return "";
  }

  function mount() {
    if (alreadyAcked()) return;
    if (document.querySelector(`[${MARKER}]`)) return;
    if (document.body?.dataset?.sokoniNoPrivacyBanner === "1") return;

    const prefix = basePrefix();
    const bar = document.createElement("aside");
    bar.setAttribute(MARKER, "1");
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Privacy notice");
    bar.className = "sokoni-privacy-consent";
    bar.innerHTML = `
      <div class="sokoni-privacy-consent__inner">
        <p class="sokoni-privacy-consent__text">
          Sokoni uses your phone and delivery details to fulfill orders under Kenya’s
          <strong>Data Protection Act, 2019</strong>.
          Read our
          <a href="${prefix}privacy.html">Privacy Policy</a>
          and
          <a href="${prefix}terms.html">Terms</a>
          (returns: contact within 48 hours of delivery for wrong or damaged items).
        </p>
        <button type="button" class="sokoni-privacy-consent__btn" data-privacy-ack>Got it</button>
      </div>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-privacy-ack]")?.addEventListener("click", () => {
      ack();
      bar.remove();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
