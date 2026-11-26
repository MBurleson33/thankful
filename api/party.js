// Party mode: join once with one code, and the host switches games while everyone stays connected.
// Each game's room reuses the party code, so phones jump straight in. Upstash Redis via REST (plain fetch).
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "party:";
const CODE_RE = /^[A-Z]{4}$/;
const GAMES = ["chameleon", "thankful", "gobble", "scribble", "trivia"];
// game room keys that a new party code must not collide with
const GAME_ROOM_KEYS = code => ["chameleon:room:" + code, "thankful:room:" + code, "gobble:room:" + code, "scribble:room:" + code, "trivia:room:" + code];

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
const K = code => ({ room: P + "room:" + code, players: P + "players:" + code });
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);

async function load(code) {
  const k = K(code);
  const [room, players] = await redis([["GET", k.room], ["HGETALL", k.players]]);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { try { const j = JSON.parse(v); pl.push({ id, name: j.name, t: j.t }); } catch (e) {} }
  pl.sort((a, b) => a.t - b.t);
  return { room: JSON.parse(room), players: pl.map(p => ({ id: p.id, name: p.name })) };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const send = (status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ...body, now: Date.now() })); };
  if (!URL_ || !TOKEN) return send(500, { error: "The game server isn't set up yet (no database connected)." });
  try {
    if (req.method === "GET") {
      const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
      const code = String(q.code || "").toUpperCase();
      if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
      const st = await load(code);
      if (!st) return send(404, { error: "No party with that code. Check it and try again." });
      return send(200, st);
    }
    if (req.method !== "POST") return send(405, { error: "Method not allowed" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== "object") {
      const raw = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
      try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
    }
    const action = body.action, pid = cleanId(body.pid);
    if (!pid) return send(400, { error: "Missing player id." });

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      for (let tries = 0; tries < 10; tries++) {
        let code = ""; for (let i = 0; i < 4; i++) code += L[Math.floor(Math.random() * L.length)];
        const taken = await redis(GAME_ROOM_KEYS(code).map(key => ["EXISTS", key]));
        if (taken.some(Boolean)) continue;
        const k = K(code);
        const room = { code, hostId: pid, game: "", switchedAt: Date.now() };
        const [ok] = await redis([["SET", k.room, JSON.stringify(room), "NX", "EX", TTL]]);
        if (ok !== "OK") continue;
        await redis([["HSET", k.players, pid, JSON.stringify({ name, t: Date.now() })], ["EXPIRE", k.players, TTL]]);
        return send(200, await load(code));
      }
      return send(500, { error: "Couldn't make a party code. Try again." });
    }

    const code = String(body.code || "").toUpperCase();
    if (!CODE_RE.test(code)) return send(400, { error: "That code doesn't look right." });
    const st = await load(code);
    if (!st) return send(404, { error: "No party with that code. Check it and try again." });
    const k = K(code), room = st.room;

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const taken = st.players.find(p => p.id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (taken) return send(409, { error: `Someone named ${taken.name} is already in. Add a last initial.` });
      const [old] = await redis([["HGET", k.players, pid]]);
      let t = Date.now(); try { if (old) t = JSON.parse(old).t || t; } catch (e) {}
      await redis([["HSET", k.players, pid, JSON.stringify({ name, t })], ["EXPIRE", k.players, TTL], ["EXPIRE", k.room, TTL]]);
    } else if (action === "leave") {
      if (pid !== room.hostId) await redis([["HDEL", k.players, pid]]);
    } else if (action === "end") {
      // host ends the game night: everyone's phone sees the party is gone and returns to the start screen
      if (pid !== room.hostId) return send(403, { error: "Only the host can end the party." });
      await redis([["DEL", k.room, k.players]]);
      return send(200, { ended: true });
    } else {
      if (pid !== room.hostId) return send(403, { error: "Only the host can do that." });
      if (action === "game") {
        const g = String(body.game || "");
        if (g && !GAMES.includes(g)) return send(400, { error: "Unknown game." });
        room.game = g; room.switchedAt = Date.now();
        await redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ["EXPIRE", k.players, TTL]]);
      } else if (action === "kick") {
        const who = cleanId(body.who);
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who]]);
      } else {
        return send(400, { error: "Unknown action." });
      }
    }
    return send(200, await load(code));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
