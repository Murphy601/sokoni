(function () {
  const API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://127.0.0.1:3001/api/agent"
      : "https://bot.sokonimall.com/api/agent";

  const WHATSAPP = "254117422428";
  const form = document.getElementById("ask-form");
  const input = document.getElementById("ask-input");
  const log = document.getElementById("chat-log");
  let sessionId = sessionStorage.getItem("sokoni-ai-session") || "";

  function bubble(text, role) {
    const wrap = document.createElement("div");
    wrap.className = role === "user" ? "flex justify-end" : "flex justify-start";
    const b = document.createElement("div");
    b.className =
      role === "user"
        ? "ask-bubble ask-bubble--user"
        : "ask-bubble ask-bubble--bot";
    b.textContent = text;
    wrap.appendChild(b);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function renderProducts(products) {
    if (!products?.length) return;
    const wrap = document.createElement("div");
    wrap.className = "flex justify-start";
    const box = document.createElement("div");
    box.className = "max-w-[95%] space-y-2";
    products.slice(0, 3).forEach((p) => {
      const card = document.createElement("div");
      card.className = "ask-product-card";
      const waText = encodeURIComponent(`Hi Sokoni, I want ${p.name} (${p.id})`);
      card.innerHTML = `<div><strong class="text-white">${p.name}</strong><br><span class="text-zinc-400">KES ${Number(p.priceKes).toLocaleString()}${p.isSecondhand ? " · pre-loved" : ""}</span></div>`;
      const a = document.createElement("a");
      a.href = `https://wa.me/${WHATSAPP}?text=${waText}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "ask-product-order";
      a.textContent = "Order";
      card.appendChild(a);
      box.appendChild(card);
    });
    wrap.appendChild(box);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  async function sendMessage(text) {
    bubble(text, "user");
    input.value = "";
    input.disabled = true;

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sessionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Request failed");

      if (data.sessionId) {
        sessionId = data.sessionId;
        sessionStorage.setItem("sokoni-ai-session", sessionId);
      }

      if (data.reply) bubble(data.reply, "assistant");
      renderProducts(data.products);
    } catch (err) {
      bubble(err.message || "Could not reach Sokoni AI. Try WhatsApp instead.", "assistant");
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendMessage(text);
  });

  const q = new URLSearchParams(window.location.search).get("q");
  if (q) {
    input.value = q;
    sendMessage(q);
  } else {
    bubble("Poa! 👋 Unatafuta nini? Try: \"dress under 5000\" or \"SK-1042\" to track.", "assistant");
  }
})();
