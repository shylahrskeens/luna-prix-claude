/** One bot, one lap, printed every 0.4 s: what is it doing and why. */
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
const track = new TrackRuntime(trackById(trackId));
const core = new RaceCore(track, RaceCore.configFor('timeTrial', trackId, 2, 5));
const lo = resolveLoadout(AXIES[0], KARTS[1], defaultParts(), { playerId: 'b', budget: MODE_RULES.timeTrial.statBudget });
const r = core.addRacer('b', 'Solo', lo, { isBot: true });
const bot = new BotDriver(r, RIVALS[2], track, 3);
const inputs = new Map<string, KartInput>();
let t = 0, last = -1;
console.log('   t     u    spd  thr brk str  drift  corner  curv     err   look   lat  dist2aim  zone');
while (core.phase !== 'complete' && t < 200) {
  const inp = bot.think(DT, core);
  inputs.set('b', inp);
  core.step(DT, inputs);
  if (r.progress.raw > 0 && r.progress.raw < 1 && t - last >= 0.4) {
    last = t;
    const k = r.kart;
    const maxLat = k.h.grip * (0.72 + 0.9 * 0.34);
    const corner = track.cornerSpeed(r.ground.s, maxLat, k.h.brake);
    const curv = track.main.curvatureAt(r.ground.s + 12);
    console.log(
      `${t.toFixed(1).padStart(5)} ${r.ground.u.toFixed(3)} ${k.speed.toFixed(1).padStart(5)} ` +
      `${inp.throttle.toFixed(1)} ${inp.brake.toFixed(1)} ${inp.steer.toFixed(2).padStart(5)}  ` +
      `${k.drifting ? 'D' + k.driftTier : ' -'}    ${(isFinite(corner) ? corner.toFixed(1) : ' inf').padStart(5)}  ` +
      `${curv.toFixed(4).padStart(7)}  ${bot.debug.err.toFixed(2).padStart(5)} ${bot.debug.look.toFixed(0).padStart(5)} ` +
      `${bot.debug.lat.toFixed(1).padStart(5)} ${Math.hypot(bot.debug.aimX - k.pos.x, bot.debug.aimZ - k.pos.z).toFixed(1).padStart(8)}  ` +
      `${track.zoneAt(r.ground.u)?.label ?? '-'}` +
      `${r.ground.outside > 0.1 ? '  OFF' : ''}${!k.grounded ? '  AIR' : ''}`,
    );
  }
  t += DT;
}
