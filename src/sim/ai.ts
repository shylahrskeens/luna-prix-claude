/** Bot drivers.
 *
 *  Bots use the same KartRuntime and the same inputs a human sends. There is no
 *  hidden speed, no scripted line and no dynamic difficulty: a bot is a skill
 *  number plus a personality, and in ranked the mode rules set catch-up to zero
 *  so what you beat is what it actually drove.
 */
import { clamp, clamp01, damp, loopDelta, Rng, v3, wrapAngle, type V3 } from '../core/math';
import type { KartInput } from './kart';
import type { Racer, RaceCore } from './race';
import type { TrackRuntime } from './track';

export interface BotPersonality {
  name: string;
  /** 0..1. Scales cornering confidence, lookahead quality and reaction time. */
  skill: number;
  /** 0..1. How willing they are to lean on a rival for a line. */
  aggression: number;
  /** 0..1. How much they commit to drifting rather than gripping. */
  driftLove: number;
  /** Steering noise, in radians. Low skill wanders. */
  jitter: number;
  /** Preferred lateral offset from the ideal line — gives each bot a signature. */
  lineBias: number;
  /** 0..1. Chance of taking the risky alternate route. */
  riskAppetite: number;
}

/** The seven rivals. Each is a recognisable driver rather than a difficulty
 *  slider: Vessel never drifts, Kestrel always does, Bramble will not move. */
export const RIVALS: BotPersonality[] = [
  { name: 'Kestrel',  skill: 0.94, aggression: 0.62, driftLove: 0.95, jitter: 0.006, lineBias: -0.10, riskAppetite: 0.85 },
  { name: 'Bramble',  skill: 0.88, aggression: 0.90, driftLove: 0.35, jitter: 0.010, lineBias: 0.14, riskAppetite: 0.30 },
  { name: 'Vessel',   skill: 0.90, aggression: 0.28, driftLove: 0.10, jitter: 0.005, lineBias: 0.00, riskAppetite: 0.45 },
  { name: 'Cinder',   skill: 0.83, aggression: 0.74, driftLove: 0.80, jitter: 0.016, lineBias: -0.18, riskAppetite: 0.92 },
  { name: 'Marrow',   skill: 0.79, aggression: 0.52, driftLove: 0.55, jitter: 0.020, lineBias: 0.08, riskAppetite: 0.40 },
  { name: 'Quill',    skill: 0.75, aggression: 0.40, driftLove: 0.70, jitter: 0.026, lineBias: -0.06, riskAppetite: 0.60 },
  { name: 'Tumble',   skill: 0.68, aggression: 0.66, driftLove: 0.45, jitter: 0.034, lineBias: 0.20, riskAppetite: 0.25 },
];

interface BotState {
  steer: number;
  driftHold: number;
  /** Cooldown before the bot is allowed to start another drift. */
  driftCooldown: number;
  /** Lateral offset the bot is currently aiming for. */
  lateral: number;
  rng: Rng;
  /** Reaction delay buffer — low-skill bots see the corner late. */
  delay: number;
  /** Branch the bot committed to this lap, if any. */
  branch: string | null;
  branchUntil: number;
  target: V3;
}

export class BotDriver {
  readonly racer: Racer;
  readonly p: BotPersonality;
  private st: BotState;
  private track: TrackRuntime;

  constructor(racer: Racer, personality: BotPersonality, track: TrackRuntime, seed: number) {
    this.racer = racer;
    this.p = personality;
    this.track = track;
    this.st = {
      steer: 0,
      driftHold: 0,
      driftCooldown: 0,
      lateral: personality.lineBias,
      rng: new Rng(seed),
      delay: (1 - personality.skill) * 0.22,
      branch: null,
      branchUntil: 0,
      target: v3(),
    };
  }

  /** Difficulty scaling applied on top of the personality, 0.6..1.15. */
  difficulty = 1;

  /** Last-frame debug view, for the authoring tools. Not read by the game. */
  debug = { aimX: 0, aimZ: 0, err: 0, look: 0, lat: 0, onBranch: false, jumping: false, target: 0 };

  think(dt: number, core: RaceCore): KartInput {
    const k = this.racer.kart;
    const g = this.racer.ground;
    const st = this.st;
    const p = this.p;
    const skill = clamp01(p.skill * this.difficulty);

    st.driftCooldown = Math.max(0, st.driftCooldown - dt);

    if (k.mode === 'frozen') {
      // Hold the launch. Better drivers time it tighter.
      const hold = -core.time < (0.30 + (1 - skill) * 0.55);
      return { throttle: hold ? 1 : 0, brake: 0, steer: 0, drift: false, lookBack: false };
    }
    if (k.mode === 'finished' || k.mode === 'respawning') {
      return { throttle: 1, brake: 0, steer: 0, drift: false, lookBack: false };
    }

    const speed = k.speed;
    // Lookahead scales with speed: you steer at where you will be, not where
    // you are. Weak bots look less far ahead, which is exactly how they lose.
    const sNow = g.s;
    // Lookahead scales with speed, but a tight corner has to cap it: aiming
    // twenty metres into a radius-26 hairpin points the kart at the inside
    // wall, which is exactly what a bot that cannot drive looks like.
    const kHere = Math.max(Math.abs(this.track.main.curvatureAt(sNow + 8)), 1e-4);
    const radius = 1 / kHere;
    const look = clamp(
      Math.min(6 + speed * (0.42 + skill * 0.34), radius * 0.62),
      7, 34,
    );

    // ---- pick a line ------------------------------------------------------
    this.chooseBranch(core, g.u);

    // A bot committed to an alternate line has to actually drive it. Aiming at
    // the main racing line while physically on a narrow vine bridge walks the
    // kart straight off the side — which is exactly what the risk-taking bots
    // were doing, every lap, until this existed.
    let aim = st.target;
    let onBranchLine = false;
    if (st.branch) {
      const bp = this.track.branchPointAhead(st.branch, k.pos, look * 0.72, st.target);
      if (bp) { aim = bp; onBranchLine = true; }
      else st.branch = null;
    }

    if (!onBranchLine) {
      aim = this.track.racingLine(sNow + look, st.target);
      const sm = this.track.main.sample(sNow + look);
      // Personality offset plus avoidance.
      let lateralTarget = p.lineBias * sm.w;
      lateralTarget += this.avoid(core, look);
      st.lateral = damp(st.lateral, lateralTarget, 3.0, dt);
      aim.x += sm.right.x * st.lateral;
      aim.y += sm.right.y * st.lateral;
      aim.z += sm.right.z * st.lateral;

      // Off the road: forget the racing line, get back on it.
      if (g.outside > 1.5) {
        const home = this.track.main.pointAt(sNow + 12, 0);
        aim.x = home.x; aim.y = home.y; aim.z = home.z;
      }
    }

    // ---- steering ---------------------------------------------------------
    const toX = aim.x - k.pos.x;
    const toZ = aim.z - k.pos.z;
    const want = Math.atan2(toX, toZ);
    let err = wrapAngle(want - k.yaw);
    this.debug.aimX = aim.x; this.debug.aimZ = aim.z; this.debug.err = err;
    this.debug.look = look; this.debug.lat = st.lateral; this.debug.onBranch = onBranchLine;
    err += st.rng.signed() * p.jitter * (1.4 - skill);
    let steer = clamp(err * (2.0 + skill * 0.9), -1, 1);
    // Reaction smoothing: the delay is what makes a weak bot untidy rather
    // than simply slow.
    const react = 1 / Math.max(0.03, st.delay + 0.045);
    st.steer = damp(st.steer, steer, react, dt);
    steer = st.steer;

    // ---- throttle and braking --------------------------------------------
    const maxLat = k.h.grip * (0.72 + skill * 0.34);
    const corner = this.track.cornerSpeed(sNow, maxLat, k.h.brake * (0.75 + skill * 0.3));
    const targetSpeed = Math.min(corner, k.h.topSpeed * (0.82 + skill * 0.22));
    let throttle = 1;
    let brake = 0;
    if (speed > targetSpeed * 1.06) {
      brake = clamp01((speed - targetSpeed) / 9);
      throttle = brake > 0.5 ? 0 : 0.35;
    } else if (speed > targetSpeed * 0.96) {
      throttle = 0.72;
    }
    // Do not brake on a hairpin exit just because the entry was slow.
    if (Math.abs(err) < 0.12 && speed < targetSpeed) { throttle = 1; brake = 0; }

    // ---- jumps ------------------------------------------------------------
    // A gap is not a corner. Braking for the turn on the far side of the gator
    // pit is how a bot ends up in the water, so within range of a jump the
    // approach is simple: straight, flat and fast.
    const gapDist = this.track.gapAhead(sNow);
    const jumping = gapDist < 62 || (!k.grounded && k.airTime > 0.12);
    if (gapDist < 62) {
      throttle = 1;
      brake = 0;
      // Aim down the centre of the runway rather than at the racing line.
      const centre = this.track.main.pointAt(sNow + Math.max(10, gapDist * 0.6), 0);
      const cErr = wrapAngle(Math.atan2(centre.x - k.pos.x, centre.z - k.pos.z) - k.yaw);
      steer = clamp(cErr * 2.4, -1, 1);
      st.steer = steer;
    }

    this.debug.jumping = jumping;
    this.debug.target = targetSpeed;

    // ---- drifting ---------------------------------------------------------
    // Drift when the corner is long enough to charge a tier. Below-average
    // drivers misjudge this, which is where they lose the boost.
    const curveAhead = Math.abs(this.track.main.curvatureAt(sNow + 18));
    const curveFar = Math.abs(this.track.main.curvatureAt(sNow + 44));
    const sustained = curveAhead > 0.012 && curveFar > 0.007;
    let drift = false;
    if (k.drifting) {
      st.driftHold += dt;
      // Release on the tier the bot is patient enough to wait for.
      const wantTier = p.driftLove > 0.8 ? 2 : p.driftLove > 0.45 ? 1 : 1;
      const done = k.driftTier >= wantTier && (curveAhead < 0.010 || st.driftHold > 3.4);
      drift = !done;
      if (done) { st.driftHold = 0; st.driftCooldown = 0.5; }
    } else if (
      sustained && speed > 13 && Math.abs(steer) > 0.32 && !jumping &&
      // Only drift where a drift is actually quicker. A drift trades lateral
      // grip for rotation and boost; if the corner needs more grip than the
      // drifting kart has, the slide runs wide and the boost never pays for
      // the time it cost. This one check is the difference between a bot that
      // looks stylish and a bot that is stylish and fast.
      speed * speed * curveAhead < k.h.driftGrip * 1.35 &&
      st.driftCooldown <= 0 && st.rng.next() < p.driftLove * 0.9 + 0.08 &&
      g.outside <= 0.5
    ) {
      drift = true;
      st.driftHold = 0;
    }

    // ---- air --------------------------------------------------------------
    if (!k.grounded && k.airTime > 0.2) {
      // Level the kart for the landing: steer out of the roll, pitch to flat.
      // Good drivers also throw a trick on the way down.
      brake = k.pitch > 0.05 ? 0.6 : 0;
      throttle = k.pitch < -0.05 ? 1 : 0.2;
      drift = skill > 0.86 && k.airTime > 0.5 && k.vel.y > 0 && !k.trickActive && st.rng.next() < 0.25;
      steer = clamp(-k.roll * 2.2, -1, 1) * (0.4 + skill * 0.6);
      st.steer = steer;
    }

    // ---- rotating gates ---------------------------------------------------
    // Steer for the opening rather than the racing line when one is close.
    const gateShift = this.gateAim(core, sNow);
    if (gateShift !== null) {
      steer = clamp(steer + gateShift, -1, 1);
      st.steer = steer;
      if (Math.abs(gateShift) > 0.45) { throttle = Math.min(throttle, 0.7); brake = 0; }
    }

    return { throttle, brake, steer, drift, lookBack: false };
  }

  /** Steering correction toward the opening of a rotating gate just ahead.
   *
   *  Distance to the gate is measured ALONG THE TRACK, not through the air. A
   *  circuit folds back on itself constantly: the temple gate sits 260 metres
   *  down the road from the start straight but only 90 metres away in a
   *  straight line, and matching on straight-line distance had bots steering
   *  for a gate opening while they were still on the pit straight.
   */
  private gateAim(core: RaceCore, sNow: number): number | null {
    const k = this.racer.kart;
    const L = this.track.lapLength;
    for (const h of core.hazards) {
      if (h.def.kind !== 'gate') continue;
      const def = h.def as Extract<typeof h.def, { kind: 'gate' }>;
      const ahead = loopDelta(sNow / L, def.s, 1) * L;
      if (ahead < 2 || ahead > 46) continue;
      const dx = h.anchor.x - k.pos.x;
      const dz = h.anchor.z - k.pos.z;
      const lat = -(dx * h.right.x + dz * h.right.z);
      const openCentre = Math.sin(h.phase * Math.PI * 2) * def.span * 0.62;
      // Aim where the opening will be when we arrive, not where it is now.
      const eta = ahead / Math.max(6, k.speed);
      const futurePhase = h.phase + eta / def.period;
      const futureCentre = Math.sin(futurePhase * Math.PI * 2) * def.span * 0.62;
      const target = futureCentre * 0.7 + openCentre * 0.3;
      const err = target - lat;
      const urgency = 1 - (ahead - 2) / 44;
      return clamp(err * 0.16 * urgency, -0.8, 0.8);
    }
    return null;
  }

  /** Lateral nudge to avoid the kart in front, weighted by aggression.
   *  An aggressive bot leaves less room and will trade paint for the line. */
  private avoid(core: RaceCore, look: number): number {
    const k = this.racer.kart;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let shift = 0;
    for (const o of core.racers) {
      if (o === this.racer) continue;
      const dx = o.kart.pos.x - k.pos.x;
      const dz = o.kart.pos.z - k.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > look || dist < 0.3) continue;
      const along = dx * fx + dz * fz;
      if (along < 0.5) continue; // behind us
      const side = dx * fz - dz * fx;
      const urgency = (1 - dist / look) * (1 - this.p.aggression * 0.55);
      shift += (side > 0 ? -1 : 1) * urgency * 3.4;
    }
    return clamp(shift, -4.5, 4.5);
  }

  /** Commit to the alternate line or the main line for this section.
   *  Deciding once and sticking to it is what stops bots from weaving at a
   *  split, which reads as indecision rather than skill. */
  private chooseBranch(core: RaceCore, u: number): void {
    const st = this.st;
    // Already committed: hold the line until the branch has actually rejoined.
    if (st.branch) {
      const b = this.track.branches.get(st.branch);
      const past = b ? (b.def.inS <= b.def.outS
        ? u > b.def.outS + 0.01 || u < b.def.inS - 0.03
        : u > b.def.outS + 0.01 && u < b.def.inS - 0.03) : true;
      if (past) { st.branch = null; st.branchUntil = core.time + 1; }
      return;
    }
    if (core.time < st.branchUntil) return;
    for (const [id, b] of this.track.branches) {
      const dist = b.def.inS - u;
      if (dist > 0 && dist < 0.025) {
        const risky = b.def.flavor !== 'safer-slower';
        // Skill gates the gamble as well as the appetite for it, so weak
        // drivers stay on the wide road where they belong.
        const take = risky
          ? st.rng.next() < this.p.riskAppetite * this.p.skill * this.p.skill
          : st.rng.next() < 1 - this.p.riskAppetite * 0.6;
        st.branch = take ? id : null;
        st.branchUntil = core.time + 2;
        return;
      }
    }
  }

  get committedBranch(): string | null {
    return this.st.branch;
  }
}
