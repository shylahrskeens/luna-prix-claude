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
import { proceduralDriver, mixerDriver, mascotDriver, type DriverRig } from './axieDriver';
import type { AxieMixerService } from './axieMixer';
import type { MascotModelService } from './mascotModel';
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
  const seatMat = mats.paint('#2a2530', { roughness: 0.7, metalness: 0.05 });

  const rbox = (w: number, h: number, d: number, r = 0.05, mat: THREE.Material = paintMat) =>
    new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) * 0.45)), mat);
  const cyl = (rt: number, rb: number, h: number, seg: number, mat: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const put = (m: THREE.Object3D, x: number, y: number, z: number, parent: THREE.Object3D = chassis) => {
    m.position.set(x, y, z); parent.add(m); return m;
  };

  // Shared by every body: fitted parts, exhausts, the lists the animator reads.
  const partVisual = (slot: keyof LoadoutParts): string =>
    opts.parts ? partById(opts.parts[slot].partId).visual : 'stock';
  const boostVisual = partVisual('boost');
  const boostGlow = boostVisual === 'starfall' ? '#c79bff' : boostVisual === 'longtail' ? '#5fb0ff' : '#ffb23f';
  const flames: THREE.Mesh[] = [];
  const wheels: WheelRig[] = [];
  const sparkAnchors: THREE.Group[] = [];
  const [ex, ey, ez] = def.sockets.exhaust;
  const exhaustL = socket(chassis, [-ex, ey, ez]);
  const exhaustR = socket(chassis, [ex, ey, ez]);

  if (def.body === 'kart') {
    // ---- main tub -----------------------------------------------------------
    const tub = put(rbox(width * 0.72, height * 0.58, length * 0.64, 0.09), 0, height * 0.40, -0.04);
    // Floor pan and a lower sill line in trim colour.
    put(rbox(width * 0.80, height * 0.10, length * 0.70, 0.03, dark), 0, height * 0.14, -0.04);
    put(rbox(width * 0.76, height * 0.06, length * 0.60, 0.02, trimPaint), 0, height * 0.26, -0.04);
    // Cockpit: a raised rim around the seat opening and a bucket seat inside.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(width * 0.26, 0.035, 6, 20), trimPaint);
    rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1.35, 1);
    put(rim, 0, height * 0.70, -0.10);
    // Bucket seat: base, a tall back with side bolsters, a headrest, and a lap
    // belt in the trim colour. The driver sinks into it rather than perching.
    put(rbox(width * 0.40, 0.08, length * 0.20, 0.03, seatMat), 0, height * 0.50, -length * 0.13);
    put(rbox(width * 0.40, height * 0.46, 0.10, 0.04, seatMat), 0, height * 0.72, -length * 0.235);
    for (const side of [-1, 1] as const) {
      put(rbox(0.07, height * 0.40, 0.16, 0.03, seatMat), side * width * 0.19, height * 0.70, -length * 0.215);
      put(rbox(0.07, 0.07, length * 0.18, 0.03, seatMat), side * width * 0.20, height * 0.54, -length * 0.13);
    }
    put(rbox(width * 0.16, 0.12, 0.08, 0.03, seatMat), 0, height * 0.98, -length * 0.235);
    put(rbox(width * 0.30, 0.03, 0.05, 0.01, trimPaint), 0, height * 0.60, -length * 0.03).rotation.x = 0.35;
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

    // ---- exhausts and flames ------------------------------------------------
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


  } else if (def.body === 'bike') {
    // ---- motorcycle ----------------------------------------------------------
    // Two wheels in line, a tank, a low frame, forks, bars, a stepped seat, a
    // fat exhaust. The rider sits astride; the seat socket is above the frame.
    const wr = wheelRadius * 1.25;
    const tank = put(rbox(width * 0.30, height * 0.36, length * 0.30, 0.09), 0, height * 0.66, length * 0.10);
    tank.rotation.x = 0.08;
    put(rbox(width * 0.10, 0.012, length * 0.26, 0.004, trimPaint), 0, height * 0.845, length * 0.10);
    put(rbox(width * 0.14, height * 0.16, length * 0.62, 0.05, dark), 0, height * 0.42, -length * 0.02);
    put(rbox(width * 0.28, height * 0.30, length * 0.22, 0.05, metalMat), 0, height * 0.40, length * 0.02);
    for (const side of [-1, 1] as const) {
      put(cyl(0.06, 0.06, 0.16, 8, chrome), side * width * 0.13, height * 0.60, length * 0.02).rotation.z = Math.PI / 2;
      put(cyl(0.06, 0.06, 0.16, 8, chrome), side * width * 0.13, height * 0.50, length * 0.02).rotation.z = Math.PI / 2;
    }
    // Seat and rear fender.
    put(rbox(width * 0.26, 0.10, length * 0.26, 0.04, seatMat), 0, height * 0.70, -length * 0.20);
    put(rbox(width * 0.28, 0.07, 0.10, 0.03, seatMat), 0, height * 0.78, -length * 0.33);
    // Half a drum over the rear wheel: axis across the bike, open side down.
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(wr * 1.12, wr * 1.12, width * 0.20, 16, 1, true, Math.PI / 2, Math.PI), paintMat);
    fender.rotation.z = Math.PI / 2;
    put(fender, 0, wr, -wheelbase * 0.5);
    // Forks, bars, headlight.
    for (const side of [-1, 1] as const) {
      const fork = cyl(0.03, 0.035, height * 0.9, 8, chrome);
      fork.rotation.x = -0.45;
      put(fork, side * width * 0.09, height * 0.62, wheelbase * 0.5 - 0.10);
    }
    put(rbox(width * 0.20, 0.10, 0.14, 0.03, dark), 0, height * 0.98, wheelbase * 0.5 - 0.22);
    const bars = put(cyl(0.022, 0.022, width * 0.62, 8, chrome), 0, height * 1.04, wheelbase * 0.5 - 0.26);
    bars.rotation.z = Math.PI / 2;
    for (const side of [-1, 1] as const) put(cyl(0.032, 0.032, 0.12, 8, dark), side * width * 0.29, height * 1.04, wheelbase * 0.5 - 0.26).rotation.z = Math.PI / 2;
    put(new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), mats.glow('#fff4d6')), 0, height * 0.84, wheelbase * 0.5 - 0.02);
    put(rbox(width * 0.24, 0.04, 0.24, 0.02, paintMat), 0, height * 0.90, wheelbase * 0.5 + 0.02).rotation.x = -0.3;
    put(cyl(0.05, 0.05, 0.12, 8, chrome), 0, height * 0.76, wheelbase * 0.5 - 0.02).rotation.x = Math.PI / 2;
    // Number plate on the tank side.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), mats.decal(numberDecal(opts.number ?? 1, trimColor)));
    plate.rotation.y = Math.PI / 2; put(plate, width * 0.153, height * 0.66, length * 0.10);
    const plate2 = plate.clone(); plate2.rotation.y = -Math.PI / 2; put(plate2, -width * 0.153, height * 0.66, length * 0.10);
    // Exhaust: one fat pipe low on the right, tip chromed.
    for (const sock of [exhaustL, exhaustR]) {
      const pipe = cyl(0.07, 0.085, 0.5, 10, metalMat);
      pipe.rotation.x = Math.PI / 2; sock.add(pipe);
      const tip = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.02, 6, 14), chrome);
      tip.position.z = -0.25; sock.add(tip);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.8, 8), mats.glow(boostGlow, 0.9));
      flame.rotation.x = -Math.PI / 2; flame.position.z = -0.6; flame.visible = false;
      sock.add(flame); flames.push(flame);
    }
    // Two wheels, in line.
    const tyreW = width * 0.16;
    const wheelGeo = new THREE.CylinderGeometry(wr, wr, tyreW, 18); wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, tyreW * 1.04, 14); rimGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(tyreW * 1.08, wr * 0.08, wr * 1.1);
    for (const sz of [1, -1] as const) {
      const holder = new THREE.Group();
      holder.position.set(0, wr, sz * wheelbase * 0.5);
      chassis.add(holder);
      const w = new THREE.Mesh(wheelGeo, tyreMat);
      holder.add(w);
      w.add(new THREE.Mesh(rimGeo, trimMat));
      for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(spokeGeo, chrome); sp.rotation.x = (i / 4) * Math.PI; w.add(sp); }
      wheels.push({ holder, mesh: w, front: sz > 0 });
      if (sz < 0) {
        for (const sx of [-1, 1] as const) { const anchor = new THREE.Group(); anchor.position.set(sx * 0.18, -wr * 0.7, 0); holder.add(anchor); sparkAnchors.push(anchor); }
      }
    }
  } else if (def.body === 'quad') {
    // ---- quad bike -----------------------------------------------------------
    // Balloon tyres on a wide track, an open tube frame, a high saddle, bars,
    // front and rear racks, and a stubby pipe each side.
    const wr = wheelRadius;
    put(rbox(width * 0.36, height * 0.20, length * 0.66, 0.06, metalMat), 0, height * 0.40, 0);
    put(rbox(width * 0.46, height * 0.22, length * 0.30, 0.08), 0, height * 0.58, length * 0.08);
    put(rbox(width * 0.10, 0.012, length * 0.26, 0.004, trimPaint), 0, height * 0.695, length * 0.08);
    put(rbox(width * 0.30, 0.10, length * 0.28, 0.05, seatMat), 0, height * 0.68, -length * 0.16);
    for (const side of [-1, 1] as const) {
      // Tube frame rails and mudguards.
      put(cyl(0.028, 0.028, length * 0.74, 8, chrome), side * width * 0.22, height * 0.50, 0).rotation.x = Math.PI / 2;
      for (const sz of [-1, 1] as const) {
        const guard = new THREE.Mesh(new THREE.CylinderGeometry(wr * 1.15, wr * 1.15, width * 0.22, 14, 1, true, Math.PI / 2, Math.PI), paintMat);
        guard.rotation.z = Math.PI / 2;
        put(guard, side * width * 0.50, wr, sz * wheelbase * 0.5);
      }
      put(cyl(0.05, 0.06, 0.34, 8, metalMat), side * width * 0.26, height * 0.46, -length * 0.40).rotation.x = Math.PI / 2;
    }
    // Racks front and back.
    for (const sz of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) put(rbox(width * 0.44, 0.02, 0.02, 0.01, chrome), 0, height * 0.62, sz * (length * 0.36 + i * 0.07));
      put(rbox(0.02, 0.02, 0.22, 0.01, chrome), -width * 0.21, height * 0.62, sz * length * 0.43);
      put(rbox(0.02, 0.02, 0.22, 0.01, chrome), width * 0.21, height * 0.62, sz * length * 0.43);
    }
    // Bars and headlight.
    const stem = put(cyl(0.025, 0.03, height * 0.34, 8, chrome), 0, height * 0.80, length * 0.24); stem.rotation.x = -0.35;
    put(cyl(0.022, 0.022, width * 0.62, 8, chrome), 0, height * 0.96, length * 0.18).rotation.z = Math.PI / 2;
    for (const side of [-1, 1] as const) put(cyl(0.032, 0.032, 0.12, 8, dark), side * width * 0.29, height * 0.96, length * 0.18).rotation.z = Math.PI / 2;
    put(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mats.glow('#fff4d6')), 0, height * 0.70, length * 0.46);
    const roundel = new THREE.Mesh(new THREE.CircleGeometry(width * 0.10, 24), mats.decal(numberDecal(opts.number ?? 1, trimColor)));
    roundel.rotation.x = -Math.PI / 2 + 0.5; put(roundel, 0, height * 0.74, length * 0.20);
    for (const sock of [exhaustL, exhaustR]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), mats.glow(boostGlow, 0.9));
      flame.rotation.x = -Math.PI / 2; flame.position.z = -0.5; flame.visible = false;
      sock.add(flame); flames.push(flame);
    }
    // Balloon tyres: fat, deep-lugged.
    const tyreW = width * 0.26;
    const wheelGeo = new THREE.CylinderGeometry(wr, wr, tyreW, 12); wheelGeo.rotateZ(Math.PI / 2);
    const lugGeo = new THREE.BoxGeometry(tyreW * 1.02, wr * 0.10, wr * 0.22);
    const rimGeo = new THREE.CylinderGeometry(wr * 0.5, wr * 0.5, tyreW * 1.04, 10); rimGeo.rotateZ(Math.PI / 2);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const holder = new THREE.Group();
      holder.position.set(sx * width * 0.50, wr, sz * wheelbase * 0.5);
      chassis.add(holder);
      const w = new THREE.Mesh(wheelGeo, tyreMat);
      holder.add(w);
      for (let i = 0; i < 8; i++) { const lug = new THREE.Mesh(lugGeo, tyreMat); const a = (i / 8) * Math.PI * 2; lug.position.set(0, Math.sin(a) * wr, Math.cos(a) * wr); lug.rotation.x = -a; w.add(lug); }
      w.add(new THREE.Mesh(rimGeo, trimMat));
      wheels.push({ holder, mesh: w, front: sz > 0 });
      if (sz < 0) { const anchor = new THREE.Group(); anchor.position.set(0, -wr * 0.7, 0); holder.add(anchor); sparkAnchors.push(anchor); }
    }
  } else if (def.body === 'sled') {
    // ---- snow sled -----------------------------------------------------------
    // A snowmobile: a long hull with a windscreen, two skis on steering
    // struts up front, a driven rubber track under the tail, running boards.
    const hull = put(rbox(width * 0.46, height * 0.42, length * 0.78, 0.12), 0, height * 0.52, 0.02);
    void hull;
    put(rbox(width * 0.10, 0.012, length * 0.70, 0.004, trimPaint), 0, height * 0.735, 0.02);
    put(rbox(width * 0.34, 0.10, length * 0.34, 0.05, seatMat), 0, height * 0.74, -length * 0.20);
    for (const side of [-1, 1] as const) put(rbox(width * 0.14, 0.05, length * 0.46, 0.02, dark), side * width * 0.32, height * 0.34, -length * 0.08);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.40, height * 0.36), glass);
    screen.rotation.x = -0.5; put(screen, 0, height * 0.94, length * 0.22);
    put(cyl(0.022, 0.022, width * 0.56, 8, chrome), 0, height * 0.90, length * 0.16).rotation.z = Math.PI / 2;
    for (const side of [-1, 1] as const) put(cyl(0.032, 0.032, 0.12, 8, dark), side * width * 0.26, height * 0.90, length * 0.16).rotation.z = Math.PI / 2;
    put(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mats.glow('#fff4d6')), 0, height * 0.62, length * 0.42);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), mats.decal(numberDecal(opts.number ?? 1, trimColor)));
    plate.rotation.y = Math.PI / 2; put(plate, width * 0.233, height * 0.56, 0.05);
    const plate2 = plate.clone(); plate2.rotation.y = -Math.PI / 2; put(plate2, -width * 0.233, height * 0.56, 0.05);
    // Skis on struts: they steer, so they are the front "wheels" (no spin).
    const skiGeo = new THREE.BoxGeometry(0.16, 0.05, 0.9);
    const skiTip = new THREE.BoxGeometry(0.16, 0.05, 0.22);
    for (const sx of [-1, 1] as const) {
      const holder = new THREE.Group();
      holder.position.set(sx * width * 0.42, 0.05, wheelbase * 0.5);
      chassis.add(holder);
      const ski = new THREE.Mesh(skiGeo, chrome); holder.add(ski);
      const tip = new THREE.Mesh(skiTip, chrome); tip.position.set(0, 0.06, 0.5); tip.rotation.x = -0.6; holder.add(tip);
      const strut = cyl(0.03, 0.03, height * 0.48, 8, dark); strut.position.set(0, height * 0.24, 0); holder.add(strut);
      const spring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), chrome); spring.position.set(0, height * 0.34, 0); spring.rotation.x = Math.PI / 2; holder.add(spring);
      // A static mesh stands in for the wheel: it steers with the holder and never spins.
      wheels.push({ holder, mesh: new THREE.Mesh(), front: true });
    }
    // The rear track: a rubber loop over two drums, lugs across it.
    const trackLen = wheelbase * 0.9, trackR = wheelRadius * 0.9;
    const belt = put(rbox(width * 0.30, trackR * 2, trackLen, trackR * 0.9, tyreMat), 0, trackR, -wheelbase * 0.28);
    void belt;
    for (let i = 0; i < 9; i++) put(rbox(width * 0.32, 0.05, 0.05, 0.01, dark), 0, 0.03, -wheelbase * 0.28 - trackLen * 0.45 + i * (trackLen * 0.9 / 8));
    const drumGeo = new THREE.CylinderGeometry(trackR * 0.55, trackR * 0.55, width * 0.28, 10); drumGeo.rotateZ(Math.PI / 2);
    for (const sz of [-1, 1] as const) {
      const holder = new THREE.Group();
      holder.position.set(0, trackR, -wheelbase * 0.28 + sz * trackLen * 0.42);
      chassis.add(holder);
      const drum = new THREE.Mesh(drumGeo, trimMat); holder.add(drum);
      wheels.push({ holder, mesh: drum, front: false });
      if (sz < 0) { for (const sx of [-1, 1] as const) { const anchor = new THREE.Group(); anchor.position.set(sx * 0.16, -trackR * 0.7, 0); holder.add(anchor); sparkAnchors.push(anchor); } }
    }
    for (const sock of [exhaustL, exhaustR]) {
      const pipe = cyl(0.06, 0.07, 0.3, 10, metalMat); pipe.rotation.x = Math.PI / 2; sock.add(pipe);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), mats.glow(boostGlow, 0.9));
      flame.rotation.x = -Math.PI / 2; flame.position.z = -0.5; flame.visible = false;
      sock.add(flame); flames.push(flame);
    }
  } else {
    // ---- hover glider ------------------------------------------------------
    // A flat teardrop hull with a canopy, wide swept fins, four thruster pods
    // underneath and a glowing hover ring. No wheels: it rides on the ring.
    const hull = put(rbox(width * 0.78, height * 0.42, length * 0.80, 0.16), 0, height * 0.50, 0);
    hull.scale.set(1, 1, 1);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(width * 0.30, 14, 10), paintMat);
    nose.scale.set(1.25, 0.65, 1.4); put(nose, 0, height * 0.50, length * 0.36);
    put(rbox(width * 0.12, 0.012, length * 0.70, 0.004, trimPaint), 0, height * 0.715, 0.02);
    for (const side of [-1, 1] as const) {
      // Swept fins, thick at the root, with a trim edge.
      const fin = put(rbox(width * 0.42, 0.06, length * 0.36, 0.03, paintMat), side * width * 0.58, height * 0.50, -length * 0.16);
      fin.rotation.y = side * 0.35; fin.rotation.z = side * 0.10;
      const edge = put(rbox(width * 0.44, 0.02, 0.06, 0.01, trimPaint), side * width * 0.60, height * 0.50, -length * 0.33);
      edge.rotation.y = side * 0.35;
      const tipLight = put(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mats.glow(side < 0 ? '#ff5a4a' : '#5fe08a')), side * width * 0.78, height * 0.52, -length * 0.26);
      void tipLight;
      // Thruster pods under the corners, with a glowing core.
      for (const sz of [-1, 1] as const) {
        const pod = cyl(width * 0.10, width * 0.13, height * 0.30, 12, metalMat);
        put(pod, side * width * 0.30, height * 0.22, sz * length * 0.26);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.075, width * 0.075, 0.03, 12), mats.glow('#7fd8ff', 1));
        put(core, side * width * 0.30, height * 0.06, sz * length * 0.26);
      }
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(width * 0.42, 0.045, 8, 36), mats.glow('#7fd8ff', 0.85));
    ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1.6, 1); put(ring, 0, height * 0.10, 0);
    // Canopy over the seat, a tail fin, and a number roundel on the nose.
    put(new THREE.Mesh(new THREE.SphereGeometry(width * 0.26, 14, 10), glass), 0, height * 0.74, length * 0.14).scale.set(1, 0.5, 1.4);
    put(rbox(0.05, height * 0.34, length * 0.18, 0.02, trimPaint), 0, height * 0.86, -length * 0.36);
    const roundel = new THREE.Mesh(new THREE.CircleGeometry(width * 0.12, 24), mats.decal(numberDecal(opts.number ?? 1, bodyColor)));
    roundel.rotation.x = -Math.PI / 2 + 0.4; put(roundel, 0, height * 0.66, length * 0.30);
    // Rear thrusters carry the boost flame.
    for (const sock of [exhaustL, exhaustR]) {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.28, 12), metalMat);
      noz.rotation.x = Math.PI / 2; sock.add(noz);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), mats.glow('#7fd8ff', 1));
      glow.position.z = -0.145; glow.rotation.y = Math.PI; sock.add(glow);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9, 8), mats.glow(boostGlow, 0.9));
      flame.rotation.x = -Math.PI / 2; flame.position.z = -0.6; flame.visible = false;
      sock.add(flame); flames.push(flame);
      const anchor = new THREE.Group(); anchor.position.set(0, -0.1, -0.2); sock.add(anchor); sparkAnchors.push(anchor);
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
  /** The official mascot models; preferred over the Mixer for the drivers
   *  that are those characters. */
  mascots?: MascotModelService;
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

  const mascots = ctx.mascots;
  if (mascots && axie.mascot) {
    const file = axie.mascot.file;
    void mascots.load(file).then((asset) => {
      if (!asset || kart.seatToken !== token) return;
      kart.driver?.dispose();
      const upgraded = mascotDriver(mascots.instance(asset), axie);
      kart.sockets.seat.add(upgraded.root);
      kart.driver = upgraded;
    });
    return driver;
  }

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

  // Suspension squat and roll on top of the body attitude. A bike leans into
  // the steer; a glider floats and banks, with no suspension to squat.
  const squat = s.compression * 0.16;
  if (rig.def.body === 'bike') {
    rig.chassis.position.y = -squat * 0.6;
    rig.chassis.rotation.z = s.roll - clamp(s.steer, -1, 1) * 0.42 - (s.drifting ? s.driftDir * 0.18 : 0);
  } else if (rig.def.body === 'hover') {
    rig.spin += dt;
    rig.chassis.position.y = 0.34 + Math.sin(rig.spin * 3.1) * 0.04 - squat * 0.3;
    rig.chassis.rotation.z = s.roll - clamp(s.steer, -1, 1) * 0.30;
    rig.chassis.rotation.x = s.pitch - clamp01(s.speed / Math.max(8, s.topSpeed)) * 0.06;
  } else {
    rig.chassis.position.y = -squat;
  }

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
