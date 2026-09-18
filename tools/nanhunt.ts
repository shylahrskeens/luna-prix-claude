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
const trackId = process.argv[2] ?? 'canopy';
const track = new TrackRuntime(trackById(trackId));
const core = new RaceCore(track, RaceCore.configFor('quickRace', trackId, 3, 7));
const bots: BotDriver[] = [];
for (let i = 0; i < 8; i++) {
  const lo = resolveLoadout(AXIES[i % 3], KARTS[(i + 1) % 3], defaultParts(), { playerId: `bot${i}`, budget: MODE_RULES.quickRace.statBudget });
  const r = core.addRacer(`bot${i}`, RIVALS[i % RIVALS.length].name, lo, { isBot: true });
  bots.push(new BotDriver(r, RIVALS[i % RIVALS.length], track, 7 * 31 + i));
}
const inputs = new Map<string, KartInput>();
let t = 0;
const bad = (n: number) => !Number.isFinite(n);
while (core.phase !== 'complete' && t < 400) {
  inputs.clear();
  for (const b of bots) {
    const inp = b.think(DT, core);
    if (bad(inp.steer) || bad(inp.throttle) || bad(inp.brake)) {
      console.log(`NaN INPUT from ${b.racer.name} at t=${t.toFixed(2)}`, inp,
        'branch=', (b as unknown as { st: { branch: string | null } }).st?.branch,
        'pos=', b.racer.kart.pos, 'u=', b.racer.ground.u);
      process.exit(1);
    }
    inputs.set(b.racer.id, inp);
  }
  core.step(DT, inputs);
  for (const r of core.racers) {
    const k = r.kart;
    if (bad(k.pos.x) || bad(k.pos.y) || bad(k.pos.z) || bad(k.vel.x) || bad(k.yaw)) {
      console.log(`NaN STATE ${r.name} at t=${t.toFixed(2)} pos=`, k.pos, 'vel=', k.vel,
        'yaw=', k.yaw, 'mode=', k.mode, 'u=', r.ground.u, 'onBranch=', r.ground.onBranch,
        'grounded=', k.grounded, 'drift=', k.drifting);
      process.exit(1);
    }
  }
  t += DT;
}
console.log(`no NaN on ${trackId} in ${t.toFixed(0)}s, phase=${core.phase}`);
