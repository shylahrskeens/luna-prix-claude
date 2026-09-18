/** Builds the visible track from the same spline the simulation drives on.
 *
 *  Everything here is generated, not authored: the road ribbon, the kerbs, the
 *  guard rails, the boost pads, the checkpoint gates, the start banner and the
 *  alternate lines. Because it reads the same TrackRuntime the physics reads,
 *  what you see is exactly what you can drive on — an edge that looks solid is
 *  solid, and a hole that looks open is open.
 */
import * as THREE from 'three';
import type { TrackRuntime } from '../sim/track';
import type { MaterialLibrary } from './scene';
import { SURFACE, type Surface } from '../sim/trackTypes';
import { clamp01, wrap } from '../core/math';

const SEG = 2.2; // metres between road cross-sections

interface RibbonOpts {
  /** Extra width beyond the drivable half-width, for the visual verge. */
  verge: number;
  /** How far the road sinks below the centreline at the edge. */
  camber: number;
  /** Vertical thickness of the road slab. */
  thickness: number;
}

function surfaceColor(s: Surface, theme: { roadTop: string; accent: string }): THREE.Color {
  switch (s) {
    case 'boost': return new THREE.Color(theme.accent);
    case 'dirt': return new THREE.Color('#8a6438');
    case 'mud': return new THREE.Color('#5a482c');
    case 'water': return new THREE.Color('#2f7a96');
    case 'metal': return new THREE.Color('#6b7484');
    case 'ice': return new THREE.Color('#cfe9f5');
    case 'grass': return new THREE.Color('#4e7a3c');
    default: return new THREE.Color(theme.roadTop);
  }
}

/** Build one closed road ribbon with vertex colours per surface. */
function buildRibbon(
  sampleAt: (s: number) => { pos: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; w: number },
  length: number,
  closed: boolean,
  surfaceAt: (s: number) => { surface: Surface; gap: boolean; shoulder: number },
  theme: { roadTop: string; roadEdge: string; accent: string },
  opts: RibbonOpts,
): { road: THREE.BufferGeometry; kerbs: THREE.BufferGeometry } {
  const count = Math.max(8, Math.round(length / SEG));
  const step = length / count;

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const kPos: number[] = [];
  const kNor: number[] = [];
  const kCol: number[] = [];
  const kIdx: number[] = [];

  const edgeCol = new THREE.Color(theme.roadEdge);
  // Subtle lane shading. A single flat colour across twenty-six metres of road
  // gives a driver nothing to judge their position against; darkening the
  // outer thirds is enough to read the width of the track at speed.
  const laneDark = 0.86;
  const kerbA = new THREE.Color('#e8e8ec');
  const kerbB = new THREE.Color('#d04a3a');

  // Cross-section: 6 points across (verge, edge, inner, inner, edge, verge).
  const rows: { valid: boolean; p: THREE.Vector3[]; c: THREE.Color[] }[] = [];
  for (let i = 0; i <= count; i++) {
    const s = i * step;
    const sm = sampleAt(wrap(s, length));
    const info = surfaceAt(wrap(s, length));
    const c = surfaceColor(info.surface, theme);
    const w = sm.w;
    // The visible verge extends to exactly where the physics still supports a
    // kart. Drawing a 2 m verge over a 4.5 m drivable shoulder means a player
    // who runs wide is driving on thin air, which is both ugly and a lie about
    // where the track ends.
    const verge = Math.max(opts.verge, info.shoulder);
    const mk = (lat: number, drop: number) =>
      new THREE.Vector3(
        sm.pos.x + sm.right.x * lat - sm.up.x * drop,
        sm.pos.y + sm.right.y * lat - sm.up.y * drop,
        sm.pos.z + sm.right.z * lat - sm.up.z * drop,
      );
    // The edge band is the outer 8% of the road, not 38% of it: the surface
    // colour has to be what a driver actually sees, or every track reads as
    // the colour of its verge.
    const cInner = c.clone();
    const cOuter = c.clone().multiplyScalar(laneDark);
    rows.push({
      valid: !info.gap,
      p: [
        mk(-w - verge, opts.camber * 1.9),
        mk(-w, opts.camber),
        mk(-w * 0.92, opts.camber * 0.25),
        mk(-w * 0.40, opts.camber * 0.05),
        mk(w * 0.40, opts.camber * 0.05),
        mk(w * 0.92, opts.camber * 0.25),
        mk(w, opts.camber),
        mk(w + verge, opts.camber * 1.9),
      ],
      c: [edgeCol, edgeCol, cOuter, cInner, cInner, cOuter, edgeCol, edgeCol],
    });
  }

  const COLS = 8;
  const pushRow = (r: typeof rows[number]) => {
    for (let j = 0; j < COLS; j++) {
      pos.push(r.p[j].x, r.p[j].y, r.p[j].z);
      nor.push(0, 1, 0);
      col.push(r.c[j].r, r.c[j].g, r.c[j].b);
    }
  };
  for (const r of rows) pushRow(r);

  const rowCount = rows.length;
  for (let i = 0; i < rowCount - 1; i++) {
    // A gap removes the road entirely — the hole you see is the hole you fall in.
    if (!rows[i].valid || !rows[i + 1].valid) continue;
    const a = i * COLS;
    const b = (i + 1) * COLS;
    for (let j = 0; j < COLS - 1; j++) {
      idx.push(a + j, b + j, a + j + 1);
      idx.push(a + j + 1, b + j, b + j + 1);
    }
  }
  if (closed && rows[rowCount - 1].valid && rows[0].valid) {
    const a = (rowCount - 1) * COLS;
    for (let j = 0; j < COLS - 1; j++) {
      idx.push(a + j, j, a + j + 1);
      idx.push(a + j + 1, j, j + 1);
    }
  }

  // Kerbs: short alternating blocks sitting just outside the road edge, only
  // where the road actually curves. They are the corner's visual language.
  let kerbRun = 0;
  for (let i = 0; i < rowCount - 1; i++) {
    if (!rows[i].valid || !rows[i + 1].valid) { kerbRun = 0; continue; }
    const s = i * step;
    const sm = sampleAt(wrap(s, length));
    const sm2 = sampleAt(wrap(s + step, length));
    const turn = Math.abs(
      Math.atan2(sm2.right.x, sm2.right.z) - Math.atan2(sm.right.x, sm.right.z),
    );
    if (turn < 0.004 && turn > -0.004) { kerbRun = 0; continue; }
    kerbRun++;
    const c = Math.floor(kerbRun / 3) % 2 === 0 ? kerbA : kerbB;
    for (const side of [-1, 1] as const) {
      const base = kPos.length / 3;
      const inner = rows[i].p[side < 0 ? 1 : COLS - 2];
      const inner2 = rows[i + 1].p[side < 0 ? 1 : COLS - 2];
      const outer = rows[i].p[side < 0 ? 0 : COLS - 1];
      const outer2 = rows[i + 1].p[side < 0 ? 0 : COLS - 1];
      const lift = 0.10;
      const verts = [
        inner.x, inner.y + lift, inner.z,
        outer.x, outer.y + lift * 0.4, outer.z,
        inner2.x, inner2.y + lift, inner2.z,
        outer2.x, outer2.y + lift * 0.4, outer2.z,
      ];
      kPos.push(...verts);
      for (let q = 0; q < 4; q++) { kNor.push(0, 1, 0); kCol.push(c.r, c.g, c.b); }
      kIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  road.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  road.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  road.setIndex(idx);
  road.computeVertexNormals();
  road.computeBoundingSphere();

  const kerbs = new THREE.BufferGeometry();
  kerbs.setAttribute('position', new THREE.Float32BufferAttribute(kPos, 3));
  kerbs.setAttribute('normal', new THREE.Float32BufferAttribute(kNor, 3));
  kerbs.setAttribute('color', new THREE.Float32BufferAttribute(kCol, 3));
  kerbs.setIndex(kIdx);
  kerbs.computeVertexNormals();
  kerbs.computeBoundingSphere();
  void opts.thickness;
  return { road, kerbs };
}

export interface TrackVisual {
  group: THREE.Group;
  /** Boost pad meshes, so they can pulse. */
  pads: THREE.Mesh[];
  /** Start/finish banner, for the lights. */
  startLights: THREE.Mesh[];
}

export function buildTrackMesh(track: TrackRuntime, mats: MaterialLibrary): TrackVisual {
  const theme = track.def.theme;
  const group = new THREE.Group();
  const pads: THREE.Mesh[] = [];
  const startLights: THREE.Mesh[] = [];
  const L = track.lapLength;

  const vertexMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: mats.gradient });
  (vertexMat as unknown as { flatShading: boolean }).flatShading = true;

  // ---- main road ---------------------------------------------------------
  const scratch = { pos: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), w: 0 };
  const mainSample = (s: number) => {
    const sm = track.main.sample(s);
    scratch.pos.set(sm.pos.x, sm.pos.y, sm.pos.z);
    scratch.right.set(sm.right.x, sm.right.y, sm.right.z);
    scratch.up.set(sm.up.x, sm.up.y, sm.up.z);
    scratch.w = sm.w;
    return scratch;
  };
  const mainSurface = (s: number) => {
    const u = s / L;
    const z = track.zoneAt(u);
    return {
      surface: (z?.surface ?? 'road') as Surface,
      gap: z?.gap === true,
      shoulder: z?.shoulder ?? track.def.shoulder,
    };
  };
  const main = buildRibbon(mainSample, L, true, mainSurface, theme, { verge: 2.2, camber: 0.32, thickness: 1.2 });
  group.add(new THREE.Mesh(main.road, vertexMat));
  group.add(new THREE.Mesh(main.kerbs, vertexMat));

  // ---- alternate lines ---------------------------------------------------
  for (const [, b] of track.branches) {
    const bs = { pos: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), w: 0 };
    const sample = (s: number) => {
      const sm = b.spline.sample(s);
      bs.pos.set(sm.pos.x, sm.pos.y, sm.pos.z);
      bs.right.set(sm.right.x, sm.right.y, sm.right.z);
      bs.up.set(sm.up.x, sm.up.y, sm.up.z);
      bs.w = sm.w;
      return bs;
    };
    const surf = () => ({ surface: (b.def.surface ?? 'road') as Surface, gap: false, shoulder: 1.0 });
    const built = buildRibbon(sample, b.spline.length, false, surf, theme, { verge: 1.2, camber: 0.20, thickness: 0.8 });
    group.add(new THREE.Mesh(built.road, vertexMat));
    group.add(new THREE.Mesh(built.kerbs, vertexMat));

    // Support pillars under an elevated branch, so a bridge reads as a bridge.
    const pillarGeo = new THREE.CylinderGeometry(0.42, 0.62, 1, 6);
    const pillarMat = mats.toon(theme.rail);
    const pillars: THREE.Matrix4[] = [];
    for (let s = 6; s < b.spline.length - 6; s += 14) {
      const sm = b.spline.sample(s);
      const ground = track.main.project({ x: sm.pos.x, y: sm.pos.y, z: sm.pos.z });
      const drop = sm.pos.y - ground.height;
      if (drop < 2.2) continue;
      for (const side of [-1, 1] as const) {
        const m = new THREE.Matrix4();
        m.compose(
          new THREE.Vector3(
            sm.pos.x + sm.right.x * side * b.def.w * 0.8,
            sm.pos.y - drop / 2,
            sm.pos.z + sm.right.z * side * b.def.w * 0.8,
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(1, drop, 1),
        );
        pillars.push(m);
      }
    }
    if (pillars.length) {
      const inst = new THREE.InstancedMesh(pillarGeo, pillarMat, pillars.length);
      pillars.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
  }

  // ---- gaps: what is at the bottom of the hole ---------------------------
  //
  //  A hole in the road needs something in it. Without a floor and a wall, the
  //  gator pit is a strip of the same grass the verge is made of, and the one
  //  moment the track is remembered for reads as a rendering mistake.
  const gapPalette = theme.scenery === 'canopy'
    ? { floor: '#2f7a96', wall: '#4a3a24', glow: null as string | null }
    : theme.scenery === 'ruin'
      ? { floor: '#150f22', wall: '#3a3346', glow: theme.accent }
      : { floor: null as string | null, wall: '#98a5bb', glow: null as string | null };

  for (const gap of track.gaps) {
    const span = ((gap.to - gap.from + 1) % 1) * L;
    const steps = Math.max(4, Math.round(span / 4));
    const margin = 14;
    const floorPos: number[] = [];
    const floorIdx: number[] = [];
    const wallPos: number[] = [];
    const wallIdx: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const s = (gap.from * L - margin) + ((span + margin * 2) * i) / steps;
      const sm = track.main.sample(s);
      const half = sm.w + 10;
      const base = (floorPos.length / 3);
      for (const side of [-1, 1] as const) {
        floorPos.push(
          sm.pos.x + sm.right.x * side * half,
          gap.floorY,
          sm.pos.z + sm.right.z * side * half,
        );
      }
      if (i > 0) {
        const a = base - 2;
        floorIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      // Bank walls: from the lip height down to the floor at each edge.
      const wb = wallPos.length / 3;
      for (const side of [-1, 1] as const) {
        const edgeLat = side * (sm.w + 4);
        wallPos.push(
          sm.pos.x + sm.right.x * edgeLat, Math.max(gap.lipY - 1.5, gap.floorY + 0.5), sm.pos.z + sm.right.z * edgeLat,
          sm.pos.x + sm.right.x * side * (sm.w + 9.5), gap.floorY, sm.pos.z + sm.right.z * side * (sm.w + 9.5),
        );
      }
      if (i > 0) {
        for (const q of [0, 2]) {
          const a = wb - 4 + q;
          wallIdx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
        }
      }
    }

    if (gapPalette.floor) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(floorPos, 3));
      g.setIndex(floorIdx);
      g.computeVertexNormals();
      const floor = new THREE.Mesh(g, mats.toon(gapPalette.floor, { flat: false }));
      group.add(floor);
      if (gapPalette.glow) {
        const glowGeo = g.clone();
        const glowMesh = new THREE.Mesh(glowGeo, mats.glow(gapPalette.glow, 0.25));
        glowMesh.position.y = 0.4;
        group.add(glowMesh);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wg.setIndex(wallIdx);
    wg.computeVertexNormals();
    group.add(new THREE.Mesh(wg, mats.toon(gapPalette.wall)));

    // Distance markers along the far bank, so the leap has a scale.
    const markerMat = mats.glow('#ffffff', 0.75);
    for (let m = 1; m <= 3; m++) {
      const sm = track.main.sample(gap.from * L + (span * m) / 4);
      for (const side of [-1, 1] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), markerMat);
        post.position.set(
          sm.pos.x + sm.right.x * side * (sm.w + 6),
          gap.floorY + 1.1,
          sm.pos.z + sm.right.z * side * (sm.w + 6),
        );
        group.add(post);
      }
    }
  }

  // ---- guard rails -------------------------------------------------------
  // Rails are placed only where a zone actually has a barrier, so the visual
  // language never promises a wall that the physics will let you through.
  const postGeo = new THREE.BoxGeometry(0.26, 1.35, 0.26);
  const railGeo = new THREE.BoxGeometry(0.16, 0.34, SEG * 3.2);
  const railMat = mats.toon(theme.rail);
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s < L; s += SEG * 3) {
    const u = s / L;
    const z = track.zoneAt(u);
    const mode = z?.wall ?? 'both';
    if (mode === 'none' || z?.gap) continue;
    const shoulder = z?.shoulder ?? track.def.shoulder;
    const sm = track.main.sample(s);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(sm.fwd.x, sm.fwd.y, sm.fwd.z).normalize(),
    );
    for (const side of [-1, 1] as const) {
      if (mode === 'right' && side < 0) continue;
      if (mode === 'left' && side > 0) continue;
      const lat = side * (sm.w + shoulder);
      const p = new THREE.Vector3(
        sm.pos.x + sm.right.x * lat,
        sm.pos.y + sm.right.y * lat,
        sm.pos.z + sm.right.z * lat,
      );
      posts.push(new THREE.Matrix4().compose(p.clone().setY(p.y + 0.6), q, new THREE.Vector3(1, 1, 1)));
      rails.push(new THREE.Matrix4().compose(p.clone().setY(p.y + 0.95), q, new THREE.Vector3(1, 1, 1)));
    }
    void up;
  }
  if (posts.length) {
    const ip = new THREE.InstancedMesh(postGeo, railMat, posts.length);
    posts.forEach((m, i) => ip.setMatrixAt(i, m));
    ip.instanceMatrix.needsUpdate = true;
    group.add(ip);
    const ir = new THREE.InstancedMesh(railGeo, mats.toon(theme.accent), rails.length);
    rails.forEach((m, i) => ir.setMatrixAt(i, m));
    ir.instanceMatrix.needsUpdate = true;
    group.add(ir);
  }

  // ---- boost pads --------------------------------------------------------
  for (const pad of track.def.boostPads) {
    const spline = pad.branch ? track.branches.get(pad.branch)?.spline : track.main;
    if (!spline) continue;
    const s = pad.branch ? spline.length * pad.s : pad.s * L;
    const sm = spline.sample(s);
    const geo = new THREE.PlaneGeometry(pad.w, pad.len, 1, 3);
    const mesh = new THREE.Mesh(geo, mats.glow(theme.accent, 0.92));
    mesh.position.set(
      sm.pos.x + sm.right.x * pad.lat,
      sm.pos.y + sm.right.y * pad.lat + 0.055,
      sm.pos.z + sm.right.z * pad.lat,
    );
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(
        new THREE.Vector3(),
        new THREE.Vector3(sm.up.x, sm.up.y, sm.up.z),
        new THREE.Vector3(sm.fwd.x, sm.fwd.y, sm.fwd.z),
      ),
    );
    mesh.renderOrder = 2;
    group.add(mesh);
    pads.push(mesh);

    // Chevrons so the pad reads as a direction, not just a colour.
    for (let c = 0; c < 3; c++) {
      const chev = new THREE.Mesh(
        new THREE.ConeGeometry(pad.w * 0.28, pad.w * 0.34, 3),
        mats.glow('#ffffff', 0.85),
      );
      const off = (c - 1) * pad.len * 0.28;
      chev.position.set(
        sm.pos.x + sm.right.x * pad.lat + sm.fwd.x * off,
        sm.pos.y + sm.right.y * pad.lat + 0.10,
        sm.pos.z + sm.right.z * pad.lat + sm.fwd.z * off,
      );
      chev.rotation.set(Math.PI / 2, 0, -Math.atan2(sm.fwd.x, sm.fwd.z));
      chev.renderOrder = 3;
      group.add(chev);
    }
  }

  // ---- checkpoint gates --------------------------------------------------
  const gateMat = mats.toon(theme.rail);
  for (const c of track.checkpoints) {
    if (c.index === 0) continue; // the start line gets its own banner
    for (const side of [-1, 1] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.4, 0.34), gateMat);
      const lat = side * (c.w + 0.8);
      post.position.set(
        c.pos.x + c.right.x * lat,
        c.pos.y + c.right.y * lat + 1.7,
        c.pos.z + c.right.z * lat,
      );
      group.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.30, 8, 6), mats.glow(theme.accent, 0.95));
      lamp.position.copy(post.position).setY(post.position.y + 1.8);
      group.add(lamp);
    }
  }

  // ---- start / finish banner --------------------------------------------
  const sl = track.startLine();
  const bannerY = 6.2;
  for (const side of [-1, 1] as const) {
    const lat = side * (sl.w + 1.6);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, bannerY, 0.9), mats.toon(theme.rail));
    tower.position.set(sl.pos.x + sl.right.x * lat, sl.pos.y + bannerY / 2, sl.pos.z + sl.right.z * lat);
    group.add(tower);
  }
  const beamLen = (sl.w + 2) * 2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 1.5, 0.7), mats.toon(theme.accent));
  beam.position.set(sl.pos.x, sl.pos.y + bannerY, sl.pos.z);
  beam.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(sl.right.x, sl.right.z) - Math.PI / 2, 0));
  group.add(beam);
  for (let i = 0; i < 5; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), mats.glow('#3a1616'));
    const lat = (i - 2) * 1.9;
    lamp.position.set(
      sl.pos.x + sl.right.x * lat,
      sl.pos.y + bannerY - 1.1,
      sl.pos.z + sl.right.z * lat,
    );
    group.add(lamp);
    startLights.push(lamp);
  }
  // Chequered start line on the road.
  const lineGeo = new THREE.PlaneGeometry(sl.w * 2, 2.6, 16, 1);
  const lineColors: number[] = [];
  const lp = lineGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const on = Math.floor((lp.getX(i) + sl.w) / 1.4) % 2 === 0;
    lineColors.push(on ? 0.95 : 0.09, on ? 0.95 : 0.09, on ? 0.97 : 0.11);
  }
  lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  const lineMesh = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  lineMesh.position.set(sl.pos.x, sl.pos.y + 0.05, sl.pos.z);
  lineMesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(sl.fwd.x, sl.fwd.z));
  lineMesh.renderOrder = 2;
  group.add(lineMesh);

  // ---- route signs at each branch entry ----------------------------------
  for (const [, b] of track.branches) {
    const sm = track.main.sample(b.def.inS * L - 34);
    const side = 1;
    const lat = side * (sm.w + 2.6);
    const signPost = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), mats.toon(theme.rail));
    signPost.position.set(sm.pos.x + sm.right.x * lat, sm.pos.y + 1.6, sm.pos.z + sm.right.z * lat);
    group.add(signPost);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 0.14), mats.glow(theme.accent, 0.9));
    board.position.copy(signPost.position).setY(signPost.position.y + 1.9);
    board.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(-sm.fwd.x, -sm.fwd.z), 0));
    group.add(board);
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return { group, pads, startLights };
}

/** Pulse the boost pads and drive the start lights. */
export function animateTrack(v: TrackVisual, time: number, countdown: number | null): void {
  const pulse = 0.72 + 0.28 * Math.sin(time * 6);
  for (const p of v.pads) (p.material as THREE.MeshBasicMaterial).opacity = pulse;
  if (countdown === null) {
    for (const l of v.startLights) (l.material as THREE.MeshBasicMaterial).color.set('#1d3a22');
    return;
  }
  // Five lamps light left to right through the last three seconds, then all
  // go green at zero — the lights-out convention, readable at a glance.
  const lit = clamp01(1 - countdown / 3.2) * 5;
  v.startLights.forEach((l, i) => {
    const m = l.material as THREE.MeshBasicMaterial;
    if (countdown <= 0) m.color.set('#35ff7a');
    else m.color.set(i < lit ? '#ff3b30' : '#3a1616');
  });
}

export { SURFACE };
