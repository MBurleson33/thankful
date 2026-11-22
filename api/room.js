// Who's Thankful For That? room sync. Upstash Redis via REST (plain fetch); rooms expire after a day.
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
// Slip text stays hidden until its turn in the reveal, and authors stay hidden until the host reveals them.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "thankful:";
const CODE_RE = /^[A-Z]{4}$/;

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
const K = code => ({ room: P + "room:" + code, players: P + "players:" + code, slips: P + "slips:" + code, votes: P + "votes:" + code });
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);

async function loadRaw(code) {
  const k = K(code);
  const [room, players, slips, votes] = await redis([["GET", k.room], ["HGETALL", k.players], ["HGETALL", k.slips], ["HGETALL", k.votes]]);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { try { const j = JSON.parse(v); pl.push({ id, name: j.name, t: j.t }); } catch (e) {} }
  pl.sort((a, b) => a.t - b.t);
  return { room: JSON.parse(room), players: pl, slips: pairs(slips), votes: pairs(votes) };
}

// What one player is allowed to see
function view(raw, me) {
  const { room, players, slips, votes } = raw;
  const name = id => (players.find(p => p.id === id) || { name: "Someone" }).name;
  const out = {
    room: { code: room.code, hostId: room.hostId, phase: room.phase, pos: room.pos, total: room.order.length, shown: room.shown, scores: room.scores, round: room.round },
    players: players.map(p => ({ id: p.id, name: p.name, wrote: !!slips[p.id] })),
    mySlip: slips[me] || "",
  };
  if (room.phase === "reveal") {
    const author = room.order[room.pos];
    const cur = Object.entries(votes).filter(([k]) => k.startsWith(room.pos + ":")).map(([k, v]) => ({ voter: k.split(":")[1], guess: v }));
    out.slip = { text: slips[author] || "(this slip was removed)", mine: author === me };
    out.myVote = (cur.find(v => v.voter === me) || {}).guess || "";
    out.voted = cur.map(v => v.voter);
    if (room.shown) {
      out.slip.author = author; out.slip.authorName = name(author);
      out.slip.right = cur.filter(v => v.guess === author).map(v => name(v.voter));
      out.slip.fooled = cur.filter(v => v.guess !== author).length;
    }
  }
  if (room.phase === "done") {
    out.all = room.order.map(id => ({ name: name(id), text: slips[id] || "" })).filter(s => s.text);
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
      const raw = await loadRaw(code);
      if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
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
      for (let tries = 0; tries < 8; tries++) {
        let code = ""; for (let i = 0; i < 4; i++) code += L[Math.floor(Math.random() * L.length)];
        const room = { code, hostId: pid, phase: "collect", order: [], pos: 0, shown: false, scores: {}, round: 1 };
        const k = K(code);
        const [ok] = await redis([["SET", k.room, JSON.stringify(room), "NX", "EX", TTL]]);
        if (ok !== "OK") continue;
        await redis([["HSET", k.players, pid, JSON.stringify({ name, t: Date.now() })], ["EXPIRE", k.players, TTL]]);
        return send(200, view(await loadRaw(code), pid));
      }
      return send(500, { error: "Couldn't make a room code. Try again." });
    }

    const code = String(body.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
    const raw = await loadRaw(code);
    if (!raw) return send(404, { error: "No game with that code. Check it and try again." });
    const { room } = raw, k = K(code);
    const isHost = pid === room.hostId;
    const inRoom = raw.players.some(p => p.id === pid);
    const touch = [["EXPIRE", k.players, TTL], ["EXPIRE", k.slips, TTL], ["EXPIRE", k.votes, TTL]];
    const saveRoom = () => redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ...touch]);

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const existing = raw.players.find(p => p.id === pid);
      const taken = raw.players.find(p => p.id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (taken) return send(409, { error: `Someone named ${taken.name} is already in. Add a last initial.` });
      await redis([["HSET", k.players, pid, JSON.stringify({ name, t: existing ? existing.t : Date.now() })], ...touch]);
    } else if (action === "leave") {
      if (!isHost) await redis([["HDEL", k.players, pid], ["HDEL", k.slips, pid]]);
    } else if (action === "slip") {
      if (!inRoom) return send(403, { error: "Join the game first." });
      if (room.phase !== "collect") return send(400, { error: "The reveal already started. You can add a slip next game." });
      const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (text.length < 2) return send(400, { error: "Write what you're thankful for." });
      await redis([["HSET", k.slips, pid, text], ...touch]);
    } else if (action === "vote") {
      if (!inRoom) return send(403, { error: "Join the game first." });
      if (room.phase !== "reveal" || room.shown) return send(400, { error: "Voting is closed for this slip." });
      const guess = cleanId(body.guess);
      if (room.order[room.pos] === pid) return send(400, { error: "That's your slip! Sit this vote out." });
      if (!raw.players.some(p => p.id === guess) || guess === pid) return send(400, { error: "Pick someone else." });
      await redis([["HSET", k.votes, room.pos + ":" + pid, guess], ...touch]);
    } else {
      // Host only from here
      if (!isHost) return send(403, { error: "Only the host can do that." });
      if (action === "kick") {
        const who = cleanId(body.who);
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who], ["HDEL", k.slips, who]]);
      } else if (action === "start") {
        const ids = raw.players.map(p => p.id).filter(id => raw.slips[id]);
        if (ids.length < 2) return send(400, { error: "You need at least two slips to start." });
        for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        room.order = ids; room.pos = 0; room.shown = false; room.phase = "reveal"; room.scores = {};
        await redis([["DEL", k.votes]]);
        await saveRoom();
      } else if (action === "show") {
        if (room.phase !== "reveal" || room.shown) return send(400, { error: "Already revealed." });
        const author = room.order[room.pos];
        for (const [kk, guess] of Object.entries(raw.votes)) {
          const [pos, voter] = kk.split(":");
          if (+pos === room.pos && guess === author) room.scores[voter] = (room.scores[voter] || 0) + 1;
        }
        room.shown = true;
        await saveRoom();
      } else if (action === "next") {
        if (room.phase !== "reveal") return send(400, { error: "Not revealing right now." });
        room.pos++; room.shown = false;
        if (room.pos >= room.order.length) room.phase = "done";
        await saveRoom();
      } else if (action === "reset") {
        room.phase = "collect"; room.order = []; room.pos = 0; room.shown = false; room.scores = {}; room.round = (room.round || 1) + 1;
        await redis([["DEL", k.slips], ["DEL", k.votes]]);
        await saveRoom();
      } else {
        return send(400, { error: "Unknown action." });
      }
    }
    return send(200, view(await loadRaw(code), pid));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
