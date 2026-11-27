// "Invite" button for every game's phone page. Once you're in a room (or a party), a small Invite pill
// appears at the top of the screen on every step of the game. Tapping it shows a big QR code, the code
// and the link, so latecomers can join without the host going back to the lobby.
(function () {
  const OKEYS = { chameleon: "chameleon-online-v1", thankful: "thankful-online-v1", gobble: "gobble-online-v1", scribble: "scribble-online-v1", trivia: "trivia-online-v1", insidejob: "insidejob-online-v1" };
  const seg = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  const game = (!seg || seg === "index.html") ? "thankful" : seg;
  if (!OKEYS[game] || document.body.classList.contains("tv")) return;
  const PHONE = g => g === "thankful" ? "/" : `/${g}/`;

  const css = document.createElement("style");
  css.textContent = `
  .inv{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(43,36,32,.18);background:#fffcf7;color:#2b2420;border-radius:999px;padding:7px 12px;font:600 14px Figtree,system-ui,sans-serif;cursor:pointer;min-height:36px;box-shadow:0 1px 2px rgba(60,40,20,.08)}
  .inv[hidden]{display:none!important}
  .bar .inv{margin-left:auto;margin-right:8px}
  .inv svg{width:16px!important;height:16px;margin:0!important;flex:none}
  .hero .inv + svg{margin-left:0!important}
  .iscrim{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(43,36,32,.5);padding:16px}
  .iscrim.open{display:flex}
  .idlg{position:relative;width:100%;max-width:400px;background:#fffcf7;border:1px solid rgba(43,36,32,.13);border-radius:18px;padding:24px 20px 18px;text-align:center;box-shadow:0 18px 36px -22px rgba(60,40,20,.5);font-family:Figtree,system-ui,sans-serif;color:#2b2420}
  .idlg::after{content:"";position:absolute;inset:6px;border:1px solid #e6d6b0;border-radius:13px;pointer-events:none}
  .idlg>*{position:relative;z-index:1}
  .idlg h2{margin:0;font:600 26px Fraunces,Georgia,serif}
  .idlg p{margin:4px 0 14px;color:#7a6b5d}
  .idlg .iqr{background:#fff;border:1px solid rgba(43,36,32,.13);border-radius:14px;padding:14px;display:inline-block}
  .idlg .iqr svg{display:block;width:min(240px,62vw);height:auto}
  .idlg .icode{font:600 44px Fraunces,Georgia,serif;letter-spacing:.18em;color:#8e2638;margin:10px 0 0;line-height:1}
  .idlg .iurl{font-weight:600;overflow-wrap:anywhere;margin:8px 0 14px;font-size:15px}
  .idlg .ib{display:block;width:100%;border:1px solid transparent;border-radius:12px;padding:14px;font:600 16px Figtree,system-ui,sans-serif;cursor:pointer;margin-top:8px}
  .idlg .ig{background:#2f4a3a;color:#fbf6ec}.idlg .iq{background:transparent;border-color:rgba(43,36,32,.15);color:#2b2420;font-weight:500}`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "inv"; btn.hidden = true;
  btn.setAttribute("aria-haspopup", "dialog");
  btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 9.5h2v2M14.5 9.5v5h-5v-2M12 12.5h.5"/></svg>Invite`;
  // live in the page header; if a game hides its header during play (Chameleon), sit in the code bar instead
  const visible = el => !!(el && el.offsetParent !== null);
  const place = () => {
    const hero = [...document.querySelectorAll(".hero")].find(visible);
    if (hero) { if (btn.parentNode !== hero) { const svg = hero.querySelector(":scope > svg"); svg ? hero.insertBefore(btn, svg) : hero.appendChild(btn); } return; }
    const bar = [...document.querySelectorAll(".bar")].find(visible);
    if (bar && btn.parentNode !== bar) { const last = bar.querySelector(":scope > button:last-of-type"); last ? bar.insertBefore(btn, last) : bar.appendChild(btn); }
  };

  const sc = document.createElement("div");
  sc.className = "iscrim";
  sc.innerHTML = `<div class="idlg" role="dialog" aria-modal="true" aria-labelledby="iT"><h2 id="iT">Scan to join</h2><p id="iP">Point a phone camera at the code.</p><div class="iqr" id="iQr"></div><div class="icode" id="iCode"></div><div class="iurl" id="iUrl"></div><button class="ib ig" type="button" id="iCopy">Copy link</button><button class="ib iq" type="button" id="iClose">Close</button></div>`;
  document.body.appendChild(sc);
  const $ = id => document.getElementById(id);

  const current = () => {
    if (window.PARTY && window.PARTY.code) return { code: window.PARTY.code, url: `${location.origin}/party/?code=${window.PARTY.code}`, party: true };
    try { const o = JSON.parse(localStorage.getItem(OKEYS[game]) || "{}"); if (/^[A-Z]{4}$/.test(o.code || "")) return { code: o.code, url: `${location.origin}${PHONE(game)}?code=${o.code}` }; } catch (e) {}
    return null;
  };
  let lib = null;
  const loadQR = () => lib || (lib = window.qrcode ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  }));
  btn.onclick = async () => {
    const c = current(); if (!c) return;
    $("iCode").textContent = c.code; $("iUrl").textContent = c.url.replace(/^https?:\/\//, "");
    $("iP").textContent = c.party ? "Point a phone camera at the code to join the game night." : "Point a phone camera at the code to join this game.";
    $("iQr").innerHTML = "";
    sc.classList.add("open"); $("iClose").focus();
    try { await loadQR(); const q = qrcode(0, "M"); q.addData(c.url); q.make(); $("iQr").innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); }
    catch (e) { $("iQr").innerHTML = "<p style='margin:0;padding:16px'>The QR code couldn't load. Share the code or link below.</p>"; }
  };
  $("iClose").onclick = () => sc.classList.remove("open");
  sc.addEventListener("click", e => { if (e.target === sc) sc.classList.remove("open"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") sc.classList.remove("open"); });
  $("iCopy").onclick = async () => {
    const c = current(); if (!c) return;
    try { await navigator.clipboard.writeText(c.url); $("iCopy").textContent = "Copied!"; } catch (e) { $("iCopy").textContent = "Couldn't copy. Share the code instead"; }
    setTimeout(() => $("iCopy").textContent = "Copy link", 1800);
  };
  // show the pill only while this phone is actually in a room
  const sync = () => { btn.hidden = !current(); if (!btn.hidden) place(); };
  sync(); setInterval(sync, 1000);
})();
