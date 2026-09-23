/** KartRuntime — the handling model.
 *
 *  Deliberately not a rigid-body engine. Arcade kart feel comes from a small
 *  set of readable rules: a longitudinal curve that caps at top speed, a
 *  lateral friction budget that can be exceeded on purpose, a yaw rate that
 *  grip limits, and a drift state that trades grip for rotation and pays out
 *  in boost. Every number below is data from the loadout, never a magic
 *  constant tuned per kart.
 *
 *  No three.js import: this runs headless in tests and on the server.
 */
import {
  approach, clamp, clamp01, damp, lerp, v3, v3len, wrapAngle, type V3,
} from '../core/math';
import type { HandlingProfile, ValidatedLoadout } from './loadout';
import { SURFACE, type GroundInfo, type Surface } from './trackTypes';

export const GRAVITY = 24.0;
/** Drift charge thresholds, in charge units. */
export const DRIFT_TIERS = [0.85, 1.95, 3.25];
export const TIER_COLOR = ['#ffffff', '#5fb0ff', '#ffa63d', '#c79bff'];

export interface KartInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  lookBack: boolean;
  /** The class special. Edge-triggered by the race, not the kart. */
  special: boolean;
  /** Fire the charged boost. The meter fills as you race; this spends it. */
  boost?: boolean;
}
export const NEUTRAL_INPUT: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false, lookBack: false, special: false };
/** Metres of driving that fill the boost meter from empty to tier three. A
 *  drift, a pad or a chest fills it faster; racing alone always gets there. */
export const RACE_CHARGE_METRES = 260;

export type KartEventKind =
  | 'hop' | 'driftStart' | 'driftTier' | 'driftEnd' | 'boostStart' | 'boostEnd'
  | 'slowed' | 'shield' | 'shieldHit' | 'jammed' | 'special'
  | 'land' | 'hardLand' | 'wallHit' | 'hazardHit' | 'respawnStart' | 'respawnEnd'
  | 'trickStart' | 'trickComplete' | 'trickFail' | 'padHit' | 'offroad' | 'onroad'
  | 'wrongWay' | 'spin';

export interface KartEvent {
  kind: KartEventKind;
  /** Magnitude 0..1 where meaningful (impact force, tier, landing quality). */
  value: number;
  pos: V3;
}

export type KartMode = 'frozen' | 'driving' | 'spun' | 'respawning' | 'finished';

/** Assists, disclosed in the UI and disabled in ranked by the mode rules. */
export interface Assists {
  autoAccel: boolean;
  steerAssist: boolean;
  recoveryAssist: boolean;
}
export const NO_ASSISTS: Assists = { autoAccel: false, steerAssist: false, recoveryAssist: false };

export class KartRuntime {
  readonly id: string;
  readonly loadout: ValidatedLoadout;
  readonly h: HandlingProfile;

  // --- pose -------------------------------------------------------------
  pos: V3 = v3();
  vel: V3 = v3();
  yaw = 0;
  /** Visual body orientation; also the orientation landing quality is judged on. */
  pitch = 0;
  roll = 0;
  /** Suspension compression 0..1, for the model and the camera. */
  compression = 0;

  // --- driving state ----------------------------------------------------
  mode: KartMode = 'frozen';
  grounded = true;
  airTime = 0;
  lastGroundNormal: V3 = v3(0, 1, 0);
  steerSmoothed = 0;
  surface: Surface = 'road';

  hopping = false;
  hopCooldown = 0;
  drifting = false;
  driftDir: -1 | 0 | 1 = 0;
  driftCharge = 0;
  driftTier = 0;
  driftAngle = 0;

  boostTime = 0;
  boostTier = 0;
  boostSource: 'drift' | 'pad' | 'start' | 'trick' | 'ring' | 'special' = 'drift';

  /** Externally supplied slipstream strength, 0..1 (set by the race core). */
  draft = 0;
  /** Externally supplied catch-up multiplier for bots, 1 = none. */
  catchUp = 1;

  spinTimer = 0;
  // ---- what another racer's special did to this kart -----------------------
  /** Seconds left of a speed penalty, and how hard it bites. */
  slowTimer = 0;
  slowFactor = 1;
  /** Seconds left of immunity to hits and to other karts' specials. */
  shieldTimer = 0;
  /** Seconds left with the boost jammed. */
  noBoostTimer = 0;
  respawnTimer = 0;
  offRoadTimer = 0;
  stuckTimer = 0;
  wrongWayTimer = 0;
  wrongWay = false;

  // --- tricks -----------------------------------------------------------
  trickActive = false;
  trickRotation = 0;
  trickKind: 'flip' | 'spin' | 'none' = 'none';
  trickCount = 0;

  // --- start boost ------------------------------------------------------
  /** Set by the race core during the countdown; charge held in the launch
   *  window converts to a start boost. */
  launchCharge = 0;
  launchBurned = false;

  /** Last ground reading, kept so the renderer and HUD do not re-query. */
  ground: GroundInfo;
  /** Arc-length hint for the next projection. */
  sHint: number | undefined;

  events: KartEvent[] = [];
  assists: Assists = NO_ASSISTS;

  /** Metres travelled, for telemetry. */
  distance = 0;
  /** Peak speed this session, for the results screen. */
  topSpeedSeen = 0;
  /** Seconds spent drifting, for the results screen. */
  driftSeconds = 0;
  /** Boosts triggered, for the results screen. */
  boostCount = 0;

  constructor(id: string, loadout: ValidatedLoadout, ground: GroundInfo) {
    this.id = id;
    this.loadout = loadout;
    this.h = loadout.handling;
    this.ground = ground;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get forwardSpeed(): number {
    return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
  }
  get boosting(): boolean {
    return this.boostTime > 0;
  }
  /** Ride height of the chassis above the road. */
  get rideHeight(): number {
    return 0.34;
  }

  private emit(kind: KartEventKind, value = 1): void {
    this.events.push({ kind, value, pos: { ...this.pos } });
  }

  reset(pos: V3, yaw: number): void {
    this.pos = { ...pos };
    this.vel = v3();
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.driftDir = 0;
    this.boostTime = 0;
    this.spinTimer = 0;
    this.respawnTimer = 0;
    this.offRoadTimer = 0;
    this.stuckTimer = 0;
    this.trickActive = false;
    this.grounded = true;
    this.airTime = 0;
    this.mode = 'frozen';
  }

  /** Hold this kart back for a moment. `factor` is a multiplier on top speed. */
  applySlow(factor: number, seconds: number): void {
    if (this.shieldTimer > 0) return;
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, seconds);
    this.emit('slowed', 1 - factor);
  }
  applyShield(seconds: number): void {
    this.shieldTimer = Math.max(this.shieldTimer, seconds);
    this.emit('shield', seconds);
  }
  applyNoBoost(seconds: number): void {
    if (this.shieldTimer > 0) return;
    this.noBoostTimer = Math.max(this.noBoostTimer, seconds);
    this.boostTime = 0;
    this.emit('jammed', seconds);
  }

  startBoost(tier: number, source: KartRuntime['boostSource']): void {
    if (this.noBoostTimer > 0 && source !== 'special') return;
    const dur = this.h.boostDuration * (tier === 1 ? 1.0 : tier === 2 ? 1.55 : 2.2);
    // Refresh rather than stack: a pad taken mid-boost extends it, it does not
    // double it. Keeps the boost state legible and uncapped stacking out.
    if (dur > this.boostTime) {
      this.boostTime = dur;
      this.boostTier = tier;
      this.boostSource = source;
    }
    const impulse = 1.8 + tier * 1.5;
    this.vel.x += Math.sin(this.yaw) * impulse;
    this.vel.z += Math.cos(this.yaw) * impulse;
    this.boostCount++;
    this.emit('boostStart', tier);
  }

  /** Hazard or heavy contact: lose control briefly. */
  hit(strength: number, dirX: number, dirZ: number): void {
    if (this.shieldTimer > 0) { this.emit('shieldHit', strength); return; }
    const absorbed = 1 - this.h.knockResist;
    const f = strength * absorbed;
    if (f < 0.12) return;
    this.vel.x += dirX * f * 7;
    this.vel.z += dirZ * f * 7;
    // Heavy hits scrub speed and spin the kart out.
    const scrub = clamp01(f * 0.55);
    this.vel.x *= 1 - scrub * 0.45;
    this.vel.z *= 1 - scrub * 0.45;
    if (f > 0.55) {
      this.spinTimer = Math.max(this.spinTimer, 0.55 + f * 0.5);
      this.endDrift(false);
      this.boostTime = 0;
      this.emit('spin', f);
    }
    this.emit('hazardHit', f);
  }

  /** Ends the current drift. `payOut` decides whether the charge becomes a
   *  boost — a drift broken by a wall, a spin or contact pays nothing. */
  endDrift(payOut: boolean): void {
    if (!this.drifting) return;
    this.drifting = false;
    const tier = this.driftTier;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.driftAngle = 0;
    this.emit('driftEnd', tier);
    if (payOut && tier > 0) this.startBoost(tier, 'drift');
  }

  /** One fixed simulation step. */
  step(dt: number, inputRaw: KartInput, g: GroundInfo): void {
    this.events.length = 0;
    this.ground = g;
    this.sHint = g.s;

    const input: KartInput = { ...inputRaw };
    // Spend the meter on the boost key. A drift in progress keeps its own
    // release; this is for the charge you earned by racing.
    if (input.boost && !this.drifting && this.driftTier > 0 && this.mode === 'driving') {
      const tier = this.driftTier;
      this.driftCharge = 0;
      this.driftTier = 0;
      this.startBoost(tier, 'drift');
    }
    if (this.mode === 'frozen') {
      // Countdown: throttle held charges the launch window instead of moving.
      input.steer = 0;
      input.brake = 0;
      if (input.throttle > 0.5) this.launchCharge += dt;
      else this.launchCharge = Math.max(0, this.launchCharge - dt * 2.2);
      input.throttle = 0;
    }
    if (this.mode === 'respawning') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.mode = 'driving';
        this.emit('respawnEnd');
      }
      return;
    }
    if (this.mode === 'finished') {
      // Coast to a stop under AI control after the flag.
      input.throttle = this.speed > 6 ? 0 : 0.25;
      input.brake = 0;
      input.drift = false;
      input.steer = clamp(-g.lat * 0.08, -1, 1);
    }
    if (this.assists.autoAccel && this.mode === 'driving') input.throttle = Math.max(input.throttle, 1);

    if (this.slowTimer > 0) { this.slowTimer -= dt; if (this.slowTimer <= 0) this.slowFactor = 1; }
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.noBoostTimer > 0) this.noBoostTimer -= dt;
    const spun = this.spinTimer > 0;
    if (spun) {
      this.spinTimer -= dt;
      input.throttle = 0;
      input.drift = false;
      input.steer = 0;
      this.yaw += 9.5 * dt * (this.spinTimer > 0 ? 1 : 0);
    }

    const surf = SURFACE[g.surface];
    const traits = this.loadout.traits;
    let gripMul = surf.grip;
    let speedMul = surf.speed;
    let dragAdd = surf.drag;
    if ((g.surface === 'dirt' || g.surface === 'mud') && traits.has('dirt-grip')) {
      gripMul = Math.min(1, gripMul + 0.30);
      dragAdd *= 0.45;
    }
    if (g.surface === 'water' && traits.has('water-immune')) {
      gripMul = Math.min(1.0, gripMul + 0.24);
      speedMul = 1.0;
      dragAdd = 0;
    }

    // ---- steering input shaping -----------------------------------------
    let steerTarget = clamp(input.steer, -1, 1);
    if (this.assists.steerAssist && this.mode === 'driving' && Math.abs(steerTarget) < 0.35) {
      // Nudge toward the centre of the road. Disclosed, and off in ranked.
      // `lat` is world-right offset and steering is screen-relative, so the
      // correction is +lat: drifting toward +X needs a turn back toward -X,
      // which is a positive steer value.
      steerTarget = clamp(steerTarget + clamp(g.lat / Math.max(2, g.width) * 0.55, -0.4, 0.4), -1, 1);
    }
    // Faster to release than to apply: the kart snaps straight, which is what
    // makes quick direction changes feel crisp.
    const steerRate = Math.abs(steerTarget) > Math.abs(this.steerSmoothed) ? 9.5 : 14.0;
    this.steerSmoothed = damp(this.steerSmoothed, steerTarget, steerRate, dt);

    const speed = this.speed;
    this.topSpeedSeen = Math.max(this.topSpeedSeen, speed);

    // ---- air / ground resolution ----------------------------------------
    //
    //  A grounded kart does not have its vertical velocity zeroed: it is set to
    //  the vertical component of travelling along the road. That one line is
    //  what makes every jump on every track ballistic and real — at the lip of
    //  a ramp the kart is already climbing at speed * slope, so when the road
    //  falls away it launches instead of dropping into the hole.
    const groundY = g.height + this.rideHeight;
    const wasGrounded = this.grounded;
    const above = this.pos.y - groundY;
    if (g.gap) {
      this.grounded = false;
    } else if (wasGrounded) {
      //  A crest launches a kart when the road falls away faster than gravity
      //  can pull it down. Project the kart forward ballistically and compare
      //  where it would be with where the road will be: if it would be above
      //  the road, it is already flying.
      //
      //  Without this a kart is welded to the surface and simply drives down
      //  the far side of every jump in the game, however steep.
      const vf = Math.max(4, Math.abs(this.forwardSpeed));
      const t = g.aheadDistance / vf;
      const ballistic = this.pos.y + this.vel.y * t - 0.5 * GRAVITY * t * t;
      const roadAhead = g.heightAhead + this.rideHeight;
      this.grounded = above <= 0.22 && ballistic <= roadAhead + 0.12;
    } else {
      this.grounded = above <= 0.06 && this.vel.y <= 0.5;
    }

    if (this.grounded) {
      if (!wasGrounded) this.onLand(g);
      this.airTime = 0;
      this.pos.y = groundY;
      this.compression = damp(this.compression, 0, 9, dt);
    } else {
      this.airTime += dt;
      this.vel.y -= GRAVITY * dt;
      this.compression = damp(this.compression, 0, 5, dt);
    }

    // ---- boost timer -----------------------------------------------------
    if (this.boostTime > 0) {
      this.boostTime -= dt;
      if (this.boostTime <= 0) {
        this.boostTime = 0;
        this.boostTier = 0;
        this.emit('boostEnd');
      }
    }
    if (this.hopCooldown > 0) this.hopCooldown -= dt;

    // ---- boost pads -------------------------------------------------------
    if (this.grounded && g.surface === 'boost' && this.mode !== 'frozen') {
      if (this.boostSource !== 'pad' || this.boostTime < this.h.boostDuration * 0.9) {
        this.startBoost(traits.has('long-boost') ? 2 : 2, 'pad');
        this.emit('padHit');
      }
    }

    if (this.slowTimer > 0) speedMul *= this.slowFactor;   // somebody's special has hold of us
    if (this.grounded) this.stepGround(dt, input, g, gripMul, speedMul, dragAdd, spun);
    else this.stepAir(dt, input);

    // ---- integrate --------------------------------------------------------
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.distance += Math.hypot(this.vel.x, this.vel.z) * dt;

    // ---- boundaries -------------------------------------------------------
    this.stepBounds(dt, g);

    // ---- body attitude ----------------------------------------------------
    this.stepAttitude(dt, g);

    // ---- recovery watchdogs ----------------------------------------------
    if (this.mode === 'driving') {
      const fwdDot = (this.vel.x * g.fwd.x + this.vel.z * g.fwd.z);
      const goingBackwards = speed > 4 && fwdDot < -0.25 * speed;
      this.wrongWayTimer = goingBackwards ? this.wrongWayTimer + dt : Math.max(0, this.wrongWayTimer - dt * 2);
      const nowWrong = this.wrongWayTimer > 0.6;
      if (nowWrong && !this.wrongWay) this.emit('wrongWay');
      this.wrongWay = nowWrong;
      if (this.wrongWayTimer > 6.5) this.triggerRespawn();

      this.stuckTimer = speed < 1.3 ? this.stuckTimer + dt : 0;
      if (this.stuckTimer > 3.6) this.triggerRespawn();
      if (this.pos.y < -400) this.triggerRespawn();
    }
  }

  private onLand(g: GroundInfo): void {
    const impact = clamp01(-this.vel.y / 22);
    // Landing quality is the body's attitude relative to THE ROAD, not to
    // level. Judging against level marks every landing on a banked corner or a
    // downhill as a crash, which is both wrong and miserable to play.
    const roadRoll = Math.atan2(g.normal.x * -g.fwd.z + g.normal.z * g.fwd.x, g.normal.y);
    const roadPitch = -Math.asin(clamp(g.fwd.y, -1, 1));
    const misalign =
      Math.abs(wrapAngle(this.roll - roadRoll)) * 0.60 +
      Math.abs(wrapAngle(this.pitch - roadPitch)) * 0.45;
    const window = this.h.landingWindow;
    const clean = misalign <= window;
    this.compression = clamp01(impact * 1.4 + 0.2);

    if (this.trickActive) {
      const full = Math.abs(this.trickRotation) >= Math.PI * 1.85;
      if (full && clean) {
        this.trickCount++;
        this.startBoost(1, 'trick');
        this.emit('trickComplete', clamp01(Math.abs(this.trickRotation) / (Math.PI * 4)));
      } else {
        this.emit('trickFail');
        this.vel.x *= 0.72;
        this.vel.z *= 0.72;
        this.spinTimer = Math.max(this.spinTimer, 0.4);
      }
      this.trickActive = false;
      this.trickRotation = 0;
      this.trickKind = 'none';
    } else if (clean) {
      // A clean landing off a real jump is worth a small reward.
      if (this.airTime > 0.55) {
        this.emit('land', 1 - misalign / Math.max(window, 1e-3));
        this.startBoost(1, 'trick');
      } else if (impact > 0.15) {
        this.emit('land', 1 - misalign / Math.max(window, 1e-3));
      }
    } else {
      const severity = clamp01((misalign - window) / 0.9);
      this.vel.x *= 1 - severity * 0.45;
      this.vel.z *= 1 - severity * 0.45;
      if (severity > 0.55) this.spinTimer = Math.max(this.spinTimer, 0.35 + severity * 0.4);
      this.emit('hardLand', severity);
      this.endDrift(false);
    }
    // Landing flattens the body onto the road.
    this.pitch = lerp(this.pitch, roadPitch, 0.75);
    this.roll = lerp(this.roll, roadRoll, 0.75);
  }

  private stepGround(
    dt: number, input: KartInput, g: GroundInfo,
    gripMul: number, speedMul: number, dragAdd: number, spun: boolean,
  ): void {
    const h = this.h;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let vf = this.vel.x * sy + this.vel.z * cy;
    let vr = this.vel.x * cy - this.vel.z * sy;

    const driftMul = this.boosting ? h.boostPower : 1;
    const topEff = h.topSpeed * speedMul * driftMul * this.catchUp * (1 + this.draft * 0.13);

    // ---- longitudinal -----------------------------------------------------
    let a = 0;
    if (!spun && this.mode !== 'frozen') {
      if (input.throttle > 0) {
        const headroom = clamp(1 - vf / Math.max(topEff, 1), -0.2, 1);
        a += h.accel * input.throttle * Math.max(0, headroom) * this.catchUp;
        if (this.boosting) a += 10.5;
      }
      if (input.brake > 0) {
        if (vf > 0.4) a -= h.brake * input.brake;
        else if (input.throttle <= 0.01) a -= h.accel * 0.45 * input.brake;
      }
    }
    // Gravity along the road. Without this a thirty metre descent costs the
    // same as a flat straight, and the reactor spiral — the whole point of
    // which is that you arrive at the bottom carrying too much speed — is just
    // a corner that happens to be lower down.
    a -= GRAVITY * g.fwd.y;
    if (input.throttle <= 0.01 && input.brake <= 0.01) a -= 3.4 * Math.sign(vf);
    a -= dragAdd * Math.sign(vf);
    // Quadratic drag gives the top end a soft, natural ceiling.
    a -= 0.0075 * vf * Math.abs(vf);
    vf += a * dt;
    if (vf < -9) vf = -9;

    // ---- drift state ------------------------------------------------------
    const canDrift = !spun && this.mode === 'driving' && vf > 7.5;
    if (input.drift && !this.drifting && canDrift && this.hopCooldown <= 0 && Math.abs(this.steerSmoothed) > 0.20) {
      // Hop first. The drift begins on the way down, which is the beat that
      // makes the input feel deliberate instead of instant.
      this.vel.y = 3.9;
      this.grounded = false;
      this.hopping = true;
      this.hopCooldown = 0.28;
      this.emit('hop');
    }
    if (this.hopping && this.grounded) {
      this.hopping = false;
      if (input.drift && canDrift && Math.abs(this.steerSmoothed) > 0.12) {
        this.drifting = true;
        this.driftDir = this.steerSmoothed > 0 ? 1 : -1;
        this.driftCharge = 0;
        this.driftTier = 0;
        this.emit('driftStart');
      }
    }
    if (this.drifting && (!input.drift || vf < 5.5 || spun)) this.endDrift(true);

    // ---- yaw --------------------------------------------------------------
    const speedFactor = clamp01(Math.abs(vf) / 6.0) * (1 - 0.34 * clamp01((Math.abs(vf) - 18) / 26));
    let yawRate: number;
    let maxLat: number;
    if (this.drifting) {
      const inside = clamp(this.steerSmoothed * this.driftDir, -1, 1);
      const tightness = 0.62 + 0.42 * inside;
      yawRate = this.driftDir * (h.turnRate * tightness + h.driftTurnBonus * 0.55) * speedFactor;
      maxLat = h.driftGrip * gripMul;
      this.driftSeconds += dt;
    } else {
      yawRate = this.steerSmoothed * h.turnRate * speedFactor;
      maxLat = h.grip * gripMul;
      // Grip caps how fast the kart can rotate without the tyres giving up.
      const limit = Math.abs(vf) > 2 ? (maxLat * 1.45) / Math.abs(vf) : 6;
      yawRate = clamp(yawRate, -limit, limit);
    }
    if (vf < 0) yawRate = -yawRate; // reversing steers the other way
    this.yaw = wrapAngle(this.yaw + yawRate * dt);

    // Rotating the body does not rotate the velocity: that difference IS the
    // slide, and the grip budget is what eats it back.
    const rotated = -yawRate * dt * vf;
    vr += rotated;
    vr = approach(vr, 0, maxLat * dt);

    //  Bound the slide.
    //
    //  Yaw injects lateral velocity at |yawRate| * vf per second and friction
    //  removes maxLat per second. The yaw limiter allows 45% more than grip
    //  can cancel, so a corner held at full lock adds sideways speed forever:
    //  ten seconds of it reached 100 m/s sideways while forward speed sat at
    //  25. A cap is what actually makes grip mean something — past it the kart
    //  understeers, which is the honest outcome of asking for more grip than
    //  the tyres have.
    const maxSlip = this.drifting
      ? Math.max(4, Math.abs(vf) * 0.62)    // a committed slide, ~32 degrees
      : Math.max(2.0, maxLat * 0.16);       // a scrub, not a slide
    vr = clamp(vr, -maxSlip, maxSlip);

    // ---- boost charge -----------------------------------------------------
    // The meter fills as you race: distance driven on the road charges it,
    // a drift charges it faster. It is spent by the boost key, or paid out
    // at the end of a drift as before.
    if (this.drifting) {
      this.driftAngle = Math.atan2(Math.abs(vr), Math.max(1, Math.abs(vf)));
      const quality = 0.55 + 0.45 * clamp01(this.driftAngle / 0.42);
      this.driftCharge += h.driftCharge * quality * dt;
    } else if (this.mode === 'driving' && !g.outOfBounds) {
      this.driftCharge += Math.abs(vf) * dt / RACE_CHARGE_METRES * DRIFT_TIERS[2];
    }
    this.driftCharge = Math.min(this.driftCharge, DRIFT_TIERS[2]);
    const tier = this.driftCharge >= DRIFT_TIERS[2] ? 3
      : this.driftCharge >= DRIFT_TIERS[1] ? 2
      : this.driftCharge >= DRIFT_TIERS[0] ? 1 : 0;
    if (tier > this.driftTier) {
      this.driftTier = tier;
      this.emit('driftTier', tier);
    }

    // ---- recombine --------------------------------------------------------
    const nsy = Math.sin(this.yaw), ncy = Math.cos(this.yaw);
    this.vel.x = vf * nsy + vr * ncy;
    this.vel.z = vf * ncy - vr * nsy;

    // ---- follow the road vertically ---------------------------------------
    // The road's forward vector already carries its slope, so the vertical
    // speed of a kart driving along it is simply forward speed times slope.
    this.vel.y = vf * g.fwd.y;
    void gripMul;
  }

  private stepAir(dt: number, input: KartInput): void {
    const h = this.h;
    const auth = h.airControl;
    // Steering yaws and rolls; throttle/brake pitch. Same stick, readable.
    this.yaw = wrapAngle(this.yaw + this.steerSmoothed * auth * 0.42 * dt);
    // Steering banks the kart in the air, but once it is falling the body
    // settles back toward level. Arcade convention, and it is what stops every
    // long jump from ending in a botched landing.
    const settling = this.vel.y < 0 ? clamp01(this.airTime * 1.2) : 0;
    const rollTarget = this.steerSmoothed * lerp(0.55, 0.22, settling);
    this.roll = damp(this.roll, rollTarget, lerp(4.0, 7.0, settling), dt);
    const pitchInput = (input.throttle - input.brake);
    this.pitch = clamp(this.pitch + pitchInput * auth * 0.55 * dt, -1.25, 1.25);

    // Trick: tap drift in the air to rotate. Completing the rotation and
    // landing clean pays a boost; bailing costs speed.
    if (input.drift && !this.trickActive && this.airTime > 0.22) {
      this.trickActive = true;
      this.trickRotation = 0;
      this.trickKind = Math.abs(this.steerSmoothed) > 0.4 ? 'spin' : 'flip';
      this.emit('trickStart');
    }
    if (this.trickActive) {
      const rate = (this.trickKind === 'spin' ? 8.2 : 6.6) * (0.75 + 0.25 * clamp01(auth / 3));
      this.trickRotation += rate * dt;
      if (this.trickKind === 'spin') this.yaw = wrapAngle(this.yaw + rate * dt * Math.sign(this.steerSmoothed || 1));
      else this.pitch = wrapAngle(this.pitch - rate * dt);
    }
    // Drift is not held through the air.
    if (this.drifting) this.endDrift(false);
  }

  private stepBounds(dt: number, g: GroundInfo): void {
    if (this.mode === 'respawning') return;

    if (g.gap && this.pos.y < g.height + 1.5) {
      this.triggerRespawn();
      return;
    }
    if (this.pos.y < this.groundKillY) {
      this.triggerRespawn();
      return;
    }

    if (g.outside > 0) {
      if (this.offRoadTimer === 0) this.emit('offroad');
      this.offRoadTimer += dt;
    } else if (this.offRoadTimer > 0) {
      this.offRoadTimer = 0;
      this.emit('onroad');
    }

    if (g.wall && g.outside > 0) {
      // The wall normal points back toward the road, along the road's right
      // vector. right = (fwd.z, -fwd.x) in the horizontal plane, so crossing
      // the right edge (lat > 0) pushes back along -right.
      const nx = g.lat > 0 ? -g.fwd.z : g.fwd.z;
      const nz = g.lat > 0 ? g.fwd.x : -g.fwd.x;
      //  Clamp the correction. A barrier nudges a kart back onto the road; it
      //  does not catapult one that is seventy metres into the scenery back
      //  across the track in a single step. An unbounded push moves the kart
      //  far enough that its lap progress jumps, and the race core correctly
      //  reads that as a teleport and flags an honest racer.
      const push = Math.min(g.outside, 0.6);
      this.pos.x += nx * push;
      this.pos.z += nz * push;
      const into = this.vel.x * -nx + this.vel.z * -nz;
      if (into > 0) {
        const grazing = clamp01(into / Math.max(this.speed, 1));
        this.vel.x += nx * into * 1.35;
        this.vel.z += nz * into * 1.35;
        const scrub = 1 - clamp01(grazing * 0.55) * (1 - this.h.knockResist * 0.5);
        this.vel.x *= scrub;
        this.vel.z *= scrub;
        if (grazing > 0.32) {
          this.endDrift(false);
          this.emit('wallHit', grazing);
          if (grazing > 0.72) this.spinTimer = Math.max(this.spinTimer, 0.3);
        } else if (grazing > 0.05) {
          this.emit('wallHit', grazing * 0.4);
        }
      }
      this.offRoadTimer = 0;
    } else if (g.outOfBounds) {
      // No barrier: the scenery is drivable but slow, and a countdown returns
      // the kart to the road so nobody can hide out there.
      if (this.offRoadTimer > 2.4) this.triggerRespawn();
    }
  }

  private groundKillY = -60;
  setKillY(y: number): void {
    this.groundKillY = y;
  }

  triggerRespawn(): void {
    if (this.mode === 'respawning' || this.mode === 'finished') return;
    this.mode = 'respawning';
    this.respawnTimer = this.h.respawnTime;
    this.vel = v3();
    this.drifting = false;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.boostTime = 0;
    this.spinTimer = 0;
    this.offRoadTimer = 0;
    this.stuckTimer = 0;
    this.wrongWayTimer = 0;
    this.trickActive = false;
    this.emit('respawnStart');
  }

  /** Place the kart after a respawn. Called by the race core, which owns the
   *  checkpoint the kart is entitled to. */
  placeAt(pos: V3, yaw: number, speed = 5): void {
    //  Drop the projection hint. It still points at wherever this kart was
    //  when it went off, and the next projection would search a window around
    //  THAT, land on a point seventy metres from where the kart now is, and
    //  hand the race core a lap-progress jump it correctly reads as a teleport.
    this.sHint = undefined;
    this.pos = { ...pos };
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.vel = v3(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.grounded = true;
    this.airTime = 0;
  }

  private stepAttitude(dt: number, g: GroundInfo): void {
    if (this.grounded) {
      // Lean into the corner and squat under acceleration.
      const lat = this.drifting ? this.driftDir * 0.34 : this.steerSmoothed * 0.16;
      const bankTarget = -lat * clamp01(this.speed / 16) - Math.asin(clamp(g.normal.x * g.fwd.z - g.normal.z * g.fwd.x, -1, 1)) * 0;
      const roadRoll = Math.atan2(g.normal.x * -g.fwd.z + g.normal.z * g.fwd.x, g.normal.y);
      this.roll = damp(this.roll, bankTarget + roadRoll, 9, dt);
      const slope = Math.asin(clamp(g.fwd.y, -1, 1));
      this.pitch = damp(this.pitch, -slope + this.compression * 0.08, 8, dt);
    } else if (!this.trickActive) {
      // In the air, the nose follows the arc unless the player fights it.
      const arc = Math.atan2(this.vel.y, Math.max(2, this.speed));
      this.pitch = damp(this.pitch, clamp(this.pitch * 0.55 + arc * 0.45, -1.2, 1.2), 2.2, dt);
    }
  }

  /** Snapshot for ghosts, replays and network transmission. */
  snapshot(): number[] {
    return [
      this.pos.x, this.pos.y, this.pos.z,
      this.vel.x, this.vel.y, this.vel.z,
      this.yaw, this.pitch, this.roll,
      this.boostTime, this.driftTier, this.drifting ? 1 : 0,
    ];
  }
  applySnapshot(a: number[]): void {
    this.pos.x = a[0]; this.pos.y = a[1]; this.pos.z = a[2];
    this.vel.x = a[3]; this.vel.y = a[4]; this.vel.z = a[5];
    this.yaw = a[6]; this.pitch = a[7]; this.roll = a[8];
    this.boostTime = a[9]; this.driftTier = a[10]; this.drifting = a[11] > 0.5;
  }
}

/** Resolve contact between two karts. Heavier wins, and the exchange is
 *  symmetric so neither client can gain from disagreeing about it. */
export function resolveKartContact(a: KartRuntime, b: KartRuntime): boolean {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const dy = b.pos.y - a.pos.y;
  if (Math.abs(dy) > 1.6) return false;
  const d2 = dx * dx + dz * dz;
  const r = a.h.radius + b.h.radius;
  if (d2 > r * r || d2 < 1e-6) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d, nz = dz / d;
  const overlap = r - d;

  const ma = a.h.mass, mb = b.h.mass;
  const total = ma + mb;
  // Separate proportionally to the other kart's mass.
  a.pos.x -= nx * overlap * (mb / total);
  a.pos.z -= nz * overlap * (mb / total);
  b.pos.x += nx * overlap * (ma / total);
  b.pos.z += nz * overlap * (ma / total);

  const rvx = b.vel.x - a.vel.x;
  const rvz = b.vel.z - a.vel.z;
  const along = rvx * nx + rvz * nz;
  if (along > 0) return true; // already separating

  // Damped, mass-weighted impulse. The 0.55 restitution keeps contact punchy
  // without the pinball spin that ruins remote collisions.
  const j = (-(1 + 0.55) * along) / (1 / ma + 1 / mb);
  const ja = (j / ma) * (1 - a.h.knockResist * 0.6);
  const jb = (j / mb) * (1 - b.h.knockResist * 0.6);
  a.vel.x -= nx * ja; a.vel.z -= nz * ja;
  b.vel.x += nx * jb; b.vel.z += nz * jb;

  const force = clamp01(Math.abs(along) / 18);
  if (force > 0.1) {
    a.events.push({ kind: 'hazardHit', value: force * 0.6, pos: { ...a.pos } });
    b.events.push({ kind: 'hazardHit', value: force * 0.6, pos: { ...b.pos } });
  }
  // Anti-spin: contact never rotates a kart directly. Losing a drift is the
  // only rotational consequence, which keeps remote contact predictable.
  if (force > 0.45) {
    if (a.h.mass < b.h.mass * 0.82) a.endDrift(false);
    if (b.h.mass < a.h.mass * 0.82) b.endDrift(false);
  }
  return true;
}

export { lerp, v3len };
