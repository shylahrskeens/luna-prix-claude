/** Headless test client. Connects, joins, readies up, drives with the bot AI
 *  and reports what the server told it. Two of these is a real multiplayer
 *  test: same server, same room, independent sockets. */
import WebSocket from 'ws';
import { TrackRuntime, BotDriver, RIVALS, resolveLoadout, defaultParts,
         axieById, kartById, trackById, MODE_RULES } from '../server/sim.mjs';

const url = process.argv[2] ?? 'ws://localhost:8787';
const name = process.argv[3] ?? 'Tester';
const trackId = process.argv[4] ?? 'canopy';
const axieId = process.argv[5] ?? 'mock-buba';
const kartId = process.argv[6] ?? 'kart-moonshard';
const latency = Number(process.argv[7] ?? 0);   // simulated one-way ms
const loss = Number(process.argv[8] ?? 0);      // 0..1 packet loss

const track = new TrackRuntime(trackById(trackId));
const lo = resolveLoadout(axieById(axieId), kartById(kartId), defaultParts(), {
  playerId: name, budget: MODE_RULES.quickRace.statBudget,
});

const ws = new WebSocket(url);
let id = null, started = false, driver = null, snaps = 0, lastSnap = null;
let firstSnapAt = 0, lastPos = 0, corrections = [];

const send = (o) => {
  if (loss > 0 && Math.random() < loss) return;
  const fire = () => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  if (latency > 0) setTimeout(fire, latency); else fire();
};

ws.on('open', () => {
  send({ t: 'join', trackId, mode: 'quickRace', laps: 2, name,
    loadout: { playerId: name, axieId, kartId, parts: lo.parts,
      rulesVersion: lo.rulesVersion, validationToken: lo.validationToken } });
  setTimeout(() => send({ t: 'ready', ready: true }), 300);
});

ws.on('message', (raw) => {
  const handle = () => {
    const m = JSON.parse(String(raw));
    if (m.t === 'hello') id = m.id;
    if (m.t === 'error') console.log(`[${name}] server says: ${m.message}`);
    if (m.t === 'lobby' && !started) {
      const mine = m.lobby.members.find((x) => x.name === name);
      if (m.lobby.countdown !== null && m.lobby.countdown % 4 === 0) {
        console.log(`[${name}] lobby ${m.lobby.roomId}: ${m.lobby.members.length} in, start in ${m.lobby.countdown}s (me=${mine ? 'yes' : 'no'})`);
      }
    }
    if (m.t === 'start') {
      started = true;
      console.log(`[${name}] START seed=${m.seed} field=${m.members.length}`);
      // Drive with the bot AI against a LOCAL mirror of the race so the client
      // has something to send inputs from.
      const fake = { kart: null, ground: TrackRuntime.emptyGround(), progress: {}, isPlayer: true };
      void fake;
      driver = { t: 0 };
      let tick = 0;
      const iv = setInterval(() => {
        if (ws.readyState !== 1) { clearInterval(iv); return; }
        // Simple input: full throttle, steer toward the road from the snapshot.
        let steer = 0;
        if (lastSnap) {
          const me = lastSnap.racers.find((r) => r.id === id);
          if (me) {
            const pos = { x: me.s[0], y: me.s[1], z: me.s[2] };
            const g = track.ground(pos, undefined, TrackRuntime.emptyGround());
            const aim = track.pointOnRoad(g.s + 22, track.racingLineLat(g.s + 22));
            const want = Math.atan2(aim.x - pos.x, aim.z - pos.z);
            let err = want - me.s[6];
            while (err > Math.PI) err -= Math.PI * 2;
            while (err < -Math.PI) err += Math.PI * 2;
            steer = Math.max(-1, Math.min(1, err * 2.4));
          }
        }
        send({ t: 'in', k: tick++, s: Math.round(steer * 127), a: 15, b: 0, d: 0 });
      }, 1000 / 30);
    }
    if (m.t === 'snap') {
      snaps++;
      if (!firstSnapAt) firstSnapAt = Date.now();
      lastSnap = m.snap;
      const me = m.snap.racers.find((r) => r.id === id);
      if (me) { corrections.push(me.p - lastPos); lastPos = me.p; }
    }
    if (m.t === 'result') {
      const r = m.authoritative;
      const mine = r?.entries.find((e) => e.playerId === id);
      console.log(`[${name}] RESULT accepted=${m.accepted} finish=${mine?.finish}/${r?.entries.length} ` +
        `time=${mine?.totalTime?.toFixed(2)}s bestLap=${mine?.bestLap?.toFixed(2)}s ` +
        `publishable=${r?.publishable} snapshots=${snaps} ` +
        `rate=${(snaps / ((Date.now() - firstSnapAt) / 1000)).toFixed(1)}/s`);
      ws.close();
      process.exit(0);
    }
  };
  if (latency > 0) setTimeout(handle, latency); else handle();
});

ws.on('error', (e) => { console.log(`[${name}] socket error ${e.message}`); process.exit(1); });
setTimeout(() => { console.log(`[${name}] TIMEOUT after 200s`); process.exit(2); }, 200000);
