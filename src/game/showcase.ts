/** The garage turntable.
 *
 *  Renders the live kart and driver behind the menus, using the same builders
 *  the race uses. What you configure is literally the object you will race —
 *  there is no separate preview model to drift out of sync.
 */
import * as THREE from 'three';
import type { RenderContext } from '../render/scene';
import { buildKart, seatAxie, updateKart, type KartRig } from '../render/kartMesh';
import { axieById } from '../data/axies';
import { kartById } from '../data/karts';
import type { LoadoutParts } from '../sim/loadout';
import { damp } from '../core/math';

export class Showcase {
  private ctx: RenderContext;
  private root = new THREE.Group();
  private rig: KartRig | null = null;
  private turn = 0;
  private targetTurn = 0;
  private t = 0;
  private key: string = '';
  private floor: THREE.Mesh;
  active = false;
  /** Set while the player is dragging to spin the model. */
  private dragging = false;
  private lastX = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.root.visible = false;
    ctx.scene.add(this.root);

    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 0.12, 40),
      ctx.materials.toon('#1a1f2f', { flat: false }),
    );
    ring.position.y = -0.07;
    this.root.add(ring);
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.04, 6, 48),
      ctx.materials.glow('#c79bff', 0.85),
    );
    glow.rotation.x = Math.PI / 2;
    this.root.add(glow);
    this.floor = ring;
  }

  /** Attach drag-to-spin on the canvas. */
  bind(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.targetTurn -= (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
  }

  show(axieId: string, kartId: string, parts: LoadoutParts, themeColors?: { a: string; b: string }): void {
    const key = `${axieId}|${kartId}|${Object.values(parts).map((p) => `${p.partId}${p.level}`).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      if (this.rig) {
        this.root.remove(this.rig.root);
        this.rig.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      }
      this.rig = buildKart(kartById(kartId), this.ctx.materials, { parts });
      seatAxie(this.rig, axieById(axieId), this.ctx.materials);
      this.root.add(this.rig.root);
    }
    this.active = true;
    this.root.visible = true;
    this.ctx.scene.fog = null;
    this.ctx.renderer.setClearColor(new THREE.Color(themeColors?.a ?? '#0a0c12'), 1);
  }

  hide(): void {
    this.active = false;
    this.root.visible = false;
  }

  update(dt: number): void {
    if (!this.active || !this.rig) return;
    this.t += dt;
    if (!this.dragging) this.targetTurn += dt * 0.28;
    this.turn = damp(this.turn, this.targetTurn, 8, dt);
    this.rig.root.rotation.y = this.turn;
    this.floor.rotation.y = -this.turn * 0.3;

    updateKart(this.rig, {
      dt,
      x: 0, y: 0, z: 0,
      yaw: this.turn, pitch: 0, roll: 0,
      groundY: 0,
      speed: 0, topSpeed: 30,
      steer: Math.sin(this.t * 0.6) * 0.3,
      drifting: false, driftDir: 0, driftTier: 0,
      boosting: false, grounded: true, airTime: 0, compression: 0,
      impact: 0, rivalSide: Math.sin(this.t * 0.45) * 0.6,
      mood: 'idle',
      spinTimer: 0, respawnFade: 1,
    });
    // The rig root carries the turn, so undo it on the kart's own transform.
    this.rig.root.rotation.y = this.turn;

    // Three-quarter view from far enough back that the whole kart sits inside
    // the clear column the menus leave down the middle of the screen.
    const cam = this.ctx.camera;
    const narrow = window.innerWidth < 1100;
    const dist = narrow ? 7.4 : 9.6;
    cam.position.set(dist * 0.62, dist * 0.40, dist * 0.78);
    cam.lookAt(0, narrow ? 0.75 : 0.60, 0);
    const fov = narrow ? 34 : 26;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.ctx.sun.position.set(6, 9, 7);
    this.ctx.sun.target.position.set(0, 0.6, 0);
    this.ctx.render();
  }
}
