/**
 * Every HTML write goes through DOMPurify before it touches the page.
 * Tokens live in localStorage, so an unsanitized listing title or chat
 * string must not be able to run a script.
 */
(function () {
  if (window.__sokoniHtmlGuard) return;
  window.__sokoniHtmlGuard = true;

  var purify = window.DOMPurify;
  var sanitizing = false;
  var PURIFY_CONFIG = {
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: [
      "loading",
      "decoding",
      "playsinline",
      "muted",
      "loop",
      "poster",
      "preload",
      "controls",
      "autoplay",
      "referrerpolicy",
      "fetchpriority",
      "autocomplete",
      "inputmode",
      "enterkeyhint",
    ],
  };

  function fallbackSanitize(html) {
    var doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    doc.querySelectorAll("script,iframe,object,embed,link,meta,base").forEach(function (node) {
      node.remove();
    });
    doc.body.querySelectorAll("*").forEach(function (el) {
      Array.from(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var value = String(attr.value || "");
        if (name.indexOf("on") === 0) el.removeAttribute(attr.name);
        else if (
          (name === "href" || name === "src" || name === "xlink:href" || name === "action") &&
          /^\s*javascript:/i.test(value)
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML;
  }

  function clean(html) {
    var raw = String(html ?? "");
    if (purify && typeof purify.sanitize === "function") {
      return purify.sanitize(raw, PURIFY_CONFIG);
    }
    return fallbackSanitize(raw);
  }

  document.addEventListener(
    "error",
    function (event) {
      var img = event.target;
      if (!img || img.tagName !== "IMG") return;
      if (img.dataset.fallbackSrc && !img.dataset.fallbackUsed) {
        img.dataset.fallbackUsed = "1";
        if (img.dataset.fallbackClass) {
          var marked = img.dataset.fallbackClosest
            ? img.closest(img.dataset.fallbackClosest) || img
            : img;
          marked.classList.add(img.dataset.fallbackClass);
        }
        img.src = img.dataset.fallbackSrc;
        return;
      }
      if (img.dataset.fallbackClass) {
        var host = img.dataset.fallbackClosest
          ? img.closest(img.dataset.fallbackClosest) || img
          : img;
        host.classList.add(img.dataset.fallbackClass);
      }
      if (!img.dataset.fallbackText) return;
      var node = document.createElement(img.dataset.fallbackTag || "span");
      if (img.dataset.fallbackSpanClass) node.className = img.dataset.fallbackSpanClass;
      node.textContent = img.dataset.fallbackText;
      if (img.dataset.fallbackReplace === "parent" && img.parentElement) {
        img.parentElement.replaceChildren(node);
      } else {
        img.replaceWith(node);
      }
    },
    true
  );

  var inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  var outer = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML");
  var nativeInsert = Element.prototype.insertAdjacentHTML;

  function assign(nativeSet, el, value) {
    if (sanitizing) {
      nativeSet.call(el, value);
      return;
    }
    sanitizing = true;
    try {
      nativeSet.call(el, clean(value));
    } finally {
      sanitizing = false;
    }
  }

  if (inner && inner.set && inner.get) {
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      enumerable: inner.enumerable,
      get: function () {
        return inner.get.call(this);
      },
      set: function (value) {
        assign(inner.set, this, value);
      },
    });
  }

  if (outer && outer.set && outer.get) {
    Object.defineProperty(Element.prototype, "outerHTML", {
      configurable: true,
      enumerable: outer.enumerable,
      get: function () {
        return outer.get.call(this);
      },
      set: function (value) {
        assign(outer.set, this, value);
      },
    });
  }

  Element.prototype.insertAdjacentHTML = function (position, html) {
    if (sanitizing) return nativeInsert.call(this, position, html);
    sanitizing = true;
    try {
      nativeInsert.call(this, position, clean(html));
    } finally {
      sanitizing = false;
    }
  };
})();
