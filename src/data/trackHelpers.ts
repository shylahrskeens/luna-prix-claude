/** Helpers shared by the track definitions. */
import { v3 } from '../core/math';
import { Spline, type SplineNode } from '../sim/spline';
import type { TrackNodeTuple, RouteMark } from './route';

/** Build an alternate line by offsetting the main route.
 *
 *  Authoring a branch as free world coordinates means every change to the main
 *  line breaks the join. Offsetting the main spline instead means a branch is
 *  described the way it plays — "swings four metres wide and climbs six" — and
 *  it can never detach.
 */
export function offsetBranch(
  nodes: TrackNodeTuple[],
  inU: number,
  outU: number,
  shape: (t: number) => { lat: number; lift: number },
  samples = 12,
): [number, number, number][] {
  const sn: SplineNode[] = nodes.map(([x, y, z, w, bankDeg]) => ({
    p: v3(x, y, z), w, bank: (bankDeg * Math.PI) / 180,
  }));
  const spline = new Spline(sn, true);
  const L = spline.length;
  const out: [number, number, number][] = [];
  const span = (outU - inU + 1) % 1 || (outU - inU);
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    const s = (inU + span * t) * L;
    const sm = spline.sample(s);
    const { lat, lift } = shape(t);
    out.push([
      sm.pos.x + sm.right.x * lat,
      sm.pos.y + sm.right.y * lat + lift,
      sm.pos.z + sm.right.z * lat,
    ]);
  }
  return out;
}

/** Build an alternate line that is genuinely SHORTER than the main line.
 *
 *  A branch that merely bulges sideways is longer than the road it replaces,
 *  no matter what the sign at the entry claims. This blends the main line
 *  toward the straight chord between the two join points, which is shorter by
 *  construction: `blend` 0 is the main line, 1 is the full chord.
 */
export function chordBranch(
  nodes: TrackNodeTuple[],
  inU: number,
  outU: number,
  blend: number,
  lift: (t: number) => number,
  samples = 12,
): [number, number, number][] {
  const sn: SplineNode[] = nodes.map(([x, y, z, w, bankDeg]) => ({
    p: v3(x, y, z), w, bank: (bankDeg * Math.PI) / 180,
  }));
  const spline = new Spline(sn, true);
  const L = spline.length;
  const span = (outU - inU + 1) % 1 || (outU - inU);
  const p0 = spline.sample(inU * L).pos;
  const p1 = spline.sample((inU + span) * L).pos;
  const out: [number, number, number][] = [];
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    const m = spline.sample((inU + span * t) * L).pos;
    const cx = p0.x + (p1.x - p0.x) * t;
    const cy = p0.y + (p1.y - p0.y) * t;
    const cz = p0.z + (p1.z - p0.z) * t;
    // Taper the blend at both ends so the branch leaves and rejoins smoothly.
    const taper = Math.sin(t * Math.PI) ** 0.45;
    const b = blend * taper;
    out.push([
      m.x + (cx - m.x) * b,
      m.y + (cy - m.y) * b + lift(t),
      m.z + (cz - m.z) * b,
    ]);
  }
  return out;
}

/** Point a fraction of the way through a named route segment. */
export function at(m: RouteMark, t: number): number {
  return m.from + (m.to - m.from) * t;
}
/** Sub-span of a named route segment. */
export function span(m: RouteMark, a: number, b: number): { from: number; to: number } {
  return { from: at(m, a), to: at(m, b) };
}
