// Fast Finger Trivia room sync. Everyone answers the same multiple-choice question on their phone;
// correct answers score 500-1000 points depending on speed, plus a streak bonus.
// Phases: lobby -> q (get-ready countdown, then answering) -> ans (reveal + scores) -> ... -> final.
// Upstash Redis via REST (plain fetch); rooms expire after a day.
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const { CATS } = require("./_trivia-bank.js");
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "trivia:";
const CODE_RE = /^[A-Z]{4}$/;
const READY_MS = 3500;       // "get ready" countdown before each question
const GRACE_MS = 600;        // network slack after the timer hits zero
const CAT_IDS = Object.keys(CATS);

async function redis(cmds) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const K = code => ({ room: P + "room:" + code, players: P + "players:" + code, answers: P + "answers:" + code, lock: P + "lock:" + code });
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Build this game's question list from the chosen categories, skipping ones this room has already seen
function buildDeck(room) {
  const cats = (room.cats && room.cats.length ? room.cats : CAT_IDS).filter(c => CATS[c]);
  const all = cats.flatMap(c => CATS[c].qs.map((_, i) => `${c}:${i}`));
  const seen = new Set(room.seen || []);
  let pool = all.filter(id => !seen.has(id));
  if (pool.length < room.count) { room.seen = (room.seen || []).filter(id => !all.includes(id)); pool = all.slice(); }
  return shuffle(pool).slice(0, Math.min(room.count, pool.length));
}
function loadQuestion(room) {
  const id = room.deck[room.qi];
  const [c, i] = id.split(":");
  const [text, right, ...wrong] = CATS[c].qs[+i];
  const choices = shuffle([right, ...wrong]);
  room.cur = { id, cat: CATS[c].name, text, choices, correct: choices.indexOf(right) };
  room.qAt = Date.now() + READY_MS;
  room.qEnd = room.qAt + room.secs * 1000;
  room.phase = "q";
  room.seen = [...(room.seen || []), id].slice(-400);
}

async function loadRaw(code) {
  const k = K(code);
  const [room, players, answers] = await redis([["GET", k.room], ["HGETALL", k.players], ["HGETALL", k.answers]]);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { const j = parse(v); if (j) pl.push({ id, name: j.name, t: j.t }); }
  pl.sort((a, b) => a.t - b.t);
  const ans = {};
  for (const [id, v] of Object.entries(pairs(answers))) { const j = parse(v); if (j) ans[id] = j; }
  return { room: JSON.parse(room), players: pl, answers: ans };
}

// Close the current question once (time's up or everyone answered) and score it
async function maybeClose(raw, force) {
  const { room, players, answers } = raw;
  if (room.phase !== "q") return false;
  const now = Date.now();
  const everyone = players.length > 0 && players.every(p => answers[p.id] && answers[p.id].q === room.qi);
  if (!force && !everyone && now < room.qEnd + GRACE_MS) return false;
  const k = K(room.code);
  const [got] = await redis([["SET", `${k.lock}:${room.game}:${room.qi}`, "1", "NX", "EX", 600]]);
  if (got !== "OK") return false;
  const res = {}, counts = [0, 0, 0, 0];
  room.scores = room.scores || {}; room.streaks = room.streaks || {};
  for (const p of players) {
    const a = answers[p.id];
    if (!a || a.q !== room.qi) { room.streaks[p.id] = 0; res[p.id] = { c: -1, ok: false, pts: 0 }; continue; }
    counts[a.c] = (counts[a.c] || 0) + 1;
    const ok = a.c === room.cur.correct;
    let pts = 0;
    if (ok) {
      const frac = Math.min(1, Math.max(0, a.ms / (room.secs * 1000)));
      pts = Math.round((1000 - 500 * frac) / 10) * 10;
      room.streaks[p.id] = (room.streaks[p.id] || 0) + 1;
      pts += Math.min(300, (room.streaks[p.id] - 1) * 100);
    } else room.streaks[p.id] = 0;
    room.scores[p.id] = (room.scores[p.id] || 0) + pts;
    res[p.id] = { c: a.c, ok, pts, ms: a.ms, streak: room.streaks[p.id] };
  }
  const fastest = Object.entries(res).filter(([, r]) => r.ok).sort((x, y) => x[1].ms - y[1].ms)[0];
  room.result = { res, counts, fastest: fastest ? fastest[0] : null };
  room.phase = "ans";
  await redis([["SET", k.room, JSON.stringify(room), "EX", TTL]]);
  return true;
}

function view(raw, me) {
  const { room, players, answers } = raw;
  const out = {
    room: { code: room.code, hostId: room.hostId, phase: room.phase, game: room.game || 0, qi: room.qi, total: (room.deck || []).length,
            secs: room.secs, count: room.count, cats: room.cats || [], scores: room.scores || {}, streaks: room.streaks || {}, prevRanks: room.prevRanks || {} },
    players: players.map(p => ({ id: p.id, name: p.name, answered: !!(answers[p.id] && answers[p.id].q === room.qi && room.phase === "q") })),
    catList: CAT_IDS.map(id => ({ id, name: CATS[id].name, n: CATS[id].qs.length })),
  };
  if (room.phase === "q" || room.phase === "ans") {
    out.q = { text: room.cur.text, cat: room.cur.cat, choices: room.cur.choices, qAt: room.qAt, qEnd: room.qEnd };
    const mine = answers[me];
    out.myAnswer = mine && mine.q === room.qi ? mine.c : -1;
  }
  if (room.phase === "ans") { out.q.correct = room.cur.correct; out.result = room.result; }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const send = (status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ...body, now: Date.now() })); };
  if (!URL_ || !TOKEN) return send(500, { error: "The game server isn't set up yet (no database connected)." });

  try {
    if (req.method === "GET") {
      const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
      const code = String(q.code || "").toUpperCase(), me = cleanId(q.pid);
      if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
      let raw = await loadRaw(code);
      if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
      if (await maybeClose(raw)) raw = await loadRaw(code);
      return send(200, view(raw, me));
    }
    if (req.method !== "POST") return send(405, { error: "Method not allowed" });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== "object") {
      const rawBody = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
      try { body = JSON.parse(rawBody || "{}"); } catch (e) { body = {}; }
    }
    const action = body.action, pid = cleanId(body.pid);
    if (!pid) return send(400, { error: "Missing player id." });

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      const want = CODE_RE.test(String(body.want || "").toUpperCase()) ? String(body.want).toUpperCase() : "";
      for (let tries = 0; tries < (want ? 1 : 8); tries++) {
        let code = ""; for (let i = 0; i < 4; i++) code += L[Math.floor(Math.random() * L.length)];
        if (want) code = want;
        const room = { code, hostId: pid, phase: "lobby", game: 0, qi: 0, deck: [], cur: null, secs: 20, count: 15, cats: [], scores: {}, streaks: {}, seen: [] };
        const k = K(code);
        const [ok] = await redis([["SET", k.room, JSON.stringify(room), "NX", "EX", TTL]]);
        if (ok !== "OK") {
          if (!want) continue;
          const ex = await loadRaw(want);   // party mode: this party's trivia room already exists
          if (!ex) continue;
          if (ex.room.hostId !== pid) return send(409, { error: "That party code is already in use by another game. Start a new party." });
          return send(200, view(ex, pid));
        }
        await redis([["HSET", k.players, pid, JSON.stringify({ name, t: Date.now() })], ["EXPIRE", k.players, TTL]]);
        return send(200, view(await loadRaw(code), pid));
      }
      return send(500, { error: "Couldn't make a room code. Try again." });
    }

    const code = String(body.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
    let raw = await loadRaw(code);
    if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
    const { room } = raw, k = K(code);
    const isHost = pid === room.hostId;
    const inRoom = raw.players.some(p => p.id === pid);
    const touch = [["EXPIRE", k.players, TTL], ["EXPIRE", k.answers, TTL]];
    const saveRoom = () => redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ...touch]);
    const rankMap = () => { const r = {}; Object.entries(room.scores || {}).sort((a, b) => b[1] - a[1]).forEach(([id], i) => r[id] = i + 1); return r; };

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const existing = raw.players.find(p => p.id === pid);
      const taken = raw.players.find(p => p.id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (taken) return send(409, { error: `Someone named ${taken.name} is already in. Add a last initial.` });
      await redis([["HSET", k.players, pid, JSON.stringify({ name, t: existing ? existing.t : Date.now() })], ...touch]);
    } else if (action === "leave") {
      if (!isHost) await redis([["HDEL", k.players, pid], ["HDEL", k.answers, pid]]);
    } else if (action === "answer") {
      if (!inRoom) return send(403, { error: "Join the game first." });
      if (room.phase !== "q") return send(400, { error: "Too late! This question is closed." });
      const now = Date.now();
      if (now < room.qAt - 300) return send(400, { error: "Wait for the question to appear." });
      if (now > room.qEnd + GRACE_MS) return send(400, { error: "Time's up!" });
      const c = +body.c;
      if (![0, 1, 2, 3].includes(c) || +body.qi !== room.qi) return send(400, { error: "That answer didn't count. Try again." });
      const prev = raw.answers[pid];
      if (prev && prev.q === room.qi) return send(200, view(raw, pid));   // answers lock in
      const ms = Math.max(0, now - room.qAt);
      await redis([["HSET", k.answers, pid, JSON.stringify({ q: room.qi, c, ms })], ...touch]);
      raw = await loadRaw(code);
      if (await maybeClose(raw)) raw = await loadRaw(code);
      return send(200, view(raw, pid));
    } else {
      if (!isHost) return send(403, { error: "Only the host can do that." });
      if (action === "kick") {
        const who = cleanId(body.who);
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who], ["HDEL", k.answers, who]]);
      } else if (action === "settings") {
        if (room.phase !== "lobby") return send(400, { error: "Change settings in the lobby." });
        if ([10, 15, 20].includes(+body.count)) room.count = +body.count;
        if ([10, 15, 20, 30].includes(+body.secs)) room.secs = +body.secs;
        if (Array.isArray(body.cats)) room.cats = body.cats.map(String).filter(c => CATS[c]);
        await saveRoom();
      } else if (action === "start") {
        if (raw.players.length < 2) return send(400, { error: "You need at least 2 players." });
        if ([10, 15, 20].includes(+body.count)) room.count = +body.count;
        if ([10, 15, 20, 30].includes(+body.secs)) room.secs = +body.secs;
        if (Array.isArray(body.cats)) room.cats = body.cats.map(String).filter(c => CATS[c]);
        room.game = (room.game || 0) + 1; room.scores = {}; room.streaks = {}; room.prevRanks = {}; room.result = null;
        raw.players.forEach(p => room.scores[p.id] = 0);
        room.deck = buildDeck(room); room.qi = 0;
        if (!room.deck.length) return send(400, { error: "Pick at least one category." });
        loadQuestion(room);
        await redis([["DEL", k.answers]]); await saveRoom();
      } else if (action === "close") {
        // host ends the question early (someone's away from their phone)
        if (room.phase !== "q") return send(400, { error: "No question is open." });
        if (await maybeClose(raw, true)) raw = await loadRaw(code);
        return send(200, view(raw, pid));
      } else if (action === "next") {
        if (room.phase !== "ans") return send(400, { error: "Finish this question first." });
        if (+body.qi !== room.qi && body.qi !== undefined) return send(200, view(raw, pid));   // double tap
        room.prevRanks = rankMap();
        for (const p of raw.players) if (!(p.id in room.scores)) room.scores[p.id] = 0;
        if (room.qi >= room.deck.length - 1) room.phase = "final";
        else { room.qi++; loadQuestion(room); }
        await saveRoom();
      } else if (action === "end") {
        room.phase = "final"; await saveRoom();
      } else if (action === "lobby") {
        room.phase = "lobby"; room.result = null; await redis([["DEL", k.answers]]); await saveRoom();
      } else {
        return send(400, { error: "Unknown action." });
      }
    }
    return send(200, view(await loadRaw(code), pid));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
