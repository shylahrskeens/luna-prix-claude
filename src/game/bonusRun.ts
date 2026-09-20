/** Bonus-event controller.
 *
 *  Wraps a solo RaceView and layers the event's scoring on top. The kart, the
 *  track system, the hazards and the camera are all the ones from the main
 *  game — a bonus event changes what is being measured, not how the game
 *  works, which is why both events took data and a scoring function rather
 *  than a second engine.
 */
import type { RaceView } from './raceView';
import type { BonusEventDefinition } from '../data/bonus';
import { medalFor } from '../data/bonus';
import type { KartEvent } from '../sim/kart';
import type { Racer } from '../sim/race';
import { clamp01 } from '../core/math';

/** What one threaded hoop is worth on the Mega Ramp, in metres. */
const RING_METRES = 12;

export type BonusPhase = 'countdown' | 'run' | 'flight' | 'scored' | 'failed';

export interface BonusScore {
  /** The headline number in the event's unit. */
  score: number;
  /** Was the attempt valid at all? */
  valid: boolean;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  /** Human-readable breakdown, in display order. */
  lines: { label: string; value: string; good?: boolean }[];
  reason?: string;
}

export class BonusRun {
  readonly def: BonusEventDefinition;
  private view: RaceView;
  phase: BonusPhase = 'countdown';
  result: BonusScore | null = null;

  // --- mega ramp state ---
  private launchS = 0;
  private launched = false;
  private peakHeight = 0;
  private landingQuality = 1;
  private tricks = 0;
  private outsideCorridor = false;

  // --- luna launch state ---
  private ringsHit = new Set<number>();
  /** Signed distance along the road from each ring's plane, last frame. */
  private ringSide = new Map<number, number>();
  /** Rings threaded back-to-back without missing one. */
  private ringChain = 0;
  private bestChain = 0;
  private ringPoints = 0;
  private clearedStacks = new Set<number>();
  private stackPoints = 0;
  private hitStack = false;
  private touchdownS = -1;
  private targetPoints = 0;
  private targetRingName = 'missed';

  // --- gauntlet state ---
  private resets = 0;
  private nearMiss = 0;
  private nearMissActive = new Set<number>();
  private gapsCleared = 0;
  /** Index of the gap span the kart is currently over, or -1. */
  private pendingGap = -1;
  /** Which spans have already been credited — a leap counts once, however
   *  many times a respawn walks the kart back over its edge. */
  private clearedGaps = new Set<number>();

  /** Live readout for the HUD while the attempt is running. */
  live = { primary: '0', secondary: '', hint: '' };

  constructor(def: BonusEventDefinition, view: RaceView) {
    this.def = def;
    this.view = view;
  }

  onKartEvent(racer: Racer, e: KartEvent): void {
    if (!racer.isPlayer) return;
    // Mega Ramp and Luna Launch are both single flights judged on how they
    // land, so they read the same events.
    if (this.def.kind === 'megaRamp' || this.def.kind === 'launch') {
      if (e.kind === 'trickComplete') this.tricks++;
      if (e.kind === 'land') this.landingQuality = Math.max(this.landingQuality, 1);
      if (e.kind === 'hardLand') this.landingQuality = Math.min(this.landingQuality, 1 - 0.34 * clamp01(e.value));
      if (e.kind === 'hazardHit' && e.value >= 1) this.hitStack = true;
      if (e.kind === 'respawnStart' && this.launched) this.outsideCorridor = true;
    } else {
      if (e.kind === 'respawnStart') this.resets++;
    }
  }

  update(dt: number): void {
    const core = this.view.core;
    const player = core.player!;
    const k = player.kart;
    const track = this.view.track;

    if (core.phase === 'countdown') { this.phase = 'countdown'; return; }
    if (this.phase === 'scored' || this.phase === 'failed') return;

    if (this.def.kind === 'launch') {
      this.updateLaunch(dt);
      return;
    }

    if (this.def.kind === 'megaRamp') {
      const rampEnd = this.rampLipS(track.def);
      if (!this.launched) {
        this.phase = 'run';
        this.live.primary = `${Math.round(k.speed * 3.6)} km/h`;
        this.live.secondary = 'Speed at the lip is the whole score';
        this.live.hint = k.boosting ? 'BOOSTING' : 'Take all five pads';
        if (!k.grounded && player.ground.s > rampEnd - 6) {
          this.launched = true;
          this.launchS = player.ground.s;
          this.peakHeight = k.pos.y;
        }
      } else if (!k.grounded) {
        this.phase = 'flight';
        this.peakHeight = Math.max(this.peakHeight, k.pos.y);
        this.scoreRings(core.hazards, k);
        const dist = Math.max(0, player.ground.s - this.launchS) + this.ringsHit.size * RING_METRES;
        const medals = this.def.medals;
        const next = dist < medals.bronze ? ['BRONZE', medals.bronze] as const
          : dist < medals.silver ? ['SILVER', medals.silver] as const
          : dist < medals.gold ? ['GOLD', medals.gold] as const
          : null;
        this.live.primary = `${dist.toFixed(1)} m`;
        this.live.secondary = this.ringsHit.size
          ? `${this.ringsHit.size}/4 hoops · +${this.ringsHit.size * RING_METRES} m · air ${k.airTime.toFixed(1)}s`
          : `air ${k.airTime.toFixed(1)}s · hoops are worth ${RING_METRES} m each`;
        this.live.hint = k.trickActive ? 'TRICK — LAND IT FLAT'
          : next ? `${(next[1] - dist).toFixed(0)} m to ${next[0]}`
          : 'PAST GOLD — LAND IT';
        if (Math.abs(player.ground.lat) > player.ground.width + 6) this.outsideCorridor = true;
      } else if (this.phase === 'flight') {
        this.finishRamp(player.ground.s - this.launchS);
      }
      if (core.time > this.def.timeLimit && !this.launched) {
        this.fail('Ran out of time on the runway.');
      }
    } else {
      this.phase = 'run';
      const t = Math.max(0, core.time);
      this.live.primary = `${t.toFixed(2)} s`;
      this.live.secondary = `${this.gapsCleared}/${track.gaps.length} leaps · ${this.resets} resets`;
      this.live.hint = this.nearMiss > 0 ? `-${this.nearMiss.toFixed(1)}s near miss` : 'Learn the bite cycles';

      // Near misses: close to an open set of jaws without being bitten.
      const kx = k.pos.x, kz = k.pos.z;
      for (let i = 0; i < core.hazards.length; i++) {
        const h = core.hazards[i];
        if (h.def.kind !== 'gator') continue;
        const d = Math.hypot(kx - h.pos.x, kz - h.pos.z);
        const close = d < h.radius + k.h.radius + 3.0;
        if (h.active && close && !this.nearMissActive.has(i)) {
          this.nearMissActive.add(i);
          this.nearMiss += 0.6;
        } else if (!close) {
          this.nearMissActive.delete(i);
        }
      }

      // Count the leaps, by span rather than by position: a respawn can walk
      // the kart back and forth across a gap edge several times, and none of
      // those is a second leap.
      const gap = track.gapAt(player.ground.u);
      if (gap) {
        this.pendingGap = track.gaps.indexOf(gap);
      } else if (this.pendingGap >= 0 && k.grounded) {
        if (!this.clearedGaps.has(this.pendingGap)) {
          this.clearedGaps.add(this.pendingGap);
          this.gapsCleared = this.clearedGaps.size;
        }
        this.pendingGap = -1;
      }

      if (player.progress.finished || player.progress.raw >= 0.995) this.finishGauntlet(t);
      else if (core.time > this.def.timeLimit) this.fail('Time limit reached.');
    }
    void dt;
  }

  /** Luna Launch: one flight, scored on three independent channels. */
  private updateLaunch(dt: number): void {
    const core = this.view.core;
    const player = core.player!;
    const k = player.kart;
    const track = this.view.track;
    const L = track.lapLength;
    const hazards = core.hazards;
    void dt;

    const kickerEnd = this.zoneEndS('Kicker');

    if (!this.launched) {
      this.phase = 'run';
      this.live.primary = `${Math.round(k.speed * 3.6)} km/h`;
      this.live.secondary = 'Speed down the drop is your distance';
      this.live.hint = k.boosting ? 'BOOSTING' : 'Three pads on the way down';
      if (!k.grounded && player.ground.s > kickerEnd - 8) {
        this.launched = true;
        this.launchS = player.ground.s;
        this.peakHeight = k.pos.y;
      }
      if (core.time > this.def.timeLimit) this.fail('Ran out of time on the ramp.');
      return;
    }

    // ---- in the air -------------------------------------------------------
    if (!k.grounded && this.touchdownS < 0) {
      this.phase = 'flight';
      this.peakHeight = Math.max(this.peakHeight, k.pos.y);
      this.scoreRings(hazards, k);
      this.scoreStacks(hazards, k, player.ground.s);
      const dist = Math.max(0, player.ground.s - this.launchS);
      const target = hazards.find((h) => h.def.kind === 'target');
      const toTarget = target
        ? (target.def as Extract<typeof target.def, { kind: 'target' }>).s * L - player.ground.s
        : 0;
      this.live.primary = `${this.runningTotal()} pts`;
      this.live.secondary = `${dist.toFixed(0)} m · ${this.ringsHit.size}/3 rings · ${this.clearedStacks.size}/4 cleared`;
      this.live.hint = this.hitStack
        ? 'CLIPPED IT'
        : toTarget > 6 ? `${toTarget.toFixed(0)} m to the target`
        : toTarget < -6 ? 'PAST THE TARGET' : 'TARGET — LAND FLAT';
      return;
    }

    // ---- touchdown --------------------------------------------------------
    if (this.touchdownS < 0 && k.grounded) {
      this.touchdownS = player.ground.s;
      this.scoreTarget(hazards, k, player.ground.lat);
      this.finishLaunch();
    }
  }

  /** Arc length where a named zone ends. */
  private zoneEndS(label: string): number {
    const z = this.view.track.def.zones.find((q) => q.label === label);
    return (z ? z.to : 0.5) * this.view.track.lapLength;
  }

  /** A ring counts when the kart crosses its plane inside the hoop. */
  private scoreRings(hazards: typeof this.view.core.hazards, k: { pos: { x: number; y: number; z: number } }): void {
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.def.kind !== 'ring' || this.ringsHit.has(i)) continue;
      const dx = k.pos.x - h.pos.x;
      const dy = k.pos.y - h.pos.y;
      const dz = k.pos.z - h.pos.z;
      const along = dx * h.fwd.x + dz * h.fwd.z;
      const prev = this.ringSide.get(i);
      this.ringSide.set(i, along);
      if (prev === undefined || prev > 0 || along <= 0) continue;
      // Crossed the plane this frame. Inside the hoop?
      const lat = dx * h.right.x + dz * h.right.z;
      const radial = Math.hypot(lat, dy);
      if (radial <= h.radius) {
        this.ringsHit.add(i);
        this.ringChain++;
        this.bestChain = Math.max(this.bestChain, this.ringChain);
        // Consecutive rings are worth progressively more: the third one in a
        // row is the hard one, so it should pay like it.
        this.ringPoints += 250 * this.ringChain;
      } else {
        this.ringChain = 0;
      }
    }
  }

  /** An obstacle counts as cleared once the kart is past it and still flying. */
  private scoreStacks(
    hazards: typeof this.view.core.hazards,
    k: { pos: { y: number } },
    s: number,
  ): void {
    const L = this.view.track.lapLength;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.def.kind !== 'stack' || this.clearedStacks.has(i)) continue;
      const def = h.def as Extract<typeof h.def, { kind: 'stack' }>;
      const stackS = def.s * L;
      if (s > stackS + def.len * 0.5 && k.pos.y > h.anchor.y + def.h) {
        this.clearedStacks.add(i);
        this.stackPoints += def.points ?? 150;
      }
    }
  }

  /** Where did it come down relative to the target? */
  private scoreTarget(
    hazards: typeof this.view.core.hazards,
    k: { pos: { x: number; z: number } },
    lat: number,
  ): void {
    void lat;
    const target = hazards.find((h) => h.def.kind === 'target');
    if (!target) return;
    const def = target.def as Extract<typeof target.def, { kind: 'target' }>;
    const d = Math.hypot(k.pos.x - target.anchor.x, k.pos.z - target.anchor.z);
    const names = ['outer', 'bronze', 'silver', 'GOLD'];
    for (let i = def.rings.length - 1; i >= 0; i--) {
      if (d <= def.rings[i]) {
        this.targetPoints = def.points?.[i] ?? 0;
        this.targetRingName = names[Math.min(names.length - 1, i)];
        return;
      }
    }
    this.targetPoints = 0;
    this.targetRingName = 'missed';
  }

  private runningTotal(): number {
    return Math.round(this.ringPoints + this.stackPoints + this.targetPoints);
  }

  private finishLaunch(): void {
    const trickMult = 1 + Math.min(0.25, this.tricks * 0.08);
    const base = this.ringPoints + this.stackPoints + this.targetPoints;
    // A perfect run — gold ring, flat landing — is worth calling out.
    const perfect = this.targetRingName === 'GOLD' && this.landingQuality >= 0.99;
    const bonus = perfect ? 750 : 0;
    const score = Math.round((base + bonus) * this.landingQuality * trickMult);
    this.phase = 'scored';
    this.result = {
      score,
      valid: true,
      medal: medalFor(this.def, score),
      lines: [
        { label: 'Rings threaded', value: this.ringsHit.size > 0
            ? `${this.ringsHit.size}/3 (best chain ${this.bestChain}) — ${this.ringPoints} pts`
            : 'None', good: this.ringsHit.size > 0 },
        { label: 'Obstacles cleared', value: `${this.clearedStacks.size}/4 — ${this.stackPoints} pts`,
          good: this.clearedStacks.size >= 4 },
        { label: 'Landed in', value: this.targetPoints > 0
            ? `${this.targetRingName} — ${this.targetPoints} pts` : 'Missed the target',
          good: this.targetPoints > 0 },
        { label: 'Landing', value: this.landingQuality >= 0.99
            ? 'Clean ×1.00' : `Heavy ×${this.landingQuality.toFixed(2)}`, good: this.landingQuality >= 0.99 },
        { label: 'Tricks', value: this.tricks > 0 ? `${this.tricks} ×${trickMult.toFixed(2)}` : 'None',
          good: this.tricks > 0 },
        ...(perfect ? [{ label: 'Perfect landing', value: '+750 pts', good: true }] : []),
      ],
    };
  }

  /** Arc length of the ramp lip on the Mega Ramp course. */
  private rampLipS(def: { zones: { from: number; to: number; label?: string }[] }): number {
    const ramp = def.zones.find((z) => z.label === 'Ramp');
    return (ramp ? ramp.to : 0.5) * this.view.track.lapLength;
  }

  private finishRamp(distance: number): void {
    const d = Math.max(0, distance) + this.ringsHit.size * RING_METRES;
    const trickMult = 1 + Math.min(0.25, this.tricks * 0.08);
    const score = d * this.landingQuality * trickMult;
    if (this.outsideCorridor) {
      this.fail('Landed outside the corridor.');
      return;
    }
    this.phase = 'scored';
    this.result = {
      score,
      valid: true,
      medal: medalFor(this.def, score),
      lines: [
        { label: 'Distance', value: `${d.toFixed(1)} m` },
        { label: 'Landing', value: this.landingQuality >= 0.99 ? 'Clean ×1.00' : `Heavy ×${this.landingQuality.toFixed(2)}`, good: this.landingQuality >= 0.99 },
        { label: 'Tricks', value: this.tricks > 0 ? `${this.tricks} ×${trickMult.toFixed(2)}` : 'None', good: this.tricks > 0 },
        { label: 'Peak height', value: `${(this.peakHeight - (this.view.player.kart.pos.y)).toFixed(0)} m` },
      ],
    };
  }

  private finishGauntlet(time: number): void {
    const penalty = this.resets * 6;
    const bonus = Math.min(6, this.nearMiss);
    const score = Math.max(0, time + penalty - bonus);
    this.phase = 'scored';
    this.result = {
      score,
      valid: true,
      medal: medalFor(this.def, score),
      lines: [
        { label: 'Raw time', value: `${time.toFixed(2)} s` },
        { label: 'Leaps cleared', value: `${this.gapsCleared}/${this.view.track.gaps.length}`, good: this.gapsCleared >= this.view.track.gaps.length },
        { label: 'Resets', value: this.resets > 0 ? `${this.resets} (+${penalty.toFixed(0)} s)` : 'None', good: this.resets === 0 },
        { label: 'Near misses', value: bonus > 0 ? `-${bonus.toFixed(1)} s` : 'None', good: bonus > 0 },
      ],
    };
  }

  private fail(reason: string): void {
    this.phase = 'failed';
    this.result = {
      score: this.def.higherIsBetter ? 0 : this.def.timeLimit,
      valid: false,
      medal: 'none',
      lines: [],
      reason,
    };
  }

  get finished(): boolean {
    return this.phase === 'scored' || this.phase === 'failed';
  }
}
