/** Where does Luna Launch actually put a kart, and where are the hoops?
 *
 *  Drives one bot flat out down the runway and logs the flight: launch speed,
 *  air time, distance from the lip, apex height, and how far each ring sits
 *  from the arc. Run it after any change to the ramp or the rings.
 */
import { LUNA_LAUNCH_TRACK } from '../src/data/bonus';
import { TrackRuntime } from '../src/sim/track';
import { RaceCore } from '../src/sim/race';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { AXIES } from '../src/data/axies';
import { KARTS } from '../src/data/karts';
import { MODE_RULES } from '../src/data/rules';
import type { KartInput } from '../src/sim/kart';
import { BotDriver, RIVALS } from '../src/sim/ai';

const DT = 1 / 120;
const def = LUNA_LAUNCH_TRACK;
const track = new TrackRuntime(def);
const L = track.lapLength;
for (const kartIdx of [0, 1, 2]) {
  const cfg = RaceCore.configFor('quickRace', def.id, 1, 7);
  const core = new RaceCore(track, cfg);
  const lo = resolveLoadout(AXIES[0], KARTS[kartIdx], defaultParts(), { playerId: 'p', budget: MODE_RULES.quickRace.statBudget });
  const r = core.addRacer('p', 'probe', lo, { isBot: true, isPlayer: false, colorIndex: 0 });
  const bot = new BotDriver(r, RIVALS[0], track, 99);
  const inputs = new Map<string, KartInput>();
  const k = r.kart;
  const slot = track.gridSlot(0);
  k.reset(slot.pos, slot.yaw);
  k.mode = 'frozen';
  track.ground(k.pos, undefined, r.ground);
  let launched = false, lipS = 0, lipY = 0, lipV = 0, t0 = 0, apex = -1e9, apexS = 0, landS = 0, air = 0;
  let lipX = 0, lipZ = 0;
  const lipGuess = -1e9;
  const samples: string[] = [];
  const table: string[] = [];
  const flight: [number, number, number][] = [];
  for (let t = 0; t < 60; t += DT) {
    inputs.set(r.id, bot.think(DT, core));
    core.applyCatchUp();
    core.step(DT, inputs);
    const g = r.ground;
    if (Math.abs(t - Math.round(t)) < DT / 2 && Math.round(t) % 4 === 0 && kartIdx === 0) console.log(`    t=${t.toFixed(0)} mode=${k.mode} s=${g.s.toFixed(0)} lat=${g.lat.toFixed(1)} out=${g.outside.toFixed(1)} surf=${g.surface} wall=${g.wall} v=${k.speed.toFixed(1)} x=${k.pos.x.toFixed(1)} yaw=${k.yaw.toFixed(2)}`);
    if (!launched && !k.grounded && k.airTime > 0.05 && g.s > 0.3 * L && k.pos.y > lipGuess - 1) { launched = true; lipS = g.s; lipY = k.pos.y; lipX = k.pos.x; lipZ = k.pos.z; lipV = k.speed; t0 = t; }
    if (launched && !k.grounded) {
      air = t - t0;
      if (k.pos.y > apex) { apex = k.pos.y; apexS = g.s; }
      flight.push([k.pos.x, k.pos.y, k.pos.z]);
      if (Math.abs(air * 10 - Math.round(air * 10)) < DT * 5) table.push(`[${(k.pos.z - lipZ).toFixed(1)}, ${(k.pos.y - lipY).toFixed(1)}, ${(k.pos.x - lipX).toFixed(1)}]`);
      if (Math.round(air * 4) === air * 4 || Math.abs(air * 4 - Math.round(air * 4)) < DT * 2) samples.push(`${(g.s - lipS).toFixed(0)}m:${(k.pos.y - lipY).toFixed(0)}m`);
    }
    if (launched && k.grounded && air > 0.5 && !landS) { landS = g.s; break; }
    if (k.mode !== 'driving' && k.mode !== 'frozen') break;
  }
  const rings = def.hazards.filter((h) => h.kind === 'ring' || h.kind === 'target' || h.kind === 'stack').map((h) => {
    const s = h.s * L; const sm = track.main.sample(s);
    return `${h.kind}@${(s - lipS).toFixed(0)}m lat${'lat' in h ? h.lat : 0} y=${(sm.pos.y + ('h' in h ? h.h : 0) - lipY).toFixed(0)}m-vs-lip`;
  });
  // The hill under the arc, every 20 m, so ring heights can be set against it.
  const hill: string[] = [];
  for (let d = 0; d <= Math.max(60, landS - lipS + 40); d += 20) { const sm = track.main.sample(lipS + d); hill.push(`${d}:${(sm.pos.y - lipY).toFixed(0)}`); }
  console.log(`${KARTS[kartIdx].name.padEnd(10)} lip speed ${lipV.toFixed(1)} m/s  air ${air.toFixed(2)} s  distance ${(landS - lipS).toFixed(0)} m  apex +${(apex - lipY).toFixed(0)} m at ${(apexS - lipS).toFixed(0)} m`);
  console.log(`  arc (every 0.25 s, along:height vs lip): ${samples.join(' ')}`);
  // The check that matters: how close does the flight pass to each hoop's
  // centre, in world metres? (Under the ring radius = threaded.)
  const misses = core.hazards.filter((h) => h.def.kind === 'ring').map((h, i) => {
    let best = Infinity;
    for (const [x, y, z] of flight) best = Math.min(best, Math.hypot(x - h.pos.x, y - h.pos.y, z - h.pos.z));
    const d = h.def as { r: number; bonus?: boolean; sweep?: number };
    return `${d.bonus ? 'B' : 'R'}${i}:${best.toFixed(1)}/${d.r}${d.sweep ? '±' + d.sweep : ''}`;
  });
  console.log(`  ring miss (closest approach / radius): ${misses.join(' ')}`);
  if (kartIdx === 0) console.log(`  lipU=${(lipS / L).toFixed(5)} L=${L.toFixed(1)} lipWorld=[${lipX.toFixed(1)}, ${lipY.toFixed(1)}, ${lipZ.toFixed(1)}] table(world: [dz, dy, dx] per 0.1s)=[${table.join(',')}]`);
  if (kartIdx === 0) { console.log(`  hazards: ${rings.join(' | ')}`); console.log(`  ground under arc (along:height vs lip): ${hill.join(' ')}`); }
}
