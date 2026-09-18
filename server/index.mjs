/** Luna Prix authoritative race server.
 *
 *  The server owns race truth: it runs the same RaceCore the client does, at
 *  the same fixed step, from client inputs. Clients predict locally and are
 *  corrected from the snapshots this sends. Nothing a client claims about its
 *  own position, lap count or loadout is trusted — the loadout is recomputed
 *  from part ids against the server's own rules version, and the result of a
 *  race is the result this simulation produced.
 *
 *  Run:  npm run server         (defaults to port 8787)
 *  Then: open the game with ?server=ws://localhost:8787
 */
import { WebSocketServer } from 'ws';
import {
  TrackRuntime, RaceCore, BotDriver, RIVALS,
  resolveLoadout, defaultParts, NEUTRAL_INPUT,
  axieById, kartById, trackById,
  MODE_RULES, RULES_VERSION, ratingDelta, hashString,
} from './sim.mjs';

const PORT = Number(process.env.PORT || 8787);
const STEP = 1 / 120;
const SNAPSHOT_HZ = 20;
const LOBBY_WAIT_SECONDS = 12;
const MIN_PLAYERS_TO_START = 1;
const CAPACITY = 8;

let nextId = 1;
const rooms = new Map();

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

/** Recompute a loadout from part ids. A client's stat block is a claim; this
 *  is the number the race actually uses. */
function validateLoadout(claim, mode) {
  const problems = [];
  if (claim?.rulesVersion !== RULES_VERSION) {
    problems.push(`Client rules version ${claim?.rulesVersion} does not match server ${RULES_VERSION}`);
  }
  let axie, kart;
  try { axie = axieById(claim.axieId); } catch { problems.push('Unknown Axie'); }
  try { kart = kartById(claim.kartId); } catch { problems.push('Unknown kart'); }
  if (!axie || !kart) return { ok: false, problems };
  const rules = MODE_RULES[mode] ?? MODE_RULES.quickRace;
  const parts = claim.parts && typeof claim.parts === 'object' ? claim.parts : defaultParts();
  const lo = resolveLoadout(axie, kart, parts, {
    playerId: claim.playerId || `p${nextId++}`,
    budget: rules.statBudget,
    normalize: rules.ranked,
  });
  // resolveLoadout already trims anything over budget rather than rejecting,
  // so an out-of-spec client races a legal version of its own build.
  return { ok: true, loadout: lo, problems: [...problems, ...lo.problems] };
}

class Room {
  constructor(id, trackId, mode, laps) {
    this.id = id;
    this.trackId = trackId;
    this.mode = mode;
    this.laps = laps;
    this.track = new TrackRuntime(trackById(trackId));
    this.clients = new Map();
    this.core = null;
    this.bots = [];
    this.inputs = new Map();
    this.tick = 0;
    this.countdown = null;
    this.timer = null;
    this.acc = 0;
    this.last = 0;
    this.snapAcc = 0;
    this.finished = false;
  }

  get inProgress() {
    return this.core !== null && !this.finished;
  }

  lobbyState() {
    return {
      roomId: this.id,
      trackId: this.trackId,
      mode: this.mode,
      laps: this.laps,
      capacity: CAPACITY,
      inProgress: this.inProgress,
      countdown: this.countdown,
      members: [...this.clients.values()].map((c) => ({
        id: c.id, name: c.name, ready: c.ready,
        axieId: c.loadout.axieId, kartId: c.loadout.kartId,
        ping: c.ping, isLocal: false, isBot: false,
      })),
    };
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === 1) c.ws.send(s);
    }
  }

  pushLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }

  add(client) {
    if (this.clients.size >= CAPACITY) return false;
    // Late join: allowed into the lobby, but a race in progress is not
    // rewound for them. They watch and race the next one.
    this.clients.set(client.id, client);
    this.pushLobby();
    this.maybeStartCountdown();
    return true;
  }

  remove(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (this.core) {
      // A racer who leaves mid-race coasts under no input rather than
      // vanishing, so everyone else's race stays intact.
      this.inputs.delete(id);
    }
    this.pushLobby();
    if (this.clients.size === 0) this.stop();
  }

  maybeStartCountdown() {
    if (this.inProgress || this.countdown !== null) return;
    const ready = [...this.clients.values()].filter((c) => c.ready).length;
    if (ready >= MIN_PLAYERS_TO_START && ready === this.clients.size) {
      this.countdown = LOBBY_WAIT_SECONDS;
      this.tickCountdown();
    }
  }

  tickCountdown() {
    if (this.countdown === null) return;
    this.pushLobby();
    if (this.countdown <= 0) {
      this.countdown = null;
      this.start();
      return;
    }
    this.countdown -= 1;
    setTimeout(() => this.tickCountdown(), 1000);
  }

  start() {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.core = new RaceCore(this.track, RaceCore.configFor(this.mode, this.trackId, this.laps, seed));
    this.bots = [];
    this.finished = false;

    for (const c of this.clients.values()) {
      const r = this.core.addRacer(c.id, c.name, c.loadout, { isPlayer: false });
      c.racer = r;
    }
    // Fill the grid with bots so a one-player room is still a race.
    const fill = Math.max(0, Math.min(CAPACITY, 8) - this.clients.size);
    for (let i = 0; i < fill; i++) {
      const p = RIVALS[i % RIVALS.length];
      const pick = hashString(`${seed}:${p.name}`);
      const lo = resolveLoadout(
        axieById(['mock-buba', 'mock-puffy', 'mock-pomodoro'][pick % 3]),
        kartById(['kart-dartwing', 'kart-moonshard', 'kart-terrapin'][(pick >>> 3) % 3]),
        defaultParts(),
        { playerId: `bot-${i}`, budget: MODE_RULES[this.mode].statBudget, normalize: MODE_RULES[this.mode].ranked },
      );
      const r = this.core.addRacer(`bot-${i}`, p.name, lo, { isBot: true, skill: p.skill });
      this.bots.push(new BotDriver(r, p, this.track, hashString(`${seed}:${i}`)));
    }

    const members = [
      ...[...this.clients.values()].map((c) => ({
        id: c.id, name: c.name, ready: true,
        axieId: c.loadout.axieId, kartId: c.loadout.kartId,
        ping: c.ping, isLocal: false, isBot: false,
      })),
      ...this.bots.map((b) => ({
        id: b.racer.id, name: b.racer.name, ready: true,
        axieId: b.racer.loadout.axieId, kartId: b.racer.loadout.kartId,
        ping: null, isLocal: false, isBot: true,
      })),
    ];
    log(`room ${this.id}: start seed=${seed} players=${this.clients.size} bots=${this.bots.length}`);
    this.broadcast({ t: 'start', seed, startAt: Date.now(), members });

    this.last = Date.now();
    this.acc = 0;
    this.snapAcc = 0;
    this.timer = setInterval(() => this.step(), 1000 / 60);
  }

  step() {
    const now = Date.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;

    let steps = 0;
    while (this.acc >= STEP && steps < 16) {
      this.inputs.clear();
      for (const c of this.clients.values()) this.inputs.set(c.id, c.input);
      for (const b of this.bots) this.inputs.set(b.racer.id, b.think(STEP, this.core));
      this.core.applyCatchUp();
      this.core.step(STEP, this.inputs);
      this.acc -= STEP;
      this.tick++;
      steps++;
    }

    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_HZ) {
      this.snapAcc = 0;
      this.broadcast({
        t: 'snap',
        snap: {
          t: this.core.time,
          racers: this.core.racers.map((r) => ({
            id: r.id,
            s: r.kart.snapshot().map((v) => Math.round(v * 100) / 100),
            p: Math.round(r.progress.raw * 10000) / 10000,
            pos: r.progress.position,
          })),
        },
      });
    }

    if (this.core.phase === 'complete') this.finish();
  }

  finish() {
    const result = this.core.buildResult();
    log(`room ${this.id}: complete, publishable=${result.publishable}`);
    for (const c of this.clients.values()) {
      const entry = result.entries.find((e) => e.playerId === c.id);
      const accepted = !!entry && entry.integrity.length === 0 && result.publishable;
      let rating;
      if (accepted && MODE_RULES[this.mode].ranked) {
        c.rating += ratingDelta(c.rating, entry.finish, result.entries.length);
        rating = c.rating;
      }
      if (c.ws.readyState === 1) {
        c.ws.send(JSON.stringify({
          t: 'result',
          accepted,
          reason: accepted ? undefined : 'Result held: the server did not agree with it.',
          rating,
          authoritative: result,
        }));
      }
      c.ready = false;
    }
    this.stop();
    this.finished = true;
    this.core = null;
    this.pushLobby();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function roomFor(trackId, mode, laps, requested) {
  if (requested && rooms.has(requested)) return rooms.get(requested);
  for (const r of rooms.values()) {
    if (r.trackId === trackId && r.mode === mode && !r.inProgress && r.clients.size < CAPACITY) return r;
  }
  const id = requested || `r${Math.random().toString(36).slice(2, 8)}`;
  const room = new Room(id, trackId, mode, laps);
  rooms.set(id, room);
  return room;
}

const wss = new WebSocketServer({ port: PORT });
log(`Luna Prix server listening on ws://localhost:${PORT}`);
log(`rules ${RULES_VERSION}`);

wss.on('connection', (ws) => {
  const client = {
    id: `c${nextId++}`,
    ws,
    name: 'Racer',
    ready: false,
    ping: null,
    rating: 1000,
    input: { ...NEUTRAL_INPUT },
    room: null,
    loadout: null,
    racer: null,
  };
  ws.send(JSON.stringify({ t: 'hello', id: client.id, serverTime: Date.now() }));

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return; // never throw on a malformed frame
    }
    switch (m.t) {
      case 'join': {
        const mode = MODE_RULES[m.mode] ? m.mode : 'quickRace';
        let track;
        try { track = trackById(m.trackId); } catch {
          ws.send(JSON.stringify({ t: 'error', message: 'Unknown track' }));
          return;
        }
        const v = validateLoadout(m.loadout || {}, mode);
        if (!v.ok) {
          ws.send(JSON.stringify({ t: 'error', message: `Loadout rejected: ${v.problems.join('; ')}` }));
          return;
        }
        client.name = String(m.name || 'Racer').slice(0, 18);
        client.loadout = v.loadout;
        const room = roomFor(track.id, mode, Number(m.laps) || MODE_RULES[mode].laps, m.roomId);
        if (!room.add(client)) {
          ws.send(JSON.stringify({ t: 'error', message: 'Room is full' }));
          return;
        }
        client.room = room;
        if (v.problems.length) {
          ws.send(JSON.stringify({ t: 'error', message: `Loadout adjusted: ${v.problems.join('; ')}` }));
        }
        break;
      }
      case 'ready':
        client.ready = !!m.ready;
        client.room?.pushLobby();
        client.room?.maybeStartCountdown();
        break;
      case 'in': {
        // Bounded on arrival: no client can ask for more than full lock.
        const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
        client.input = {
          steer: Math.max(-1, Math.min(1, (Number(m.s) || 0) / 127)),
          throttle: clamp01((Number(m.a) || 0) / 15),
          brake: clamp01((Number(m.b) || 0) / 15),
          drift: !!m.d,
          lookBack: false,
        };
        break;
      }
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', sent: m.sent }));
        break;
      case 'result':
        // The client's own result is informational. The server already sent
        // its authoritative one when the race finished.
        ws.send(JSON.stringify({
          t: 'result', accepted: false,
          reason: 'Client-submitted results are not accepted; the server publishes its own.',
        }));
        break;
      case 'leave':
        client.room?.remove(client.id);
        client.room = null;
        break;
    }
  });

  ws.on('close', () => {
    client.room?.remove(client.id);
  });
  ws.on('error', () => {
    client.room?.remove(client.id);
  });
});

process.on('SIGINT', () => {
  log('shutting down');
  for (const r of rooms.values()) r.stop();
  wss.close(() => process.exit(0));
});
