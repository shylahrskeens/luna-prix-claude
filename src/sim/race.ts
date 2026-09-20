/** RaceCore — the authority on race truth.
 *
 *  Progress is a single continuous number per racer: laps completed, with a
 *  fraction. It advances by the signed step in lap position every tick, which
 *  means lap counting, race position, wrong-way detection, split times and
 *  checkpoint-skip detection all fall out of one accumulator instead of five
 *  interacting special cases.
 *
 *  A step larger than MAX_STEP cannot happen by driving, so it is rejected and
 *  flagged. That single rule is the whole anti-skip system.
 */
import { clamp, clamp01, loopDelta, v3, wrap, type V3 } from '../core/math';
import { TrackRuntime, type HazardState } from './track';
import { KartRuntime, resolveKartContact, type KartEvent, type KartInput, NEUTRAL_INPUT } from './kart';
import type { GroundInfo } from './trackTypes';
import type { ValidatedLoadout } from './loadout';
import { MODE_RULES, RULES_VERSION, type Mode } from '../data/rules';
import { SPECIALS, SPECIAL_COST } from '../data/specials';

/** Largest believable lap-fraction advance in one simulation step. At 120 Hz
 *  and 45 m/s on the shortest track this is ~0.0004, so 0.02 is a 50x margin
 *  that still catches any real teleport. */
const MAX_STEP = 0.02;

export type RacePhase = 'grid' | 'countdown' | 'racing' | 'finishing' | 'complete';

export interface RacerProgress {
  /** Continuous progress in laps. Negative on the grid, `laps` at the flag. */
  raw: number;
  prevU: number;
  lap: number;
  /** Index of the next checkpoint this racer must reach. */
  nextCp: number;
  /** Last checkpoint confirmed — the respawn entitlement. */
  lastCp: number;
  position: number;
  lapTimes: number[];
  splits: number[];
  bestLap: number;
  finished: boolean;
  finishTime: number;
  /** Integrity notes; a non-empty list quarantines the result. */
  integrity: string[];
  /** Still running when the flag window closed. A normal racing outcome, not
   *  a cheating signal — it must never quarantine anyone else's result. */
  dnf: boolean;
  /** Metres to the racer in front, for the HUD. */
  gapAhead: number;
}

export interface Racer {
  id: string;
  name: string;
  isPlayer: boolean;
  isBot: boolean;
  kart: KartRuntime;
  ground: GroundInfo;
  progress: RacerProgress;
  loadout: ValidatedLoadout;
  /** Class-special charge, 0..1. Drifting fills it; firing empties it. */
  special: number;
  /** Edge detection for the special button. */
  specialHeld: boolean;
  /** Seconds before this racer may fire again. */
  specialCooldown: number;
  /** Drift seconds already paid into the meter. */
  driftPaid: number;
  /** Bot skill 0..1; unused for humans. */
  skill: number;
  /** Livery tint index for the renderer. */
  colorIndex: number;
}

export interface RaceConfig {
  mode: Mode;
  trackId: string;
  laps: number;
  /** Deterministic seed for bot personalities and scenery. */
  seed: number;
  /** Countdown length in seconds. */
  countdown: number;
  assistsAllowed: boolean;
  catchUp: number;
}

export interface RaceResultEntry {
  playerId: string;
  name: string;
  isPlayer: boolean;
  finish: number;
  totalTime: number;
  lapTimes: number[];
  bestLap: number;
  topSpeed: number;
  driftSeconds: number;
  boosts: number;
  tricks: number;
  integrity: string[];
  dnf: boolean;
  axieId: string;
  kartId: string;
}

export interface RaceResult {
  raceId: string;
  mode: Mode;
  trackId: string;
  rulesVersion: string;
  laps: number;
  seed: number;
  entries: RaceResultEntry[];
  /** True only when no entry carries an integrity flag. */
  publishable: boolean;
  finishedAt: number;
}

export interface RaceEvent {
  kind: 'lap' | 'finish' | 'overtake' | 'checkpoint' | 'countdown' | 'go' | 'lastLap' | 'integrity' | 'special';
  racerId: string;
  value: number;
  text?: string;
}

export class RaceCore {
  readonly track: TrackRuntime;
  readonly cfg: RaceConfig;
  readonly racers: Racer[] = [];
  phase: RacePhase = 'grid';
  /** Race clock. Negative during the countdown, 0 at lights out. */
  time = 0;
  /** Wall time since the race object was created, for the countdown. */
  private phaseTimer = 0;
  hazards: HazardState[] = [];
  events: RaceEvent[] = [];
  /** Set when every racer has finished or the finish timer expires. */
  finishTimeout = 0;
  /** No race runs past this, however badly it is going. Set from the leader's time. */
  private hardStop = Infinity;
  /** True while the tail is running and the player may cut it short. */
  get canSkipTail(): boolean { return this.phase === 'finishing'; }
  /** Set when the player has asked to get on with it: the view runs the rest of
   *  the field much faster. It does NOT cut the race off — truncating it wrote
   *  the whole field off as DNF, so a win could read "seven did not finish". */
  hurry = false;
  skipTail(): void { if (this.phase === 'finishing') this.hurry = true; }

  constructor(track: TrackRuntime, cfg: RaceConfig) {
    this.track = track;
    this.cfg = cfg;
    this.time = -cfg.countdown;
    this.phase = 'countdown';
  }

  addRacer(
    id: string, name: string, loadout: ValidatedLoadout,
    opts: { isPlayer?: boolean; isBot?: boolean; skill?: number; colorIndex?: number } = {},
  ): Racer {
    const ground = TrackRuntime.emptyGround();
    const kart = new KartRuntime(id, loadout, ground);
    kart.setKillY(this.track.def.killY);
    const slot = this.track.gridSlot(this.racers.length);
    kart.reset(slot.pos, slot.yaw);
    kart.mode = 'frozen';
    const startU = this.track.def.start.s;
    const projected = this.track.ground(slot.pos, undefined, ground);
    const racer: Racer = {
      id, name,
      isPlayer: opts.isPlayer ?? false,
      isBot: opts.isBot ?? false,
      kart, ground, loadout,
      special: 0, specialHeld: false, specialCooldown: 0, driftPaid: 0,
      skill: opts.skill ?? 0.7,
      colorIndex: opts.colorIndex ?? this.racers.length,
      progress: {
        raw: loopDelta(startU, projected.u, 1),
        prevU: projected.u,
        lap: 0,
        nextCp: 0,
        lastCp: this.track.checkpoints.length - 1,
        position: this.racers.length + 1,
        lapTimes: [],
        splits: [],
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        integrity: [],
        dnf: false,
        gapAhead: 0,
      },
    };
    this.racers.push(racer);
    return racer;
  }

  get player(): Racer | undefined {
    return this.racers.find((r) => r.isPlayer);
  }

  /** Fixed-step advance. `inputs` maps racer id to input for this step. */
  step(dt: number, inputs: Map<string, KartInput>): void {
    this.events.length = 0;
    this.phaseTimer += dt;

    if (this.phase === 'countdown') {
      const before = Math.ceil(-this.time);
      this.time += dt;
      const after = Math.ceil(-this.time);
      if (after !== before && after >= 0) {
        this.events.push({ kind: 'countdown', racerId: '', value: after });
      }
      if (this.time >= 0) {
        this.phase = 'racing';
        this.time = 0;
        this.events.push({ kind: 'go', racerId: '', value: 0 });
        for (const r of this.racers) {
          r.kart.mode = 'driving';
          // Start boost: the launch window is the last 0.45s before lights out,
          // widened for Mech and for start-tuned engines.
          const width = r.loadout.traits.has('start-tune') ? 0.62 : 0.45;
          const c = r.kart.launchCharge;
          if (c > 0 && c <= width) r.kart.startBoost(c > width * 0.55 ? 2 : 1, 'start');
          else if (c > width * 2.2) {
            // Held far too early: bogged start.
            r.kart.vel.x *= 0.2; r.kart.vel.z *= 0.2;
            r.kart.spinTimer = 0.45;
          }
          r.kart.launchBurned = true;
        }
      }
    } else {
      this.time += dt;
    }

    this.hazards = this.track.updateHazards(Math.max(0, this.time));

    // ---- per-racer simulation -------------------------------------------
    for (const r of this.racers) {
      const input = r.progress.finished ? NEUTRAL_INPUT : (inputs.get(r.id) ?? NEUTRAL_INPUT);
      // The special charges off the thing the game is already about. Drifting
      // pays a boost and fills the meter; what you do with the meter is yours.
      if (r.kart.driftSeconds > r.driftPaid) {
        r.special = Math.min(1, r.special + (r.kart.driftSeconds - r.driftPaid) * 0.34);
        r.driftPaid = r.kart.driftSeconds;
      }
      if (r.specialCooldown > 0) r.specialCooldown -= dt;
      if (input.special && !r.specialHeld && r.special >= SPECIAL_COST && r.specialCooldown <= 0
          && r.kart.mode === 'driving' && !r.progress.finished && this.phase !== 'countdown') {
        this.fireSpecial(r);
      }
      r.specialHeld = !!input.special;
      this.track.ground(r.kart.pos, r.kart.sHint, r.ground);
      r.kart.step(dt, input, r.ground);
      for (const e of r.kart.events) {
        // Place on the event, not on a state test.
        //
        //  The kart flips itself out of `respawning` in the same step that its
        //  timer expires, so a check for "still respawning and the timer has
        //  run out" is never true: the kart was never actually moved, it just
        //  paused where it fell and carried on falling. In a gap that is an
        //  infinite loop and the end of that racer's race.
        if (e.kind === 'respawnEnd') {
          const anchor = this.track.respawn(r.progress.lastCp);
          r.kart.placeAt(anchor.pos, anchor.yaw, 6);
          this.track.ground(r.kart.pos, undefined, r.ground);
          r.kart.sHint = r.ground.s;
          this.reanchorProgress(r);
        }
        this.onKartEvent(r, e);
      }
    }

    // ---- contact ---------------------------------------------------------
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        resolveKartContact(this.racers[i].kart, this.racers[j].kart);
      }
    }

    // ---- hazards ---------------------------------------------------------
    this.applyHazards(dt);

    // ---- slipstream ------------------------------------------------------
    this.applyDraft(dt);

    // ---- progress --------------------------------------------------------
    for (const r of this.racers) this.advanceProgress(r, dt);

    // ---- standings -------------------------------------------------------
    this.sortPositions();

    // ---- phase -----------------------------------------------------------
    if (this.phase === 'racing' && this.racers.every((r) => r.progress.finished)) {
      this.phase = 'complete';
    } else if (this.phase === 'finishing') {
      this.finishTimeout -= dt;
      if (this.finishTimeout <= 0 || this.racers.every((r) => r.progress.finished)) {
        // Never take the flag away from a human who is still driving. The
        // leader's tail used to guillotine a slow player at 45 seconds and hand
        // them a DNF on their own first race. Keep waiting, up to a hard stop
        // so a wedged kart cannot hold the race open for ever.
        const human = this.racers.find((r) => r.isPlayer && !r.progress.finished);
        if (human && this.time < this.hardStop) { this.finishTimeout = 10; return; }
        // Whoever is still out there is placed on the pace they were actually
        // running, in the order the player last saw them. Marking them DNF
        // would hand the player every place behind them, which is a lie.
        const rest = this.racers
          .filter((r) => !r.progress.finished)
          .sort((a, b) => b.progress.raw - a.progress.raw);
        let last = Math.max(0, ...this.racers.map((r) => (r.progress.finished ? r.progress.finishTime : 0)));
        for (const r of rest) {
          const projected = Math.max(last + 0.25, this.projectedFinish(r));
          last = projected;
          this.finishRacer(r, true, projected);
        }
        this.phase = 'complete';
      }
    }
  }

  /** Kart-level events that the race core needs to act on. A respawn costs the
   *  racer the ground back to their checkpoint, which is penalty enough, so no
   *  artificial time is added — but it is worth surfacing to the HUD. */
  private onKartEvent(r: Racer, e: KartEvent): void {
    if (e.kind === 'respawnStart') {
      this.events.push({ kind: 'checkpoint', racerId: r.id, value: -1, text: 'respawn' });
    }
  }

  /** Re-seat a respawned racer's progress on the checkpoint they were actually
   *  returned to.
   *
   *  Without this, a respawn is a free lap: the accumulator keeps the progress
   *  the kart had when it fell, the kart re-drives the same ground, and the
   *  progress is credited twice. Progress can only ever move backwards here.
   */
  private reanchorProgress(r: Racer): void {
    const p = r.progress;
    const g = this.track.ground(r.kart.pos, undefined, r.ground);
    const startS = this.track.def.start.s;
    const frac = wrap(g.u - startS, 1);
    //  Pick the lap the racer is actually on: the one that puts the re-anchored
    //  progress nearest to where they were. A checkpoint anchor can legitimately
    //  sit slightly AHEAD of where a kart left the road, so refusing any forward
    //  movement at all is wrong — it silently subtracts an entire lap and the
    //  racer never recovers.
    //
    //  The integer lap count may never go UP, which is the part that actually
    //  matters: that is the only way a respawn could gift a lap.
    const lapBase = Math.min(Math.round(p.raw - frac), Math.floor(p.raw));
    p.raw = lapBase + frac;
    p.prevU = g.u;
  }

  private advanceProgress(r: Racer, dt: number): void {
    const p = r.progress;
    if (p.finished) return;
    const u = r.ground.u;
    let d = loopDelta(p.prevU, u, 1);
    if (Math.abs(d) > MAX_STEP) {
      // Cannot have been driven. Most often a respawn placing the kart, which
      // is legitimate: the checkpoint anchor is behind them, so the step is
      // negative and we simply re-anchor without crediting progress.
      if (r.kart.mode === 'respawning' || r.kart.respawnTimer > 0) {
        p.prevU = u;
        return;
      }
      // A jump in the PROJECTION is not a jump in the WORLD.
      //
      //  Far from the centreline — on a branch, deep in the scenery — the
      //  nearest point on the track is genuinely ambiguous, and it can flip
      //  between two places the kart drove between continuously. On the road
      //  it cannot: there the projection is unambiguous, so a jump there is a
      //  real teleport and worth flagging. Re-anchor quietly off the road,
      //  flag on it.
      if (r.ground.onBranch !== null || r.ground.outside > 2 || r.ground.reacquired) {
        p.prevU = u;
        return;
      }
      p.integrity.push(
        `Discontinuous progress at t=${this.time.toFixed(2)}s, lap position ${u.toFixed(3)} ` +
        `(${d.toFixed(3)} laps in one step from ${p.prevU.toFixed(3)}, ` +
        `${r.ground.outside.toFixed(1)} m off the road)`,
      );
      this.events.push({ kind: 'integrity', racerId: r.id, value: d, text: 'progress jump' });
      p.prevU = u;
      return;
    }
    const before = p.raw;
    p.raw += d;
    p.prevU = u;

    const n = this.track.checkpoints.length;
    // Checkpoints, split times and lap crossings all read off `raw`.
    if (d > 0) {
      const beforeCp = Math.floor(before * n);
      const afterCp = Math.floor(p.raw * n);
      for (let c = beforeCp + 1; c <= afterCp; c++) {
        const idx = wrap(c, n);
        p.lastCp = idx === 0 ? n - 1 : idx - 1;
        p.nextCp = wrap(idx + 1, n);
        if (this.phase === 'racing') p.splits.push(this.time);
        this.events.push({ kind: 'checkpoint', racerId: r.id, value: idx });
      }
      const beforeLap = Math.floor(before);
      const afterLap = Math.floor(p.raw);
      if (afterLap > beforeLap && this.phase !== 'countdown') {
        for (let l = beforeLap + 1; l <= afterLap; l++) {
          if (l <= 0) continue;
          const lapStart = p.lapTimes.reduce((a, b) => a + b, 0);
          const lapTime = this.time - lapStart;
          p.lapTimes.push(lapTime);
          p.bestLap = Math.min(p.bestLap, lapTime);
          p.lap = l;
          this.events.push({ kind: 'lap', racerId: r.id, value: l });
          if (l === this.cfg.laps - 1 && r.isPlayer) {
            this.events.push({ kind: 'lastLap', racerId: r.id, value: l });
          }
          if (l >= this.cfg.laps) {
            this.finishRacer(r, false);
            break;
          }
        }
      }
    }
    void dt;
  }

  /** What the clock would have read had this racer kept the pace they were on. */
  private projectedFinish(r: Racer): number {
    const p = r.progress;
    const done = Math.max(0.05, p.raw);
    const remaining = Math.max(0, this.cfg.laps - p.raw);
    const perLap = this.time / done;
    return this.time + remaining * perLap;
  }

  /** The Axie's class special. Everything it does is deterministic and reads
   *  only race state, so the server resolves the same move from the same class. */
  private fireSpecial(r: Racer): void {
    const sp = SPECIALS[r.loadout.axieClass];
    r.special = 0;
    r.specialCooldown = r.isBot ? 11 : 6;
    const me = r.kart;
    const fwdX = Math.sin(me.yaw), fwdZ = Math.cos(me.yaw);
    const rel = this.racers
      .filter((o) => o !== r && !o.progress.finished)
      .map((o) => {
        const dx = o.kart.pos.x - me.pos.x, dz = o.kart.pos.z - me.pos.z;
        const dist = Math.max(0.001, Math.hypot(dx, dz));
        return { o, nx: dx / dist, nz: dz / dist, dist, ahead: dx * fwdX + dz * fwdZ };
      })
      .sort((a, b) => a.dist - b.dist);
    const inFront = rel.find((x) => x.ahead > 0 && x.dist < sp.range);

    switch (sp.kind) {
      case 'ram':
        for (const t of rel) if (t.dist < sp.range && t.ahead > -3) t.o.kart.hit(0.50, t.nx, t.nz);
        me.startBoost(1, 'special');
        break;
      case 'wake':
        for (const t of rel) if (t.dist < sp.range && t.ahead < 0) {
          t.o.kart.applySlow(0.84, sp.duration);
          t.o.kart.hit(0.26, t.nx, t.nz);
        }
        break;
      case 'root':
        if (inFront) inFront.o.kart.applySlow(0.58, sp.duration);
        break;
      case 'gust':
        for (const t of rel.slice(0, 3)) if (t.dist < sp.range) t.o.kart.hit(0.42, -t.nz, t.nx);
        break;
      case 'sting':
        if (inFront) { inFront.o.kart.applyNoBoost(sp.duration); inFront.o.kart.applySlow(0.90, sp.duration); }
        break;
      case 'shell':
        me.applyShield(sp.duration);
        break;
      case 'overdrive':
        me.startBoost(3, 'special');
        me.boostTime = Math.max(me.boostTime, sp.duration);
        break;
      case 'draft':
        me.draft = 1;
        me.startBoost(1, 'special');
        break;
      case 'hex':
        if (inFront) inFront.o.kart.applyNoBoost(sp.duration);
        break;
    }
    this.events.push({ kind: 'special', racerId: r.id, value: 0 });
  }

  private finishRacer(r: Racer, timedOut: boolean, atTime?: number): void {
    const p = r.progress;
    if (p.finished) return;
    p.finished = true;
    // A projected time orders the table; `dnf` keeps it from being shown or saved
    // as a real result.
    p.finishTime = atTime ?? (timedOut ? this.time + 30 : this.time);
    r.kart.mode = 'finished';
    if (timedOut) p.dnf = true;
    const place = this.racers.filter((x) => x.progress.finished).length;
    if (place === 1) this.hardStop = this.time * 2.5 + 60;
    this.events.push({ kind: 'finish', racerId: r.id, value: place });
    if (r.isPlayer && this.phase !== 'complete') {
      // Once the player is done the race gets a SHORT tail — long enough to
      // watch yourself cross and the next car come in, not long enough to feel
      // stuck. Anyone still out is placed on their own pace when it ends.
      //
      //  This used to require `phase === 'racing'`, so finishing anywhere but
      //  first left the 45s leader tail running and the player sat with no
      //  control for up to three quarters of a minute. Measured at 28s.
      this.phase = 'finishing';
      this.finishTimeout = Math.min(this.finishTimeout > 0 ? this.finishTimeout : Infinity, 60);
    } else if (this.phase === 'racing' && place === 1) {
      this.phase = 'finishing';
      this.finishTimeout = 45;
    }
  }

  private sortPositions(): void {
    const order = [...this.racers].sort((a, b) => {
      if (a.progress.finished !== b.progress.finished) return a.progress.finished ? -1 : 1;
      if (a.progress.finished && b.progress.finished) return a.progress.finishTime - b.progress.finishTime;
      return b.progress.raw - a.progress.raw;
    });
    for (let i = 0; i < order.length; i++) {
      const r = order[i];
      const prev = r.progress.position;
      r.progress.position = i + 1;
      if (prev !== i + 1 && r.isPlayer && this.phase === 'racing') {
        this.events.push({ kind: 'overtake', racerId: r.id, value: i + 1 });
      }
      const ahead = order[i - 1];
      r.progress.gapAhead = ahead
        ? Math.max(0, (ahead.progress.raw - r.progress.raw) * this.track.lapLength)
        : 0;
    }
  }

  /** Slipstream: sitting inside a leading kart's wake raises top speed.
   *  Aquatic Axies build it faster, which is their whole race plan. */
  private applyDraft(dt: number): void {
    for (const r of this.racers) {
      let best = 0;
      const k = r.kart;
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      for (const o of this.racers) {
        if (o === r) continue;
        const dx = o.kart.pos.x - k.pos.x;
        const dz = o.kart.pos.z - k.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 2.5 || dist > 16) continue;
        const align = (dx * fx + dz * fz) / dist;
        if (align < 0.86) continue;
        const strength = (1 - (dist - 2.5) / 13.5) * (align - 0.86) / 0.14;
        best = Math.max(best, clamp01(strength));
      }
      const rate = r.loadout.axieClass === 'Aquatic' ? 4.5 : 2.4;
      k.draft = k.draft + (best - k.draft) * clamp01(rate * dt);
    }
  }

  /** Per (hazard, racer) cooldown. A kart pinned against a temple gate must
   *  not take a fresh impact every single simulation step — at 120 Hz that is
   *  a deadlock, not a hazard. */
  private hazardCooldown = new Map<string, number>();

  private canHit(hazardIndex: number, racerId: string, seconds: number): boolean {
    const key = `${hazardIndex}:${racerId}`;
    const until = this.hazardCooldown.get(key) ?? -1;
    if (this.time < until) return false;
    this.hazardCooldown.set(key, this.time + seconds);
    return true;
  }

  private applyHazards(dt: number): void {
    const tmp = v3();
    let hazardIndex = -1;
    for (const h of this.hazards) {
      hazardIndex++;
      const d = h.def;
      for (const r of this.racers) {
        const k = r.kart;
        if (k.mode === 'respawning') continue;
        const dx = k.pos.x - h.pos.x;
        const dz = k.pos.z - h.pos.z;
        const dy = k.pos.y - h.pos.y;

        switch (d.kind) {
          case 'gator': {
            if (!h.active) break;
            const dist = Math.hypot(dx, dz);
            if (dist < h.radius + k.h.radius && Math.abs(dy) < 3.2
                && this.canHit(hazardIndex, r.id, 0.9)) {
              // Hard enough to cost the jump, not hard enough to spin a kart
              // out in mid-air where it has no way to recover.
              k.hit(k.grounded ? 0.9 : 0.5, dx / (dist || 1), dz / (dist || 1));
            }
            break;
          }
          case 'bumper': {
            const dist = Math.hypot(dx, dz);
            if (dist < h.radius + k.h.radius && Math.abs(dy) < 2.2) {
              const nx = dx / (dist || 1), nz = dz / (dist || 1);
              k.pos.x = h.pos.x + nx * (h.radius + k.h.radius);
              k.pos.z = h.pos.z + nz * (h.radius + k.h.radius);
              if (this.canHit(hazardIndex, r.id, 0.5)) k.hit(0.55, nx, nz);
            }
            break;
          }
          case 'roller': {
            const dist = Math.hypot(dx, dz);
            if (dist < h.radius + k.h.radius && Math.abs(dy) < 2.6
                && this.canHit(hazardIndex, r.id, 0.7)) {
              k.hit(0.8, dx / (dist || 1), dz / (dist || 1));
            }
            break;
          }
          case 'gate': {
            // A rotating temple gate with one opening. The gap sweeps across
            // the road, so the line through it changes every lap.
            const along = Math.abs(dx * h.fwd.x + dz * h.fwd.z);
            if (along > 1.6) break;
            const lat = dx * h.right.x + dz * h.right.z;
            const openCentre = Math.sin(h.phase * Math.PI * 2) * d.span * 0.62;
            const openHalf = d.span * 0.40;
            if (Math.abs(lat - openCentre) > openHalf && this.canHit(hazardIndex, r.id, 0.8)) {
              // A gate costs speed and line, never control. Shoving the kart
              // sideways pins it against the bar; spinning it turns a mistimed
              // gate into a ten-second recovery, which is not the lesson the
              // hazard is meant to teach.
              const keep = 1 - 0.42 * (1 - k.h.knockResist * 0.5);
              k.vel.x *= keep;
              k.vel.z *= keep;
              k.endDrift(false);
              const toOpen = Math.sign(openCentre - lat) || 1;
              k.vel.x += h.right.x * toOpen * 3.0;
              k.vel.z += h.right.z * toOpen * 3.0;
              k.events.push({ kind: 'hazardHit', value: 0.5, pos: { ...k.pos } });
            }
            break;
          }
          case 'panel': {
            // The panel is only dangerous while it is missing: drive over the
            // hole and you fall. Handled as a local gap.
            if (!h.active) break;
            const along = Math.abs(dx * h.fwd.x + dz * h.fwd.z);
            const lat = dx * h.right.x + dz * h.right.z;
            if (along < d.len * 0.5 && Math.abs(lat - d.lat * 0) < d.w * 0.5 && k.grounded) {
              k.grounded = false;
              k.vel.y = -2;
              k.pos.y -= 0.5;
            }
            break;
          }
          case 'turbine': {
            const along = dx * h.fwd.x + dz * h.fwd.z;
            if (Math.abs(along) > d.len * 0.5) break;
            const lat = dx * h.right.x + dz * h.right.z;
            if (Math.abs(lat) > 14) break;
            // Constant crosswind. Not damage — a line problem.
            const push = d.strength * (1 - Math.abs(along) / (d.len * 0.5));
            k.vel.x += h.right.x * push * dt;
            k.vel.z += h.right.z * push * dt;
            break;
          }
          case 'stack': {
            //  Solid, and deliberately unforgiving: the whole point of an
            //  obstacle is that clearing it was a choice you could fail.
            //  Judged as a box, because a stack of crates is a box and a
            //  sphere would let a kart clip a corner and sail on.
            const along = dx * h.fwd.x + dz * h.fwd.z;
            const lat = dx * h.right.x + dz * h.right.z;
            const below = k.pos.y < h.anchor.y + d.h + k.h.radius * 0.5;
            if (Math.abs(along) < d.len * 0.5 + k.h.radius
                && Math.abs(lat - 0) < d.w * 0.5 + k.h.radius
                && below && k.pos.y > h.anchor.y - 2
                && this.canHit(hazardIndex, r.id, 1.2)) {
              k.hit(0.9, -h.fwd.x, -h.fwd.z);
              k.events.push({ kind: 'hazardHit', value: 1, pos: { ...k.pos } });
            }
            break;
          }
          case 'ring':
          case 'target':
            break;
        }
      }
    }
    void tmp;
  }

  /** Freeze the race into a result record. */
  buildResult(): RaceResult {
    const ordered = [...this.racers].sort((a, b) => {
      if (a.progress.finished !== b.progress.finished) return a.progress.finished ? -1 : 1;
      if (a.progress.finished && b.progress.finished) return a.progress.finishTime - b.progress.finishTime;
      return b.progress.raw - a.progress.raw;
    });
    const entries: RaceResultEntry[] = ordered.map((r, i) => ({
      playerId: r.id,
      name: r.name,
      isPlayer: r.isPlayer,
      finish: i + 1,
      totalTime: r.progress.finishTime,
      lapTimes: [...r.progress.lapTimes],
      bestLap: isFinite(r.progress.bestLap) ? r.progress.bestLap : 0,
      topSpeed: r.kart.topSpeedSeen,
      driftSeconds: r.kart.driftSeconds,
      boosts: r.kart.boostCount,
      tricks: r.kart.trickCount,
      integrity: [...r.progress.integrity],
      dnf: r.progress.dnf,
      axieId: r.loadout.axieId,
      kartId: r.loadout.kartId,
    }));
    return {
      raceId: `${this.cfg.trackId}-${this.cfg.seed}-${Math.floor(Date.now() / 1000)}`,
      mode: this.cfg.mode,
      trackId: this.cfg.trackId,
      rulesVersion: RULES_VERSION,
      laps: this.cfg.laps,
      seed: this.cfg.seed,
      entries,
      publishable: entries.every((e) => e.integrity.length === 0),
      finishedAt: Date.now(),
    };
  }

  /** Apply per-mode catch-up to bots only. Ranked passes 0 and this is a no-op. */
  applyCatchUp(): void {
    const strength = this.cfg.catchUp;
    if (strength <= 0) {
      for (const r of this.racers) r.kart.catchUp = 1;
      return;
    }
    const leader = this.racers.reduce((a, b) => (b.progress.raw > a.progress.raw ? b : a));
    for (const r of this.racers) {
      if (!r.isBot) { r.kart.catchUp = 1; continue; }
      const behind = clamp01((leader.progress.raw - r.progress.raw) * 2.2);
      r.kart.catchUp = 1 + behind * strength * 0.16;
    }
  }

  /** World position a spectator/minimap should point at for racer `id`. */
  racerPos(id: string): V3 | null {
    const r = this.racers.find((x) => x.id === id);
    return r ? r.kart.pos : null;
  }

  static configFor(mode: Mode, trackId: string, laps: number, seed: number): RaceConfig {
    const m = MODE_RULES[mode];
    return {
      mode, trackId, laps, seed,
      countdown: 3.0,
      assistsAllowed: m.assistsAllowed,
      catchUp: m.catchUp,
    };
  }
}

export { clamp };
