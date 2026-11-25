// Gobble Minds room sync. Everyone answers a prompt; players in the single most popular answer score.
// A lone unique answer takes "the turkey" (can't win while holding it).
// Upstash Redis via REST (plain fetch); rooms expire after a day.
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "gobble:";
const CODE_RE = /^[A-Z]{4}$/;

const PROMPTS = [
  "Name a pie", "The best Thanksgiving side dish", "Something orange", "A food that goes with gravy",
  "Something you do after the big meal", "A word that describes how you feel after dinner", "Name a fall color",
  "Something you'd find on a Thanksgiving table", "The best part of the turkey", "A Thanksgiving dessert that isn't pie",
  "Something people argue about at Thanksgiving", "A board or card game families play", "Something that goes in stuffing",
  "A drink at Thanksgiving dinner", "A place you'd go for a long walk", "Something you smell on Thanksgiving morning",
  "Name a holiday movie", "Something you put on a cracker", "A kitchen tool you can't cook without",
  "What time should Thanksgiving dinner start?", "A topping for sweet potatoes", "Name a breakfast food",
  "The first thing you do on Black Friday", "Something in a cornucopia", "A good name for a turkey",
  "Something you're tired of hearing about", "A sport to watch on Thanksgiving", "Something kids beg for",
  "A word that rhymes with pie", "Something that's always in the junk drawer", "An animal you'd see on a farm",
  "The worst chore after a big dinner", "A Bible story every kid knows", "Something you'd bring to a potluck",
  "A hymn or worship song everyone knows", "Something you'd find in Grandma's house", "A famous Pilgrim, Native American or explorer",
  "Name a nut", "A reason to give thanks today", "Something that gets passed around the table",
];

// Odd Bird mode: narrow categories, so a truly unique answer takes some thought
const ODD_PROMPTS = [
  "Name a pie", "A Thanksgiving side dish", "A book of the Bible", "A U.S. state", "A kind of nut",
  "A fall vegetable", "A breakfast cereal", "A pizza topping", "A Christmas song", "A board game",
  "A dog breed", "A fast food restaurant", "A color of the rainbow", "A kitchen appliance", "One of Jesus' 12 disciples",
  "A U.S. president", "A spice in your cabinet", "An NFL team", "A type of bread", "A farm animal",
  "A fruit", "A candy bar", "A Thanksgiving dessert", "A Christmas tradition", "A hero from the Bible",
  "A holiday", "A country in Europe", "A flavor of ice cream", "A sport", "A city in Oklahoma",
  "A flavor of pie filling", "A hymn", "A Christmas movie", "A cheese", "A type of soup", "A topping for mashed potatoes",
];
const promptList = mode => mode === "odd" ? ODD_PROMPTS : PROMPTS;

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
const K = code => ({ room: P + "room:" + code, players: P + "players:" + code, answers: P + "answers:" + code });
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const cleanAnswer = t => String(t || "").replace(/\s+/g, " ").trim().slice(0, 40);

// "The Pumpkin Pies!" -> "pumpkin pie"
function norm(t) {
  let s = String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(a|an|the|my|some) /, "");
  s = s.split(" ").map(w => (w.length > 3 && w.endsWith("ies")) ? w.slice(0, -3) + "y" : (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) ? w.slice(0, -1) : w).join(" ");
  return s || "?";
}

function autoGroups(answers) {
  const map = new Map();
  for (const [pid, text] of Object.entries(answers)) {
    const key = norm(text);
    if (!map.has(key)) map.set(key, { key, label: text, ids: [] });
    map.get(key).ids.push(pid);
  }
  return [...map.values()];
}

function pickPrompt(room) {
  const list = promptList(room.mode);
  const used = new Set((room.used || []).map(String));
  let pool = list.filter(t => !used.has(t));
  if (!pool.length) { room.used = []; pool = list.slice(); }
  const t = pool[Math.floor(Math.random() * pool.length)];
  room.used = [...(room.used || []), t];
  return t;
}

async function loadRaw(code) {
  const k = K(code);
  const [room, players, answers] = await redis([["GET", k.room], ["HGETALL", k.players], ["HGETALL", k.answers]]);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { try { const j = JSON.parse(v); pl.push({ id, name: j.name, t: j.t }); } catch (e) {} }
  pl.sort((a, b) => a.t - b.t);
  return { room: JSON.parse(room), players: pl, answers: pairs(answers) };
}

function view(raw, me) {
  const { room, players, answers } = raw;
  const out = {
    room: { code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, prompt: room.prompt, scores: room.scores, turkey: room.turkey || null, target: room.target, mode: room.mode || "herd" },
    players: players.map(p => ({ id: p.id, name: p.name, answered: !!answers[p.id] })),
    myAnswer: answers[me] || "",
  };
  if (room.phase === "review" || room.phase === "reveal") out.groups = room.groups;
  if (room.phase === "reveal") out.result = room.result;
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
        const room = { code, hostId: pid, phase: "lobby", round: 0, prompt: "", scores: {}, turkey: null, groups: [], result: null, used: [], target: 8, mode: "herd" };
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
    const touch = [["EXPIRE", k.players, TTL], ["EXPIRE", k.answers, TTL]];
    const saveRoom = () => redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ...touch]);
    const newRound = async (prompt) => {
      room.round += 1; room.phase = "answer"; room.prompt = prompt || pickPrompt(room); room.groups = []; room.result = null;
      await redis([["DEL", k.answers]]);
    };

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
      if (room.phase !== "answer") return send(400, { error: "Answers are closed for this prompt." });
      const text = cleanAnswer(body.text);
      if (!text) return send(400, { error: "Type an answer first." });
      await redis([["HSET", k.answers, pid, text], ...touch]);
    } else {
      if (!isHost) return send(403, { error: "Only the host can do that." });
      if (action === "kick") {
        const who = cleanId(body.who);
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who], ["HDEL", k.answers, who]]);
      } else if (action === "mode") {
        if (room.phase !== "lobby") return send(400, { error: "Pick the mode in the lobby." });
        room.mode = body.mode === "odd" ? "odd" : "herd"; room.used = [];
        await saveRoom();
      } else if (action === "veto") {
        if (room.phase !== "review") return send(400, { error: "You can only strike answers before scoring." });
        const g = room.groups.find(x => x.key === String(body.key));
        if (!g) return send(400, { error: "That answer is gone. Try again." });
        g.vetoed = !g.vetoed;
        await saveRoom();
      } else if (action === "start") {
        if (raw.players.length < 3) return send(400, { error: "You need at least 3 players." });
        const t = +body.target; if ([5, 8, 10, 12].includes(t)) room.target = t;
        if (body.mode === "odd" || body.mode === "herd") room.mode = body.mode;
        room.scores = {}; room.turkey = null; room.round = 0; room.used = [];
        await newRound(); await saveRoom();
      } else if (action === "swap") {
        if (room.phase !== "answer") return send(400, { error: "You can only swap the prompt while people are answering." });
        const custom = String(body.prompt || "").replace(/\s+/g, " ").trim().slice(0, 90);
        room.round -= 1; await newRound(custom || null); await saveRoom();
      } else if (action === "close") {
        if (room.phase !== "answer") return send(400, { error: "Not collecting answers right now." });
        if (Object.keys(raw.answers).length < 2) return send(400, { error: "Wait for at least two answers." });
        room.groups = autoGroups(raw.answers); room.phase = "review";
        await saveRoom();
      } else if (action === "merge") {
        if (room.phase !== "review") return send(400, { error: "Merging is only before scoring." });
        const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
        const pick = room.groups.filter(g => keys.includes(g.key));
        if (pick.length < 2) return send(400, { error: "Pick at least two answers to merge." });
        const main = pick.slice().sort((a, b) => b.ids.length - a.ids.length)[0];
        const merged = { key: pick.map(g => g.key).join("+"), label: main.label, ids: pick.flatMap(g => g.ids), parts: pick.flatMap(g => g.parts || [g.label]), vetoed: pick.every(g => g.vetoed) };
        room.groups = room.groups.filter(g => !keys.includes(g.key)).concat(merged);
        await saveRoom();
      } else if (action === "unmerge") {
        if (room.phase !== "review") return send(400, { error: "Too late to undo." });
        room.groups = autoGroups(raw.answers); await saveRoom();
      } else if (action === "score") {
        if (room.phase !== "review") return send(400, { error: "Show the answers first." });
        const vetoed = room.groups.filter(g => g.vetoed).map(g => g.key);
        if (room.mode === "odd") {
          const valid = room.groups.filter(g => !g.vetoed).sort((a, b) => b.ids.length - a.ids.length);
          const uniques = valid.filter(g => g.ids.length === 1);
          uniques.forEach(g => { const id = g.ids[0]; room.scores[id] = (room.scores[id] || 0) + 1; });
          const top = valid[0] ? valid[0].ids.length : 0;
          const tiedTop = valid.filter(g => g.ids.length === top).length > 1;
          const copy = (top >= 2 && !tiedTop) ? valid[0] : null;
          if (copy) copy.ids.forEach(id => { room.scores[id] = Math.max(0, (room.scores[id] || 0) - 1); });
          room.result = { mode: "odd", uniqueKeys: uniques.map(g => g.key), uniques: uniques.map(g => g.ids[0]), copyKey: copy ? copy.key : null, copycats: copy ? copy.ids : [], vetoed };
          room.result.over = Object.values(room.scores).some(v => v >= room.target);
          room.phase = "reveal";
          await saveRoom();
          return send(200, view(await loadRaw(code), pid));
        }
        const groups = room.groups.filter(g => !g.vetoed).sort((a, b) => b.ids.length - a.ids.length);
        const top = groups[0] ? groups[0].ids.length : 0;
        const tied = groups.filter(g => g.ids.length === top).length > 1;
        const winners = (!tied && top >= 2) ? groups[0].ids : [];
        winners.forEach(id => { room.scores[id] = (room.scores[id] || 0) + 1; });
        const loners = groups.filter(g => g.ids.length === 1);
        let turkeyMoved = false, prevTurkey = room.turkey || null;
        if (loners.length === 1 && raw.players.length >= 3) { room.turkey = loners[0].ids[0]; turkeyMoved = room.turkey !== prevTurkey; }
        room.result = { mode: "herd", topKey: winners.length ? groups[0].key : null, winners, tied: tied && top >= 1, allDifferent: top < 2, turkey: room.turkey, turkeyMoved, prevTurkey, vetoed };
        // game over: someone reached the target without holding the turkey
        const champs = Object.entries(room.scores).filter(([id, s]) => s >= room.target && id !== room.turkey);
        room.result.over = champs.length > 0;
        room.phase = "reveal";
        await saveRoom();
      } else if (action === "next") {
        if (room.phase !== "reveal") return send(400, { error: "Score this round first." });
        await newRound(); await saveRoom();
      } else if (action === "end") {
        room.phase = "final"; await saveRoom();
      } else if (action === "lobby") {
        room.phase = "lobby"; room.groups = []; room.result = null; await redis([["DEL", k.answers]]); await saveRoom();
      } else {
        return send(400, { error: "Unknown action." });
      }
    }
    return send(200, view(await loadRaw(code), pid));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
