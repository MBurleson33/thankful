// A gentle shower of leaves for reveal moments: window.leafBurst(el, amount).
// Decorative only (aria-hidden, no pointer events); does nothing under prefers-reduced-motion.
(function () {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTV = document.body.classList.contains("tv");
  const COLORS = ["#b08a3e", "#8e2638", "#2f4a3a", "#c9a45c", "#a8432f"];
  const LEAF = "M20 2c7 6 10 14 8 22-2 7-6 11-8 14-2-3-6-7-8-14-2-8 1-16 8-22z";
  const VEIN = "M20 6v31";
  const svg = c => `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${LEAF}" fill="${c}"/><path d="${VEIN}" stroke="rgba(255,252,247,.5)" stroke-width="1.2" fill="none"/></svg>`;

  window.leafBurst = function (target, amount) {
    if (reduce || !target || !target.getBoundingClientRect) return;
    const r = target.getBoundingClientRect();
    const n = amount || (isTV ? 28 : 16), big = isTV ? 1.7 : 1;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.className = "fx-burst";
      const size = (12 + Math.random() * 12) * big;
      const x0 = r.left + Math.random() * r.width, y0 = r.top + r.height * (0.2 + Math.random() * 0.4);
      el.style.cssText = `left:${x0 - size / 2}px;top:${y0 - size / 2}px;width:${size}px;height:${size}px`;
      el.innerHTML = svg(COLORS[i % COLORS.length]);
      document.body.appendChild(el);
      const up = -(30 + Math.random() * 70) * big, side = (Math.random() * 2 - 1) * 90 * big;
      const fall = (180 + Math.random() * 220) * big, spin = (Math.random() * 300 - 150) | 0;
      el.animate([
        { transform: "translate(0,0) rotate(0deg)", opacity: 0 },
        { transform: `translate(${side * 0.4}px,${up}px) rotate(${spin * 0.3}deg)`, opacity: .95, offset: .25 },
        { transform: `translate(${side}px,${fall}px) rotate(${spin}deg)`, opacity: 0 }
      ], { duration: 2200 + Math.random() * 900, easing: "cubic-bezier(.25,.6,.35,1)", fill: "forwards", delay: Math.random() * 180 }).onfinish = () => el.remove();
    }
  };
})();
