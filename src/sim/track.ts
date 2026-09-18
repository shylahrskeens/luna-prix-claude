/** TrackRuntime — everything the simulation needs to ask about a track.
 *
 *  Owns the main spline, the alternate-line splines, zone lookup, hazard state
 *  and checkpoint geometry. Progress is ALWAYS measured on the main spline,
 *  even while a kart is physically on a branch, which is what makes shortcut
 *  validation and race position trivially correct.
 */
import {
  clamp, lerp, loopDelta, v3, v3add, v3norm, v3cross, v3sub, wrap, type V3,
} from '../core/math';
import { Spline, type SplineNode, type ProjectResult } from './spline';
import {
  SURFACE, type GroundInfo, type HazardDef, type Surface, type TrackDefinition, type ZoneDef,
} from './trackTypes';

/** Live state of one hazard at a given race time. Pure f(time). */
export interface HazardState {
  def: HazardDef;
  /** World position of the moving element. */
  pos: V3;
  /** 0..1 animation phase for the renderer. */
  phase: number;
  /** True while the hazard can actually hit something. */
  active: boolean;
  /** Effective collision radius right now. */
  radius: number;
  /** Warning ramp 0..1 — drives the telegraph VFX/audio before a strike. */
  telegraph: number;
  /** Cached anchor so the renderer does not re-project every frame. */
  anchor: V3;
  fwd: V3;
  right: V3;
}

export interface Checkpoint {
  index: number;
  s: number;
  u: number;
  pos: V3;
  fwd: V3;
  right: V3;
  w: number;
  /** Respawn anchor: slightly before the gate, on the centreline. */
  respawnPos: V3;
  respawnYaw: number;
}

function zoneContains(z: ZoneDef, u: number): boolean {
  if (z.from <= z.to) return u >= z.from && u < z.to;
  return u >= z.from || u < z.to; // wraps the start line
}

export class TrackRuntime {
  readonly def: TrackDefinition;
  readonly main: Spline;
  readonly branches = new Map<string, {
    def: TrackDefinition['branches'][number];
    spline: Spline;
    /** Arc length of the branch between the two join points, excluding the
     *  stitched lead-in and lead-out that exist only to give the spline ends
     *  a correct tangent. This is the number that may honestly be compared
     *  with the main line. */
    drivableLength: number;
    /** Arc length on the branch spline where the drivable part starts. */
    startS: number;
  }>();
  readonly checkpoints: Checkpoint[] = [];
  readonly lapLength: number;
  /** Zone lookup table at 1/512 lap resolution — zones never change at runtime. */
  private readonly zoneLut: (ZoneDef | null)[] = [];
  private readonly LUT = 512;
  private readonly padLut: Uint8Array;

  constructor(def: TrackDefinition) {
    this.def = def;
    const nodes: SplineNode[] = def.nodes.map(([x, y, z, w, bankDeg]) => ({
      p: v3(x, y, z), w, bank: (bankDeg * Math.PI) / 180,
    }));
    this.main = new Spline(nodes, true);
    this.lapLength = this.main.length;

    for (const b of def.branches) {
      // Stitch: start at the main line where the branch leaves, run the authored
      // points, and end back on the main line where it rejoins. The stitched
      // ends guarantee a seamless join with no geometry gap.
      const inPos = this.main.pointAt(b.inS * this.lapLength, 0);
      const outPos = this.main.pointAt(b.outS * this.lapLength, 0);
      const pre = this.main.pointAt((b.inS - 0.012) * this.lapLength, 0);
      const post = this.main.pointAt((b.outS + 0.012) * this.lapLength, 0);
      const pts: V3[] = [pre, inPos, ...b.nodes.map(([x, y, z]) => v3(x, y, z)), outPos, post];
      const bn: SplineNode[] = pts.map((p) => ({ p, w: b.w, bank: 0 }));
      const spline = new Spline(bn, false);
      const a = spline.project(inPos);
      const z = spline.project(outPos);
      this.branches.set(b.id, {
        def: b, spline,
        drivableLength: Math.max(1, z.s - a.s),
        startS: a.s,
      });
    }

    // Zone LUT.
    for (let i = 0; i < this.LUT; i++) {
      const u = (i + 0.5) / this.LUT;
      let found: ZoneDef | null = null;
      for (const z of def.zones) if (zoneContains(z, u)) found = z;
      this.zoneLut.push(found);
    }

    // Boost pads get their own coarse presence table so the per-frame query is
    // a single array read; exact bounds are checked only when the flag is set.
    this.padLut = new Uint8Array(this.LUT);
    for (const pad of def.boostPads) {
      const halfU = pad.len / 2 / this.lapLength;
      const a = Math.floor(wrap(pad.s - halfU, 1) * this.LUT);
      const b = Math.floor(wrap(pad.s + halfU, 1) * this.LUT);
      if (a <= b) for (let i = a; i <= b && i < this.LUT; i++) this.padLut[i] = 1;
      else {
        for (let i = a; i < this.LUT; i++) this.padLut[i] = 1;
        for (let i = 0; i <= b; i++) this.padLut[i] = 1;
      }
    }

    // Checkpoints, evenly spaced from the start line.
    const n = def.checkpointCount;
    for (let i = 0; i < n; i++) {
      const u = wrap(def.start.s + i / n, 1);
      const s = u * this.lapLength;
      const sm = this.main.sample(s);
      // Walk back from the gate until the anchor is on real road. Without this
      // a checkpoint that happens to fall inside a gap respawns the racer
      // straight back into the hole they just fell down — an infinite loop
      // that ends their race.
      let backS = s - 6;
      for (let guard = 0; guard < 40; guard++) {
        const bu = wrap(backS / this.lapLengthRaw, 1);
        const z = this.zoneForU(bu, def.zones);
        if (!z?.gap) break;
        backS -= 4;
      }
      const back = this.main.sample(backS);
      this.checkpoints.push({
        index: i,
        s, u,
        pos: { ...sm.pos },
        fwd: { ...sm.fwd },
        right: { ...sm.right },
        w: sm.w,
        respawnPos: v3(back.pos.x, back.pos.y + 0.6, back.pos.z),
        respawnYaw: Math.atan2(back.fwd.x, back.fwd.z),
      });
    }
  }

  private get lapLengthRaw(): number {
    return this.main.length;
  }
  /** Zone lookup that does not depend on the LUT, for use during construction. */
  private zoneForU(u: number, zones: ZoneDef[]): ZoneDef | null {
    let found: ZoneDef | null = null;
    for (const z of zones) if (zoneContains(z, u)) found = z;
    return found;
  }

  zoneAt(u: number): ZoneDef | null {
    return this.zoneLut[clamp(Math.floor(wrap(u, 1) * this.LUT), 0, this.LUT - 1)];
  }

  /** Grid slot `i` (0-based) in world space. */
  gridSlot(i: number): { pos: V3; yaw: number } {
    const g = this.def.start;
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? -1 : 1;
    const s = this.def.start.s * this.lapLength - 8 - row * g.rowGap;
    const sm = this.main.sample(s);
    const lat = col * g.colGap * 0.5;
    return {
      pos: v3(
        sm.pos.x + sm.right.x * lat,
        sm.pos.y + sm.right.y * lat + 0.5,
        sm.pos.z + sm.right.z * lat,
      ),
      yaw: Math.atan2(sm.fwd.x, sm.fwd.z),
    };
  }

  private scratch: ProjectResult | undefined;

  /** The core query. `hintS` is the kart's last known arc length. */
  ground(p: V3, hintS: number | undefined, out: GroundInfo): GroundInfo {
    const pr = this.main.project(p, hintS, this.scratch);
    this.scratch = pr;
    const u = pr.s / this.lapLength;
    const zone = this.zoneAt(u);
    const shoulder = zone?.shoulder ?? this.def.shoulder;

    out.s = pr.s;
    out.u = u;
    out.lat = pr.lat;
    out.width = pr.w;
    out.height = pr.height;
    out.curvature = pr.sample.curvature;
    out.fwd.x = pr.sample.fwd.x; out.fwd.y = pr.sample.fwd.y; out.fwd.z = pr.sample.fwd.z;
    out.normal.x = pr.sample.up.x; out.normal.y = pr.sample.up.y; out.normal.z = pr.sample.up.z;
    out.covered = zone?.covered ?? false;
    out.onBranch = null;
    out.gap = false;

    let surface: Surface = zone?.surface ?? 'road';
    let outside = pr.outside;
    let bestWidth = pr.w;

    // Which drivable surface is the kart actually on?
    //
    //  Comparing lateral offsets alone is not enough once a branch runs above
    //  or below the main line: a kart on the outer edge of the road is only a
    //  metre from the vine bridge in plan view, and gets snapped six metres
    //  into the air onto a bridge it never drove onto. Comparing true 3D
    //  distance to each surface answers the question correctly, and keeps a
    //  kart attached to the bridge while it is airborne over it.
    let bestDist = Math.hypot(outside, p.y - out.height);
    if (this.branches.size > 0) {
      for (const [id, b] of this.branches) {
        const d = b.def;
        const inU = d.inS, outU = d.outS;
        const within = inU <= outU ? u >= inU - 0.03 && u <= outU + 0.03
                                   : u >= inU - 0.03 || u <= outU + 0.03;
        if (!within) continue;
        const bp = b.spline.project(p);
        const bOutside = Math.max(0, Math.abs(bp.lat) - bp.w);
        const bDist = Math.hypot(bOutside, p.y - bp.height);
        if (bDist < bestDist) {
          bestDist = bDist;
          outside = bOutside;
          bestWidth = bp.w;
          out.height = bp.height;
          out.normal.x = bp.sample.up.x; out.normal.y = bp.sample.up.y; out.normal.z = bp.sample.up.z;
          out.onBranch = id;
          surface = d.surface ?? 'road';
        }
      }
    }

    // Gap zones remove the road entirely (the gator pit, the reactor break).
    if (zone?.gap && out.onBranch === null) {
      out.gap = true;
      out.height = this.def.killY + 1.0;
      surface = 'water';
    }

    // Boost pads override the surface where the kart is actually on one.
    if (!out.gap && this.padLut[clamp(Math.floor(u * this.LUT), 0, this.LUT - 1)]) {
      for (const pad of this.def.boostPads) {
        if (pad.branch && pad.branch !== out.onBranch) continue;
        if (!pad.branch && out.onBranch) continue;
        const ds = loopDelta(pad.s * this.lapLength, pr.s, this.lapLength);
        if (Math.abs(ds) <= pad.len / 2) {
          const lat = out.onBranch ? 0 : pr.lat;
          if (Math.abs(lat - pad.lat) <= pad.w / 2) { surface = 'boost'; break; }
        }
      }
    }

    out.surface = surface;
    out.outside = outside;
    out.onRoad = outside <= 0.01 && !out.gap;
    out.onShoulder = !out.onRoad && outside <= shoulder && !out.gap;
    out.outOfBounds = out.gap || outside > shoulder;
    if (out.onShoulder) out.surface = surface === 'boost' ? 'grass' : (zone?.surface === 'water' ? 'water' : 'grass');

    const wallMode = zone?.wall ?? 'both';
    const crossingRight = pr.lat > 0;
    out.wall =
      wallMode === 'both' ||
      (wallMode === 'right' && crossingRight) ||
      (wallMode === 'left' && !crossingRight);
    out.wallSign = crossingRight ? -1 : 1;
    // A wall sits at the outside edge of the shoulder, not at the road edge,
    // so drifting a wheel wide is a mistake rather than an instant stop.
    if (out.wall && outside <= shoulder * 0.55) out.wall = false;
    void bestWidth;
    return out;
  }

  static emptyGround(): GroundInfo {
    return {
      height: 0, normal: v3(0, 1, 0), surface: 'road', s: 0, u: 0, lat: 0, width: 10,
      outside: 0, onRoad: true, onShoulder: false, outOfBounds: false, wall: false,
      wallSign: 1, gap: false, covered: false, onBranch: null, curvature: 0, fwd: v3(0, 0, 1),
    };
  }

  surfaceProps(s: Surface) {
    return SURFACE[s];
  }

  // ---- hazards ---------------------------------------------------------

  private hazardStates: HazardState[] | null = null;

  /** Allocate the hazard state array once. */
  initHazards(): HazardState[] {
    if (this.hazardStates) return this.hazardStates;
    this.hazardStates = this.def.hazards.map((def) => {
      const s = ('s' in def ? def.s : 0) * this.lapLength;
      const sm = this.main.sample(s);
      const lat = 'lat' in def ? def.lat : 0;
      const anchor = v3(
        sm.pos.x + sm.right.x * lat,
        sm.pos.y + sm.right.y * lat,
        sm.pos.z + sm.right.z * lat,
      );
      return {
        def,
        pos: { ...anchor },
        anchor,
        fwd: { ...sm.fwd },
        right: { ...sm.right },
        phase: 0,
        active: false,
        radius: 1,
        telegraph: 0,
      };
    });
    return this.hazardStates;
  }

  /** Advance every hazard to `time`. Deterministic, stateless, order-free. */
  updateHazards(time: number): HazardState[] {
    const list = this.initHazards();
    for (const h of list) {
      const d = h.def;
      switch (d.kind) {
        case 'gator': {
          // Jaws rise out of the water on a fixed cycle. Telegraph occupies the
          // last 30% of the closed phase so the bite is never a surprise.
          const t = wrap(time / d.period + d.phase, 1);
          h.phase = t;
          const bite = t < 0.34 ? Math.sin((t / 0.34) * Math.PI) : 0;
          h.pos.x = h.anchor.x;
          h.pos.z = h.anchor.z;
          h.pos.y = h.anchor.y - d.reach + bite * d.reach * 1.35;
          h.active = bite > 0.42;
          h.radius = (d.scale ?? 1) * 2.3;
          h.telegraph = t > 0.80 ? (t - 0.80) / 0.20 : bite > 0 ? 1 : 0;
          break;
        }
        case 'gate': {
          // Rotating temple gate. Passable when the opening lines up.
          const t = wrap(time / d.period + d.phase, 1);
          h.phase = t;
          h.pos.x = h.anchor.x; h.pos.y = h.anchor.y; h.pos.z = h.anchor.z;
          h.active = true;
          h.radius = d.span;
          h.telegraph = 1;
          break;
        }
        case 'panel': {
          // Bridge panel that drops and resets. Closed for most of the cycle.
          const t = wrap(time / d.period + d.phase, 1);
          h.phase = t;
          const open = t > 0.55 && t < 0.85;
          h.pos.x = h.anchor.x; h.pos.z = h.anchor.z;
          h.pos.y = h.anchor.y - (open ? 4.5 : 0);
          h.active = open;
          h.radius = d.w * 0.5;
          h.telegraph = t > 0.42 && t < 0.55 ? (t - 0.42) / 0.13 : 0;
          break;
        }
        case 'roller': {
          // Crystal roller sweeping across the road.
          const t = wrap(time / d.period + d.phase, 1);
          h.phase = t;
          const off = Math.sin(t * Math.PI * 2) * d.travel;
          h.pos.x = h.anchor.x + h.right.x * off;
          h.pos.y = h.anchor.y + d.r * 0.6;
          h.pos.z = h.anchor.z + h.right.z * off;
          h.active = true;
          h.radius = d.r;
          h.telegraph = 1;
          break;
        }
        case 'turbine': {
          h.phase = wrap(time * 0.6, 1);
          h.active = true;
          h.radius = d.len * 0.5;
          h.telegraph = 1;
          break;
        }
        case 'bumper': {
          h.phase = wrap(time * 0.35, 1);
          h.active = true;
          h.radius = d.r;
          h.telegraph = 1;
          break;
        }
        case 'ring': {
          h.phase = wrap(time * 0.25, 1);
          h.pos.y = h.anchor.y + d.h;
          h.active = false;
          h.radius = d.r;
          h.telegraph = 1;
          break;
        }
      }
    }
    return list;
  }

  /** World position and orientation of the start/finish banner. */
  startLine(): { pos: V3; fwd: V3; right: V3; w: number } {
    const sm = this.main.sample(this.def.start.s * this.lapLength);
    return { pos: { ...sm.pos }, fwd: { ...sm.fwd }, right: { ...sm.right }, w: sm.w };
  }

  /** Nearest checkpoint index at or before lap position u. */
  checkpointBefore(u: number): number {
    const n = this.checkpoints.length;
    const rel = wrap(u - this.def.start.s, 1);
    return clamp(Math.floor(rel * n), 0, n - 1);
  }

  /** Respawn pose for a kart that was last confirmed at checkpoint `cp`. */
  respawn(cp: number): { pos: V3; yaw: number } {
    const c = this.checkpoints[wrap(cp, this.checkpoints.length)];
    return { pos: { ...c.respawnPos }, yaw: c.respawnYaw };
  }

  /** A point on the ideal racing line at lap position u — used by the bots and
   *  by the ghost/minimap. Shifts to the inside of the coming corner. */
  racingLine(s: number, out: V3 = v3()): V3 {
    const sm = this.main.sample(s);
    const ahead = this.main.sample(s + 26);
    const k = (sm.curvature * 0.55 + ahead.curvature * 0.45);
    // Positive curvature turns right, so the line moves right (positive lat).
    const lat = clamp(k * 160, -1, 1) * sm.w * 0.62;
    out.x = sm.pos.x + sm.right.x * lat;
    out.y = sm.pos.y + sm.right.y * lat;
    out.z = sm.pos.z + sm.right.z * lat;
    return out;
  }

  /** Distance in metres to the next gap ahead of `s`, or Infinity.
   *  A driver approaching a jump must not brake for the corner beyond it. */
  gapAhead(s: number, within = 110): number {
    const step = 4;
    for (let d = 0; d < within; d += step) {
      const u = wrap((s + d) / this.lapLength, 1);
      if (this.zoneAt(u)?.gap) return d;
    }
    return Infinity;
  }

  /** A point `look` metres ahead along a branch, for a driver committed to it.
   *  Returns null once the branch has been left behind. */
  branchPointAhead(id: string, pos: V3, look: number, out: V3 = v3()): V3 | null {
    const b = this.branches.get(id);
    if (!b) return null;
    const pr = b.spline.project(pos);
    // Past the end: the branch has rejoined, hand the driver back to the main line.
    if (pr.s > b.spline.length - 2) return null;
    return b.spline.pointAt(Math.min(pr.s + look, b.spline.length - 1), 0, out);
  }

  /** How far a racer is from a branch's drivable surface. */
  branchOffset(id: string, pos: V3): number {
    const b = this.branches.get(id);
    if (!b) return Infinity;
    const pr = b.spline.project(pos);
    return Math.max(0, Math.abs(pr.lat) - pr.w);
  }

  /** Highest speed a kart may hold at `s` and still make every corner ahead.
   *
   *  For each point down the road it works out the speed that corner allows,
   *  then adds back the speed that can be shed braking over the distance to
   *  it. Taking the minimum is exactly a braking point. The previous version
   *  took the worst curvature in a fixed window, which made a bot brake for a
   *  hairpin forty metres before the straight leading to it had even started.
   */
  cornerSpeed(s: number, maxLat: number, brakeAccel = 20): number {
    let best = Infinity;
    for (let d = 0; d <= 110; d += 5) {
      const k = Math.abs(this.main.curvatureAt(s + d));
      if (k < 1e-4) continue;
      const corner = Math.sqrt(maxLat / k);
      const allowed = Math.sqrt(corner * corner + 2 * brakeAccel * d);
      if (allowed < best) best = allowed;
    }
    return best;
  }

  /** Total drivable length of the shortest branch between two lap positions —
   *  used by the route-choice HUD to say how much a shortcut actually saves. */
  branchDelta(id: string): number {
    const b = this.branches.get(id);
    if (!b) return 0;
    const mainSpan = wrap(b.def.outS - b.def.inS, 1) * this.lapLength;
    return b.drivableLength - mainSpan;
  }
}

/** Build the ground normal for a banked road, given the spline frame. */
export function bankedNormal(right: V3, fwd: V3, out: V3 = v3()): V3 {
  return v3norm(v3cross(right, fwd), out);
}

export { v3add, v3sub, lerp };
