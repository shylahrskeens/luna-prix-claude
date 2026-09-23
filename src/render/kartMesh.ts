/** Procedural kart models, part visuals and the seat socket system.
 *
 *  The seat contract is what makes three Axies x three karts nine working
 *  combinations rather than nine hand-placed one-offs: the kart exposes named
 *  sockets, the Axie definition supplies its own offset and scale, and the
 *  driver is parented to the socket. Adding a fourth kart or a fetched Axie
 *  costs one data entry each and no new code.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { KartDefinition } from '../data/karts';
import type { AxieDefinition } from '../data/axies';
import type { MaterialLibrary } from './scene';
import type { LoadoutParts } from '../sim/loadout';
import { partById } from '../data/parts';
import { buildAxie, type AxieDriveState } from './axieMesh';
import { proceduralDriver, mixerDriver, type DriverRig } from './axieDriver';
import type { AxieMixerService } from './axieMixer';
import { clamp, clamp01, damp } from '../core/math';

const PAINT: Record<string, { body: string; trim: string }> = {
  factory:  { body: '', trim: '' },
  duskfade: { body: '#7a45c9', trim: '#ff8a4c' },
  reeflight:{ body: '#1fb6c9', trim: '#bff7ff' },
  mosswork: { body: '#5f8348', trim: '#d8c38a' },
  lunacian: { body: '#f2f0ff', trim: '#b9a0ff' },
};

/** A race number on a roundel, painted once per (number, colour) and cached. */
const decalCache = new Map<string, THREE.CanvasTexture>();
function numberDecal(n: number, ring: string): THREE.CanvasTexture {
  const key = `${n}|${ring}`;
  const hit = decalCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f4ee';
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = ring;
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#15161c';
  g.font = '800 64px Inter, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  decalCache.set(key, tex);
  return tex;
}

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
  driver: DriverRig | null;
  /** Bumped on every seat change and on dispose; a Mixer character that
   *  arrives for an older token is thrown away. */
  seatToken: number;
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
  opts: { parts?: LoadoutParts; livery?: string; number?: number } = {},
): KartRig {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paintId = opts.parts?.paint?.partId ?? 'paint-factory';
  const paint = PAINT[paintId.replace('paint-', '')] ?? PAINT.factory;
  const bodyColor = opts.livery ?? (paint.body || def.palette.body);
  const trimColor = paint.trim || def.palette.trim;

  // bodyMat is gone: painted panels use mats.paint(bodyColor) below.
  const trimMat = mats.toon(trimColor);
  const metalMat = mats.toon(def.palette.metal);
  const tyreMat = mats.toon('#26282f');

  const { length, width, height, wheelRadius, wheelbase } = def.size;

  // ---- materials ----------------------------------------------------------
  // Painted panels and chrome are physically shaded and pick up the scene's
  // environment map; the rest stays toon so the kart reads with the world.
  const paintMat = mats.paint(bodyColor);
  const trimPaint = mats.paint(trimColor);
  const chrome = mats.chrome('#cfd6e0');
  const dark = mats.toon('#1b1d24');
  const glass = mats.paint('#2a3140', { roughness: 0.15, metalness: 0.6 });

  const rbox = (w: number, h: number, d: number, r = 0.05, mat: THREE.Material = paintMat) =>
    new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) * 0.45)), mat);
  const cyl = (rt: number, rb: number, h: number, seg: number, mat: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const put = (m: THREE.Object3D, x: number, y: number, z: number, parent: THREE.Object3D = chassis) => {
    m.position.set(x, y, z); parent.add(m); return m;
  };

  // ---- main tub -----------------------------------------------------------
  const tub = put(rbox(width * 0.72, height * 0.58, length * 0.64, 0.09), 0, height * 0.40, -0.04);
  // Floor pan and a lower sill line in trim colour.
  put(rbox(width * 0.80, height * 0.10, length * 0.70, 0.03, dark), 0, height * 0.14, -0.04);
  put(rbox(width * 0.76, height * 0.06, length * 0.60, 0.02, trimPaint), 0, height * 0.26, -0.04);
  // Cockpit: a raised rim around the seat opening and a bucket seat inside.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(width * 0.26, 0.035, 6, 20), trimPaint);
  rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.35, 1);
  put(rim, 0, height * 0.70, -0.10);
  put(rbox(width * 0.34, height * 0.34, 0.10, 0.04, dark), 0, height * 0.72, -length * 0.20);
  put(rbox(width * 0.34, 0.06, length * 0.16, 0.03, dark), 0, height * 0.56, -length * 0.12);
  // Racing stripe down the centreline.
  put(rbox(width * 0.10, 0.012, length * 0.60, 0.004, trimPaint), 0, height * 0.695, 0.02);

  // ---- nose -----------------------------------------------------------------
  const nose = cyl(width * 0.12, width * 0.34, length * 0.42, 10, paintMat);
  nose.rotation.x = Math.PI / 2;
  put(nose, 0, height * 0.36, length * 0.42);
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(width * 0.12, 10, 8), paintMat);
  put(noseCap, 0, height * 0.36, length * 0.63);
  // Headlights and a bumper bar.
  for (const side of [-1, 1] as const) {
    put(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mats.glow('#fff4d6')), side * width * 0.16, height * 0.38, length * 0.58);
  }
  put(rbox(width * 0.66, 0.06, 0.07, 0.03, chrome), 0, height * 0.24, length * 0.62);
  // Number roundel on the nose.
  const number = opts.number ?? 1;
  const roundel = new THREE.Mesh(new THREE.CircleGeometry(width * 0.12, 24), mats.decal(numberDecal(number, bodyColor)));
  roundel.rotation.x = -Math.PI / 2 + 0.55;
  put(roundel, 0, height * 0.50, length * 0.36);

  // ---- side pods ------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    put(rbox(width * 0.20, height * 0.40, length * 0.46, 0.07, trimPaint), side * width * 0.43, height * 0.34, -0.02);
    // Intake grille: three dark slats on the leading face.
    for (let i = 0; i < 3; i++) {
      put(rbox(width * 0.14, 0.035, 0.03, 0.01, dark), side * width * 0.43, height * 0.24 + i * 0.09, length * 0.215);
    }
    // Side number plate.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30), mats.decal(numberDecal(number, trimColor)));
    plate.rotation.y = side * Math.PI / 2;
    put(plate, side * (width * 0.53 + 0.003), height * 0.36, 0.04);
    // Mirror on a stalk.
    put(cyl(0.012, 0.012, 0.16, 5, chrome), side * width * 0.40, height * 0.80, length * 0.18).rotation.z = side * 0.9;
    put(rbox(0.08, 0.05, 0.03, 0.01, dark), side * width * 0.47, height * 0.84, length * 0.18);
  }

  // ---- engine ---------------------------------------------------------------
  put(rbox(width * 0.50, height * 0.50, length * 0.24, 0.05, metalMat), 0, height * 0.50, -length * 0.36);
  for (const side of [-1, 1] as const) {
    put(cyl(0.07, 0.07, 0.14, 8, chrome), side * width * 0.13, height * 0.80, -length * 0.36);
    // Tail lights.
    put(rbox(0.10, 0.05, 0.03, 0.01, mats.glow('#ff3b3b')), side * width * 0.24, height * 0.44, -length * 0.485);
  }
  // Rear diffuser fins.
  for (const i of [-1, 0, 1]) {
    put(rbox(0.03, height * 0.18, 0.20, 0.01, dark), i * width * 0.16, height * 0.18, -length * 0.43);
  }

  // ---- part visuals -------------------------------------------------------
  // Fitted parts change the silhouette, so a built kart looks built.
  const partVisual = (slot: keyof LoadoutParts): string =>
    opts.parts ? partById(opts.parts[slot].partId).visual : 'stock';

  const aero = partVisual('aero');
  if (aero === 'kitewing') {
    put(rbox(width * 1.15, 0.05, 0.34, 0.02, trimPaint), 0, height * 1.05, -length * 0.46);
    for (const side of [-1, 1] as const) {
      put(rbox(0.05, height * 0.38, 0.30, 0.02, trimPaint), side * width * 0.52, height * 0.86, -length * 0.46);
      put(cyl(0.02, 0.02, height * 0.36, 5, chrome), side * width * 0.30, height * 0.86, -length * 0.46);
    }
  } else if (aero === 'slipcowl') {
    const cowl = new THREE.Mesh(new THREE.SphereGeometry(width * 0.40, 14, 10), paintMat);
    cowl.scale.set(1, 0.62, 1.5);
    put(cowl, 0, height * 0.68, -length * 0.18);
    put(new THREE.Mesh(new THREE.SphereGeometry(width * 0.22, 12, 8), glass), 0, height * 0.78, length * 0.02).scale.set(1, 0.5, 1.3);
  } else {
    put(rbox(width * 0.80, 0.05, 0.22, 0.02, trimPaint), 0, height * 0.92, -length * 0.45);
    for (const side of [-1, 1] as const) {
      put(cyl(0.02, 0.02, height * 0.30, 5, chrome), side * width * 0.24, height * 0.78, -length * 0.45);
    }
  }

  const chassisVisual = partVisual('chassis');
  if (chassisVisual === 'bulwark') {
    for (const side of [-1, 1] as const) {
      const bar = put(cyl(0.05, 0.05, height * 1.0, 8, chrome), side * width * 0.36, height * 0.82, -length * 0.06);
      bar.rotation.z = side * 0.12;
    }
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(width * 0.34, 0.05, 6, 14, Math.PI), chrome);
    hoop.rotation.y = Math.PI / 2;
    put(hoop, 0, height * 1.20, -length * 0.06);
  } else if (chassisVisual === 'lattice') {
    for (let i = 0; i < 4; i++) {
      put(rbox(width * 0.80, 0.035, 0.035, 0.01, chrome), 0, height * 0.18 + i * 0.09, length * 0.10 - i * 0.14);
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
    const pipe = cyl(0.085, 0.10, 0.34, 10, metalMat);
    pipe.rotation.x = Math.PI / 2;
    sock.add(pipe);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.022, 6, 14), chrome);
    tip.position.z = -0.17;
    sock.add(tip);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.85, 8), mats.glow(boostGlow, 0.9));
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
  const tread = tiresVisual === 'cleat' ? 10 : tiresVisual === 'glasswing' ? 18 : 14;
  const tyreW = width * 0.19;
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, tyreW, tread);
  wheelGeo.rotateZ(Math.PI / 2);
  const grooveGeo = new THREE.TorusGeometry(wheelRadius * 0.98, wheelRadius * 0.06, 5, tread);
  grooveGeo.rotateY(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.58, wheelRadius * 0.58, tyreW * 1.04, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(tyreW * 1.08, wheelRadius * 0.14, wheelRadius * 1.0);
  const capGeo = new THREE.SphereGeometry(wheelRadius * 0.16, 8, 6);
  const wheels: WheelRig[] = [];
  const sparkAnchors: THREE.Group[] = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const holder = new THREE.Group();
    holder.position.set(sx * width * 0.52, wheelRadius, sz * wheelbase * 0.5);
    chassis.add(holder);
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    holder.add(w);
    // Sidewall groove, rim, three spokes and a hub cap.
    const groove = new THREE.Mesh(grooveGeo, dark);
    groove.position.x = sx * tyreW * 0.30;
    w.add(groove);
    w.add(new THREE.Mesh(rimGeo, trimMat));
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(spokeGeo, chrome);
      spoke.rotation.x = (i / 3) * Math.PI;
      w.add(spoke);
    }
    const cap = new THREE.Mesh(capGeo, chrome);
    cap.position.x = sx * tyreW * 0.55;
    w.add(cap);
    // Suspension: two arms from the tub to the hub, with a small damper.
    for (const dz of [-0.10, 0.10]) {
      const arm = cyl(0.018, 0.018, width * 0.20, 5, chrome);
      arm.rotation.z = Math.PI / 2;
      put(arm, sx * width * 0.42, wheelRadius * 0.95, sz * wheelbase * 0.5 + dz);
    }
    const damper = cyl(0.03, 0.03, wheelRadius * 0.9, 6, dark);
    damper.rotation.z = sx * 0.55;
    put(damper, sx * width * 0.44, wheelRadius * 1.35, sz * wheelbase * 0.5);
    // The steering axis is the holder, so a wheel can spin and steer at once.
    wheels.push({ holder, mesh: w, front: sz > 0 });
    if (sz < 0) {
      const anchor = new THREE.Group();
      anchor.position.set(0, -wheelRadius * 0.7, 0);
      holder.add(anchor);
      sparkAnchors.push(anchor);
    }
  }
  void tub;

  // ---- sockets ------------------------------------------------------------
  const sockets = {
    seat: socket(chassis, def.sockets.seat),
    handle: socket(chassis, def.sockets.handle),
    cameraLook: socket(chassis, def.sockets.cameraLook),
    exhaustL, exhaustR,
  };

  // Steering wheel at the handle socket.
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.026, 8, 18), chrome);
  wheelRim.rotation.x = -0.9;
  sockets.handle.add(wheelRim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.30, 0.02), dark);
    spoke.rotation.set(-0.9, 0, (i / 3) * Math.PI);
    sockets.handle.add(spoke);
  }
  const column = cyl(0.02, 0.02, 0.26, 6, dark);
  column.rotation.x = 0.6;
  column.position.z = 0.10; column.position.y = -0.08;
  sockets.handle.add(column);

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
    driver: null, seatToken: 0, flames, sparkAnchors, shadow, def, spin: 0,
  };
}

export interface SeatContext {
  materials: MaterialLibrary;
  /** When present and enabled, the seat is upgraded to a Mixer character as
   *  soon as one loads. Absent (headless tools, tests) means procedural only. */
  mixer?: AxieMixerService;
}

/** Seat an Axie in a kart. Uses the Axie's own offset on top of the socket, so
 *  a taller Axie sits correctly in every kart without a per-pair tweak.
 *
 *  The procedural driver is seated synchronously, so the kart is never empty.
 *  If the Mixer is available the real Axie is requested and swapped in when
 *  it arrives — unless the seat has changed hands or been disposed since. */
export function seatAxie(kart: KartRig, axie: AxieDefinition, ctx: SeatContext): DriverRig {
  kart.driver?.dispose();
  const token = ++kart.seatToken;
  const driver = proceduralDriver(buildAxie(axie, ctx.materials), axie);
  kart.sockets.seat.add(driver.root);
  kart.driver = driver;

  const mixer = ctx.mixer;
  if (mixer?.enabled) {
    void mixer.create(axie).then((character) => {
      if (!character) return;
      if (kart.seatToken !== token) { character.dispose(); return; }
      kart.driver?.dispose();
      const upgraded = mixerDriver(character, axie);
      kart.sockets.seat.add(upgraded.root);
      kart.driver = upgraded;
    });
  }
  return driver;
}

/** Release the driver (a Mixer character holds GPU leases) and the kart's own
 *  geometry. The seat token moves on so an in-flight character is dropped. */
export function disposeKart(kart: KartRig): void {
  kart.seatToken++;
  kart.driver?.dispose();
  kart.driver = null;
  kart.root.removeFromParent();
  kart.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
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

  rig.driver?.update(s);
}
