// Party mode glue, loaded by every game page and TV page before the game's own script.
// When the URL carries ?party=CODE it sets window.PARTY, seeds the game's saved identity,
// shows a slim party bar (host gets "Switch game"), and follows the host to whatever game is picked.
(function () {
  const KEY = "party-v1";
  const OKEYS = { chameleon: "chameleon-online-v1", thankful: "thankful-online-v1", gobble: "gobble-online-v1", scribble: "scribble-online-v1", trivia: "trivia-online-v1", insidejob: "insidejob-online-v1" };
  const NAMES = { chameleon: "Chameleon", thankful: "Who's Thankful For That?", gobble: "Gobble Minds", scribble: "Scribble Telephone", trivia: "Fast Finger Trivia", insidejob: "Inside Job" };
  const qs = new URLSearchParams(location.search);
  const code = String(qs.get("party") || "").toUpperCase();
  const isTV = document.body.classList.contains("tv");
  const seg = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  const game = (!seg || seg === "index.html" || seg === "tv.html") ? "thankful" : seg;
  // where each game's phone page and TV page live (Thankful sits at the site root)
  const API = { thankful: "/api/room", gobble: "/api/gobble", scribble: "/api/scribble", chameleon: "/api/chameleon", trivia: "/api/trivia", insidejob: "/api/insidejob" };
  // each game's own Leave buttons; in party mode they leave the whole party instead
  const LEAVE_IDS = ["lLeave", "dLeave", "rLeave", "aLeave", "fLeave", "lbLeave", "leave", "vLeave", "lgLeave"];
  const PHONE = g => g === "thankful" ? "/" : `/${g}/`;
  const TVP = g => g === "thankful" ? "/tv.html" : `/${g}/tv.html`;
  // games with no TV page of their own: the party TV screen shows "Now playing" instead
  const NO_TV = ["chameleon", "insidejob"];
  window.PARTY = null;
  if (!/^[A-Z]{4}$/.test(code) || !OKEYS[game]) return;

  let me = null;
  try { me = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (!isTV && (!me || me.code !== code)) {
    // No identity for this party on this phone: send them to the party page to join first
    location.replace(`/party/?code=${code}`); return;
  }
  window.PARTY = isTV ? { code, tv: true, game } : { code, pid: me.pid, name: me.name, host: me.hostId === me.pid, game };
  if (!isTV) { try { localStorage.setItem(OKEYS[game], JSON.stringify({ pid: me.pid, name: me.name, code: "" })); } catch (e) {} }
  // stop this device from rejoining the party (keeps the name for next time)
  const forget = () => { try { const m = JSON.parse(localStorage.getItem(KEY) || "{}"); m.code = ""; m.hostId = ""; localStorage.setItem(KEY, JSON.stringify(m)); localStorage.setItem(OKEYS[game], JSON.stringify({ pid: me && me.pid, name: me && me.name, code: "" })); } catch (e) {} };

  // ---------- the party bar
  const css = document.createElement("style");
  css.textContent = `
  .pbar{display:flex;align-items:center;gap:10px;max-width:460px;margin:0 auto 14px;padding:8px 8px 8px 14px;background:#fffcf7;border:1px solid rgba(43,36,32,.13);border-radius:999px;box-shadow:0 1px 2px rgba(60,40,20,.08);font:500 14px Figtree,system-ui,sans-serif;color:#2b2420;position:relative;z-index:3}
  .pbar b{font-family:Fraunces,Georgia,serif;font-weight:600;color:#8e2638;letter-spacing:.12em}
  .pbar .pwho{flex:1;color:#7a6b5d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pbar .pq{background:transparent;color:#2b2420;border:1px solid rgba(43,36,32,.18)}
  .pbar button,.pbar a{flex:none;border:0;border-radius:999px;background:#2f4a3a;color:#fbf6ec;font:600 14px Figtree,system-ui,sans-serif;padding:9px 14px;cursor:pointer;text-decoration:none;min-height:38px;display:inline-flex;align-items:center}
  .pbar.tvbar{position:fixed;left:24px;bottom:20px;margin:0;max-width:none;font-size:18px;padding:10px 20px;z-index:30}
  .pscrim{position:fixed;inset:0;z-index:50;display:none;align-items:flex-end;justify-content:center;background:rgba(43,36,32,.45);padding:16px}
  .pscrim.open{display:flex}
  .pdlg{position:relative;width:100%;max-width:460px;background:#fffcf7;border:1px solid rgba(43,36,32,.13);border-radius:16px;padding:22px 20px;box-shadow:0 18px 36px -22px rgba(60,40,20,.5);font-family:Figtree,system-ui,sans-serif;color:#2b2420}
  .pdlg::after{content:"";position:absolute;inset:6px;border:1px solid #e6d6b0;border-radius:11px;pointer-events:none}
  .pdlg h2{margin:0 0 8px;font:600 26px Fraunces,Georgia,serif}
  .pdlg p{margin:0 0 16px;color:#7a6b5d}
  .pdlg .b{position:relative;z-index:1;display:block;width:100%;border:1px solid transparent;border-radius:12px;padding:15px;font:600 17px Figtree,system-ui,sans-serif;cursor:pointer;margin-top:10px}
  .pdlg .go{background:#2f4a3a;color:#fbf6ec}.pdlg .hot{background:#8e2638;color:#fbf6ec}.pdlg .q{background:transparent;border-color:rgba(43,36,32,.13);color:#2b2420;font-weight:500}`;
  document.head.appendChild(css);

  const bar = document.createElement("div");
  bar.className = "pbar" + (isTV ? " tvbar" : "");
  bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Party");
  if (isTV) bar.innerHTML = `<span>Party <b>${code}</b></span><span class="pwho">Playing ${NAMES[game]}</span>`;
  else if (window.PARTY.host) bar.innerHTML = `<span>Party <b>${code}</b></span><span class="pwho">You're the host</span><button type="button" id="pSwitch">Switch game</button><button type="button" class="pq" id="pLeave">End</button>`;
  else bar.innerHTML = `<span>Party <b>${code}</b></span><span class="pwho">The host picks the games</span><button type="button" class="pq" id="pLeave">Leave</button>`;
  const wrap = document.querySelector(".wrap");
  if (!isTV && wrap) wrap.parentNode.insertBefore(bar, wrap); else document.body.appendChild(bar);

  if (!isTV && window.PARTY.host) {
    const sc = document.createElement("div");
    sc.className = "pscrim";
    sc.innerHTML = `<div class="pdlg" role="dialog" aria-modal="true" aria-labelledby="pT"><h2 id="pT">Switch games?</h2><p>Everyone goes back to the party lobby, still connected, and you pick the next game.</p><button class="b go" type="button" id="pYes">Back to the party lobby</button><button class="b q" type="button" id="pNo">Keep playing</button></div>`;
    document.body.appendChild(sc);
    document.getElementById("pSwitch").onclick = () => { sc.classList.add("open"); document.getElementById("pYes").focus(); };
    document.getElementById("pNo").onclick = () => sc.classList.remove("open");
    sc.addEventListener("click", e => { if (e.target === sc) sc.classList.remove("open"); });
    document.getElementById("pYes").onclick = async () => {
      document.getElementById("pYes").textContent = "Switching…";
      try {
        await fetch("/api/party", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "game", pid: me.pid, code, game: "" }) });
      } catch (e) {}
      location.href = `/party/?code=${code}`;
    };
  }

  // ---------- leaving (guests) and ending (host)
  if (!isTV) {
    const host = window.PARTY.host;
    const ls = document.createElement("div");
    ls.className = "pscrim";
    ls.innerHTML = host
      ? `<div class="pdlg" role="dialog" aria-modal="true" aria-labelledby="pLT"><h2 id="pLT">End the game night?</h2><p>Everyone's phone goes back to the start screen, and party ${code} closes. You can host a new one anytime.</p><button class="b hot" type="button" id="pLYes">End it for everyone</button><button class="b q" type="button" id="pLNo">Keep playing</button></div>`
      : `<div class="pdlg" role="dialog" aria-modal="true" aria-labelledby="pLT"><h2 id="pLT">Leave the game night?</h2><p>Your phone stops following party ${code}. You can rejoin anytime with the code.</p><button class="b hot" type="button" id="pLYes">Leave</button><button class="b q" type="button" id="pLNo">Stay</button></div>`;
    document.body.appendChild(ls);
    const open = () => { ls.classList.add("open"); document.getElementById("pLYes").focus(); };
    document.getElementById("pLeave").onclick = open;
    document.getElementById("pLNo").onclick = () => ls.classList.remove("open");
    ls.addEventListener("click", e => { if (e.target === ls) ls.classList.remove("open"); });
    // the game's own Leave buttons would only leave the game and get pulled back in, so route them here
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("button");
      if (b && LEAVE_IDS.includes(b.id)) { e.preventDefault(); e.stopImmediatePropagation(); open(); }
    }, true);
    const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    document.getElementById("pLYes").onclick = async () => {
      document.getElementById("pLYes").textContent = host ? "Ending…" : "Leaving…";
      if (host) await post("/api/party", { action: "end", pid: me.pid, code });
      else await Promise.all([post("/api/party", { action: "leave", pid: me.pid, code }), post(API[game], { action: "leave", pid: me.pid, code })]);
      forget(); location.href = "/party/";
    };
  }

  // ---------- follow the host
  async function check() {
    try {
      const r = await fetch(`/api/party?code=${code}`, { cache: "no-store" });
      if (r.status === 404) { if (isTV) location.href = "/party/tv.html"; else { forget(); location.href = "/party/?ended=1"; } return; }
      if (!r.ok) return;
      const j = await r.json();
      if (!isTV && !j.players.some(p => p.id === me.pid)) { location.href = `/party/?code=${code}`; return; }
      const g = j.room.game || "";
      if (g === game) return;
      if (!g) location.href = isTV ? `/party/tv.html?code=${code}` : `/party/?code=${code}`;
      else if (isTV) location.href = NO_TV.includes(g) ? `/party/tv.html?code=${code}` : `${TVP(g)}?code=${code}&party=${code}`;
      else location.href = `${PHONE(g)}?party=${code}`;
    } catch (e) {}
  }
  setInterval(check, 2500);
})();
