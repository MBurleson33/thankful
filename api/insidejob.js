// Inside Job room sync. Everyone gets the same secret location and a role, except the Mole, who has to bluff.
// The server keeps the secrets: each phone only ever receives its own card until the round is over.
// Rules: anyone can stop the round and accuse one player; everyone else votes yes or no (the accuser counts as yes,
// the accused doesn't vote) and more than half of the other players must say yes. A failed accusation resumes the round.
// Accuse the Mole and they get one last guess at the location; accuse anyone else and the Mole wins.
// The Mole can also stop the round and guess. If the timer runs out with nobody caught, the Mole wins.
// Rooms live in Upstash Redis (REST API, plain fetch) and expire after a day.
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Storage) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24;
const P = "insidejob:";
const CODE_RE = /^[A-Z]{4}$/;
const TIMERS = [300, 360, 420, 480, 600];
const MIN_PLAYERS = 3, MAX_PLAYERS = 12;

// Location name, then roles. Players past the role count get a repeat.
const LOCATIONS = [
  ["Thanksgiving Dinner", ["Host", "Turkey Carver", "Kid at the Kids' Table", "Grandma", "Uncle Watching Football", "Dish Washer", "Guest Who Brought Rolls"]],
  ["Church Potluck", ["Pastor", "Casserole Queen", "Greeter", "Youth Group Kid", "Coffee Maker", "Dessert Table Guard", "First-Time Visitor"]],
  ["Bowling Alley", ["Shoe Rental Clerk", "League Champion", "Birthday Kid", "Snack Bar Cook", "Pin Mechanic", "Scorekeeper", "Gutter-Ball Rookie"]],
  ["Fire Station", ["Fire Chief", "Rookie Firefighter", "Dalmatian", "Truck Driver", "Station Cook", "Paramedic", "Field Trip Kid"]],
  ["Farmers Market", ["Honey Seller", "Flower Vendor", "Street Musician", "Shopper with a Wagon", "Baker", "Peach Farmer", "Dog Walker"]],
  ["Haunted House", ["Ghost Actor", "Scared Teenager", "Ticket Taker", "Brave Little Kid", "Fog Machine Operator", "Zombie", "Owner"]],
  ["Car Wash", ["Attendant", "Customer", "Soap Sprayer", "Towel Dryer", "Manager", "Kid in the Back Seat", "Sign Spinner"]],
  ["Barbershop", ["Barber", "Kid Getting a First Haircut", "Regular Customer", "Shop Owner", "Guy Reading the Paper", "Shampoo Assistant", "Sports Talker"]],
  ["Dentist's Office", ["Dentist", "Hygienist", "Nervous Patient", "Receptionist", "Kid Picking a Prize", "Parent in the Waiting Room", "Orthodontist"]],
  ["Pumpkin Patch", ["Farmer", "Hayride Driver", "Family Photographer", "Toddler", "Corn Maze Guide", "Cider Seller", "Scarecrow Actor"]],
  ["Ski Lodge", ["Ski Instructor", "Snowboarder", "Hot Cocoa Server", "Lift Operator", "Ski Patrol", "Beginner with a Cast", "Fireplace Lounger"]],
  ["Water Park", ["Lifeguard", "Wave Pool Swimmer", "Kid on the Lazy River", "Snack Shack Cook", "Slide Tester", "Parent Holding Towels", "Sunburned Tourist"]],
  ["Drive-In Movie", ["Projectionist", "Couple on a Date", "Concession Worker", "Kid in Pajamas", "Ticket Booth Clerk", "Parking Attendant", "Car Full of Teens"]],
  ["Campground", ["Park Ranger", "Scout Leader", "Marshmallow Roaster", "Fisherman", "Camper Who Forgot the Tent", "Storyteller", "Raccoon"]],
  ["Mall at Christmas", ["Mall Santa", "Elf Helper", "Gift Wrapper", "Stressed Shopper", "Security Guard", "Food Court Cook", "Kid in Line"]],
  ["Bakery", ["Head Baker", "Cake Decorator", "Cashier", "Early Morning Customer", "Delivery Driver", "Bride Tasting Cakes", "Donut Fryer"]],
  ["Laundromat", ["Owner", "Student with a Huge Pile", "Change Machine Fixer", "Lost Sock Hunter", "Mom with Three Kids", "Person Napping", "Dry Cleaner"]],
  ["Pet Store", ["Fish Tank Cleaner", "Parrot", "Cashier", "Puppy Shopper", "Dog Groomer", "Reptile Expert", "Kid Begging for a Hamster"]],
  ["Rodeo", ["Bull Rider", "Rodeo Clown", "Announcer", "Barrel Racer", "Concession Worker", "Horse Trainer", "Fan in a Cowboy Hat"]],
  ["State Fair", ["Corn Dog Seller", "Ride Operator", "Prize Pig Owner", "Game Booth Worker", "Pie Contest Judge", "Kid with Cotton Candy", "Funnel Cake Fryer"]],
  ["Football Tailgate", ["Grill Master", "Superfan in Face Paint", "Cornhole Champion", "Ticket Holder", "Marching Band Member", "Cooler Carrier", "Fan of the Other Team"]],
  ["Recording Studio", ["Singer", "Producer", "Sound Engineer", "Drummer", "Backup Singer", "Band Manager", "Intern Getting Coffee"]],
  ["Escape Room", ["Game Master", "Puzzle Genius", "Team Captain", "Person Who Panics", "Clue Finder", "Birthday Group", "Late Arrival"]],
  ["Ice Cream Truck", ["Driver", "Kid Chasing the Truck", "Parent with Cash", "Neighbor", "Sprinkles Expert", "Kid Who Dropped Their Cone", "Neighborhood Dog"]],
  ["Kid's Birthday Party", ["Birthday Kid", "Party Clown", "Parent with a Camera", "Bounce House Kid", "Cake Cutter", "Grandparent", "Piñata Swinger"]],
  ["Garage Sale", ["Seller", "Bargain Hunter", "Neighbor Browsing", "Kid Selling Lemonade", "Antique Collector", "Early Bird", "Price Sticker Person"]],
  ["Lighthouse", ["Lighthouse Keeper", "Tourist", "Fisherman", "Photographer", "Tour Guide", "Seagull", "Storm Chaser"]],
  ["Car Dealership", ["Salesperson", "Sales Manager", "First-Time Buyer", "Mechanic", "Finance Manager", "Test Driver", "Customer Waiting on an Oil Change"]],
  ["Mini Golf", ["Course Owner", "Hole-in-One Champ", "Kid Who Lost the Ball", "Couple on a Date", "Scorekeeper", "Ice Cream Server", "Windmill Repairer"]],
  ["Trampoline Park", ["Jump Coach", "Birthday Kid", "Parent on the Bench", "Dodgeball Champ", "Front Desk Worker", "Foam Pit Diver", "Safety Monitor"]],
];
const LOC_NAMES = LOCATIONS.map(l => l[0]);

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

const K = code => ({ room: P + "room:" + code, players: P + "players:" + code, votes: P + "votes:" + code, lock: P + "lock:" + code });
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 20);
const cleanId = s => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function loadRaw(code) {
  const k = K(code);
  const [room, players, votes] = await redis([["GET", k.room], ["HGETALL", k.players], ["HGETALL", k.votes]]);
  if (!room) return null;
  const pl = [];
  for (const [id, v] of Object.entries(pairs(players))) { const j = parse(v); if (j) pl.push({ id, name: j.name, t: j.t }); }
  pl.sort((a, b) => a.t - b.t);
  const vt = {};
  for (const [id, v] of Object.entries(pairs(votes))) { const j = parse(v); if (j) vt[id] = j; }
  return { room: JSON.parse(room), lobby: pl.map(p => ({ id: p.id, name: p.name })), votes: vt };
}

// each accusation gets its own ballot
const ballotKey = room => `${room.round}.${room.accuseN || 0}`;
const voters = room => room.players.filter(p => p.id !== room.accuse.target);
function tally(raw) {
  const { room } = raw, b = ballotKey(room), out = {};
  out[room.accuse.by] = "yes";   // the accuser counts as yes
  for (const p of voters(room)) { const v = raw.votes[p.id]; if (p.id !== room.accuse.by && v && v.b === b) out[p.id] = v.v; }
  return out;
}

function view(raw, me) {
  const { room, lobby } = raw;
  const out = {
    room: {
      code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, timer: room.timer,
      players: room.players, firstId: room.firstId || "", tStart: room.tStart || 0, tEnd: room.tEnd || 0, tLeft: room.tLeft || 0,
      accuse: room.phase === "accuse" || room.phase === "lastguess" ? room.accuse : null,
      lastFailed: room.phase === "round" ? room.lastFailed || null : null,
      scores: room.scores || {}, result: null,
    },
    lobby, locations: LOC_NAMES,
  };
  if (room.phase === "accuse") {
    const t = tally(raw);
    out.voted = Object.keys(t);
    out.myVote = t[me] || "";
  }
  if (room.phase === "result") {
    out.room.result = Object.assign({}, room.result, { moleId: room.moleId, location: LOC_NAMES[room.loc] });
  }
  const seat = (room.players || []).find(p => p.id === me);
  if (seat && room.phase !== "lobby") {
    out.me = room.moleId === me
      ? { mole: true }
      : { mole: false, location: LOC_NAMES[room.loc], role: LOCATIONS[room.loc][1][room.roles[me] % LOCATIONS[room.loc][1].length] };
  }
  return out;
}

// Score the round and move to the result screen. Mole win: +2 to the Mole. Crew win: +1 to everyone else.
const MOLE_WINS = ["framed", "timeup", "guessed", "lastguess"];
function finish(room, result) {
  const moleWins = MOLE_WINS.includes(result.outcome);
  const sc = room.scores || {};
  for (const p of room.players) {
    sc[p.id] = sc[p.id] || 0;
    if (moleWins && p.id === room.moleId) sc[p.id] += 2;
    if (!moleWins && p.id !== room.moleId) sc[p.id] += 1;
  }
  room.scores = sc; room.result = Object.assign({ moleWins }, result);
  room.phase = "result"; room.tStart = room.tEnd = room.tLeft = 0;
}

// Only one request may end a round (two phones closing the same vote at once would score it twice).
async function claim(room, what) {
  const [got] = await redis([["SET", K(room.code).lock + ":" + room.round + ":" + what, "1", "NX", "EX", 120]]);
  return got === "OK";
}

// Time's up with nobody caught: the Mole wins. Checked whenever anyone talks to the server.
async function maybeTimeUp(raw) {
  const { room } = raw;
  if (room.phase !== "round" || !room.tEnd || Date.now() < room.tEnd) return false;
  if (!(await claim(room, "time"))) return false;
  finish(room, { outcome: "timeup", accusedId: "" });
  await redis([["SET", K(room.code).room, JSON.stringify(room), "EX", TTL]]);
  return true;
}

// Settle the accusation as soon as the outcome is certain (or when the host forces it; missing votes count as no).
async function maybeSettle(raw, force) {
  const { room } = raw;
  if (room.phase !== "accuse") return false;
  const t = tally(raw), n = voters(room).length;
  const yes = Object.values(t).filter(v => v === "yes").length;
  const missing = n - Object.keys(t).length;
  const need = Math.floor(n / 2) + 1;   // more than half of the other players
  let passed = null;
  if (yes >= need) passed = true;
  else if (yes + missing < need || (force && yes < need)) passed = false;
  if (passed === null) return false;
  if (!(await claim(room, "acc" + (room.accuseN || 0)))) return false;
  room.accuse.yes = yes; room.accuse.of = n;
  if (!passed) {
    // back to the round; the clock picks up where it paused
    room.phase = "round"; room.lastFailed = Object.assign({}, room.accuse);
    if (room.tLeft) { room.tEnd = Date.now() + room.tLeft; room.tStart = room.tEnd - room.timer * 1000; room.tLeft = 0; }
  } else if (room.accuse.target === room.moleId) {
    room.phase = "lastguess";
  } else {
    finish(room, { outcome: "framed", accusedId: room.accuse.target, by: room.accuse.by, yes, of: n });
  }
  await redis([["SET", K(room.code).room, JSON.stringify(room), "EX", TTL]]);
  return true;
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
      if (await maybeTimeUp(raw)) raw = await loadRaw(code);
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
        const room = { code, hostId: pid, phase: "lobby", round: 0, timer: 480, players: [], used: [], scores: {} };
        const k = K(code);
        const [ok] = await redis([["SET", k.room, JSON.stringify(room), "NX", "EX", TTL]]);
        if (ok !== "OK") {
          if (!want) continue;
          const ex = await loadRaw(want);   // party mode: this party's room already exists
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
    if (await maybeTimeUp(raw)) raw = await loadRaw(code);
    const { room } = raw, k = K(code);
    const isHost = pid === room.hostId;
    const seated = (room.players || []).some(p => p.id === pid);
    const touch = [["EXPIRE", k.players, TTL], ["EXPIRE", k.votes, TTL]];
    const saveRoom = () => redis([["SET", k.room, JSON.stringify(room), "EX", TTL], ...touch]);
    const tooLate = () => send(400, room.phase === "result" ? { error: "Time's up! The round is over." } : { error: "That can't happen right now." });

    if (action === "join") {
      const name = cleanName(body.name);
      if (!name) return send(400, { error: "Add your name first." });
      const existing = raw.lobby.find(p => p.id === pid);
      const taken = raw.lobby.find(p => p.id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (taken) return send(409, { error: `Someone named ${taken.name} is already in. Add a last initial.` });
      const [old] = await redis([["HGET", k.players, pid]]);
      const t = (parse(old) || {}).t || Date.now();
      await redis([["HSET", k.players, pid, JSON.stringify({ name, t: existing ? t : Date.now() })], ...touch]);
    } else if (action === "leave") {
      if (!isHost) await redis([["HDEL", k.players, pid]]);
    } else if (action === "accuse") {
      if (!seated) return send(403, { error: "You're not in this round." });
      if (room.phase !== "round") return tooLate();
      const who = cleanId(body.who);
      if (who === pid) return send(400, { error: "You can't accuse yourself." });
      if (!room.players.some(p => p.id === who)) return send(400, { error: "Pick one of the players." });
      room.accuseN = (room.accuseN || 0) + 1;
      room.accuse = { by: pid, target: who, n: room.accuseN };
      if (room.tStart && Date.now() < room.tEnd) { room.tLeft = Math.max(1000, room.tEnd - Date.now()); room.tStart = room.tEnd = 0; }
      room.phase = "accuse";
      await saveRoom();
      raw = await loadRaw(code);
      await maybeSettle(raw, false);   // with 3 players the accuser's yes can already decide it
    } else if (action === "vote") {
      if (room.phase !== "accuse") return tooLate();
      if (!seated) return send(403, { error: "You're not in this round." });
      if (pid === room.accuse.target) return send(400, { error: "You're the one accused, so you don't vote." });
      if (pid === room.accuse.by) return send(400, { error: "You made the accusation, so your vote is already yes." });
      const v = body.v === "yes" ? "yes" : body.v === "no" ? "no" : "";
      if (!v) return send(400, { error: "Vote yes or no." });
      await redis([["HSET", k.votes, pid, JSON.stringify({ b: ballotKey(room), v })], ...touch]);
      raw = await loadRaw(code);
      await maybeSettle(raw, false);
    } else if (action === "guess") {
      if (pid !== room.moleId) return send(403, { error: "Only the Mole can guess the location." });
      if (room.phase !== "round" && room.phase !== "lastguess") return tooLate();
      const g = +body.loc;
      if (!Number.isInteger(g) || g < 0 || g >= LOCATIONS.length) return send(400, { error: "Pick a location from the list." });
      if (!(await claim(room, "guess"))) return send(200, view(await loadRaw(code), pid));
      const right = g === room.loc, guess = LOC_NAMES[g];
      if (room.phase === "lastguess") finish(room, { outcome: right ? "lastguess" : "caught", accusedId: room.moleId, by: room.accuse.by, guess, yes: room.accuse.yes, of: room.accuse.of });
      else finish(room, { outcome: right ? "guessed" : "wrongguess", accusedId: "", guess });
      await saveRoom();
    } else {
      // Everything below is host only
      if (!isHost) return send(403, { error: "Only the host can do that." });
      if (action === "settings") {
        const t = +body.timer; if (TIMERS.includes(t)) room.timer = t;
      } else if (action === "kick") {
        const who = cleanId(body.who);
        if (who && who !== room.hostId) await redis([["HDEL", k.players, who]]);
      } else if (action === "start" || action === "next") {
        const players = raw.lobby.slice();
        if (players.length < MIN_PLAYERS) return send(400, { error: `You need at least ${MIN_PLAYERS} players.` });
        if (players.length > MAX_PLAYERS) return send(400, { error: `${MAX_PLAYERS} players max.` });
        if (action === "start") { room.round = 0; room.scores = {}; }
        let left = LOCATIONS.map((_, i) => i).filter(i => !(room.used || []).includes(i));
        if (!left.length) { room.used = []; left = LOCATIONS.map((_, i) => i); }
        room.loc = pick(left); room.used = (room.used || []).concat(room.loc);
        room.players = players; room.round += 1;
        room.moleId = pick(players).id; room.firstId = pick(players).id;
        const order = shuffle(LOCATIONS[room.loc][1].map((_, i) => i));
        room.roles = {}; players.filter(p => p.id !== room.moleId).forEach((p, i) => { room.roles[p.id] = order[i % order.length]; });
        room.phase = "round"; room.tStart = room.tEnd = room.tLeft = 0; room.accuseN = 0; room.accuse = null; room.lastFailed = null; room.result = null;
      } else if (action === "timer") {
        if (room.phase !== "round") return tooLate();
        const now = Date.now();
        if (room.tStart && now < room.tEnd) { room.tLeft = room.tEnd - now; room.tStart = room.tEnd = 0; }   // pause
        else if (room.tLeft) { room.tEnd = now + room.tLeft; room.tStart = room.tEnd - room.timer * 1000; room.tLeft = 0; }   // resume
        else { room.tStart = now + 3000; room.tEnd = room.tStart + room.timer * 1000; }
      } else if (action === "closevote") {
        await maybeSettle(raw, true);
        return send(200, view(await loadRaw(code), pid));
      } else if (action === "lobby") {
        room.phase = "lobby"; room.tStart = room.tEnd = room.tLeft = 0;
      } else {
        return send(400, { error: "Unknown action." });
      }
      await saveRoom();
    }
    return send(200, view(await loadRaw(code), pid));
  } catch (e) {
    return send(500, { error: "The game server had a problem. Try again in a moment." });
  }
};
module.exports.LOCATIONS = LOCATIONS;
