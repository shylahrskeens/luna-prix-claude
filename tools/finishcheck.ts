/** Does the race end cleanly once the PLAYER crosses the line?
 *
 *  The headless harness runs bots only, so it never exercises the tail that
 *  starts when a human finishes. This does: it makes racer 0 the player, drives
 *  everyone with bots, and measures how long the race sits in `finishing`, who
 *  ends up DNF, and whether the order survives.
 */
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
const NEUTRAL: KartInput = { accel: 0, brake: 0, steer: 0, drift: false, lookBack: false, item: false };

function run(trackId: string, seed: number, skipAfter: number | null) {
  const track = new TrackRuntime(trackById(trackId));
  const cfg = RaceCore.configFor('quickRace', trackId, 3, seed);
  const core = new RaceCore(track, cfg);
  const bots: BotDriver[] = [];
  for (let i = 0; i < 8; i++) {
    const lo = resolveLoadout(AXIES[i % AXIES.length], KARTS[(i + 1) % KARTS.length], defaultParts(), {
      playerId: `r${i}`, budget: MODE_RULES.quickRace.statBudget,
    });
    const r = core.addRacer(`r${i}`, RIVALS[i % RIVALS.length].name, lo, { isBot: i > 0, isPlayer: i === 0, colorIndex: i });
    bots.push(new BotDriver(r, RIVALS[i % RIVALS.length], track, seed * 31 + i));
  }
  const inputs = new Map<string, KartInput>();
  let playerDone = -1, completeAt = -1, skipped = false, frames = 0, framesAtDone = -1;
  for (let step = 0; step < 120 * 400 && core.phase !== 'complete'; step++) {
    inputs.clear();
    for (let i = 0; i < bots.length; i++) {
      const r = core.racers[i];
      inputs.set(r.id, r.progress.finished ? NEUTRAL : bots[i].think(DT, core));
    }
    core.applyCatchUp();
    core.step(DT, inputs);
    frames++;
    if (core.phase === 'finishing' && core.racers[0].progress.finished) {
      for (let k = 0; k < (core.hurry ? 240 : 24) && core.phase === 'finishing'; k++) {
        inputs.clear();
        for (let i = 0; i < bots.length; i++) {
          const r = core.racers[i];
          inputs.set(r.id, r.progress.finished ? NEUTRAL : bots[i].think(DT, core));
        }
        core.applyCatchUp();
        core.step(DT, inputs);
      }
    }
    if (playerDone < 0 && core.racers[0].progress.finished) { playerDone = core.time; framesAtDone = frames; }
    if (playerDone >= 0 && skipAfter != null && !skipped && core.time - playerDone >= skipAfter) { core.skipTail(); skipped = true; }
    if (core.phase === 'complete' && completeAt < 0) completeAt = core.time;
  }
  const res = core.buildResult();
  const tail = completeAt - playerDone;
  const wall = (frames - framesAtDone) / 120;   // frames the player actually sits through
  const dnf = res.entries.filter((e) => e.dnf).length;
  const order = res.entries.map((e) => `${e.finish}:${e.isPlayer ? 'YOU' : e.name.slice(0, 6)}${e.dnf ? '(DNF)' : ''}`).join(' ');
  const times = res.entries.map((e) => e.totalTime);
  const monotonic = times.every((t, i) => i === 0 || t >= times[i - 1] - 1e-6);
  console.log(
    `${trackId.padEnd(11)} seed ${String(seed).padStart(2)}  ${skipAfter == null ? 'tail runs ' : 'skip@' + skipAfter + 's  '}` +
    `player ${playerDone.toFixed(1)}s -> complete ${completeAt.toFixed(1)}s  tail ${tail.toFixed(2)}s  ` +
    `dnf ${dnf}  wait ${wall.toFixed(2)}s  times ascending ${monotonic}  ${order}`,
  );
  const playerDnf = !!res.entries.find((e) => e.isPlayer)?.dnf;
  return { tail, dnf, monotonic, playerDnf, wall, complete: core.phase === 'complete' };
}

let bad = 0;
for (const t of ['canopy', 'ruin', 'cloudforge']) {
  for (const seed of [3, 11, 23]) {
    const a = run(t, seed, null);
    const b = run(t, seed, 0.5);
    for (const r of [a, b]) {
      if (!r.complete) { console.log('  !! never completed'); bad++; }
      // A racer still out when the flag closes IS a DNF — that is honest. What must
      // never happen is the player being marked DNF after crossing the line.
      if (r.playerDnf) { console.log('  !! the player crossed the line and was marked DNF'); bad++; }
      if (!r.monotonic) { console.log('  !! finish times are not in finishing order'); bad++; }
    }
    if (a.wall > 3) { console.log(`  !! the player waits ${a.wall.toFixed(1)}s after finishing`); bad++; }
    if (b.wall > 1) { console.log(`  !! skip did not cut the wait (${b.wall.toFixed(2)}s)`); bad++; }
    if (a.dnf > 4) { console.log(`  !! ${a.dnf} racers written off as DNF`); bad++; }   // a lapped bot is a real DNF
  }
}
console.log(bad === 0 ? '\nFINISH OK' : `\n${bad} PROBLEMS`);
process.exit(bad === 0 ? 0 : 1);
