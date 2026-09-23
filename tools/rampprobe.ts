/** Where does the Mega Ramp actually put a kart, and where are the hoops?
 *
 *  Drives one bot flat out down the runway and logs the flight: launch speed,
 *  air time, distance from the lip, apex height, and how far each ring sits
 *  from the arc. Run it after any change to the ramp or the rings.
 */
import { MEGA_RAMP_TRACK } from '../src/data/bonus';
import { TrackRuntime } from '../src/sim/track';
import { RaceCore } from '../src/sim/race';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { AXIES } from '../src/data/axies';
import { KARTS } from '../src/data/karts';
import { MODE_RULES } from '../src/data/rules';
import type { KartInput } from '../src/sim/kart';
import { BotDriver, RIVALS } from '../src/sim/ai';

const DT = 1 / 120;
const def = MEGA_RAMP_TRACK;
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
  const samples: string[] = [];
  for (let t = 0; t < 60; t += DT) {
    inputs.set(r.id, bot.think(DT, core));
    core.applyCatchUp();
    core.step(DT, inputs);
    const g = r.ground;
    if (Math.abs(t - Math.round(t)) < DT / 2 && Math.round(t) % 4 === 0 && kartIdx === 0) console.log(`    t=${t.toFixed(0)} mode=${k.mode} s=${g.s.toFixed(0)} lat=${g.lat.toFixed(1)} out=${g.outside.toFixed(1)} surf=${g.surface} wall=${g.wall} v=${k.speed.toFixed(1)} x=${k.pos.x.toFixed(1)} yaw=${k.yaw.toFixed(2)}`);
    if (!launched && !k.grounded && k.airTime > 0.05 && g.s > 0.3 * L) { launched = true; lipS = g.s; lipY = k.pos.y; lipV = k.speed; t0 = t; }
    if (launched && !k.grounded) {
      air = t - t0;
      if (k.pos.y > apex) { apex = k.pos.y; apexS = g.s; }
      if (Math.round(air * 4) === air * 4 || Math.abs(air * 4 - Math.round(air * 4)) < DT * 2) samples.push(`${(g.s - lipS).toFixed(0)}m:${(k.pos.y - lipY).toFixed(0)}m`);
    }
    if (launched && k.grounded && air > 0.5 && !landS) { landS = g.s; break; }
    if (k.mode !== 'driving' && k.mode !== 'frozen') break;
  }
  const rings = def.hazards.filter((h) => h.kind === 'ring').map((h) => {
    const s = h.s * L; const sm = track.main.sample(s);
    return `ring@${(s - lipS).toFixed(0)}m lat${'lat' in h ? h.lat : 0} y=${(sm.pos.y + ('h' in h ? h.h : 0) - lipY).toFixed(0)}m-above-lip`;
  });
  console.log(`${KARTS[kartIdx].name.padEnd(10)} lip speed ${lipV.toFixed(1)} m/s  air ${air.toFixed(2)} s  distance ${(landS - lipS).toFixed(0)} m  apex +${(apex - lipY).toFixed(0)} m at ${(apexS - lipS).toFixed(0)} m`);
  console.log(`  arc (every 0.25 s, along:height vs lip): ${samples.join(' ')}`);
  if (kartIdx === 0) console.log(`  rings: ${rings.join(' | ')}`);
}
