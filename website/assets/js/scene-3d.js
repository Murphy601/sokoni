/**
 * Lightweight 3D phone tilt — desktop only, hero section.
 */
(function () {
  const phone = document.getElementById("hero-mock");
  const wrap = document.getElementById("hero-phone-3d");
  if (!phone || !wrap) return;

  let raf = null;
  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;

  function onMove(e) {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    targetY = Math.max(-8, Math.min(8, dx * 12));
    targetX = Math.max(-6, Math.min(6, -dy * 10));
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    curX += (targetX - curX) * 0.08;
    curY += (targetY - curY) * 0.08;
    phone.style.transform = `rotateX(${curX}deg) rotateY(${curY}deg)`;
    if (Math.abs(targetX - curX) > 0.05 || Math.abs(targetY - curY) > 0.05) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  }

  function onLeave() {
    targetX = 0;
    targetY = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  wrap.addEventListener("mousemove", onMove);
  wrap.addEventListener("mouseleave", onLeave);
})();
