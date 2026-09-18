/** Route builder.
 *
 *  A track is authored as the sequence a driver experiences it — "110 metres
 *  flat, then a 90 degree right at radius 70, then climb into a hairpin" —
 *  rather than as a list of coordinates. The builder integrates that into
 *  control points and closes the loop exactly.
 */
import { TAU, v3 } from '../core/math';
import { Spline, type SplineNode } from '../sim/spline';

export type RouteSeg =
  | { t: 'straight'; len: number; dy?: number; w?: number; bank?: number; mark?: string }
  | { t: 'turn'; angle: number; radius: number; dy?: number; w?: number; bank?: number; mark?: string };

/** Normalised lap span of a named segment, so zones, hazards and boost pads
 *  can be placed against the route the same way a designer talks about it
 *  ("the gap is the gator run") instead of against raw numbers that break the
 *  moment a corner radius changes. */
export interface RouteMark {
  from: number;
  to: number;
  /** Midpoint, the usual anchor for a single hazard. */
  mid: number;
}
export type RouteMarks = Record<string, RouteMark>;

export interface BuiltRoute {
  nodes: TrackNodeTuple[];
  marks: RouteMarks;
  length: number;
}

export interface RouteOptions {
  /** Starting position and heading (radians, 0 = +Z). */
  start?: [number, number, number];
  heading?: number;
  /** Default half-width. */
  width: number;
  /** Control point spacing, metres. */
  spacing?: number;
}

export type TrackNodeTuple = [number, number, number, number, number];

/** Build a closed loop from route segments.
 *
 *  Two corrections make hand-authoring practical:
 *  1. Turn angles are scaled so they sum to exactly one full revolution, so
 *     the track always ends pointing the way it started.
 *  2. Any residual position error is distributed linearly along the loop, so
 *     the ends meet exactly. With a well-authored route the correction is a
 *     metre or two spread over a kilometre and is invisible.
 */
export function buildRoute(segs: RouteSeg[], opts: RouteOptions): TrackNodeTuple[] {
  return buildRouteFull(segs, opts).nodes;
}

/** As `buildRoute`, plus the normalised span of every named segment. */
export function buildRouteFull(segs: RouteSeg[], opts: RouteOptions): BuiltRoute {
  const spacing = opts.spacing ?? 14;
  const [sx, sy, sz] = opts.start ?? [0, 0, 0];

  let turnSum = 0;
  for (const s of segs) if (s.t === 'turn') turnSum += s.angle;
  const sign = turnSum >= 0 ? 1 : -1;
  const scale = turnSum !== 0 ? (sign * TAU) / turnSum : 1;

  let x = sx, y = sy, z = sz;
  let heading = opts.heading ?? 0;
  let width = opts.width;
  let bank = 0;
  const pts: TrackNodeTuple[] = [];

  /** Running arc length, used to turn segment boundaries into lap fractions. */
  let dist = 0;
  const bounds: { mark?: string; from: number; to: number }[] = [];
  const push = () => pts.push([x, y, z, width, bank]);
  push();

  for (const seg of segs) {
    if (seg.w !== undefined) width = seg.w;
    const segBank = seg.bank ?? 0;
    const startDist = dist;
    if (seg.t === 'straight') {
      const steps = Math.max(1, Math.round(seg.len / spacing));
      const step = seg.len / steps;
      const dyStep = (seg.dy ?? 0) / steps;
      for (let i = 0; i < steps; i++) {
        x += Math.sin(heading) * step;
        z += Math.cos(heading) * step;
        y += dyStep;
        bank = segBank;
        dist += step;
        push();
      }
    } else {
      const angle = seg.angle * scale;
      const arc = Math.abs(angle) * seg.radius;
      const steps = Math.max(2, Math.round(arc / spacing));
      const dyStep = (seg.dy ?? 0) / steps;
      const aStep = angle / steps;
      for (let i = 0; i < steps; i++) {
        // Advance along the arc: turn half, move, turn half. Keeps the chord
        // centred on the true arc so the radius comes out right.
        heading += aStep / 2;
        const chord = 2 * seg.radius * Math.sin(Math.abs(aStep) / 2);
        x += Math.sin(heading) * chord;
        z += Math.cos(heading) * chord;
        heading += aStep / 2;
        y += dyStep;
        bank = segBank * (angle > 0 ? 1 : -1);
        dist += chord;
        push();
      }
    }
    bounds.push({ mark: seg.mark, from: startDist, to: dist });
  }

  // Drop the duplicated closing point, then distribute the closure error.
  pts.pop();
  const n = pts.length;
  const ex = pts[n - 1][0] + (pts[n - 1][0] - pts[n - 2][0]) - sx;
  const ey = pts[n - 1][1] - sy;
  const ez = pts[n - 1][2] + (pts[n - 1][2] - pts[n - 2][2]) - sz;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts[i][0] -= ex * t;
    pts[i][1] -= ey * t;
    pts[i][2] -= ez * t;
  }
  // Marks must be expressed in the SPLINE's arc length, not the polyline's.
  //
  //  The two differ: a Catmull-Rom curve bows outside the polygon through its
  //  control points, and it does so most in the corners, so the error is not a
  //  constant scale that cancels out — it accumulates. Left uncorrected, every
  //  zone, hazard and boost pad on the track sits tens of metres from the
  //  geometry it was authored against, and a jump ramp ends up behind the hole
  //  it is supposed to launch over.
  //
  //  So: build the real spline here, project each segment boundary's control
  //  point onto it, and hand back arc-length-true lap fractions.
  const sn: SplineNode[] = pts.map(([x, y, z, w, bankDeg]) => ({
    p: v3(x, y, z), w, bank: (bankDeg * Math.PI) / 180,
  }));
  const spline = new Spline(sn, true);
  const splineLength = spline.length;
  const total = dist || 1;

  // Control-point index at a given polyline distance. `bounds` were recorded
  // in the same order the points were pushed, one push per step.
  const idxForDist = (d: number): number => {
    const approx = Math.round((d / total) * (pts.length - 1));
    return Math.max(0, Math.min(pts.length - 1, approx));
  };
  const uAt = (d: number): number => {
    const i = idxForDist(d);
    const p = pts[i];
    return spline.project(v3(p[0], p[1], p[2])).s / splineLength;
  };

  const marks: RouteMarks = {};
  for (const b of bounds) {
    if (!b.mark) continue;
    const from = uAt(b.from);
    let to = uAt(b.to);
    if (to < from) to += 1; // the segment wraps the start line
    marks[b.mark] = { from, to, mid: (from + to) / 2 };
  }
  return { nodes: pts, marks, length: splineLength };
}

/** Approximate loop length, for sanity-checking a route while authoring. */
export function routeLength(pts: TrackNodeTuple[]): number {
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}
