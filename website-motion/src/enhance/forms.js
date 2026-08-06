import { bindTapScale, markEnhanced, prefersReducedMotion, safeAnimate } from "../lib/motion.js";

/**
 * Auth / seller / buyer forms — subtle enter + CTA tap (login, signup, profile, sell).
 */
export function enhanceForms(root = document) {
  const forms = root.querySelectorAll(
    "form, .sell-form, #review-form, #login-form, #signup-form, .account-form"
  );

  forms.forEach((form) => {
    if (!markEnhanced(form, "form")) return;

    if (!prefersReducedMotion()) {
      form.style.opacity = "0";
      form.style.transform = "translate3d(0, 14px, 0)";
      requestAnimationFrame(() => {
        safeAnimate(form, { opacity: 1, y: 0 }, { duration: 0.36, ease: "easeOut" });
      });
      setTimeout(() => {
        if (form.style.opacity === "0") {
          form.style.opacity = "";
          form.style.transform = "";
        }
      }, 700);
    }

    form.querySelectorAll("button[type='submit'], .button-whatsapp, .depop-hero-cta--primary, .depop-btn-accent").forEach((btn) => {
      bindTapScale(btn, { hover: 1.02, tap: 0.96 });
      if (btn.getBoundingClientRect().height < 44) {
        btn.style.minHeight = "48px";
      }
    });

    form.querySelectorAll("input, select, textarea").forEach((field) => {
      if (!markEnhanced(field, "field")) return;
      field.addEventListener(
        "focus",
        () => {
          if (prefersReducedMotion()) return;
          safeAnimate(field, { scale: 1.01 }, { duration: 0.15, ease: "easeOut" });
        },
        { passive: true }
      );
      field.addEventListener(
        "blur",
        () => {
          if (prefersReducedMotion()) return;
          safeAnimate(field, { scale: 1 }, { duration: 0.15, ease: "easeOut" });
        },
        { passive: true }
      );
    });
  });
}

export function observeForms() {
  enhanceForms();
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.("form") || node.querySelector?.("form")) enhanceForms(node);
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}
