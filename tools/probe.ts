/** Focused probe: where on the track are racers losing time? */
import { trackById } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
import { RaceCore } from '../src/sim/race';
import { BotDriver, RIVALS } from '../src/sim/ai';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { AXIES } from '../src/data/axies';
import { KARTS } from '../src/data/karts';
import { MODE_RULES } from '../src/data/rules';
import type { KartInput } from '../src/sim/kart';

const DT = 1 / 120;
const trackId = process.argv[2] ?? 'ruin';
const def = trackById(trackId);
const track = new TrackRuntime(def);
const core = new RaceCore(track, RaceCore.configFor('quickRace', trackId, 2, 5));
const bots: BotDriver[] = [];
for (let i = 0; i < 3; i++) {
  const lo = resolveLoadout(AXIES[i % 3], KARTS[1], defaultParts(), { playerId: `b${i}`, budget: MODE_RULES.quickRace.statBudget });
  const r = core.addRacer(`b${i}`, RIVALS[i].name, lo, { isBot: true });
  bots.push(new BotDriver(r, RIVALS[i], track, 11 + i));
}
const BINS = 40;
const slow = new Float64Array(BINS);
const wrong = new Float64Array(BINS);
const wall = new Float64Array(BINS);
const off = new Float64Array(BINS);
const spd = new Float64Array(BINS);
const cnt = new Float64Array(BINS);
const inputs = new Map<string, KartInput>();
let t = 0;
while (core.phase !== 'complete' && t < 400) {
  inputs.clear();
  for (const b of bots) inputs.set(b.racer.id, b.think(DT, core));
  core.step(DT, inputs);
  for (const r of core.racers) {
    const b = Math.min(BINS - 1, Math.floor(r.ground.u * BINS));
    cnt[b] += DT;
    spd[b] += r.kart.speed * DT;
    if (r.kart.speed < 12) slow[b] += DT;
    if (r.kart.wrongWay) wrong[b] += DT;
    if (r.ground.outside > 0.1) off[b] += DT;
    for (const e of r.kart.events) if (e.kind === 'wallHit' && e.value > 0.25) wall[b] += 1;
  }
  t += DT;
}
console.log(`${def.name} — ${def.nodes.length} nodes, ${track.lapLength.toFixed(0)} m, ${t.toFixed(0)}s sim, phase ${core.phase}`);
console.log('bin   u        zone                 avg m/s   slow(s)  wrong(s)  off(s)  walls');
for (let i = 0; i < BINS; i++) {
  const u = (i + 0.5) / BINS;
  const z = track.zoneAt(u);
  const avg = cnt[i] > 0 ? spd[i] / cnt[i] : 0;
  const flag = avg < 18 || wrong[i] > 1 ? '  <<<' : '';
  console.log(
    `${String(i).padStart(3)} ${u.toFixed(3)}  ${(z?.label ?? '-').padEnd(20)} ` +
    `${avg.toFixed(1).padStart(7)}  ${slow[i].toFixed(1).padStart(7)}  ${wrong[i].toFixed(1).padStart(8)}  ` +
    `${off[i].toFixed(1).padStart(6)}  ${String(wall[i]).padStart(5)}${flag}`,
  );
}
