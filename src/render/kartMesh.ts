/** Procedural kart models, part visuals and the seat socket system.
 *
 *  The seat contract is what makes three Axies x three karts nine working
 *  combinations rather than nine hand-placed one-offs: the kart exposes named
 *  sockets, the Axie definition supplies its own offset and scale, and the
 *  driver is parented to the socket. Adding a fourth kart or a fetched Axie
 *  costs one data entry each and no new code.
 */
import * as THREE from 'three';
import type { KartDefinition } from '../data/karts';
import type { AxieDefinition } from '../data/axies';
import type { MaterialLibrary } from './scene';
import type { LoadoutParts } from '../sim/loadout';
import { partById } from '../data/parts';
import { buildAxie, updateAxie, type AxieDriveState, type AxieRig } from './axieMesh';
import { clamp, clamp01, damp } from '../core/math';

const PAINT: Record<string, { body: string; trim: string }> = {
  factory:  { body: '', trim: '' },
  duskfade: { body: '#7a45c9', trim: '#ff8a4c' },
  reeflight:{ body: '#1fb6c9', trim: '#bff7ff' },
  mosswork: { body: '#5f8348', trim: '#d8c38a' },
  lunacian: { body: '#f2f0ff', trim: '#b9a0ff' },
};

/** Livery tints applied to rival karts so eight karts are eight colours. */
export const LIVERY = [
  '#ff7a52', '#7c8cff', '#3fbf7f', '#ffd166',
  '#ff6fae', '#5fd8e8', '#c79bff', '#e0e6ef',
];

/** One wheel: the holder steers, the mesh spins. Keeping them as an explicit
 *  record beats stashing references in `userData` — the types survive. */
export interface WheelRig {
  holder: THREE.Group;
  mesh: THREE.Mesh;
  front: boolean;
}

export interface KartRig {
  root: THREE.Group;
  /** Chassis group; leans and squats relative to root. */
  chassis: THREE.Group;
  wheels: WheelRig[];
  sockets: {
    seat: THREE.Group;
    handle: THREE.Group;
    cameraLook: THREE.Group;
    exhaustL: THREE.Group;
    exhaustR: THREE.Group;
  };
  driver: AxieRig | null;
  /** Boost flame meshes, toggled by the effects layer. */
  flames: THREE.Mesh[];
  /** Drift spark emitters sit at the rear wheels. */
  sparkAnchors: THREE.Group[];
  /** Blob shadow under the kart. */
  shadow: THREE.Mesh;
  def: KartDefinition;
  spin: number;
}

function socket(parent: THREE.Object3D, p: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  parent.add(g);
  return g;
}

export function buildKart(
  def: KartDefinition,
  mats: MaterialLibrary,
  opts: { parts?: LoadoutParts; livery?: string } = {},
): KartRig {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paintId = opts.parts?.paint?.partId ?? 'paint-factory';
  const paint = PAINT[paintId.replace('paint-', '')] ?? PAINT.factory;
  const bodyColor = opts.livery ?? (paint.body || def.palette.body);
  const trimColor = paint.trim || def.palette.trim;

  const bodyMat = mats.toon(bodyColor);
  const trimMat = mats.toon(trimColor);
  const metalMat = mats.toon(def.palette.metal);
  const tyreMat = mats.toon('#26282f');

  const { length, width, height, wheelRadius, wheelbase } = def.size;

  // ---- main tub -----------------------------------------------------------
  const tub = new THREE.Mesh(new THREE.BoxGeometry(width * 0.74, height * 0.62, length * 0.66), bodyMat);
  tub.position.set(0, height * 0.42, -0.04);
  chassis.add(tub);

  // Tapered nose.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.10, width * 0.34, length * 0.40, 4), bodyMat);
  nose.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  nose.position.set(0, height * 0.36, length * 0.40);
  chassis.add(nose);

  // Side pods.
  for (const side of [-1, 1] as const) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(width * 0.20, height * 0.42, length * 0.44), trimMat);
    pod.position.set(side * width * 0.42, height * 0.36, -0.02);
    chassis.add(pod);
  }

  // Engine block behind the seat.
  const engine = new THREE.Mesh(new THREE.BoxGeometry(width * 0.50, height * 0.52, length * 0.24), metalMat);
  engine.position.set(0, height * 0.52, -length * 0.36);
  chassis.add(engine);

  // ---- part visuals -------------------------------------------------------
  // Fitted parts change the silhouette, so a built kart looks built.
  const partVisual = (slot: keyof LoadoutParts): string =>
    opts.parts ? partById(opts.parts[slot].partId).visual : 'stock';

  const aero = partVisual('aero');
  if (aero === 'kitewing') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(width * 1.15, 0.07, 0.34), trimMat);
    wing.position.set(0, height * 1.05, -length * 0.46);
    chassis.add(wing);
    for (const side of [-1, 1] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, height * 0.38, 0.30), trimMat);
      fin.position.set(side * width * 0.52, height * 0.86, -length * 0.46);
      chassis.add(fin);
    }
  } else if (aero === 'slipcowl') {
    const cowl = new THREE.Mesh(new THREE.SphereGeometry(width * 0.40, 7, 5), bodyMat);
    cowl.scale.set(1, 0.62, 1.5);
    cowl.position.set(0, height * 0.68, -length * 0.18);
    chassis.add(cowl);
  } else {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(width * 0.80, 0.06, 0.22), trimMat);
    wing.position.set(0, height * 0.92, -length * 0.45);
    chassis.add(wing);
  }

  const chassisVisual = partVisual('chassis');
  if (chassisVisual === 'bulwark') {
    for (const side of [-1, 1] as const) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height * 1.0, 5), metalMat);
      bar.position.set(side * width * 0.36, height * 0.82, -length * 0.06);
      bar.rotation.z = side * 0.12;
      chassis.add(bar);
    }
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(width * 0.34, 0.05, 4, 8, Math.PI), metalMat);
    hoop.position.set(0, height * 1.20, -length * 0.06);
    hoop.rotation.y = Math.PI / 2;
    chassis.add(hoop);
  } else if (chassisVisual === 'lattice') {
    for (let i = 0; i < 4; i++) {
      const spar = new THREE.Mesh(new THREE.BoxGeometry(width * 0.80, 0.04, 0.04), metalMat);
      spar.position.set(0, height * 0.18 + i * 0.09, length * 0.10 - i * 0.14);
      chassis.add(spar);
    }
  }

  const boostVisual = partVisual('boost');
  const boostGlow = boostVisual === 'starfall' ? '#c79bff' : boostVisual === 'longtail' ? '#5fb0ff' : '#ffb23f';

  // ---- exhausts and flames ------------------------------------------------
  const flames: THREE.Mesh[] = [];
  const [ex, ey, ez] = def.sockets.exhaust;
  const exhaustL = socket(chassis, [-ex, ey, ez]);
  const exhaustR = socket(chassis, [ex, ey, ez]);
  for (const sock of [exhaustL, exhaustR]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.30, 6), metalMat);
    pipe.rotation.x = Math.PI / 2;
    sock.add(pipe);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.85, 6), mats.glow(boostGlow, 0.9));
    // Point it back down the road: a cone's axis is +Y, and -90 degrees about
    // X maps that to -Z. The opposite sign fires the flame through the kart.
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -0.55;
    flame.visible = false;
    sock.add(flame);
    flames.push(flame);
  }

  // ---- wheels -------------------------------------------------------------
  const tiresVisual = partVisual('tires');
  const tread = tiresVisual === 'cleat' ? 7 : tiresVisual === 'glasswing' ? 12 : 9;
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, width * 0.19, tread);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.45, wheelRadius * 0.45, width * 0.21, 6);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels: WheelRig[] = [];
  const sparkAnchors: THREE.Group[] = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const holder = new THREE.Group();
    holder.position.set(sx * width * 0.52, wheelRadius, sz * wheelbase * 0.5);
    chassis.add(holder);
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    holder.add(w);
    const hub = new THREE.Mesh(hubGeo, trimMat);
    w.add(hub);
    // The steering axis is the holder, so a wheel can spin and steer at once.
    wheels.push({ holder, mesh: w, front: sz > 0 });
    if (sz < 0) {
      const anchor = new THREE.Group();
      anchor.position.set(0, -wheelRadius * 0.7, 0);
      holder.add(anchor);
      sparkAnchors.push(anchor);
    }
  }

  // ---- sockets ------------------------------------------------------------
  const sockets = {
    seat: socket(chassis, def.sockets.seat),
    handle: socket(chassis, def.sockets.handle),
    cameraLook: socket(chassis, def.sockets.cameraLook),
    exhaustL, exhaustR,
  };

  // Steering wheel at the handle socket.
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 4, 10), metalMat);
  wheelRim.rotation.x = -0.9;
  sockets.handle.add(wheelRim);

  // ---- blob shadow --------------------------------------------------------
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(width, length) * 0.42, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.30, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  root.add(shadow);

  return {
    root, chassis, wheels, sockets,
    driver: null, flames, sparkAnchors, shadow, def, spin: 0,
  };
}

/** Seat an Axie in a kart. Uses the Axie's own offset on top of the socket, so
 *  a taller Axie sits correctly in every kart without a per-pair tweak. */
export function seatAxie(kart: KartRig, axie: AxieDefinition, mats: MaterialLibrary): AxieRig {
  if (kart.driver) {
    kart.sockets.seat.remove(kart.driver.root);
  }
  const rig = buildAxie(axie, mats);
  rig.root.position.set(...axie.rig.seatOffset);
  rig.root.rotation.x = axie.rig.seatPitch;
  kart.sockets.seat.add(rig.root);
  kart.driver = rig;
  return rig;
}

export interface KartDriveState extends AxieDriveState {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
  groundY: number;
  spinTimer: number;
  respawnFade: number;
}

export function updateKart(rig: KartRig, s: KartDriveState): void {
  const dt = Math.min(s.dt, 0.05);
  rig.root.position.set(s.x, s.y, s.z);
  rig.root.rotation.set(0, s.yaw, 0);
  rig.chassis.rotation.set(s.pitch, 0, s.roll);

  // Suspension squat and roll on top of the body attitude.
  const squat = s.compression * 0.16;
  rig.chassis.position.y = -squat;

  // Wheels: spin with ground speed, front pair steers.
  rig.spin += (s.speed / Math.max(0.1, rig.def.size.wheelRadius)) * dt;
  const steerAngle = clamp(s.steer, -1, 1) * 0.52;
  for (const w of rig.wheels) {
    w.mesh.rotation.x = rig.spin;
    // Rear wheels kick out in a drift; front wheels follow the input.
    w.holder.rotation.y = w.front ? steerAngle : (s.drifting ? -s.driftDir * 0.18 : 0);
  }

  // Boost flames.
  const lit = s.boosting;
  for (const f of rig.flames) {
    f.visible = lit;
    if (lit) {
      const flick = 0.72 + Math.random() * 0.5;
      f.scale.set(flick, 1, flick);
      f.position.z = -0.55 - flick * 0.22;
    }
  }

  // Blob shadow tracks the ground, fading with height.
  const airGap = Math.max(0, s.y - s.groundY);
  rig.shadow.position.set(0, s.groundY - s.y + 0.03, 0);
  const sm = rig.shadow.material as THREE.MeshBasicMaterial;
  sm.opacity = 0.32 * clamp01(1 - airGap / 7);
  rig.shadow.scale.setScalar(1 + clamp01(airGap / 7) * 0.7);

  // Respawn fade.
  rig.root.visible = s.respawnFade > 0.02;
  rig.root.scale.setScalar(damp(rig.root.scale.x, s.respawnFade, 14, dt));

  if (rig.driver) updateAxie(rig.driver, s);
}
