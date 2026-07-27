/**
 * Lightweight 3D tilt — desktop only, hero phone + preview stack.
 */
(function () {
  const stack = document.getElementById("hero-3d-stack");
  const wrap = document.getElementById("hero-phone-3d");
  if (!stack || !wrap) return;

  let raf = null;
  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;
  let idlePhase = 0;

  function onMove(e) {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    targetY = Math.max(-14, Math.min(14, dx * 18));
    targetX = Math.max(-10, Math.min(10, -dy * 14));
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    idlePhase += 0.012;
    const floatY = Math.sin(idlePhase) * 1.2;
    curX += (targetX - curX) * 0.09;
    curY += (targetY - curY) * 0.09;
    stack.style.transform =
      `rotateX(${curX + floatY * 0.15}deg) rotateY(${curY}deg) translateZ(12px) translateY(${floatY}px)`;
    if (Math.abs(targetX - curX) > 0.04 || Math.abs(targetY - curY) > 0.04 || Math.abs(floatY) > 0.1) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function onLeave() {
    targetX = 0;
    targetY = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  wrap.addEventListener("mousemove", onMove);
  wrap.addEventListener("mouseleave", onLeave);
  raf = requestAnimationFrame(tick);
})();
