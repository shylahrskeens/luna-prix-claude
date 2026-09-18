/** Arc-length parameterised centripetal Catmull-Rom spline.
 *
 *  Every track in Luna Prix is a spline plus a cross-section. That single
 *  choice buys us, for free and consistently across all three tracks:
 *  lap progress, race position, wrong-way detection, out-of-bounds,
 *  respawn anchors, the AI racing line, the minimap, and camera look-ahead.
 */
import { clamp, lerp, v3, v3dist, v3sub, v3norm, v3cross, wrap, type V3 } from '../core/math';

export interface SplineNode {
  /** World position of the centreline at this node. */
  p: V3;
  /** Half-width of the drivable surface here, in metres. */
  w: number;
  /** Bank / camber in radians. Positive rolls the road to the right. */
  bank: number;
}

export interface SplineSample {
  /** Arc length from the start of the spline. */
  s: number;
  /** Centreline position. */
  pos: V3;
  /** Unit tangent (direction of travel). */
  fwd: V3;
  /** Unit right vector (horizontal, perpendicular to fwd). */
  right: V3;
  /** Surface normal after banking. */
  up: V3;
  /** Half-width here. */
  w: number;
  /** Bank angle here. */
  bank: number;
  /** Signed curvature (1/radius); positive turns right. */
  curvature: number;
}

export interface ProjectResult {
  /** Arc length of the nearest point on the centreline. */
  s: number;
  /** Signed lateral offset; positive is to the right of the racing direction. */
  lat: number;
  /** Height of the road surface under the query point. */
  height: number;
  /** Half-width at s. */
  w: number;
  /** How far outside the road edge the point is (0 when on the road). */
  outside: number;
  /** Sample at s, reused so callers can avoid a second lookup. */
  sample: SplineSample;
}

const SAMPLE_SPACING = 1.0; // metres between resampled points

/** Centripetal Catmull-Rom on four control points. */
function catmullRom(p0: V3, p1: V3, p2: V3, p3: V3, t: number, out: V3): V3 {
  const t2 = t * t;
  const t3 = t2 * t;
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return out;
}

export class Spline {
  readonly closed: boolean;
  readonly length: number;
  /** Resampled points at (approximately) uniform arc length. */
  private readonly pts: V3[] = [];
  private readonly fwds: V3[] = [];
  private readonly rights: V3[] = [];
  private readonly ups: V3[] = [];
  private readonly widths: number[] = [];
  private readonly banks: number[] = [];
  private readonly curvatures: number[] = [];
  private readonly spacing: number;
  /** Coarse XZ grid for O(1)-ish global projection. */
  private readonly grid = new Map<number, number[]>();
  private readonly cell = 12;

  constructor(nodes: SplineNode[], closed = true) {
    this.closed = closed;
    const n = nodes.length;
    if (n < 4) throw new Error('Spline needs at least 4 nodes');

    // Dense pass along the raw curve, then resample by arc length.
    const dense: { p: V3; w: number; bank: number }[] = [];
    const segCount = closed ? n : n - 1;
    const tmp = v3();
    for (let i = 0; i < segCount; i++) {
      const i0 = closed ? wrap(i - 1, n) : clamp(i - 1, 0, n - 1);
      const i1 = i;
      const i2 = closed ? wrap(i + 1, n) : clamp(i + 1, 0, n - 1);
      const i3 = closed ? wrap(i + 2, n) : clamp(i + 2, 0, n - 1);
      const a = nodes[i0], b = nodes[i1], c = nodes[i2], d = nodes[i3];
      const approx = Math.max(4, Math.ceil(v3dist(b.p, c.p) / 0.5));
      for (let k = 0; k < approx; k++) {
        const t = k / approx;
        const p = catmullRom(a.p, b.p, c.p, d.p, t, v3());
        dense.push({ p, w: lerp(b.w, c.w, t), bank: lerp(b.bank, c.bank, t) });
      }
    }
    if (!closed) {
      const last = nodes[n - 1];
      dense.push({ p: { ...last.p }, w: last.w, bank: last.bank });
    }

    // Cumulative arc length over the dense polyline.
    const cum: number[] = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + v3dist(dense[i - 1].p, dense[i].p));
    const closeLen = closed ? v3dist(dense[dense.length - 1].p, dense[0].p) : 0;
    const total = cum[cum.length - 1] + closeLen;

    const count = Math.max(8, Math.round(total / SAMPLE_SPACING));
    this.spacing = total / count;
    this.length = total;

    const sampleCount = closed ? count : count + 1;
    for (let i = 0; i < sampleCount; i++) {
      const target = i * this.spacing;
      // Walk the dense table (monotonic, so a linear cursor would do, but the
      // binary search keeps this independent of call order).
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const i1 = clamp(lo, 1, dense.length - 1);
      const i0 = i1 - 1;
      const segLen = cum[i1] - cum[i0];
      const t = segLen > 1e-6 ? (target - cum[i0]) / segLen : 0;
      const a = dense[i0], b = dense[i1];
      this.pts.push({ x: lerp(a.p.x, b.p.x, t), y: lerp(a.p.y, b.p.y, t), z: lerp(a.p.z, b.p.z, t) });
      this.widths.push(lerp(a.w, b.w, t));
      this.banks.push(lerp(a.bank, b.bank, t));
      void tmp;
    }

    // Frames. Forward from neighbours, right = fwd x worldUp, up from bank.
    const m = this.pts.length;
    for (let i = 0; i < m; i++) {
      const prev = this.pts[closed ? wrap(i - 1, m) : clamp(i - 1, 0, m - 1)];
      const next = this.pts[closed ? wrap(i + 1, m) : clamp(i + 1, 0, m - 1)];
      const fwd = v3norm(v3sub(next, prev));
      if (fwd.x === 0 && fwd.y === 0 && fwd.z === 0) fwd.z = 1;
      const rightFlat = v3norm(v3(fwd.z, 0, -fwd.x));
      const bank = this.banks[i];
      const cb = Math.cos(bank), sb = Math.sin(bank);
      // Roll the frame about the forward axis by `bank`.
      const upFlat = v3norm(v3cross(rightFlat, fwd));
      const right = v3(rightFlat.x * cb + upFlat.x * sb, rightFlat.y * cb + upFlat.y * sb, rightFlat.z * cb + upFlat.z * sb);
      const up = v3norm(v3cross(right, fwd));
      this.fwds.push(fwd);
      this.rights.push(right);
      this.ups.push(up);
    }
    // Signed curvature from heading change per metre.
    for (let i = 0; i < m; i++) {
      const a = this.fwds[closed ? wrap(i - 1, m) : clamp(i - 1, 0, m - 1)];
      const b = this.fwds[closed ? wrap(i + 1, m) : clamp(i + 1, 0, m - 1)];
      const ha = Math.atan2(a.x, a.z);
      const hb = Math.atan2(b.x, b.z);
      let d = hb - ha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvatures.push(d / (2 * this.spacing));
    }

    // Spatial hash of sample indices for global projection.
    for (let i = 0; i < m; i++) {
      const p = this.pts[i];
      const key = this.cellKey(p.x, p.z);
      let bucket = this.grid.get(key);
      if (!bucket) this.grid.set(key, (bucket = []));
      bucket.push(i);
    }
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    return (cx & 0xffff) * 65536 + (cz & 0xffff);
  }

  get sampleCount(): number {
    return this.pts.length;
  }

  /** Index of the resampled point nearest to arc length s. */
  private indexAt(s: number): number {
    const m = this.pts.length;
    const raw = s / this.spacing;
    return this.closed ? wrap(Math.round(raw), m) : clamp(Math.round(raw), 0, m - 1);
  }

  /** Normalise an arc length into the spline's domain. */
  normalizeS(s: number): number {
    return this.closed ? wrap(s, this.length) : clamp(s, 0, this.length);
  }

  /** Sample the centreline frame at arc length s (linearly interpolated). */
  sample(s: number, out?: SplineSample): SplineSample {
    const m = this.pts.length;
    const sn = this.normalizeS(s);
    const raw = sn / this.spacing;
    const i0 = this.closed ? wrap(Math.floor(raw), m) : clamp(Math.floor(raw), 0, m - 1);
    const i1 = this.closed ? wrap(i0 + 1, m) : clamp(i0 + 1, 0, m - 1);
    const t = raw - Math.floor(raw);
    const a = this.pts[i0], b = this.pts[i1];
    const fa = this.fwds[i0], fb = this.fwds[i1];
    const ra = this.rights[i0], rb = this.rights[i1];
    const ua = this.ups[i0], ub = this.ups[i1];
    const r: SplineSample = out ?? {
      s: 0, pos: v3(), fwd: v3(), right: v3(), up: v3(), w: 0, bank: 0, curvature: 0,
    };
    r.s = sn;
    r.pos.x = lerp(a.x, b.x, t); r.pos.y = lerp(a.y, b.y, t); r.pos.z = lerp(a.z, b.z, t);
    r.fwd.x = lerp(fa.x, fb.x, t); r.fwd.y = lerp(fa.y, fb.y, t); r.fwd.z = lerp(fa.z, fb.z, t);
    r.right.x = lerp(ra.x, rb.x, t); r.right.y = lerp(ra.y, rb.y, t); r.right.z = lerp(ra.z, rb.z, t);
    r.up.x = lerp(ua.x, ub.x, t); r.up.y = lerp(ua.y, ub.y, t); r.up.z = lerp(ua.z, ub.z, t);
    v3norm(r.fwd, r.fwd);
    v3norm(r.right, r.right);
    v3norm(r.up, r.up);
    r.w = lerp(this.widths[i0], this.widths[i1], t);
    r.bank = lerp(this.banks[i0], this.banks[i1], t);
    r.curvature = lerp(this.curvatures[i0], this.curvatures[i1], t);
    return r;
  }

  /** World position of a point `lat` metres right of the centreline at s. */
  pointAt(s: number, lat: number, out: V3 = v3()): V3 {
    const sm = this.sample(s, this.scratchSample);
    out.x = sm.pos.x + sm.right.x * lat;
    out.y = sm.pos.y + sm.right.y * lat;
    out.z = sm.pos.z + sm.right.z * lat;
    return out;
  }
  private scratchSample: SplineSample = {
    s: 0, pos: v3(), fwd: v3(), right: v3(), up: v3(), w: 0, bank: 0, curvature: 0,
  };

  /** Look up the curvature `ahead` metres down the road. */
  curvatureAt(s: number): number {
    return this.curvatures[this.indexAt(s)];
  }
  widthAt(s: number): number {
    return this.widths[this.indexAt(s)];
  }

  /** Project a world point onto the spline.
   *
   *  Vertical distance is weighted the same as horizontal. A track that passes
   *  over itself — the reactor spiral, the vine bridge — has two pieces of
   *  road at nearly the same x/z, and discounting height makes the projection
   *  flip between them, which reads downstream as a 200 metre teleport.
   *
   *  `hintS` restricts the search to a window around a previous result, which
   *  is both far faster and immune to the "nearest point is on the other side
   *  of a hairpin" failure that plagues naive projection. */
  project(p: V3, hintS?: number, out?: ProjectResult): ProjectResult {
    const m = this.pts.length;
    let best = -1;
    let bestD2 = Infinity;

    if (hintS !== undefined) {
      const centre = this.indexAt(hintS);
      // Wide enough to absorb a slow frame (26 m is 3 km/s at the simulation
      // step), narrow enough that it can never reach the far leg of a hairpin
      // and report a fifty-metre teleport.
      const window = 26;
      for (let k = -window; k <= window; k++) {
        const i = this.closed ? wrap(centre + k, m) : centre + k;
        if (i < 0 || i >= m) continue;
        const q = this.pts[i];
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      // If the hint clearly failed (we are far from the whole window), fall
      // back to a global search — and reset the distance with it. Keeping the
      // failed window's distance means the fallback compares against a value
      // the global minimum can only equal, never beat, so it finds nothing and
      // hands back index -1.
      if (bestD2 > 90 * 90) { best = -1; bestD2 = Infinity; }
    }

    if (best < 0) {
      // Grid-accelerated global search over the 3x3 cell neighbourhood, then a
      // full scan if that neighbourhood was empty (happens off in the scenery).
      const cx = Math.floor(p.x / this.cell);
      const cz = Math.floor(p.z / this.cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = this.grid.get((((cx + ox) & 0xffff) * 65536) + ((cz + oz) & 0xffff));
          if (!bucket) continue;
          for (const i of bucket) {
            const q = this.pts[i];
            const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = i; }
          }
        }
      }
      if (best < 0) {
        for (let i = 0; i < m; i++) {
          const q = this.pts[i];
          const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
      }
    }

    // A spline always has samples, so this cannot legitimately fail; guard
    // anyway rather than let a NaN escape into the physics.
    if (best < 0) best = 0;

    // Refine to sub-sample accuracy by projecting onto the local tangent.
    const q = this.pts[best];
    const f = this.fwds[best];
    const along = (p.x - q.x) * f.x + (p.y - q.y) * f.y + (p.z - q.z) * f.z;
    const s = this.normalizeS(best * this.spacing + clamp(along, -this.spacing, this.spacing));

    const r: ProjectResult = out ?? {
      s: 0, lat: 0, height: 0, w: 0, outside: 0,
      sample: { s: 0, pos: v3(), fwd: v3(), right: v3(), up: v3(), w: 0, bank: 0, curvature: 0 },
    };
    const sm = this.sample(s, r.sample);
    const dx = p.x - sm.pos.x, dy = p.y - sm.pos.y, dz = p.z - sm.pos.z;
    r.s = s;
    r.lat = dx * sm.right.x + dy * sm.right.y + dz * sm.right.z;
    r.w = sm.w;
    // Road height under the query point, following the bank.
    r.height = sm.pos.y + sm.right.y * r.lat;
    r.outside = Math.max(0, Math.abs(r.lat) - sm.w);
    return r;
  }

  /** Iterate the resampled centreline (for mesh building and minimaps). */
  forEachSample(fn: (i: number, pos: V3, fwd: V3, right: V3, up: V3, w: number) => void): void {
    for (let i = 0; i < this.pts.length; i++) {
      fn(i, this.pts[i], this.fwds[i], this.rights[i], this.ups[i], this.widths[i]);
    }
  }
  get spacingMeters(): number {
    return this.spacing;
  }
}
