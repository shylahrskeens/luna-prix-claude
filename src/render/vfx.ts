/** Pooled particle effects.
 *
 *  One InstancedMesh, one fixed pool, no allocation during a race. The budget
 *  comes from the quality tier, and when it is exhausted the oldest particle
 *  is recycled rather than the effect being dropped — so the gameplay-critical
 *  cues (drift tier colour, boost flare, impact) never vanish under load.
 */
import * as THREE from 'three';
import { clamp01, Rng } from '../core/math';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  drag: number;
  gravity: number;
  spin: number;
  rot: number;
}

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private cursor = 0;
  private rng = new Rng(4242);
  private budget: number;

  constructor(budget: number) {
    this.budget = budget;
    // A flat quad, always camera-facing via per-instance rotation toward the
    // camera in `update`. Cheaper and more controllable than a Points cloud.
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexColors: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, budget);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(budget * 3), 3);
    this.mesh.count = budget;
    for (let i = 0; i < budget; i++) {
      this.pool.push({
        x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0, grow: 0,
        r: 1, g: 1, b: 1, drag: 1, gravity: 0, spin: 0, rot: 0,
      });
    }
  }

  setBudget(n: number): void {
    this.budget = Math.min(n, this.pool.length);
    this.mesh.count = this.budget;
  }

  private take(): Particle {
    // Round-robin recycling: an effect never fails to emit, it just takes the
    // oldest slot. Under load the picture thins out instead of going missing.
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.budget;
    return p;
  }

  emit(opts: {
    x: number; y: number; z: number;
    vx?: number; vy?: number; vz?: number;
    spread?: number; speed?: number;
    life?: number; size?: number; grow?: number;
    color: THREE.ColorRepresentation;
    gravity?: number; drag?: number; count?: number;
  }): void {
    const n = opts.count ?? 1;
    COLOR.set(opts.color);
    for (let i = 0; i < n; i++) {
      const p = this.take();
      const spread = opts.spread ?? 0;
      const sp = opts.speed ?? 0;
      p.x = opts.x; p.y = opts.y; p.z = opts.z;
      p.vx = (opts.vx ?? 0) + this.rng.signed() * spread + this.rng.signed() * sp;
      p.vy = (opts.vy ?? 0) + this.rng.next() * spread;
      p.vz = (opts.vz ?? 0) + this.rng.signed() * spread + this.rng.signed() * sp;
      p.maxLife = (opts.life ?? 0.5) * this.rng.range(0.75, 1.25);
      p.life = p.maxLife;
      p.size = (opts.size ?? 0.4) * this.rng.range(0.7, 1.3);
      p.grow = opts.grow ?? 0;
      p.r = COLOR.r; p.g = COLOR.g; p.b = COLOR.b;
      p.gravity = opts.gravity ?? 0;
      p.drag = opts.drag ?? 2.2;
      p.spin = this.rng.signed() * 4;
      p.rot = this.rng.next() * Math.PI;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    const q = camera.quaternion;
    for (let i = 0; i < this.budget; i++) {
      const p = this.pool[i];
      if (p.life <= 0) {
        DUMMY.position.set(0, -9999, 0);
        DUMMY.scale.setScalar(0);
        DUMMY.updateMatrix();
        this.mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }
      p.life -= dt;
      const k = 1 - Math.exp(-p.drag * dt);
      p.vx -= p.vx * k;
      p.vz -= p.vz * k;
      p.vy -= p.vy * k;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;

      const t = clamp01(p.life / p.maxLife);
      const size = p.size * (1 + p.grow * (1 - t));
      DUMMY.position.set(p.x, p.y, p.z);
      DUMMY.quaternion.copy(q);
      DUMMY.rotateZ(p.rot);
      DUMMY.scale.setScalar(size * (0.25 + t * 0.75));
      DUMMY.updateMatrix();
      this.mesh.setMatrixAt(i, DUMMY.matrix);
      // Fade by dimming the additive colour — no per-instance alpha needed.
      const fade = t * t;
      this.mesh.setColorAt(i, COLOR.setRGB(p.r * fade, p.g * fade, p.b * fade));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pool) p.life = 0;
  }
}

/** Screen-space speed lines, drawn as a fixed ring of quads parented to the
 *  camera. Intensity is driven by speed and boost. */
export class SpeedLines {
  readonly group = new THREE.Group();
  private bars: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;

  constructor(count = 26) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    // Short, thin, and pushed out toward the edge of frame. Speed lines that
    // reach the middle of the screen read as debris lying on the road rather
    // than as motion, and they hide the thing you are steering at.
    const geo = new THREE.PlaneGeometry(0.004, 0.075);
    const rng = new Rng(77);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      const a = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const r = rng.range(0.70, 1.15);
      m.position.set(Math.cos(a) * r, Math.sin(a) * r, -1);
      m.rotation.z = a - Math.PI / 2;
      this.bars.push(m);
      this.group.add(m);
    }
    this.group.renderOrder = 900;
    this.group.frustumCulled = false;
  }

  /** `intensity` 0..1. Motion-comfort settings can cap it to zero. */
  update(intensity: number, dt: number): void {
    this.mat.opacity = clamp01(intensity) * 0.16;
    const scale = 0.7 + clamp01(intensity) * 1.1;
    for (const b of this.bars) b.scale.set(1, scale, 1);
    void dt;
  }
}
