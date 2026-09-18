/** Procedural Axie models and their animation rig.
 *
 *  The model is built from the SAME six parts that produce the driving stats,
 *  so an Axie looks like what it drives like: six Plant parts give Pomodoro a
 *  leafy, heavy silhouette and the armour to match. Swapping in the official
 *  3D toolkit meshes later means replacing `buildAxie` — the rig contract and
 *  every animation layer below it stays exactly as it is.
 *
 *  Animation is layered rather than switched: idle, steering, drift, air,
 *  landing, boost, impact and finish all write to different channels of the
 *  same rig, so a drifting Axie that gets hit mid-corner still leans into the
 *  corner while it flinches.
 */
import * as THREE from 'three';
import type { AxieClass, AxieDefinition, AxiePart } from '../data/axies';
import type { MaterialLibrary } from './scene';
import { clamp, clamp01, damp, lerp } from '../core/math';

/** Per-class accent used for parts whose class differs from the body. */
const CLASS_TINT: Record<AxieClass, string> = {
  Beast: '#f2a44c', Aquatic: '#63c9f0', Plant: '#84d96e', Bird: '#f2708f',
  Bug: '#e8534f', Reptile: '#c07adf', Mech: '#9fb3c8', Dawn: '#b7c7ff', Dusk: '#7b6bd6',
};

export interface AxieRig {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  eyes: THREE.Group;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  pupilL: THREE.Mesh;
  pupilR: THREE.Mesh;
  mouth: THREE.Mesh;
  earL: THREE.Group;
  earR: THREE.Group;
  horn: THREE.Group;
  back: THREE.Group;
  tail: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Internal animation state. */
  anim: {
    lean: number;
    crouch: number;
    earTrail: number;
    tailSwing: number;
    blink: number;
    blinkTimer: number;
    squint: number;
    cheer: number;
    flinch: number;
    lookX: number;
    lookY: number;
    t: number;
  };
}

function partFor(def: AxieDefinition, type: AxiePart['type']): AxiePart {
  return def.parts.find((p) => p.type === type) ?? def.parts[0];
}

/** Ear geometry by the ear part's class — this is where a Beast reads as a
 *  Beast from thirty metres away. */
function earGeometry(cls: AxieClass): THREE.BufferGeometry {
  switch (cls) {
    case 'Beast':   return new THREE.ConeGeometry(0.16, 0.42, 4);
    case 'Aquatic': return new THREE.CylinderGeometry(0.02, 0.22, 0.34, 3);
    case 'Plant':   return new THREE.SphereGeometry(0.18, 5, 4).scale(1, 0.4, 1.5);
    case 'Bird':    return new THREE.ConeGeometry(0.13, 0.46, 3);
    case 'Bug':     return new THREE.CylinderGeometry(0.035, 0.05, 0.50, 4);
    case 'Reptile': return new THREE.ConeGeometry(0.19, 0.26, 5);
    default:        return new THREE.BoxGeometry(0.22, 0.30, 0.10);
  }
}
function hornGeometry(cls: AxieClass): THREE.BufferGeometry {
  switch (cls) {
    case 'Beast':   return new THREE.ConeGeometry(0.11, 0.40, 5);
    case 'Aquatic': return new THREE.SphereGeometry(0.15, 6, 5).scale(1, 1.5, 0.5);
    case 'Plant':   return new THREE.CylinderGeometry(0.05, 0.09, 0.36, 5);
    case 'Bird':    return new THREE.ConeGeometry(0.09, 0.50, 4);
    case 'Bug':     return new THREE.ConeGeometry(0.13, 0.30, 6);
    case 'Reptile': return new THREE.ConeGeometry(0.15, 0.34, 4);
    default:        return new THREE.CylinderGeometry(0.06, 0.06, 0.40, 6);
  }
}
function backGeometry(cls: AxieClass): THREE.BufferGeometry {
  switch (cls) {
    case 'Beast':   return new THREE.SphereGeometry(0.30, 6, 5).scale(1, 0.75, 1.1);
    case 'Aquatic': return new THREE.ConeGeometry(0.26, 0.42, 4).rotateX(Math.PI * 0.12);
    case 'Plant':   return new THREE.SphereGeometry(0.26, 5, 4).scale(1.4, 0.5, 1);
    case 'Bird':    return new THREE.BoxGeometry(0.62, 0.08, 0.34);
    case 'Bug':     return new THREE.SphereGeometry(0.28, 6, 4).scale(1, 0.6, 1.2);
    case 'Reptile': return new THREE.ConeGeometry(0.16, 0.30, 4);
    default:        return new THREE.BoxGeometry(0.42, 0.20, 0.30);
  }
}
function tailGeometry(cls: AxieClass): THREE.BufferGeometry {
  switch (cls) {
    case 'Beast':   return new THREE.ConeGeometry(0.12, 0.52, 5).rotateX(Math.PI / 2);
    case 'Aquatic': return new THREE.ConeGeometry(0.22, 0.34, 3).rotateX(Math.PI / 2).scale(1, 1.6, 1);
    case 'Plant':   return new THREE.SphereGeometry(0.16, 5, 4).scale(0.7, 0.7, 2.2);
    case 'Bird':    return new THREE.BoxGeometry(0.30, 0.06, 0.46);
    case 'Bug':     return new THREE.CylinderGeometry(0.10, 0.03, 0.44, 5).rotateX(Math.PI / 2);
    default:        return new THREE.ConeGeometry(0.14, 0.40, 4).rotateX(Math.PI / 2);
  }
}
function mouthGeometry(cls: AxieClass): THREE.BufferGeometry {
  switch (cls) {
    case 'Aquatic': return new THREE.TorusGeometry(0.09, 0.035, 4, 8);
    case 'Beast':   return new THREE.BoxGeometry(0.20, 0.08, 0.06);
    case 'Plant':   return new THREE.BoxGeometry(0.16, 0.05, 0.06);
    case 'Bird':    return new THREE.ConeGeometry(0.08, 0.20, 4).rotateX(-Math.PI / 2);
    default:        return new THREE.BoxGeometry(0.17, 0.07, 0.06);
  }
}

export function buildAxie(def: AxieDefinition, mats: MaterialLibrary): AxieRig {
  const root = new THREE.Group();
  const bodyMat = mats.toon(def.palette.body);
  const shadeMat = mats.toon(def.palette.shade);
  const accentMat = mats.toon(def.palette.accent);
  const tint = (p: AxiePart) =>
    p.class === def.class ? bodyMat : mats.toon(CLASS_TINT[p.class]);

  // ---- body ---------------------------------------------------------------
  const bodyGeo = new THREE.SphereGeometry(0.42, 8, 6);
  bodyGeo.scale(1.0, 0.92, 1.08);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.34;
  root.add(body);

  // Four stubby legs, tucked because the Axie is sitting in a kart.
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.10, 5, 4), shadeMat);
    leg.position.set(sx * 0.27, 0.10, sz * 0.22);
    leg.scale.set(1, 0.8, 1.2);
    root.add(leg);
  }

  // ---- head group (the whole front of the body) ---------------------------
  const head = new THREE.Group();
  head.position.set(0, 0.36, 0.06);
  root.add(head);

  // ---- eyes ---------------------------------------------------------------
  const eyes = new THREE.Group();
  head.add(eyes);
  const eyeGeo = new THREE.SphereGeometry(0.115, 8, 6);
  const whiteMat = mats.toon('#ffffff', { flat: false });
  const pupilMat = mats.toon('#171a22', { flat: false });
  const mkEye = (x: number) => {
    const e = new THREE.Mesh(eyeGeo, whiteMat);
    e.position.set(x, 0.05, 0.34);
    e.scale.set(1, 1, 0.7);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.058, 6, 5), pupilMat);
    pupil.position.set(0, 0, 0.075);
    e.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), mats.glow('#ffffff'));
    glint.position.set(0.035, 0.038, 0.10);
    e.add(glint);
    eyes.add(e);
    return { e, pupil };
  };
  const L = mkEye(-0.155);
  const R = mkEye(0.155);

  // ---- mouth --------------------------------------------------------------
  const mouthPart = partFor(def, 'mouth');
  const mouth = new THREE.Mesh(mouthGeometry(mouthPart.class), tint(mouthPart));
  mouth.position.set(0, -0.13, 0.40);
  head.add(mouth);

  // ---- ears ---------------------------------------------------------------
  const earPart = partFor(def, 'ears');
  const earGeo = earGeometry(earPart.class);
  const mkEar = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.34, 0.20, 0.04);
    const m = new THREE.Mesh(earGeo, tint(earPart));
    m.position.y = 0.16;
    m.rotation.z = -side * 0.42;
    g.add(m);
    head.add(g);
    return g;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  // ---- horn ---------------------------------------------------------------
  const hornPart = partFor(def, 'horn');
  const horn = new THREE.Group();
  horn.position.set(0, 0.34, 0.14);
  const hornMesh = new THREE.Mesh(hornGeometry(hornPart.class), tint(hornPart));
  hornMesh.position.y = 0.16;
  hornMesh.rotation.x = -0.34;
  horn.add(hornMesh);
  head.add(horn);

  // ---- back ---------------------------------------------------------------
  const backPart = partFor(def, 'back');
  const back = new THREE.Group();
  back.position.set(0, 0.60, -0.16);
  const backMesh = new THREE.Mesh(backGeometry(backPart.class), tint(backPart));
  back.add(backMesh);
  root.add(back);

  // ---- tail ---------------------------------------------------------------
  const tailPart = partFor(def, 'tail');
  const tail = new THREE.Group();
  tail.position.set(0, 0.30, -0.38);
  const tailMesh = new THREE.Mesh(tailGeometry(tailPart.class), tint(tailPart));
  tailMesh.position.z = -0.20;
  tail.add(tailMesh);
  root.add(tail);

  // ---- arms on the wheel --------------------------------------------------
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.30, 0.38, 0.22);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.20, 3, 5), shadeMat);
    upper.rotation.x = -0.95;
    upper.rotation.z = -side * 0.22;
    upper.position.set(0, -0.02, 0.10);
    g.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.078, 5, 4), accentMat);
    hand.position.set(side * 0.02, -0.06, 0.24);
    g.add(hand);
    root.add(g);
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  root.scale.setScalar(def.rig.scale);

  return {
    root, body, head, eyes,
    eyeL: L.e, eyeR: R.e, pupilL: L.pupil, pupilR: R.pupil,
    mouth, earL, earR, horn, back, tail, armL, armR,
    anim: {
      lean: 0, crouch: 0, earTrail: 0, tailSwing: 0,
      blink: 0, blinkTimer: 1.5, squint: 0, cheer: 0, flinch: 0,
      lookX: 0, lookY: 0, t: 0,
    },
  };
}

/** Everything the rig needs to know about the driving state. */
export interface AxieDriveState {
  dt: number;
  speed: number;
  topSpeed: number;
  steer: number;
  drifting: boolean;
  driftDir: number;
  driftTier: number;
  boosting: boolean;
  grounded: boolean;
  airTime: number;
  compression: number;
  /** 0..1, decays after a hit. */
  impact: number;
  /** 0..1, set when a rival is close alongside. */
  rivalSide: number;
  /** 'race' | 'win' | 'lose' | 'idle' — drives the finish and menu layers. */
  mood: 'race' | 'win' | 'lose' | 'idle';
}

export function updateAxie(rig: AxieRig, s: AxieDriveState): void {
  const a = rig.anim;
  const dt = Math.min(s.dt, 0.05);
  a.t += dt;
  const fast = clamp01(s.speed / Math.max(8, s.topSpeed));

  // ---- blinking -----------------------------------------------------------
  a.blinkTimer -= dt;
  if (a.blinkTimer <= 0) { a.blink = 1; a.blinkTimer = 1.8 + Math.random() * 3.2; }
  a.blink = Math.max(0, a.blink - dt * 7.5);
  const blinkScale = 1 - a.blink * 0.92;

  // ---- lean: steering, then drift on top ---------------------------------
  const steerLean = s.steer * 0.26;
  const driftLean = s.drifting ? s.driftDir * 0.42 : 0;
  a.lean = damp(a.lean, (steerLean + driftLean) * (0.4 + 0.6 * fast), 9, dt);

  // ---- crouch: speed, boost and landing compression ----------------------
  const crouchTarget = fast * 0.10 + (s.boosting ? 0.07 : 0) + s.compression * 0.16;
  a.crouch = damp(a.crouch, crouchTarget, 11, dt);

  // ---- flinch -------------------------------------------------------------
  a.flinch = Math.max(damp(a.flinch, 0, 5, dt), s.impact);

  // ---- squint: wind at speed, hard squint under boost ---------------------
  a.squint = damp(a.squint, fast * 0.35 + (s.boosting ? 0.40 : 0), 7, dt);

  // ---- cheer / slump ------------------------------------------------------
  const cheerTarget = s.mood === 'win' ? 1 : s.mood === 'lose' ? -1 : 0;
  a.cheer = damp(a.cheer, cheerTarget, 4, dt);

  // ---- look: at a rival alongside, else down the road --------------------
  a.lookX = damp(a.lookX, s.rivalSide * 0.55 - s.steer * 0.18, 7, dt);
  a.lookY = damp(a.lookY, s.grounded ? 0 : clamp(-s.airTime * 0.5, -0.35, 0), 6, dt);

  // ---- ears and tail trail the motion ------------------------------------
  a.earTrail = damp(a.earTrail, fast * 0.85 + (s.boosting ? 0.45 : 0) + (s.grounded ? 0 : 0.5), 8, dt);
  a.tailSwing = Math.sin(a.t * (3 + fast * 7)) * (0.14 + fast * 0.22);

  // ---- write the rig ------------------------------------------------------
  const idleBob = Math.sin(a.t * 2.1) * 0.012 * (1 - fast);
  const rumble = s.grounded ? Math.sin(a.t * 44) * 0.004 * fast : 0;

  rig.body.position.y = 0.34 - a.crouch * 0.5 + idleBob + rumble;
  rig.body.rotation.z = -a.lean * 0.55;
  rig.body.rotation.x = a.crouch * 0.6 - (s.grounded ? 0 : 0.18) + a.cheer * -0.12;
  rig.body.scale.set(1 + s.compression * 0.10, 1 - s.compression * 0.14, 1 + s.compression * 0.06);

  rig.head.position.y = 0.36 - a.crouch * 0.42 + idleBob;
  rig.head.rotation.z = -a.lean * 0.85 - a.flinch * 0.25;
  rig.head.rotation.y = a.lookX;
  rig.head.rotation.x = a.lookY + a.flinch * 0.30 + (s.grounded ? 0 : -0.14) + a.cheer * 0.18;

  // Eyes: squint with speed, snap wide open in the air or on impact.
  const wide = (!s.grounded ? 0.30 : 0) + a.flinch * 0.45;
  const eyeOpen = clamp(1 - a.squint + wide, 0.18, 1.45) * blinkScale;
  rig.eyeL.scale.set(1, eyeOpen, 0.7);
  rig.eyeR.scale.set(1, eyeOpen, 0.7);
  const pupilShift = a.lookX * 0.06;
  rig.pupilL.position.x = pupilShift;
  rig.pupilR.position.x = pupilShift;

  // Mouth: open under boost and in the air, grin on a win.
  const open = (s.boosting ? 0.9 : 0) + (!s.grounded ? 0.6 : 0) + Math.max(0, a.cheer);
  rig.mouth.scale.set(1 + open * 0.35, 1 + open * 1.25, 1);
  rig.mouth.position.y = -0.13 - open * 0.02;

  // Ears stream backwards with speed and flick with the lean.
  const earBack = a.earTrail;
  rig.earL.rotation.x = earBack * 0.85;
  rig.earR.rotation.x = earBack * 0.85;
  rig.earL.rotation.z = a.lean * 0.9 - 0.10 + Math.sin(a.t * 9) * 0.03 * earBack;
  rig.earR.rotation.z = a.lean * 0.9 + 0.10 + Math.sin(a.t * 9 + 1) * 0.03 * earBack;

  rig.horn.rotation.z = -a.lean * 0.3;

  // Back part reacts to boost — wings and shells flare.
  const flare = (s.boosting ? 1 : 0) * 0.5 + (s.grounded ? 0 : 0.35);
  rig.back.rotation.x = -flare * 0.42;
  rig.back.scale.setScalar(1 + flare * 0.16);
  rig.back.position.y = 0.60 - a.crouch * 0.42;

  rig.tail.rotation.y = a.tailSwing;
  rig.tail.rotation.x = -earBack * 0.35 + (s.grounded ? 0 : 0.4);
  rig.tail.position.y = 0.30 - a.crouch * 0.42;

  // Hands hold the wheel and turn with it; a win throws one arm up.
  const wheel = s.steer * 0.55 + (s.drifting ? s.driftDir * 0.3 : 0);
  rig.armL.rotation.z = wheel * 0.5;
  rig.armR.rotation.z = wheel * 0.5;
  rig.armL.position.y = 0.38 - a.crouch * 0.42 - wheel * 0.05;
  rig.armR.position.y = 0.38 - a.crouch * 0.42 + wheel * 0.05;
  if (a.cheer > 0.05) {
    rig.armR.rotation.x = -a.cheer * 1.9 + Math.sin(a.t * 9) * 0.25 * a.cheer;
    rig.armL.rotation.x = -a.cheer * 0.5;
  } else if (a.cheer < -0.05) {
    rig.armL.rotation.x = -a.cheer * 0.8;
    rig.armR.rotation.x = -a.cheer * 0.8;
  } else {
    rig.armL.rotation.x = 0;
    rig.armR.rotation.x = 0;
  }
  void lerp;
}

/** A still, well-lit pose for the garage and Axie Select. */
export function poseForShowcase(rig: AxieRig, t: number): void {
  rig.anim.t = t;
  updateAxie(rig, {
    dt: 1 / 60, speed: 0, topSpeed: 30, steer: Math.sin(t * 0.7) * 0.25,
    drifting: false, driftDir: 0, driftTier: 0, boosting: false,
    grounded: true, airTime: 0, compression: 0, impact: 0, rivalSide: 0, mood: 'idle',
  });
}
