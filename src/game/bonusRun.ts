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

/** Points per horizontal metre of flight on Luna Launch. */
const FLIGHT_POINTS_PER_M = 8;

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
  private launchX = 0;
  private launchZ = 0;
  private launched = false;
  private peakHeight = 0;
  private landingQuality = 1;
  private tricks = 0;

  // --- luna launch state ---
  private ringsHit = new Set<number>();
  /** Signed distance along the road from each ring's plane, last frame. */
  private ringSide = new Map<number, number>();
  /** Rings threaded back-to-back without missing one. */
  private ringChain = 0;
  private bestChain = 0;
  private ringPoints = 0;
  private bonusHit = 0;
  private bonusPoints = 0;
  private flightPoints = 0;
  private flightMetres = 0;
  private clearedStacks = new Set<number>();
  private stackPoints = 0;
  private hitStack = false;
  private touchdownS = -1;

  // --- boss gauntlet state ---
  /** Player hearts; a bite, a slam, a boulder or a fall costs one. */
  private hearts = 5;
  private hurtCooldown = 0;
  private bossHp = 6;
  private bossHits = 0;
  private itemsUsed = 0;
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
    if (this.def.kind === 'launch') {
      if (e.kind === 'trickComplete') this.tricks++;
      if (e.kind === 'land') this.landingQuality = Math.max(this.landingQuality, 1);
      if (e.kind === 'hardLand') this.landingQuality = Math.min(this.landingQuality, 1 - 0.34 * clamp01(e.value));
      if (e.kind === 'hazardHit' && e.value >= 1) this.hitStack = true;
    } else {
      if (e.kind === 'respawnStart') this.resets++;   // a fall costs time, not a heart
      if (e.kind === 'hazardHit' && e.value >= 0.5) this.hurt('hit');
    }
  }

  /** Race-level events the boss battle listens for. */
  onRaceEvent(e: { kind: string; racerId: string; value: number; text?: string }): void {
    if (this.def.kind !== 'gauntlet') return;
    const me = this.view.player;
    if (e.kind === 'bossHit' && e.racerId === me.id && this.bossHp > 0) {
      this.bossHp--;
      this.bossHits++;
    }
    if (e.kind === 'item' && e.racerId === me.id && e.value === 1) this.itemsUsed++;
    if (e.kind === 'itemHit' && e.racerId === me.id) this.hurt('comet');
  }

  private hurt(_why: string): void {
    if (this.hurtCooldown > 0 || this.phase === 'scored' || this.phase === 'failed') return;
    this.hearts = Math.max(0, this.hearts - 1);
    this.hurtCooldown = 1.4;
  }

  /** The boss's health bar and the player's hearts, for the HUD. */
  get battle(): { hearts: number; bossHp: number; bossMax: number } | null {
    return this.def.kind === 'gauntlet' ? { hearts: this.hearts, bossHp: this.bossHp, bossMax: 6 } : null;
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

    {
      this.phase = 'run';
      const t = Math.max(0, core.time);
      this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
      const hearts = '♥'.repeat(this.hearts) + '♡'.repeat(5 - this.hearts);
      const bossBar = '█'.repeat(this.bossHp) + '░'.repeat(6 - this.bossHp);
      this.live.primary = `${t.toFixed(2)} s`;
      this.live.secondary = `${hearts} · KILNBANE ${bossBar} · ${this.gapsCleared}/${track.gaps.length} leaps`;
      this.live.hint = this.bossHp <= 0 ? 'BOSS DOWN — RUN FOR THE DOCK'
        : player.item ? `FIRE THE ${player.item === 'comet' ? 'COMET AT THE BOSS' : player.item.toUpperCase()}`
        : this.nearMiss > 0 ? `-${this.nearMiss.toFixed(1)}s near miss` : 'Grab chests — comets hurt the boss';
      if (this.hearts <= 0) { this.fail('Out of hearts. The gauntlet wins this one.'); return; }

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
        this.launchX = k.pos.x; this.launchZ = k.pos.z;
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
      // Horizontal metres, not arc length: over the cliff the spline projection
      // of an airborne kart runs far ahead of where it actually is.
      const dist = Math.hypot(k.pos.x - this.launchX, k.pos.z - this.launchZ);
      this.flightMetres = dist;
      this.flightPoints = Math.round(dist * FLIGHT_POINTS_PER_M);
      const target = hazards.find((h) => h.def.kind === 'target');
      const toTarget = target
        ? (target.pos.x - k.pos.x) * player.ground.fwd.x + (target.pos.z - k.pos.z) * player.ground.fwd.z
        : 0;
      void L;
      const ringTotal = hazards.filter((h) => h.def.kind === 'ring' && !(h.def as { bonus?: boolean }).bonus).length;
      const bonusTotal = hazards.filter((h) => h.def.kind === 'ring' && (h.def as { bonus?: boolean }).bonus).length;
      const stackTotal = hazards.filter((h) => h.def.kind === 'stack').length;
      const plainRings = this.ringsHit.size - this.bonusHit;
      this.live.primary = `${this.runningTotal()} pts`;
      this.live.secondary = `${dist.toFixed(0)} m · ${plainRings}/${ringTotal} rings · ${this.bonusHit}/${bonusTotal} bullseyes`
        + (stackTotal ? ` · ${this.clearedStacks.size}/${stackTotal} cleared` : '');
      this.live.hint = this.hitStack
        ? 'CLIPPED IT'
        : this.ringChain >= 3 ? `CHAIN ×${Math.min(5, this.ringChain)}`
        : toTarget > 6 ? `${toTarget.toFixed(0)} m to the landing zone`
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
      const def = h.def as Extract<typeof h.def, { kind: 'ring' }>;
      if (radial <= h.radius) {
        this.ringsHit.add(i);
        if (def.bonus) {
          // A sweeping bullseye: a flat bounty, and it does not touch the chain.
          this.bonusHit++;
          this.bonusPoints += def.points ?? 800;
        } else {
          this.ringChain++;
          this.bestChain = Math.max(this.bestChain, this.ringChain);
          // Consecutive rings are worth progressively more, up to a cap: the
          // fifth in a row is the hard one, so it should pay like it.
          this.ringPoints += 200 * Math.min(5, this.ringChain);
        }
      } else if (!def.bonus) {
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
    const d = Math.hypot(k.pos.x - target.pos.x, k.pos.z - target.pos.z);
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
    return Math.round(this.ringPoints + this.bonusPoints + this.stackPoints + this.targetPoints + this.flightPoints);
  }

  private finishLaunch(): void {
    const trickMult = 1 + Math.min(0.25, this.tricks * 0.08);
    const base = this.ringPoints + this.bonusPoints + this.stackPoints + this.targetPoints + this.flightPoints;
    const hazards = this.view.core.hazards;
    const ringTotal = hazards.filter((h) => h.def.kind === 'ring' && !(h.def as { bonus?: boolean }).bonus).length;
    const bonusTotal = hazards.filter((h) => h.def.kind === 'ring' && (h.def as { bonus?: boolean }).bonus).length;
    const stackTotal = hazards.filter((h) => h.def.kind === 'stack').length;
    const plainRings = this.ringsHit.size - this.bonusHit;
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
        { label: 'Flight', value: `${this.flightMetres.toFixed(1)} m — ${this.flightPoints} pts`, good: this.flightMetres > 100 },
        { label: 'Rings threaded', value: plainRings > 0
            ? `${plainRings}/${ringTotal} (best chain ${this.bestChain}) — ${this.ringPoints} pts`
            : 'None', good: plainRings > 0 },
        { label: 'Bullseyes hit', value: this.bonusHit > 0
            ? `${this.bonusHit}/${bonusTotal} — ${this.bonusPoints} pts` : 'None', good: this.bonusHit > 0 },
        ...(stackTotal ? [{ label: 'Obstacles cleared', value: `${this.clearedStacks.size}/${stackTotal} — ${this.stackPoints} pts`,
          good: this.clearedStacks.size >= stackTotal }] : []),
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

  private finishGauntlet(time: number): void {
    if (this.bossHp > 0) {
      this.fail(`Reached the dock with Kilnbane still standing (${this.bossHp}/6). Comets from the chests bring it down.`);
      return;
    }
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
        { label: 'Kilnbane', value: `Down — ${this.bossHits} comet hits, ${this.itemsUsed} items used`, good: true },
        { label: 'Hearts left', value: `${this.hearts}/5`, good: this.hearts === 5 },
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
