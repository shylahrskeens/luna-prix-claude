/** Track geometry validator.
 *
 *  Checks the things that silently corrupt a race: two pieces of road close
 *  enough in 3D that the projection can confuse them, corners tighter than any
 *  kart can take, respawn anchors in a hole, and gaps no kart can clear.
 */
import { TRACKS } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
import { KARTS } from '../src/data/karts';
import { AXIES } from '../src/data/axies';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { OPEN_STAT_BUDGET } from '../src/data/rules';
import { GRAVITY } from '../src/sim/kart';

let problems = 0;
const warn = (t: string, m: string) => { console.log(`  [WARN] ${t}: ${m}`); problems++; };

for (const def of TRACKS) {
  const track = new TrackRuntime(def);
  const L = track.lapLength;
  console.log(`\n${def.name} — ${L.toFixed(0)} m, ${def.checkpointCount} checkpoints`);

  // ---- 1. proximity of non-adjacent road ----------------------------------
  // Two samples far apart along the track but close in space make the nearest
  // point ambiguous, which shows up in play as a kart being told it is going
  // the wrong way, or teleporting a lap.
  const STEP = 4;
  const pts: { s: number; x: number; y: number; z: number; w: number }[] = [];
  for (let s = 0; s < L; s += STEP) {
    const sm = track.main.sample(s);
    pts.push({ s, x: sm.pos.x, y: sm.pos.y, z: sm.pos.z, w: sm.w });
  }
  let worst = { d: Infinity, a: 0, b: 0 };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const arc = Math.min(Math.abs(pts[i].s - pts[j].s), L - Math.abs(pts[i].s - pts[j].s));
      // 45 m: below this, two pieces of road are still 'the same corner'.
      // Above it, they are separate track that must not be confusable.
      if (arc < 45) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
      // The danger zone is anything within the two roads' combined half-widths.
      const need = pts[i].w + pts[j].w;
      if (d - need < worst.d - (worst.a ? 0 : 0)) {
        if (d < worst.d) worst = { d, a: pts[i].s, b: pts[j].s };
      }
      if (d < need * 1.05) {
        warn(def.id, `road at ${pts[i].s.toFixed(0)} m and ${pts[j].s.toFixed(0)} m are ${d.toFixed(1)} m apart (widths sum ${need.toFixed(1)} m) — projection can confuse them`);
        i = pts.length; break;
      }
    }
  }
  console.log(`  closest non-adjacent road: ${worst.d.toFixed(1)} m (at ${worst.a.toFixed(0)} m and ${worst.b.toFixed(0)} m)`);

  // ---- 2. corner severity -------------------------------------------------
  const slow = resolveLoadout(AXIES[2], KARTS[2], defaultParts(), { playerId: 'x', budget: OPEN_STAT_BUDGET });
  const minCornerSpeed = 9;
  let tightest = { k: 0, s: 0 };
  for (let s = 0; s < L; s += 2) {
    const k = Math.abs(track.main.curvatureAt(s));
    if (k > tightest.k) tightest = { k, s };
  }
  const tightRadius = tightest.k > 1e-5 ? 1 / tightest.k : Infinity;
  const vMax = Math.sqrt(slow.handling.grip * tightRadius);
  console.log(`  tightest corner: radius ${tightRadius.toFixed(0)} m at ${tightest.s.toFixed(0)} m → ${vMax.toFixed(1)} m/s for the heaviest kart`);
  if (vMax < minCornerSpeed) warn(def.id, `tightest corner forces below ${minCornerSpeed} m/s`);

  // ---- 3. respawn anchors -------------------------------------------------
  for (const c of track.checkpoints) {
    const g = TrackRuntime.emptyGround();
    track.ground(c.respawnPos, undefined, g);
    if (g.gap) warn(def.id, `checkpoint ${c.index} respawns into a gap`);
    if (g.outside > 0.5) warn(def.id, `checkpoint ${c.index} respawns ${g.outside.toFixed(1)} m off the road`);
  }

  // ---- 4. gaps are clearable ----------------------------------------------
  // Contiguous gap zones are one hole in the road; merge before measuring.
  const gaps: { from: number; to: number }[] = [];
  for (const z of def.zones.filter((q) => q.gap).sort((a, b) => a.from - b.from)) {
    const last = gaps[gaps.length - 1];
    if (last && Math.abs(z.from - last.to) < 1e-4) last.to = z.to;
    else gaps.push({ from: z.from, to: z.to });
  }
  for (const z of gaps) {
    const gapLen = ((z.to - z.from + 1) % 1) * L;
    // Slope at the lip and the height the landing sits at.
    const lipS = z.from * L - 1;
    const lip = track.main.sample(lipS);
    const land = track.main.sample(z.to * L + 4);
    const slope = lip.fwd.y;
    const drop = lip.pos.y - land.pos.y;
    // Ballistics for the slowest kart that could reasonably arrive here.
    for (const [label, v] of [['slow', 22], ['fast', 34]] as const) {
      const vy = v * slope;
      const vh = v * Math.sqrt(Math.max(0, 1 - slope * slope));
      // Solve for time to fall `drop` below the lip.
      const disc = vy * vy + 2 * GRAVITY * drop;
      const tAir = disc <= 0 ? 0 : (vy + Math.sqrt(disc)) / GRAVITY;
      const reach = vh * tAir;
      const verdict = reach >= gapLen ? 'clears' : 'FALLS SHORT';
      console.log(`  gap at u=${z.from.toFixed(3)} (${gapLen.toFixed(0)} m, lip slope ${slope.toFixed(2)}, drop ${drop.toFixed(1)} m): ${label} kart @${v} m/s reaches ${reach.toFixed(0)} m — ${verdict}`);
      if (label === 'fast' && reach < gapLen) warn(def.id, 'even a fast kart cannot clear this gap');
    }
  }

  // ---- 5. branches --------------------------------------------------------
  for (const [id, b] of track.branches) {
    const mainSpan = ((b.def.outS - b.def.inS + 1) % 1) * L;
    const delta = b.drivableLength - mainSpan;
    console.log(`  branch ${id}: ${b.drivableLength.toFixed(0)} m vs ${mainSpan.toFixed(0)} m on the main line (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} m)`);
    if (b.def.flavor === 'shorter-risky' && delta > 2) {
      warn(def.id, `branch ${id} is sold as shorter but is ${delta.toFixed(0)} m longer`);
    }
    if (b.def.flavor === 'longer-faster' && delta <= 0) {
      warn(def.id, `branch ${id} is labelled longer-faster but is not longer`);
    }
  }
}
console.log(problems === 0 ? '\nGEOMETRY OK\n' : `\n${problems} geometry warning(s)\n`);
