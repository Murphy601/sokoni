/**
 * Reusable map-pin field for onboarding forms.
 *
 * Mount it on a container carrying data-pin-field, with data-lat-input and
 * data-lng-input naming the hidden inputs it writes to. Two ways to set a pin:
 * the browser's own location, or tapping the map.
 *
 * Nothing here is required. A form must still submit without a pin — the
 * backend treats a missing one as "not set" and falls back, and blocking a
 * rider or seller from signing up because a map failed to load would be worse
 * than having no pin at all.
 */
(function () {
  "use strict";

  var KE = { minLat: -4.8, maxLat: 5.1, minLng: 33.8, maxLng: 41.95 };

  function inKenya(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    return lat >= KE.minLat && lat <= KE.maxLat && lng >= KE.minLng && lng <= KE.maxLng;
  }

  function round6(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  function init(root) {
    var latInput = document.querySelector(root.dataset.latInput);
    var lngInput = document.querySelector(root.dataset.lngInput);
    if (!latInput || !lngInput) return;

    var status = root.querySelector("[data-pin-status]");
    var useBtn = root.querySelector("[data-pin-use]");
    var clearBtn = root.querySelector("[data-pin-clear]");
    var mapEl = root.querySelector("[data-pin-map]");
    var map = null;
    var marker = null;

    function say(msg, tone) {
      if (!status) return;
      status.textContent = msg;
      status.dataset.tone = tone || "";
    }

    function set(lat, lng, label) {
      if (!inKenya(lat, lng)) {
        say("That does not look like a location in Kenya. Try tapping the map.", "warn");
        return;
      }
      latInput.value = String(round6(lat));
      lngInput.value = String(round6(lng));
      say(label || "Pin set — tap the map to move it.", "ok");
      if (clearBtn) clearBtn.hidden = false;
      if (map && window.L) {
        var ll = [lat, lng];
        if (marker) marker.setLatLng(ll);
        else marker = window.L.marker(ll).addTo(map);
        map.setView(ll, 16);
      }
    }

    function clear() {
      latInput.value = "";
      lngInput.value = "";
      if (marker && map) {
        map.removeLayer(marker);
        marker = null;
      }
      if (clearBtn) clearBtn.hidden = true;
      say("No pin set. You can add one later.", "");
    }

    function ensureMap() {
      if (map || !mapEl || !window.L) return;
      map = window.L.map(mapEl).setView([-1.2864, 36.8172], 12);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      map.on("click", function (e) {
        set(e.latlng.lat, e.latlng.lng);
      });
      // The field can sit inside a section that is still display:none -- the
      // seller form is hidden until the phone is verified -- so the container
      // may have no size at all when the map is built. Fixed timers cannot
      // know when that changes; watch the box instead and re-measure the
      // moment it gets one.
      var settle = function () {
        map.invalidateSize();
      };
      [0, 150, 400].forEach(function (ms) {
        setTimeout(settle, ms);
      });
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function (entries) {
          var box = entries[0] && entries[0].contentRect;
          if (box && box.width > 0 && box.height > 0) settle();
        });
        ro.observe(mapEl);
      }
    }

    if (useBtn) {
      useBtn.addEventListener("click", function () {
        if (!navigator.geolocation) {
          say("This browser cannot share a location. Tap the map instead.", "warn");
          ensureMap();
          return;
        }
        say("Getting your location…", "");
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            ensureMap();
            set(pos.coords.latitude, pos.coords.longitude, "Pin set from your device.");
          },
          function () {
            // Denied or timed out. The map is the fallback, not a dead end.
            say("Could not read your location. Tap the map to place the pin.", "warn");
            ensureMap();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    }
    if (clearBtn) {
      clearBtn.hidden = !latInput.value;
      clearBtn.addEventListener("click", clear);
    }
    if (mapEl) {
      // Only build the map once someone wants it — it pulls tiles.
      var opener = root.querySelector("[data-pin-open-map]");
      if (opener) {
        opener.addEventListener("click", function () {
          mapEl.hidden = false;
          ensureMap();
        });
      } else {
        ensureMap();
      }
    }
    if (latInput.value && lngInput.value) {
      set(Number(latInput.value), Number(lngInput.value), "Saved pin.");
    }
  }

  function boot() {
    document.querySelectorAll("[data-pin-field]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
