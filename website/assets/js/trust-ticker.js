/**
 * One line of recent escrow activity. The text is set as text, not HTML.
 */
(function () {
  var slot = document.getElementById("trust-ticker");
  if (!slot) return;
  var base =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001"
      : "https://bot.sokonimall.com";
  var items = [];
  var index = 0;

  function show() {
    if (!items.length) {
      slot.hidden = true;
      slot.textContent = "";
      return;
    }
    var row = items[index % items.length];
    var ago = Math.max(1, Math.round((Date.now() - Number(row.at)) / 60000));
    var when = ago < 60 ? ago + " min ago" : Math.round(ago / 60) + "h ago";
    slot.hidden = false;
    slot.textContent = row.text + " · " + when;
    index += 1;
  }

  fetch(base + "/api/trust/ticker")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      items = (data && data.items) || [];
      show();
      if (items.length > 1) setInterval(show, 8000);
    })
    .catch(function () {});
})();
