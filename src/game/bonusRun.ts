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
    if (this.def.kind === 'megaRamp') {
      if (e.kind === 'trickComplete') this.tricks++;
      if (e.kind === 'land') this.landingQuality = Math.max(this.landingQuality, 1);
      if (e.kind === 'hardLand') this.landingQuality = Math.min(this.landingQuality, 1 - 0.34 * clamp01(e.value));
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

    if (this.def.kind === 'megaRamp') {
      const rampEnd = this.rampLipS(track.def);
      if (!this.launched) {
        this.phase = 'run';
        this.live.primary = `${Math.round(k.speed * 3.6)} km/h`;
        this.live.secondary = 'Speed at the lip is the whole score';
        this.live.hint = k.boosting ? 'BOOSTING' : 'Take all three pads';
        if (!k.grounded && player.ground.s > rampEnd - 6) {
          this.launched = true;
          this.launchS = player.ground.s;
          this.peakHeight = k.pos.y;
        }
      } else if (!k.grounded) {
        this.phase = 'flight';
        this.peakHeight = Math.max(this.peakHeight, k.pos.y);
        const dist = Math.max(0, player.ground.s - this.launchS);
        this.live.primary = `${dist.toFixed(1)} m`;
        this.live.secondary = `air ${k.airTime.toFixed(1)}s`;
        this.live.hint = k.trickActive ? 'TRICK — LAND IT FLAT' : 'Level the kart for the landing';
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

  /** Arc length of the ramp lip on the Mega Ramp course. */
  private rampLipS(def: { zones: { from: number; to: number; label?: string }[] }): number {
    const ramp = def.zones.find((z) => z.label === 'Ramp');
    return (ramp ? ramp.to : 0.5) * this.view.track.lapLength;
  }

  private finishRamp(distance: number): void {
    const d = Math.max(0, distance);
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
