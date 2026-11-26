// Scribble Telephone room sync. Each player starts a chain ("book") with a phrase; books pass around
// the table alternating draw and guess. Then each chain's owner reveals it step by step, everyone votes
// for a favorite moment, and the author earns a point per vote. A game is 1-3 such rounds.
// Drawings are stored as compact strokes, not images. Upstash Redis via REST (plain fetch).
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "scribble:";
const CODE_RE = /^[A-Z]{4}$/;
const MAX_STROKES = 400, MAX_POINTS = 9000;

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
const K = code => ({ room: P + "room:" + code, players: P + "players:" + code, entries: P + "entries:" + code,
  votes: P + "votes:" + code, winners: P + "winners:" + code, lock: P + "tally:" + code });
const authorOf = (room, b, i) => room.order[mod(b + i, room.order.length)];
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

// Begin a fresh pass of chains with whoever is in the room now
function startRound(room, players) {
  room.order = players.map(p => p.id);
  const n = room.order.length;
  room.rounds = Math.max(3, Math.min(n, [4, 6, 8].includes(room.cap) ? room.cap : n));
  room.round = 0; room.roundStart = Date.now(); room.phase = "play"; room.game = (room.game || 0) + 1;
  room.revealBook = 0; room.revealStep = 0; room.gain = {};
  room.scores = room.scores || {};
  for (const id of room.order) if (!(id in room.scores)) room.scores[id] = 0;
}

// Count votes into scores and keep this round's favorites. Runs once per round (lock).
async function tally(room) {
  const k = K(room.code);
  const [got] = await redis([["SET", `${k.lock}:${room.game}`, "1", "NX", "EX", 300]]);
  if (got !== "OK") return false;
  const [votes, all] = await redis([["HGETALL", k.votes], ["HGETALL", k.entries]]);
  const vv = pairs(votes), ents = pairs(all), count = {};
  for (const pick of Object.values(vv)) count[pick] = (count[pick] || 0) + 1;
  room.gain = {};
  for (const [pick, c] of Object.entries(count)) {
    const [b, i] = pick.split(":").map(Number), a = authorOf(room, b, i);
    room.scores[a] = (room.scores[a] || 0) + c; room.gain[a] = (room.gain[a] || 0) + c;
  }
  const top = Object.entries(count).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const winners = top.map(([pick, c]) => {
    const [b, i] = pick.split(":").map(Number), e = parse(ents[pick]) || {}, prev = i > 0 ? parse(ents[`${b}:${i - 1}`]) : null;
    return { votes: c, by: authorOf(room, b, i), owner: room.order[b], kind: e.kind, text: e.text || "", strokes: e.strokes || null,
             prevKind: prev ? prev.kind : "", prevText: prev && prev.kind !== "draw" ? prev.text || "" : "", prevStrokes: prev && prev.kind === "draw" ? prev.strokes : null };
  });
  room.phase = (room.roundNo || 1) >= (room.totalRounds || 1) ? "done" : "results";
  await redis([["SET", k.winners, JSON.stringify(winners), "EX", TTL]]);
  return true;
}
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const cleanText = t => String(t || "").replace(/\s+/g, " ").trim().slice(0, 80);
const mod = (a, n) => ((a % n) + n) % n;
const kindFor = r => r === 0 ? "write" : (r % 2 === 1 ? "draw" : "guess");

function cleanStrokes(s) {
  if (!Array.isArray(s)) return null;
  const out = []; let pts = 0;
  for (const st of s.slice(0, MAX_STROKES)) {
    if (!st || !Array.isArray(st.p)) continue;
    const c = Math.max(0, Math.min(7, st.c | 0)), w = Math.max(1, Math.min(60, st.w | 0));
    const p = [];
    for (let i = 0; i + 1 < st.p.length && pts < MAX_POINTS; i += 2, pts++) {
      p.push(Math.max(0, Math.min(1000, Math.round(+st.p[i] || 0))), Math.max(0, Math.min(1000, Math.round(+st.p[i + 1] || 0))));
    }
    if (p.length >= 2) out.push({ c, w, p });
  }
  return out;
}

async function loadRaw(code, withEntries) {
  const k = K(code);
  const cmds = [["GET", k.room], ["HGETALL", k.players]];
  if (withEntries) cmds.push(["HKEYS", k.entries]);
  const [room, players, keys] = await redis(cmds);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { try { const j = JSON.parse(v); pl.push({ id, name: j.name, t: j.t }); } catch (e) {} }
  pl.sort((a, b) => a.t - b.t);
  return { room: JSON.parse(room), players: pl, keys: new Set(keys || []) };
}

// Which book and entry this player works on in round r
function taskOf(room, pid, r) {
  const j = room.order.indexOf(pid);
  if (j < 0) return null;
  const n = room.order.length;
  return { book: mod(j - r, n), round: r, kind: kindFor(r) };
}

async function view(raw, me, q) {
  const { room, players, keys } = raw;
  const k = K(room.code);
  const name = id => (players.find(p => p.id === id) || { name: "Someone" }).name;
  const out = {
    room: { code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, rounds: room.rounds, roundStart: room.roundStart || 0,
            timer: room.timer, order: room.order, revealBook: room.revealBook, revealStep: room.revealStep, game: room.game || 1,
            roundNo: room.roundNo || 1, totalRounds: room.totalRounds || 1, scores: room.scores || {}, gain: room.gain || {}, cap: room.cap || 0 },
    players: players.map(p => ({ id: p.id, name: p.name })),
  };
  if (room.phase === "play") {
    out.done = room.order.filter(pid => { const t = taskOf(room, pid, room.round); return keys.has(`${t.book}:${room.round}`); });
    const t = taskOf(room, me, room.round);
    if (t) {
      out.task = { ...t, submitted: keys.has(`${t.book}:${t.round}`) };
      // send the previous entry only when the client doesn't have it yet
      if (t.round > 0 && String(q.r) !== `${room.game}:${t.round}`) {
        const [prev] = await redis([["HGET", k.entries, `${t.book}:${t.round - 1}`]]);
        out.task.prev = prev ? JSON.parse(prev) : { kind: "skip" };
      }
    }
  }
  if (room.phase === "reveal") {
    const b = room.revealBook, have = (q.rb === String(b) && String(q.g) === String(room.game)) ? Math.max(0, parseInt(q.k, 10) || 0) : 0;
    out.book = { index: b, owner: room.order[b], ownerName: name(room.order[b]), step: room.revealStep, from: have, entries: [] };
    const want = []; for (let i = have; i <= room.revealStep; i++) want.push(`${b}:${i}`);
    if (want.length) {
      const vals = await redis([["HMGET", k.entries, ...want]]);
      out.book.entries = vals[0].map((v, i) => { const e = v ? JSON.parse(v) : { kind: "skip" }; e.byName = name(room.order[mod(b + have + i, room.order.length)]); return e; });
    }
  }
  if (room.phase === "vote") {
    const [votes] = await redis([["HGETALL", k.votes]]);
    const vv = pairs(votes);
    out.voted = Object.keys(vv); out.myVote = vv[me] || "";
    if (q.vg !== "tv" && String(q.vg) !== String(room.game)) {
      const [all] = await redis([["HGETALL", k.entries]]);
      const ents = pairs(all);
      out.gallery = room.order.map((owner, b) => ({ owner, ownerName: name(owner), entries: Array.from({ length: room.rounds }, (_, i) => {
        const e = parse(ents[`${b}:${i}`]) || { kind: "skip", skipped: true };
        const by = authorOf(room, b, i);
        return { b, i, by, byName: name(by), kind: e.kind, text: e.text || "", strokes: e.strokes || null, skipped: !!e.skipped || e.kind === "skip" };
      }) }));
    }
  }
  if ((room.phase === "results" || room.phase === "done") && String(q.wg) !== String(room.game)) {
    const [w] = await redis([["GET", k.winners]]);
    out.winners = (parse(w) || []).map(x => ({ ...x, byName: name(x.by), ownerName: name(x.owner) }));
  }
  if (room.phase === "results" || room.phase === "done") {
    const n = room.order.length, last = room.rounds - 1, want = [];
    for (let b = 0; b < n; b++) { want.push(`${b}:0`, `${b}:${last}`); }
    const vals = want.length ? (await redis([["HMGET", k.entries, ...want]]))[0] : [];
    out.summary = room.order.map((pid, b) => {
      const first = vals[b * 2] ? JSON.parse(vals[b * 2]) : null, end = vals[b * 2 + 1] ? JSON.parse(vals[b * 2 + 1]) : null;
      return { owner: name(pid), start: first && first.text || "", end: end && end.kind !== "draw" ? (end.text || "") : null };
    });
  }
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
      const raw = await loadRaw(code, true);
      if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
      return send(200, await view(raw, me, q));
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
        const room = { code, hostId: pid, phase: "lobby", order: [], rounds: 0, round: 0, roundStart: 0, timer: 90, revealBook: 0, revealStep: 0, game: 0, totalRounds: 2, roundNo: 1, scores: {}, cap: 0 };
        const k = K(code);
        const [ok] = await redis([["SET", k.room, JSON.stringify(room), "NX", "EX", TTL]]);
        if (ok !== "OK") {
          if (!want) continue;
          // Party mode: the room for this party code already exists
          const ex = await loadRaw(want, true);
          if (!ex) continue;
          if (ex.room.hostId !== pid) return send(409, { error: "That party code is already in use by another game. Start a new party." });
          return send(200, await view(ex, pid, {}));
        }
        await redis([["HSET", k.players, pid, JSON.stringify({ name, t: Date.now() })], ["EXPIRE", k.players, TTL]]);
        return send(200, await view(await loadRaw(code, true), pid, {}));
      }
      return send(500, { error: "Couldn't make a room code. Try again." });
    }

    const code = String(body.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
    const raw = await loadRaw(code, true);
    if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
    const { room } = raw, k = K(code);
    const isHost = pid === room.hostId;
    const touch = [["EXPIRE", k.players, TTL], ["EXPIRE", k.entries, TTL], ["EXPIRE", k.votes, TTL], ["EXPIRE", k.winners, TTL]];
    const saveRoom = () => redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ...touch]);
    const roundComplete = async (r) => {
      const keys = await redis([["HKEYS", k.entries]]);
      const have = new Set(keys[0] || []);
      return room.order.every(p => have.has(`${taskOf(room, p, r).book}:${r}`));
    };
    const advanceFrom = (r) => {
      if (r + 1 >= room.rounds) { room.phase = "reveal"; room.revealBook = 0; room.revealStep = 0; }
      else { room.round = r + 1; room.roundStart = Date.now(); }
    };

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const existing = raw.players.find(p => p.id === pid);
      const taken = raw.players.find(p => p.id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (taken) return send(409, { error: `Someone named ${taken.name} is already in. Add a last initial.` });
      await redis([["HSET", k.players, pid, JSON.stringify({ name, t: existing ? existing.t : Date.now() })], ...touch]);
    } else if (action === "leave") {
      if (!isHost && !room.order.includes(pid)) await redis([["HDEL", k.players, pid]]);
    } else if (action === "submit") {
      if (room.phase !== "play") return send(400, { error: "Nothing to hand in right now." });
      const r = +body.round;
      if (r !== room.round) return send(409, { error: "That round already moved on." });
      const t = taskOf(room, pid, r);
      if (!t) return send(403, { error: "You're not in this round. You'll be in the next game." });
      let entry;
      if (t.kind === "draw") {
        const strokes = cleanStrokes(body.strokes);
        if (!strokes) return send(400, { error: "That drawing didn't come through. Try again." });
        entry = { kind: "draw", strokes };
      } else {
        const text = cleanText(body.text);
        if (!text) return send(400, { error: t.kind === "write" ? "Write something to draw first." : "Type your guess first." });
        entry = { kind: t.kind, text };
      }
      await redis([["HSET", k.entries, `${t.book}:${r}`, JSON.stringify(entry)], ...touch]);
      if (await roundComplete(r)) {
        const fresh = await loadRaw(code, false);
        if (fresh && fresh.room.phase === "play" && fresh.room.round === r) { Object.assign(room, fresh.room); advanceFrom(r); await saveRoom(); }
      }
    } else if (action === "next" || action === "back") {
      if (room.phase !== "reveal") return send(400, { error: "Not revealing right now." });
      if (!isHost && pid !== room.order[room.revealBook]) return send(403, { error: "It's someone else's turn to reveal." });
      if (+body.at !== room.revealBook * 100 + room.revealStep && body.at !== undefined) return send(200, await view(raw, pid, body)); // double tap
      if (action === "next") {
        if (room.revealStep < room.rounds - 1) room.revealStep++;
        else if (room.revealBook < room.order.length - 1) { room.revealBook++; room.revealStep = 0; }
        else room.phase = "vote";
      } else {
        if (room.revealStep > 0) room.revealStep--;
        else if (room.revealBook > 0) { room.revealBook--; room.revealStep = room.rounds - 1; }
      }
      await saveRoom();
    } else if (action === "vote") {
      if (room.phase !== "vote") return send(400, { error: "Voting is closed." });
      if (!room.order.includes(pid)) return send(403, { error: "You'll get to vote next round." });
      const pick = String(body.pick || "");
      const m = /^(\d+):(\d+)$/.exec(pick);
      if (!m || +m[1] >= room.order.length || +m[2] >= room.rounds) return send(400, { error: "Pick one of the cards." });
      if (authorOf(room, +m[1], +m[2]) === pid) return send(400, { error: "You can't vote for your own. Pick someone else's!" });
      const [e] = await redis([["HGET", k.entries, pick]]);
      const ent = parse(e);
      if (!ent || ent.skipped) return send(400, { error: "That one didn't make it in. Pick another." });
      const [, , voters] = await redis([["HSET", k.votes, pid, pick], ["EXPIRE", k.votes, TTL], ["HKEYS", k.votes]]);
      const present = new Set(raw.players.map(p => p.id)), have = new Set(voters || []);
      if (room.order.filter(id => present.has(id)).every(id => have.has(id))) {
        const fresh = await loadRaw(code, false);
        if (fresh && fresh.room.phase === "vote" && fresh.room.game === room.game) { Object.assign(room, fresh.room); if (await tally(room)) await saveRoom(); }
      }
    } else {
      if (!isHost) return send(403, { error: "Only the host can do that." });
      if (action === "kick") {
        const who = cleanId(body.who);
        if (room.phase !== "lobby") return send(400, { error: "You can remove players between games." });
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who]]);
      } else if (action === "settings") {
        const t = +body.timer; if ([0, 60, 90, 120].includes(t)) room.timer = t;
        if ([1, 2, 3].includes(+body.totalRounds)) room.totalRounds = +body.totalRounds;
        await saveRoom();
      } else if (action === "start") {
        if (raw.players.length < 3) return send(400, { error: "You need at least 3 players." });
        const t = +body.timer; if ([0, 60, 90, 120].includes(t)) room.timer = t;
        room.cap = [4, 6, 8].includes(+body.cap) ? +body.cap : 0;
        room.totalRounds = [1, 2, 3].includes(+body.totalRounds) ? +body.totalRounds : 2;
        room.roundNo = 1; room.scores = {};
        startRound(room, raw.players);
        await redis([["DEL", k.entries, k.votes, k.winners]]);
        await saveRoom();
      } else if (action === "skip") {
        if (room.phase !== "play") return send(400, { error: "Nothing to skip." });
        const r = room.round, cmds = [];
        for (const p of room.order) {
          const t = taskOf(room, p, r);
          if (!raw.keys.has(`${t.book}:${r}`)) cmds.push(["HSET", k.entries, `${t.book}:${r}`, JSON.stringify({ kind: t.kind === "draw" ? "draw" : t.kind, text: t.kind === "draw" ? "" : "(ran out of time)", strokes: t.kind === "draw" ? [] : undefined, skipped: true })]);
        }
        if (cmds.length) await redis(cmds);
        advanceFrom(r); await saveRoom();
      } else if (action === "closeVotes") {
        if (room.phase !== "vote") return send(400, { error: "Voting is already closed." });
        if (await tally(room)) await saveRoom();
      } else if (action === "nextRound") {
        if (room.phase !== "results") return send(400, { error: "Not between rounds right now." });
        if (raw.players.length < 3) return send(400, { error: "You need at least 3 players." });
        room.roundNo = (room.roundNo || 1) + 1;
        startRound(room, raw.players);
        await redis([["DEL", k.entries, k.votes, k.winners]]);
        await saveRoom();
      } else if (action === "lobby") {
        room.phase = "lobby"; room.order = []; room.scores = {}; room.gain = {}; room.roundNo = 1; await saveRoom();
      } else {
        return send(400, { error: "Unknown action." });
      }
    }
    return send(200, await view(await loadRaw(code, true), pid, body));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
