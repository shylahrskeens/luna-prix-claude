/** Third-person chase camera.
 *
 *  Distance and field of view respond to speed, the camera looks ahead into
 *  the corner rather than at the back of the kart, and it frames a drift by
 *  swinging toward the outside of the slide. Every one of those behaviours can
 *  be turned down or off from the comfort settings, because a camera that
 *  makes someone motion sick is not a camera.
 */
import * as THREE from 'three';
import { clamp, clamp01, damp, angleDamp, lerp } from '../core/math';

export interface CameraSettings {
  /** 0..1 scale on the speed-driven FOV swell. */
  fovKick: number;
  /** 0..1 scale on impact and boost shake. */
  shake: number;
  /** 0..1 scale on drift framing swing. */
  driftFraming: number;
  /** Base field of view in degrees. */
  baseFov: number;
  /** How far behind the kart the camera sits at rest. */
  distance: number;
  height: number;
}

export const DEFAULT_CAMERA: CameraSettings = {
  fovKick: 1, shake: 1, driftFraming: 1, baseFov: 60, distance: 7.6, height: 3.5,
};
export const COMFORT_CAMERA: CameraSettings = {
  fovKick: 0.25, shake: 0, driftFraming: 0.3, baseFov: 64, distance: 8.2, height: 3.8,
};

export interface ChaseInput {
  dt: number;
  /** Kart pose. */
  x: number; y: number; z: number; yaw: number;
  speed: number;
  topSpeed: number;
  boosting: boolean;
  drifting: boolean;
  driftDir: number;
  grounded: boolean;
  airTime: number;
  /** Direction of the road ahead, for look-ahead framing. */
  roadFwdX: number;
  roadFwdZ: number;
  /** 0..1 impulse, decays externally. */
  shake: number;
  /** Player is holding look-back. */
  lookBack: boolean;
  /** Road height under the camera's own position, if the caller knows it.
   *  On a steep descent the road behind the kart is HIGHER than the kart,
   *  and a camera hung a fixed height above the kart ends up under it,
   *  looking at the underside of the ramp. */
  groundY?: number;
}

export class ChaseCamera {
  settings: CameraSettings = { ...DEFAULT_CAMERA };
  private yaw = 0;
  private dist = 7;
  private height = 3;
  private fov = 62;
  private look = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private shakeAmt = 0;
  private lateral = 0;
  private initialised = false;

  reset(x: number, y: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.pos.set(x - Math.sin(yaw) * this.settings.distance, y + this.settings.height, z - Math.cos(yaw) * this.settings.distance);
    this.look.set(x, y, z);
    this.initialised = true;
    this.shakeAmt = 0;
    this.lateral = 0;
  }

  update(cam: THREE.PerspectiveCamera, s: ChaseInput): void {
    const st = this.settings;
    const dt = Math.min(s.dt, 0.05);
    if (!this.initialised) this.reset(s.x, s.y, s.z, s.yaw);

    const fast = clamp01(s.speed / Math.max(10, s.topSpeed));

    // Yaw follows the kart, but lags in a drift so the camera stays behind the
    // direction of travel rather than the direction the kart is pointing.
    const driftOffset = s.drifting ? -s.driftDir * 0.34 * st.driftFraming : 0;
    const targetYaw = s.lookBack ? s.yaw + Math.PI : s.yaw + driftOffset;
    const follow = s.lookBack ? 12 : lerp(6.5, 11.0, fast);
    this.yaw = angleDamp(this.yaw, targetYaw, follow, dt);

    // Pull back and lift with speed; lift further in the air so a jump reads.
    const airLift = clamp01(s.airTime * 0.8) * 2.2;
    this.dist = damp(this.dist, st.distance + fast * 2.1 + (s.boosting ? 0.7 : 0) + airLift * 0.4, 5, dt);
    this.height = damp(this.height, st.height + fast * 0.5 + airLift, 5, dt);

    // Swing toward the outside of a drift.
    const latTarget = s.drifting ? s.driftDir * 1.5 * st.driftFraming : 0;
    this.lateral = damp(this.lateral, latTarget, 5, dt);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rx = cy, rz = -sy;
    this.pos.set(
      s.x - sy * this.dist + rx * this.lateral,
      s.y + this.height,
      s.z - cy * this.dist + rz * this.lateral,
    );
    // Never below the road it is hanging over.
    if (s.groundY !== undefined && this.pos.y < s.groundY + 1.7) this.pos.y = s.groundY + 1.7;

    // Look ahead down the road, not at the kart. Blending the kart's own
    // heading with the road's keeps the framing honest when the two disagree,
    // which is exactly what a drift is.
    const aheadDist = 4.5 + fast * 8.5;
    const blend = s.grounded ? 0.55 : 0.2;
    const lookX = s.x + lerp(Math.sin(s.yaw), s.roadFwdX, blend) * aheadDist;
    const lookZ = s.z + lerp(Math.cos(s.yaw), s.roadFwdZ, blend) * aheadDist;
    const lookY = s.y + 1.35;
    this.look.x = damp(this.look.x, s.lookBack ? s.x - Math.sin(s.yaw) * 10 : lookX, 9, dt);
    this.look.y = damp(this.look.y, lookY, 7, dt);
    this.look.z = damp(this.look.z, s.lookBack ? s.z - Math.cos(s.yaw) * 10 : lookZ, 9, dt);

    // Shake: short, bounded, and never enough to lose the road.
    this.shakeAmt = Math.max(this.shakeAmt * Math.exp(-7 * dt), s.shake * st.shake);
    const a = this.shakeAmt * 0.16;
    cam.position.set(
      this.pos.x + (Math.random() - 0.5) * a,
      this.pos.y + (Math.random() - 0.5) * a,
      this.pos.z + (Math.random() - 0.5) * a,
    );
    cam.lookAt(this.look);

    const fovTarget = st.baseFov + (fast * 7 + (s.boosting ? 6 : 0)) * st.fovKick;
    this.fov = damp(this.fov, fovTarget, 6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    void clamp;
  }
}
