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

/** A large ground plane that follows the track's average height, so the world
 *  does not end at the verge. Cloudforge skips it: there is nothing down there. */
function addGround(group: THREE.Group, track: TrackRuntime, mats: MaterialLibrary): void {
  if (track.def.theme.scenery === 'cloud') return;
  let minY = Infinity;
  let cx = 0, cz = 0, n = 0;
  track.main.forEachSample((_i, p) => {
    minY = Math.min(minY, p.y);
    cx += p.x; cz += p.z; n++;
  });
  const geo = new THREE.PlaneGeometry(4200, 4200, 24, 24);
  geo.rotateX(-Math.PI / 2);
  // Gentle noise so the floor is not a mirror.
  const pos = geo.attributes.position;
  const rng = new Rng(9001);
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) + rng.range(-6, 6));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.toon(track.def.theme.ground));
  mesh.position.set(cx / n, minY - 12, cz / n);
  group.add(mesh);
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
