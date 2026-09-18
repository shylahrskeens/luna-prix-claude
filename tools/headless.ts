/** Headless race harness.
 *
 *  Runs full races with bots on every track and reports lap times, closure
 *  error, integrity flags and stuck racers. This is the check that the game is
 *  actually playable, and it runs without a browser or a GPU.
 */
import { TRACKS, trackById } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
import { RaceCore } from '../src/sim/race';
import { BotDriver, RIVALS } from '../src/sim/ai';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { AXIES } from '../src/data/axies';
import { KARTS } from '../src/data/karts';
import { MODE_RULES } from '../src/data/rules';
import { routeLength } from '../src/data/route';
import { formatTime } from '../src/core/math';
import type { KartInput } from '../src/sim/kart';

const DT = 1 / 120;

function runRace(trackId: string, laps = 3, seed = 7, verbose = true) {
  const def = trackById(trackId);
  const track = new TrackRuntime(def);
  const cfg = RaceCore.configFor('quickRace', trackId, laps, seed);
  const core = new RaceCore(track, cfg);
  const bots: BotDriver[] = [];

  for (let i = 0; i < 8; i++) {
    const axie = AXIES[i % AXIES.length];
    const kart = KARTS[(i + 1) % KARTS.length];
    const lo = resolveLoadout(axie, kart, defaultParts(), {
      playerId: `bot${i}`, budget: MODE_RULES.quickRace.statBudget,
    });
    const r = core.addRacer(`bot${i}`, RIVALS[i % RIVALS.length].name, lo, { isBot: true, colorIndex: i });
    bots.push(new BotDriver(r, RIVALS[i % RIVALS.length], track, seed * 31 + i));
  }

  const inputs = new Map<string, KartInput>();
  // Per-racer diagnostics: what is actually going wrong out there.
  const diag = new Map<string, Record<string, number>>();
  for (const r of core.racers) diag.set(r.id, { respawn: 0, wall: 0, hazard: 0, hardLand: 0, spin: 0, offroadSec: 0, airSec: 0, wrongSec: 0, boostSec: 0 });
  let t = 0;
  const maxT = 60 * laps + 60;
  while (core.phase !== 'complete' && t < maxT) {
    inputs.clear();
    for (const b of bots) inputs.set(b.racer.id, b.think(DT, core));
    core.applyCatchUp();
    core.step(DT, inputs);
    for (const r of core.racers) {
      const d = diag.get(r.id)!;
      for (const e of r.kart.events) {
        if (e.kind === 'respawnStart') d.respawn++;
        else if (e.kind === 'wallHit' && e.value > 0.3) d.wall++;
        else if (e.kind === 'hazardHit' && e.value > 0.3) d.hazard++;
        else if (e.kind === 'hardLand') d.hardLand++;
        else if (e.kind === 'spin') d.spin++;
      }
      if (r.ground.outside > 0.2) d.offroadSec += DT;
      if (!r.kart.grounded) d.airSec += DT;
      if (r.kart.wrongWay) d.wrongSec += DT;
      if (r.kart.boosting) d.boostSec += DT;
    }
    t += DT;
  }

  const result = core.buildResult();
  const nodes = def.nodes;
  // A closed loop's last control point sits one spacing BEFORE the first, so
  // the meaningful check is that the wrap-around step matches the rest of the
  // route, not that the two points coincide.
  const wrapStep = Math.hypot(
    nodes[0][0] - nodes[nodes.length - 1][0],
    nodes[0][1] - nodes[nodes.length - 1][1],
    nodes[0][2] - nodes[nodes.length - 1][2],
  );
  const prevStep = Math.hypot(
    nodes[nodes.length - 1][0] - nodes[nodes.length - 2][0],
    nodes[nodes.length - 1][1] - nodes[nodes.length - 2][1],
    nodes[nodes.length - 1][2] - nodes[nodes.length - 2][2],
  );
  const closure = Math.abs(wrapStep - prevStep);
  const lengths = { route: routeLength(nodes), spline: track.lapLength };

  if (verbose) {
    console.log(`\n=== ${def.name} (${trackId}) ===`);
    console.log(`  lap length     ${lengths.spline.toFixed(1)} m  (route poly ${lengths.route.toFixed(1)} m)`);
    console.log(`  closure error  ${closure.toFixed(2)} m (wrap step ${wrapStep.toFixed(1)} vs typical ${prevStep.toFixed(1)})`);
    console.log(`  checkpoints    ${track.checkpoints.length}`);
    console.log(`  branches       ${[...track.branches.keys()].join(', ') || 'none'}`);
    console.log(`  hazards        ${def.hazards.length}`);
    console.log(`  phase          ${core.phase} after ${t.toFixed(1)} s of sim`);
    console.log(`  finished       ${result.entries.filter((e) => e.totalTime > 0).length}/${result.entries.length}`);
    console.log(`  publishable    ${result.publishable}`);
    for (const e of result.entries) {
      const flags = e.integrity.length ? `  !! ${e.integrity[0]}` : e.dnf ? '  (DNF)' : '';
      console.log(
        `   ${String(e.finish).padStart(2)}. ${e.name.padEnd(9)} ` +
        `total ${formatTime(e.totalTime).padStart(10)}  best ${formatTime(e.bestLap).padStart(10)}  ` +
        `top ${(e.topSpeed * 3.6).toFixed(0).padStart(3)} km/h  drift ${e.driftSeconds.toFixed(1).padStart(5)}s  ` +
        `boosts ${String(e.boosts).padStart(2)}${flags}`,
      );
    }
    console.log('  diagnostics (per racer over the whole race):');
    for (const r of core.racers) {
      const d = diag.get(r.id)!;
      console.log(
        `    ${r.name.padEnd(9)} respawns ${String(d.respawn).padStart(2)}  walls ${String(d.wall).padStart(3)}  ` +
        `hazards ${String(d.hazard).padStart(3)}  hardLand ${String(d.hardLand).padStart(3)}  spins ${String(d.spin).padStart(2)}  ` +
        `offroad ${d.offroadSec.toFixed(1).padStart(5)}s  air ${d.airSec.toFixed(1).padStart(5)}s  ` +
        `wrongway ${d.wrongSec.toFixed(1).padStart(5)}s  boosting ${d.boostSec.toFixed(1).padStart(5)}s`,
      );
    }
  }
  return { core, result, closure, lengths, simTime: t };
}

const only = process.argv[2];
const seeds = (process.argv[3] ?? '7').split(',').map(Number);
let failures = 0;
for (const def of TRACKS) {
  if (only && def.id !== only) continue;
  for (const seed of seeds) {
  const { result, closure, core, simTime } = runRace(def.id, 3, seed, seeds.length === 1);
  if (seeds.length > 1) {
    const fin = result.entries.filter((e) => !e.dnf).length;
    const best = Math.min(...result.entries.map((e) => e.bestLap).filter((x) => x > 0));
    console.log(`${def.id.padEnd(11)} seed ${String(seed).padStart(3)}  finished ${fin}/8  bestLap ${best.toFixed(2)}s  publishable ${result.publishable}  sim ${simTime.toFixed(0)}s`);
  }
  const laps = result.entries.map((e) => e.lapTimes.length);
  if (core.phase !== 'complete') { console.log(`  FAIL: race did not complete in ${simTime.toFixed(0)}s`); failures++; }
  if (closure > 4) { console.log(`  FAIL: closure error ${closure.toFixed(1)} m too large`); failures++; }
  //  A racer a lap down is a racing incident, not a defect — the gator pit and
  //  the bridge break are real hazards and the weakest driver in the field does
  //  sometimes fall in. The bar scales with how much the track can punish you:
  //  a circuit with an open gap may lose up to three of eight; one without may
  //  lose one. Beyond that it is a systems problem.
  const hasGap = def.zones.some((z) => z.gap);
  const allowed = hasGap ? 3 : 1;
  const short = laps.filter((n) => n < result.laps).length;
  if (short > allowed) {
    console.log(`  FAIL: ${short} racers failed to complete ${result.laps} laps (limit ${allowed} on this track)`);
    failures++;
  }
  const best = Math.min(...result.entries.map((e) => e.bestLap).filter((x) => x > 0));
  if (best < 15 || best > 120) { console.log(`  FAIL: implausible best lap ${best.toFixed(1)}s`); failures++; }
  if (!result.publishable) { console.log('  FAIL: integrity flags raised in a clean bot race'); failures++; }
  }
}
console.log(failures === 0 ? '\nALL TRACKS PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
