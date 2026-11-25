// Festive layer for Who's Thankful For That?: pennant bunting, a faint leaf pattern,
// slowly falling leaves, and window.leafBurst(el) for reveal moments.
// Everything is decorative (aria-hidden, no pointer events) and calms down under prefers-reduced-motion.
(function () {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTV = document.body.classList.contains("tv");
  const COLORS = ["#c2334a", "#ffd447", "#a8622c", "#7a8b2e", "#e8742a", "#fffdf6"];
  const LEAF = "M20 2 23 10 30 7 28 15 37 15 31 21 35 26 26 25 24 32 21 28 21 38 19 38 19 28 16 32 14 25 5 26 9 21 3 15 12 15 10 7 17 10Z";
  const OAK = "M20 3c3 0 3 4 2 6 3-2 7-1 6 3-1 2-3 2-4 3 3 0 6 2 4 5-1 2-4 1-5 1 2 2 2 6-1 6-2 0-2-2-2-3v13h-2V24c0 1 0 3-2 3-3 0-3-4-1-6-1 0-4 1-5-1-2-3 1-5 4-5-1-1-3-1-4-3-1-4 3-5 6-3-1-2-1-6 2-6z";
  const leafSvg = (color, shape) =>
    `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${shape || LEAF}" fill="${color}" stroke="#3a1d12" stroke-width="2" stroke-linejoin="round"/></svg>`;

  // Faint leaf wallpaper
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
    <g fill="#fffdf6" opacity=".9">
      <path transform="translate(18 22) rotate(-18 20 20)" d="${LEAF}"/>
      <path transform="translate(140 40) rotate(24 20 20) scale(.8)" d="${OAK}"/>
      <path transform="translate(80 120) rotate(8 20 20) scale(.9)" d="${LEAF}"/>
      <path transform="translate(170 160) rotate(-30 20 20) scale(.7)" d="${LEAF}"/>
      <path transform="translate(20 165) rotate(40 20 20) scale(.75)" d="${OAK}"/>
    </g></svg>`;
  const pat = document.createElement("div");
  pat.className = "fx-pattern"; pat.setAttribute("aria-hidden", "true");
  pat.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(tile)}")`;
  document.body.prepend(pat);

  // Pennant bunting across the top
  const bunt = document.createElement("div");
  bunt.className = "fx-bunting"; bunt.setAttribute("aria-hidden", "true");
  document.body.prepend(bunt);
  const BUNT = ["#c2334a", "#ffd447", "#7a8b2e", "#fffdf6", "#a8622c"];
  function fillBunting() {
    const w = window.innerWidth, step = isTV ? 64 : 40, n = Math.max(6, Math.ceil(w / step));
    bunt.innerHTML = Array.from({ length: n }, (_, i) => `<i style="background:${BUNT[i % BUNT.length]};transform:rotate(${(i % 2 ? 4 : -4)}deg)"></i>`).join("");
  }
  fillBunting();
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fillBunting, 150); });

  // Slowly falling leaves
  if (!reduce) {
    const layer = document.createElement("div");
    layer.className = "fx-leaves"; layer.setAttribute("aria-hidden", "true");
    const count = isTV ? 14 : 7;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      const size = (isTV ? 34 : 22) + Math.random() * (isTV ? 30 : 16);
      el.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${14 + Math.random() * 14}s,${3 + Math.random() * 3}s;animation-delay:${-Math.random() * 28}s,${-Math.random() * 3}s;opacity:${.55 + Math.random() * .35}`;
      el.innerHTML = leafSvg(COLORS[i % 5], i % 3 === 0 ? OAK : LEAF);
      layer.appendChild(el);
    }
    document.body.prepend(layer);
  }

  // Burst of leaves from an element (used when an author is revealed)
  window.leafBurst = function (target, amount) {
    if (reduce || !target || !target.getBoundingClientRect) return;
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const n = amount || (isTV ? 40 : 22), big = isTV ? 1.6 : 1;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.className = "fx-burst";
      const size = (16 + Math.random() * 18) * big;
      el.style.cssText = `left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px`;
      el.innerHTML = leafSvg(COLORS[i % COLORS.length], i % 3 ? LEAF : OAK);
      document.body.appendChild(el);
      const ang = (Math.PI * 2 * i) / n + Math.random() * .5, dist = (90 + Math.random() * 160) * big;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * .7 - 60 * big;
      const spin = (Math.random() * 720 - 360) | 0;
      el.animate([
        { transform: "translate(0,0) rotate(0deg) scale(.4)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: .45 },
        { transform: `translate(${dx * 1.15}px,${dy + 260 * big}px) rotate(${spin}deg) scale(.9)`, opacity: 0 }
      ], { duration: 1600 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => el.remove();
    }
  };
})();
