/** Follow one racer through a full race and print every state change. */
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
const watchName = process.argv[3] ?? 'Cinder';
const track = new TrackRuntime(trackById(trackId));
const core = new RaceCore(track, RaceCore.configFor('quickRace', trackId, 3, 7));
const bots: BotDriver[] = [];
for (let i = 0; i < 8; i++) {
  const lo = resolveLoadout(AXIES[i % 3], KARTS[(i + 1) % 3], defaultParts(), { playerId: `bot${i}`, budget: MODE_RULES.quickRace.statBudget });
  const r = core.addRacer(`bot${i}`, RIVALS[i % RIVALS.length].name, lo, { isBot: true });
  bots.push(new BotDriver(r, RIVALS[i % RIVALS.length], track, 7 * 31 + i));
}
const watch = core.racers.find((r) => r.name === watchName)!;
const watchBot = bots.find((b) => b.racer === watch)!;
const inputs = new Map<string, KartInput>();
let t = 0;
let lastBranch: string | null = null;
let lastMode = '';
let lastLog = -1;
while (core.phase !== 'complete' && t < 400) {
  inputs.clear();
  for (const b of bots) inputs.set(b.racer.id, b.think(DT, core));
  core.step(DT, inputs);
  const k = watch.kart;
  const g = watch.ground;
  const tag = `t=${t.toFixed(2)} u=${g.u.toFixed(3)} raw=${watch.progress.raw.toFixed(3)} y=${k.pos.y.toFixed(1)} spd=${k.speed.toFixed(1)}`;
  for (const e of k.events) {
    if (e.kind === 'respawnStart' || e.kind === 'spin' || e.kind === 'hardLand') {
      console.log(`${tag} EVENT ${e.kind} v=${e.value.toFixed(2)} branch=${g.onBranch} committed=${watchBot.committedBranch} out=${g.outside.toFixed(1)} oob=${g.outOfBounds} gap=${g.gap}`);
    }
  }
  if (watchBot.committedBranch !== lastBranch) {
    console.log(`${tag} COMMIT ${lastBranch} -> ${watchBot.committedBranch}`);
    lastBranch = watchBot.committedBranch;
  }
  if (k.mode !== lastMode) { console.log(`${tag} MODE ${lastMode} -> ${k.mode}`); lastMode = k.mode; }
  if (k.speed < 6 && t - lastLog > 1.0 && core.phase === 'racing') {
    console.log(`${tag} SLOW branch=${g.onBranch} out=${g.outside.toFixed(1)} grounded=${k.grounded} stuck=${k.stuckTimer.toFixed(1)} wrong=${k.wrongWay}`);
    lastLog = t;
  }
  t += DT;
}
console.log(`END phase=${core.phase} t=${t.toFixed(1)} ${watchName} laps=${watch.progress.lapTimes.length} raw=${watch.progress.raw.toFixed(2)}`);
