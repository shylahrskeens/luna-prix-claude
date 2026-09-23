/** Procedural scenery.
 *
 *  Every prop is instanced and scattered from the track's own seed, so the
 *  three environments are dense but cost a handful of draw calls, and two
 *  players loading the same track see the same world.
 */
import * as THREE from 'three';
import { Rng, hashString, wrap } from '../core/math';
import type { TrackRuntime } from '../sim/track';
import type { MaterialLibrary } from './scene';

interface Scatter {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  matrices: THREE.Matrix4[];
}

/** Place props in a band beside the road, skipping anywhere they would block
 *  the racing surface or an alternate line. */
function bandScatter(
  track: TrackRuntime,
  rng: Rng,
  count: number,
  minOffRaw: number,
  maxOff: number,
  yJitter: number,
  scale: () => number,
  sink = 0,
): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const minOff = minOffRaw * (track.def.theme.sceneryScale && track.def.theme.sceneryScale < 1
    ? 1 + (1 - track.def.theme.sceneryScale) * 1.8 : 1);
  const L = track.lapLength;
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = rng.next() * L;
    const sm = track.main.sample(s);
    const side = rng.next() < 0.5 ? -1 : 1;
    const lat = side * (sm.w + minOff + rng.next() * (maxOff - minOff));
    const zone = track.zoneAt(wrap(s / L, 1));
    if (zone?.gap) continue;
    const sc = scale();
    v.set(
      sm.pos.x + sm.right.x * lat,
      sm.pos.y + sm.right.y * lat + rng.range(-yJitter, yJitter) - sink * sc,
      sm.pos.z + sm.right.z * lat,
    );
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    sv.set(sc * rng.range(0.85, 1.15), sc, sc * rng.range(0.85, 1.15));
    out.push(new THREE.Matrix4().compose(v, q, sv));
  }
  return out;
}

function addScatters(group: THREE.Group, scatters: Scatter[]): void {
  for (const sc of scatters) {
    if (!sc.matrices.length) continue;
    const inst = new THREE.InstancedMesh(sc.geo, sc.mat, sc.matrices.length);
    sc.matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
}

/** Terrariums-style ground: a flat checker of two land colours, tiles about
 *  six metres across, following the track's lowest height. Sky tracks skip it. */
const TILE_COLOURS: Record<string, [string, string]> = {
  savannah: ['#e6c37e', '#d9b26a'],
  forest:   ['#8ed06c', '#7bc25b'],
  mystic:   ['#c9a3e0', '#b98fd6'],
  arctic:   ['#dfeefa', '#cfe3f5'],
  canopy:   ['#6fae5c', '#62a050'],
  ruin:     ['#3b3150', '#342b48'],
};
function checkerTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 64, 64);
  g.fillStyle = b; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(350, 350);
  return t;
}
function addGround(group: THREE.Group, track: TrackRuntime, mats: MaterialLibrary): void {
  const key = track.def.theme.scenery;
  if (key === 'cloud' || key === 'arctic') return;
  let minY = Infinity;
  let cx = 0, cz = 0, n = 0;
  track.main.forEachSample((_i, p) => {
    minY = Math.min(minY, p.y);
    cx += p.x; cz += p.z; n++;
  });
  const geo = new THREE.PlaneGeometry(4200, 4200, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const [a, b] = TILE_COLOURS[key] ?? [track.def.theme.ground, track.def.theme.ground];
  const mat = new THREE.MeshToonMaterial({ map: checkerTexture(a, b), gradientMap: mats.gradient });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx / n, minY - 0.9, cz / n);
  group.add(mesh);
}

/** Shared chunky props, in the Terrariums manner: blob trees in tiers, tall
 *  pointed-roof houses, crop plots, fences, stumps, ponds. */
function blobTree(trunkH: number, r: number): { trunk: THREE.BufferGeometry; low: THREE.BufferGeometry; high: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(r * 0.16, r * 0.24, trunkH, 6); trunk.translate(0, trunkH / 2, 0);
  const low = new THREE.IcosahedronGeometry(r, 1); low.translate(0, trunkH + r * 0.7, 0);
  const high = new THREE.IcosahedronGeometry(r * 0.7, 1); high.translate(0, trunkH + r * 1.7, 0);
  return { trunk, low, high };
}
function pineTree(h: number): { trunk: THREE.BufferGeometry; a: THREE.BufferGeometry; b: THREE.BufferGeometry; c: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.3, 0.45, h * 0.3, 6); trunk.translate(0, h * 0.15, 0);
  const a = new THREE.ConeGeometry(h * 0.34, h * 0.45, 7); a.translate(0, h * 0.42, 0);
  const b = new THREE.ConeGeometry(h * 0.27, h * 0.40, 7); b.translate(0, h * 0.64, 0);
  const c = new THREE.ConeGeometry(h * 0.19, h * 0.34, 7); c.translate(0, h * 0.86, 0);
  return { trunk, a, b, c };
}
function houseGeo(): { body: THREE.BufferGeometry; roof: THREE.BufferGeometry; chimney: THREE.BufferGeometry; door: THREE.BufferGeometry } {
  const body = new THREE.BoxGeometry(6, 4.5, 5.5); body.translate(0, 2.25, 0);
  const roof = new THREE.ConeGeometry(5.2, 6.5, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 4.5 + 3.25, 0);
  const chimney = new THREE.BoxGeometry(0.8, 2.4, 0.8); chimney.translate(1.6, 8.2, 0.9);
  const door = new THREE.BoxGeometry(1.2, 2.0, 0.2); door.translate(0, 1.0, 2.85);
  return { body, roof, chimney, door };
}
function plotGeo(): { bed: THREE.BufferGeometry; rows: THREE.BufferGeometry } {
  const bed = new THREE.BoxGeometry(6, 0.3, 6); bed.translate(0, 0.15, 0);
  const rows = new THREE.BoxGeometry(5.4, 0.55, 0.7); rows.translate(0, 0.55, 0);
  return { bed, rows };
}
function pondGeo(r: number): { water: THREE.BufferGeometry; rim: THREE.BufferGeometry; pad: THREE.BufferGeometry } {
  const water = new THREE.CircleGeometry(r, 18); water.rotateX(-Math.PI / 2); water.translate(0, 0.06, 0);
  const rim = new THREE.RingGeometry(r, r * 1.12, 18); rim.rotateX(-Math.PI / 2); rim.translate(0, 0.05, 0);
  const pad = new THREE.CircleGeometry(0.7, 8); pad.rotateX(-Math.PI / 2); pad.translate(0, 0.1, 0);
  return { water, rim, pad };
}
const STUMP = (() => { const g = new THREE.CylinderGeometry(0.9, 1.1, 0.9, 8); g.translate(0, 0.45, 0); return g; })();
const STUMP_TOP = (() => { const g = new THREE.CylinderGeometry(0.8, 0.8, 0.12, 8); g.translate(0, 0.92, 0); return g; })();
const POST = (() => { const g = new THREE.BoxGeometry(0.24, 1.3, 0.24); g.translate(0, 0.65, 0); return g; })();
const RAIL = (() => { const g = new THREE.BoxGeometry(0.12, 0.14, 3.4); g.translate(0, 1.0, 0); return g; })();
const SHROOM_STEM = (() => { const g = new THREE.CylinderGeometry(0.18, 0.24, 1.0, 6); g.translate(0, 0.5, 0); return g; })();
const SHROOM_CAP = (() => { const g = new THREE.SphereGeometry(0.62, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); g.translate(0, 0.95, 0); return g; })();
const ROCK = new THREE.DodecahedronGeometry(1.3, 0);

/** Put a prop's parts down on the same scatter so multi-part props stay whole. */
function multi(group: THREE.Group, matrices: THREE.Matrix4[], parts: [THREE.BufferGeometry, THREE.Material][]): void {
  addScatters(group, parts.map(([geo, mat]) => ({ geo, mat, matrices })));
}

/** A town along the road: cottages close on both sides, lantern posts on the
 *  verge, hedges between them, cream paving under it all, the way Atia's
 *  Legacy villages sit around a plaza. Two per land, away from the jumps. */
function addTowns(group: THREE.Group, track: TrackRuntime, mats: MaterialLibrary, rng: Rng, roof: string, wall: string, paving: string): void {
  const L = track.lapLength;
  const h = houseGeo();
  const lantern = new THREE.CylinderGeometry(0.08, 0.12, 3.2, 6); lantern.translate(0, 1.6, 0);
  const lamp = new THREE.SphereGeometry(0.32, 8, 6); lamp.translate(0, 3.35, 0);
  const hedge = new THREE.IcosahedronGeometry(1.1, 1); hedge.translate(0, 0.9, 0);
  const bench = new THREE.BoxGeometry(1.8, 0.35, 0.6); bench.translate(0, 0.55, 0);
  const houses: THREE.Matrix4[] = [], lanterns: THREE.Matrix4[] = [], hedges: THREE.Matrix4[] = [], benches: THREE.Matrix4[] = [];
  const spots = [0.06, 0.52].map((u) => u * L);
  for (const centre of spots) {
    // Skip a town that would land on a gap or a branch join.
    const zone = track.zoneAt(wrap(centre / L, 1));
    if (zone?.gap) continue;
    const sm0 = track.main.sample(centre);
    const pave = new THREE.Mesh(new THREE.CircleGeometry(sm0.w + 26, 28), mats.toon(paving, { flat: false }));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(sm0.pos.x, sm0.pos.y - 0.35, sm0.pos.z);
    group.add(pave);
    for (let d = -44; d <= 44; d += 11) {
      const sm = track.main.sample(centre + d);
      const yaw = Math.atan2(sm.fwd.x, sm.fwd.z);
      for (const side of [-1, 1] as const) {
        // Houses face the road, set back past the verge; every third slot is a hedge instead.
        const slot = Math.round((d + 44) / 11) + (side > 0 ? 1 : 0);
        const lat = side * (sm.w + 9 + rng.range(0, 2));
        const pos = new THREE.Vector3(sm.pos.x + sm.right.x * lat, sm.pos.y, sm.pos.z + sm.right.z * lat);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 0));
        if (slot % 3 === 2) {
          for (let k = 0; k < 3; k++) hedges.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(new THREE.Vector3(sm.fwd.x, 0, sm.fwd.z), (k - 1) * 2.2), new THREE.Quaternion(), new THREE.Vector3(1, rng.range(0.8, 1.1), 1)));
          benches.push(new THREE.Matrix4().compose(pos.clone().addScaledVector(new THREE.Vector3(sm.right.x, 0, sm.right.z), -side * 3.5), q, new THREE.Vector3(1, 1, 1)));
        } else {
          houses.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(rng.range(0.9, 1.15), rng.range(0.9, 1.2), rng.range(0.9, 1.15))));
        }
        if (d % 22 === 0) {
          const ll = side * (sm.w + 2.2);
          lanterns.push(new THREE.Matrix4().compose(new THREE.Vector3(sm.pos.x + sm.right.x * ll, sm.pos.y, sm.pos.z + sm.right.z * ll), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
        }
      }
    }
  }
  multi(group, houses, [[h.body, mats.toon(wall)], [h.roof, mats.toon(roof)], [h.chimney, mats.toon('#8a6a55')], [h.door, mats.toon('#6a4a30')]]);
  multi(group, lanterns, [[lantern, mats.toon('#5a4a3a')], [lamp, mats.glow('#ffe08a', 1)]]);
  addScatters(group, [{ geo: hedge, mat: mats.toon('#5fb85a'), matrices: hedges }, { geo: bench, mat: mats.toon('#a07d52'), matrices: benches }]);
}

export function buildScenery(track: TrackRuntime, mats: MaterialLibrary, density: number): THREE.Group {
  const group = new THREE.Group();
  const theme = track.def.theme;
  const rng = new Rng(hashString(track.def.id));
  const scale = track.def.theme.sceneryScale ?? 1;
  const d = (n: number) => Math.round(n * density * scale);
  // Sparse courses also push their scenery further from the road (handled in
  // bandScatter), so the remaining props frame the action instead of standing
  // in front of it.

  addGround(group, track, mats);

  if (theme.scenery === 'canopy') {
    // Oversized jungle: trunks, canopy balls, ferns and glowing flora.
    const trunk = new THREE.CylinderGeometry(0.55, 0.85, 8, 5);
    trunk.translate(0, 4, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(3.4, 0);
    canopyGeo.translate(0, 9.2, 0);
    const fern = new THREE.ConeGeometry(1.5, 2.4, 5);
    fern.translate(0, 1.2, 0);
    const bloom = new THREE.IcosahedronGeometry(0.42, 0);
    bloom.translate(0, 1.0, 0);
    const rock = new THREE.DodecahedronGeometry(1.5, 0);

    const treeM = bandScatter(track, rng, d(340), 3, 70, 1.2, () => rng.range(0.8, 1.9));
    addScatters(group, [
      { geo: trunk, mat: mats.toon('#5a4029'), matrices: treeM },
      { geo: canopyGeo, mat: mats.toon('#2f7a3c'), matrices: treeM },
      { geo: fern, mat: mats.toon('#49a049'), matrices: bandScatter(track, rng, d(300), 1.2, 22, 0.4, () => rng.range(0.6, 1.3)) },
      { geo: bloom, mat: mats.glow('#8ef7a8', 0.95), matrices: bandScatter(track, rng, d(180), 1.5, 26, 0.6, () => rng.range(0.7, 1.5)) },
      { geo: rock, mat: mats.toon('#6b6b60'), matrices: bandScatter(track, rng, d(120), 4, 40, 0.5, () => rng.range(0.6, 1.8), 0.6) },
    ]);

    // Ancient carved markers along the route — the navigation language.
    const marker = new THREE.BoxGeometry(0.9, 4.2, 0.9);
    marker.translate(0, 2.1, 0);
    addScatters(group, [{ geo: marker, mat: mats.toon('#9b8a6a'), matrices: bandScatter(track, rng, d(70), 1.6, 4.5, 0, () => rng.range(0.8, 1.2)) }]);
  } else if (theme.scenery === 'ruin') {
    // Sunken temple: columns, broken arches, conduits and crystal.
    const column = new THREE.CylinderGeometry(1.0, 1.2, 12, 6);
    column.translate(0, 6, 0);
    const capital = new THREE.BoxGeometry(2.8, 0.8, 2.8);
    capital.translate(0, 12.2, 0);
    const block = new THREE.BoxGeometry(2.2, 1.6, 2.2);
    const crystal = new THREE.OctahedronGeometry(1.0, 0);
    crystal.translate(0, 1.2, 0);
    const conduit = new THREE.BoxGeometry(0.34, 0.34, 6);

    const colM = bandScatter(track, rng, d(150), 2.5, 34, 0.3, () => rng.range(0.7, 1.5));
    addScatters(group, [
      { geo: column, mat: mats.toon('#7d7386'), matrices: colM },
      { geo: capital, mat: mats.toon('#8f8496'), matrices: colM },
      { geo: block, mat: mats.toon('#5f5768'), matrices: bandScatter(track, rng, d(220), 1.5, 40, 0.4, () => rng.range(0.6, 1.8), 0.4) },
      { geo: crystal, mat: mats.glow(theme.accent, 0.9), matrices: bandScatter(track, rng, d(130), 1.8, 28, 0.5, () => rng.range(0.5, 1.4)) },
      { geo: conduit, mat: mats.glow('#66f0d8', 0.8), matrices: bandScatter(track, rng, d(90), 1.2, 3.0, 0.1, () => rng.range(0.8, 1.6)) },
    ]);
  } else if (theme.scenery === 'forest') {
    // Evergreen: round blob trees in three greens and one gold, pines, red-
    // roofed cottages with crop plots, stumps, mushrooms, ponds, fences.
    const t1 = blobTree(2.2, 2.6), t2 = blobTree(1.6, 2.0), p1 = pineTree(9);
    const gold = bandScatter(track, rng, d(60), 6, 60, 0.6, () => rng.range(0.9, 1.5));
    multi(group, bandScatter(track, rng, d(150), 5, 60, 0.6, () => rng.range(0.8, 1.6)), [[t1.trunk, mats.toon('#7a5236')], [t1.low, mats.toon('#5cc257')], [t1.high, mats.toon('#7ed36f')]]);
    multi(group, bandScatter(track, rng, d(120), 3, 40, 0.4, () => rng.range(0.8, 1.4)), [[t2.trunk, mats.toon('#7a5236')], [t2.low, mats.toon('#3f9e4c')], [t2.high, mats.toon('#5fb95d')]]);
    multi(group, gold, [[t1.trunk, mats.toon('#7a5236')], [t1.low, mats.toon('#f0b13a')], [t1.high, mats.toon('#ffcc55')]]);
    multi(group, bandScatter(track, rng, d(140), 4, 70, 0.8, () => rng.range(0.8, 1.5)), [[p1.trunk, mats.toon('#6a4a30')], [p1.a, mats.toon('#2f7f45')], [p1.b, mats.toon('#3e9553')], [p1.c, mats.toon('#55ac62')]]);
    const h = houseGeo();
    multi(group, bandScatter(track, rng, d(14), 22, 70, 0, () => rng.range(0.9, 1.2)), [[h.body, mats.toon('#f3e3c8')], [h.roof, mats.toon('#d9553f')], [h.chimney, mats.toon('#8a6a55')], [h.door, mats.toon('#6a4a30')]]);
    const pl = plotGeo();
    multi(group, bandScatter(track, rng, d(26), 14, 60, 0, () => 1), [[pl.bed, mats.toon('#8a5a36')], [pl.rows, mats.toon('#e9a83c')]]);
    const pond = pondGeo(7);
    multi(group, bandScatter(track, rng, d(8), 18, 60, 0, () => rng.range(0.8, 1.4)), [[pond.water, mats.toon('#5bb8e8', { flat: false })], [pond.rim, mats.toon('#c9d98a')], [pond.pad, mats.toon('#4a9e4a')]]);
    multi(group, bandScatter(track, rng, d(80), 2, 30, 0.2, () => rng.range(0.7, 1.4)), [[STUMP, mats.toon('#8a5a36')], [STUMP_TOP, mats.toon('#d9b58a')]]);
    multi(group, bandScatter(track, rng, d(120), 1.3, 22, 0.2, () => rng.range(0.7, 1.5)), [[SHROOM_STEM, mats.toon('#f1e6d2')], [SHROOM_CAP, mats.toon('#e8523f')]]);
    multi(group, bandScatter(track, rng, d(70), 1.4, 2.2, 0, () => 1), [[POST, mats.toon('#8a6a45')], [RAIL, mats.toon('#a07d52')]]);
    addScatters(group, [{ geo: ROCK, mat: mats.toon('#8f9a8a'), matrices: bandScatter(track, rng, d(90), 3, 40, 0.4, () => rng.range(0.6, 1.8), 0.5) }]);
    addTowns(group, track, mats, rng, '#d9553f', '#f3e3c8', '#e6d3b0');
  } else if (theme.scenery === 'mystic') {
    // Hazymoon: pink, lavender and violet blob trees, purple mushrooms, blue-
    // roofed cottages, crystal shards, purple ponds, the old columns.
    const t1 = blobTree(2.0, 2.6), t2 = blobTree(1.5, 1.9), p1 = pineTree(8);
    multi(group, bandScatter(track, rng, d(120), 5, 60, 0.6, () => rng.range(0.8, 1.6)), [[t1.trunk, mats.toon('#5a3d6a')], [t1.low, mats.toon('#e88bd1')], [t1.high, mats.toon('#f6a9df')]]);
    multi(group, bandScatter(track, rng, d(110), 3, 45, 0.4, () => rng.range(0.8, 1.4)), [[t2.trunk, mats.toon('#5a3d6a')], [t2.low, mats.toon('#9b6fd6')], [t2.high, mats.toon('#b58cf0')]]);
    multi(group, bandScatter(track, rng, d(80), 4, 70, 0.8, () => rng.range(0.8, 1.5)), [[p1.trunk, mats.toon('#4a3355')], [p1.a, mats.toon('#7a55b8')], [p1.b, mats.toon('#8d68cc')], [p1.c, mats.toon('#a37fe0')]]);
    const h = houseGeo();
    multi(group, bandScatter(track, rng, d(12), 22, 70, 0, () => rng.range(0.9, 1.2)), [[h.body, mats.toon('#f3e3d8')], [h.roof, mats.toon('#4f8fe0')], [h.chimney, mats.toon('#8a6a7a')], [h.door, mats.toon('#5a3d6a')]]);
    const pond = pondGeo(6);
    multi(group, bandScatter(track, rng, d(7), 18, 60, 0, () => rng.range(0.8, 1.4)), [[pond.water, mats.toon('#7f7ff0', { flat: false })], [pond.rim, mats.toon('#d8a5e8')], [pond.pad, mats.toon('#c56fd0')]]);
    multi(group, bandScatter(track, rng, d(140), 1.3, 22, 0.2, () => rng.range(0.7, 1.6)), [[SHROOM_STEM, mats.toon('#f1e6f2')], [SHROOM_CAP, mats.glow('#c860e8', 1)]]);
    const column = new THREE.CylinderGeometry(1.0, 1.2, 12, 6); column.translate(0, 6, 0);
    const capital = new THREE.BoxGeometry(2.8, 0.8, 2.8); capital.translate(0, 12.2, 0);
    multi(group, bandScatter(track, rng, d(90), 2.5, 34, 0.3, () => rng.range(0.7, 1.5)), [[column, mats.toon('#8a7aa0')], [capital, mats.toon('#9a8ab0')]]);
    const shard = new THREE.OctahedronGeometry(1.0, 0); shard.translate(0, 1.2, 0);
    const floatShard = new THREE.OctahedronGeometry(1.6, 0); floatShard.translate(0, 9, 0);
    addScatters(group, [
      { geo: shard, mat: mats.glow(theme.accent, 0.9), matrices: bandScatter(track, rng, d(120), 1.8, 28, 0.5, () => rng.range(0.5, 1.4)) },
      { geo: floatShard, mat: mats.glow('#e0a8ff', 0.85), matrices: bandScatter(track, rng, d(50), 6, 50, 4, () => rng.range(0.6, 1.6)) },
      { geo: ROCK, mat: mats.toon('#7a6a90'), matrices: bandScatter(track, rng, d(80), 3, 40, 0.4, () => rng.range(0.6, 1.8), 0.5) },
    ]);
    addTowns(group, track, mats, rng, '#4f8fe0', '#f3e3d8', '#d8b7e8');
  } else if (theme.scenery === 'savannah') {
    // Goldenwind: baobabs with fat trunks, palms, cacti with pink tops,
    // sandstone mesas, boulders, dry grass, crop plots and a watering hole.
    const bao = blobTree(3.2, 2.4);
    const baoTrunk = new THREE.CylinderGeometry(0.9, 1.6, 3.4, 8); baoTrunk.translate(0, 1.7, 0);
    multi(group, bandScatter(track, rng, d(90), 6, 70, 0.6, () => rng.range(0.9, 1.7)), [[baoTrunk, mats.toon('#b08a5a')], [bao.low, mats.toon('#7fb84a')], [bao.high, mats.toon('#9ccd5c')]]);
    const palmTrunk = new THREE.CylinderGeometry(0.28, 0.42, 7, 6); palmTrunk.translate(0, 3.5, 0);
    const frond = new THREE.ConeGeometry(3.0, 1.2, 6); frond.translate(0, 7.2, 0);
    const frond2 = new THREE.ConeGeometry(2.0, 0.9, 6); frond2.translate(0, 7.8, 0);
    multi(group, bandScatter(track, rng, d(70), 5, 60, 0.5, () => rng.range(0.8, 1.5)), [[palmTrunk, mats.toon('#8a6a45')], [frond, mats.toon('#5fae3c')], [frond2, mats.toon('#7fc94a')]]);
    const cactus = new THREE.CapsuleGeometry(0.55, 2.0, 4, 8); cactus.translate(0, 1.5, 0);
    const cactusTop = new THREE.SphereGeometry(0.5, 8, 6); cactusTop.translate(0, 2.7, 0);
    multi(group, bandScatter(track, rng, d(90), 2, 30, 0.2, () => rng.range(0.7, 1.5)), [[cactus, mats.toon('#5aa84a')], [cactusTop, mats.toon('#ff7ab8')]]);
    const mesa = new THREE.CylinderGeometry(2.6, 3.2, 9, 8); mesa.translate(0, 4.5, 0);
    const mesaTop = new THREE.CylinderGeometry(2.2, 2.6, 3, 8); mesaTop.translate(0, 10.5, 0);
    multi(group, bandScatter(track, rng, d(30), 18, 90, 0.5, () => rng.range(0.8, 1.8)), [[mesa, mats.toon('#c98b5a')], [mesaTop, mats.toon('#d9a06a')]]);
    const tuft = new THREE.ConeGeometry(0.7, 1.4, 5); tuft.translate(0, 0.7, 0);
    addScatters(group, [
      { geo: ROCK, mat: mats.toon('#b98a5a'), matrices: bandScatter(track, rng, d(120), 3, 50, 0.5, () => rng.range(0.6, 2.0), 0.6) },
      { geo: tuft, mat: mats.toon('#d8b85a'), matrices: bandScatter(track, rng, d(360), 1.0, 30, 0.2, () => rng.range(0.6, 1.4)) },
    ]);
    const h = houseGeo();
    multi(group, bandScatter(track, rng, d(10), 22, 70, 0, () => rng.range(0.9, 1.2)), [[h.body, mats.toon('#f3e3c8')], [h.roof, mats.toon('#3f8fd0')], [h.chimney, mats.toon('#8a6a55')], [h.door, mats.toon('#6a4a30')]]);
    const pl = plotGeo();
    multi(group, bandScatter(track, rng, d(18), 14, 60, 0, () => 1), [[pl.bed, mats.toon('#a5763e')], [pl.rows, mats.toon('#f0c24a')]]);
    multi(group, bandScatter(track, rng, d(50), 1.4, 2.2, 0, () => 1), [[POST, mats.toon('#8a6a45')], [RAIL, mats.toon('#a07d52')]]);
    const pond = pondGeo(8);
    multi(group, bandScatter(track, rng, d(5), 20, 60, 0, () => rng.range(0.9, 1.5)), [[pond.water, mats.toon('#4fa8d9', { flat: false })], [pond.rim, mats.toon('#c9a860')], [pond.pad, mats.toon('#6fae3c')]]);
    addTowns(group, track, mats, rng, '#3f8fd0', '#f3e3c8', '#e0c48a');
  } else if (theme.scenery === 'arctic') {
    // Winterblue: ice floes in the sky with snow-capped pines, teal and pink
    // blob trees, ice crystals, snow-roofed cottages and a frozen airship.
    const floe = new THREE.CylinderGeometry(7, 5, 2.4, 6);
    const snowcap = new THREE.CylinderGeometry(7.2, 7.2, 0.5, 6); snowcap.translate(0, 1.4, 0);
    const floeM = bandScatter(track, rng, d(90), 10, 90, 12, () => rng.range(0.8, 2.2), 14);
    multi(group, floeM, [[floe, mats.toon('#8fb4cf')], [snowcap, mats.toon('#f4f9ff')]]);
    const p1 = pineTree(9);
    const snowCone = new THREE.ConeGeometry(1.6, 1.4, 7); snowCone.translate(0, 8.6, 0);
    multi(group, bandScatter(track, rng, d(120), 9, 70, 8, () => rng.range(0.8, 1.6), 10), [[p1.trunk, mats.toon('#4a3a2e')], [p1.a, mats.toon('#2f7f7a')], [p1.b, mats.toon('#3e968f')], [p1.c, mats.toon('#55ada6')], [snowCone, mats.toon('#f7fbff')]]);
    const t1 = blobTree(2.0, 2.4);
    multi(group, bandScatter(track, rng, d(70), 9, 60, 8, () => rng.range(0.8, 1.5), 10), [[t1.trunk, mats.toon('#5a4a40')], [t1.low, mats.toon('#7fd6e8')], [t1.high, mats.toon('#f6a9df')]]);
    const h = houseGeo();
    multi(group, bandScatter(track, rng, d(10), 16, 60, 6, () => rng.range(0.9, 1.2), 6), [[h.body, mats.toon('#f3ecdf')], [h.roof, mats.toon('#4f8fe0')], [h.chimney, mats.toon('#8a7a70')], [h.door, mats.toon('#5a4a40')]]);
    const iceShard = new THREE.OctahedronGeometry(1.4, 0); iceShard.translate(0, 1.6, 0);
    const bank = new THREE.IcosahedronGeometry(6, 0);
    const beam = new THREE.BoxGeometry(0.5, 0.5, 14);
    addScatters(group, [
      { geo: iceShard, mat: mats.glow('#9fe8ff', 0.85), matrices: bandScatter(track, rng, d(80), 6, 50, 6, () => rng.range(0.6, 1.8), 6) },
      { geo: bank, mat: mats.toon('#f7fbff'), matrices: bandScatter(track, rng, d(150), 14, 160, 26, () => rng.range(0.8, 2.6), 20) },
      { geo: beam, mat: mats.toon(theme.rail), matrices: bandScatter(track, rng, d(80), 2.0, 8, 1.0, () => rng.range(0.8, 1.6), 2.0) },
    ]);
    const gapZone = track.def.zones.find((z) => z.gap);
    if (gapZone) {
      const sm = track.main.sample(((gapZone.from + gapZone.to) / 2) * track.lapLength);
      const hull = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 7), mats.toon('#dbe8f2'));
      body.scale.set(1, 0.72, 2.5);
      hull.add(body);
      const gondola = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 9), mats.toon('#5a6b7a'));
      gondola.position.y = -7;
      hull.add(gondola);
      hull.position.set(sm.pos.x + sm.right.x * 2, sm.pos.y - 16, sm.pos.z + sm.right.z * 2);
      hull.rotation.y = Math.atan2(sm.fwd.x, sm.fwd.z) + Math.PI / 2;
      group.add(hull);
    }
  } else {
    // Cloudforge: floating platforms, forge stacks, cloud banks, airship hulls.
    const platform = new THREE.CylinderGeometry(7, 5, 2.4, 6);
    const stack = new THREE.CylinderGeometry(1.1, 1.6, 12, 6);
    stack.translate(0, 6, 0);
    const cloud = new THREE.IcosahedronGeometry(6, 0);
    const beam = new THREE.BoxGeometry(0.5, 0.5, 14);

    const platM = bandScatter(track, rng, d(90), 10, 90, 12, () => rng.range(0.8, 2.2), 14);
    addScatters(group, [
      { geo: platform, mat: mats.toon('#8a93a6'), matrices: platM },
      { geo: stack, mat: mats.toon('#6e7688'), matrices: bandScatter(track, rng, d(70), 12, 70, 6, () => rng.range(0.7, 1.6), 10) },
      { geo: cloud, mat: mats.toon('#f2f7ff'), matrices: bandScatter(track, rng, d(150), 14, 160, 26, () => rng.range(0.8, 2.6), 20) },
      { geo: beam, mat: mats.toon(theme.rail), matrices: bandScatter(track, rng, d(80), 2.0, 8, 1.0, () => rng.range(0.8, 1.6), 2.0) },
    ]);

    // A moored airship at the hangar jump — the set piece's landmark.
    const gapZone = track.def.zones.find((z) => z.gap);
    if (gapZone) {
      const sm = track.main.sample(((gapZone.from + gapZone.to) / 2) * track.lapLength);
      const hull = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 7), mats.toon('#c9b48a'));
      body.scale.set(1, 0.72, 2.5);
      hull.add(body);
      const gondola = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 9), mats.toon('#7a5f3a'));
      gondola.position.y = -7;
      hull.add(gondola);
      for (const side of [-1, 1] as const) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 5), mats.toon('#8a6c44'));
        fin.position.set(side * 3, 0, -20);
        hull.add(fin);
      }
      hull.position.set(sm.pos.x + sm.right.x * 2, sm.pos.y - 16, sm.pos.z + sm.right.z * 2);
      hull.rotation.y = Math.atan2(sm.fwd.x, sm.fwd.z) + Math.PI / 2;
      group.add(hull);
    }
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
