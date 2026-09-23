/** RaceView — the running race: simulation, rendering, effects and audio.
 *
 *  The simulation runs on a fixed 120 Hz step inside an accumulator, so the
 *  physics is frame-rate independent and a race replays identically from the
 *  same seed and inputs regardless of the machine it runs on. Rendering reads
 *  the simulation; it never writes to it.
 */
import * as THREE from 'three';
import { TrackRuntime } from '../sim/track';
import { RaceCore, type RaceConfig, type RaceEvent, type Racer } from '../sim/race';
import { BotDriver, RIVALS } from '../sim/ai';
import { resolveLoadout, type LoadoutParts, type ValidatedLoadout } from '../sim/loadout';
import { NEUTRAL_INPUT, type KartEvent, type KartInput } from '../sim/kart';
import { MODE_RULES, type Mode } from '../data/rules';
import { AXIES, axieById } from '../data/axies';
import { KARTS, kartById } from '../data/karts';
import { trackById } from '../data/tracks/index';
import { SURFACE } from '../sim/trackTypes';
import { RenderContext } from '../render/scene';
import { buildTrackMesh, animateTrack, type TrackVisual } from '../render/trackMesh';
import { buildScenery } from '../render/scenery';
import { buildHazards, updateHazards, type HazardVisual } from '../render/hazardMesh';
import { buildKart, seatAxie, updateKart, disposeKart, LIVERY, type KartRig } from '../render/kartMesh';
import { ParticleSystem, SpeedLines } from '../render/vfx';
import { ChaseCamera, COMFORT_CAMERA, DEFAULT_CAMERA } from '../render/chaseCamera';
import { audio } from '../audio/audio';
import { reconcile } from '../net/ws';
import type { LobbyMember, NetworkAdapter } from '../net/adapter';
import { clamp, clamp01, damp, hashString } from '../core/math';
import type { Profile } from '../persist/store';
import type { InputManager } from '../ui/input';

const STEP = 1 / 120;

/** Which of the three scores a land plays: forests and the savannah share the
 *  bright one, the mystic ruins the dark one, the arctic sky the airy one. */
const AUDIO_THEME: Record<string, 'canopy' | 'ruin' | 'cloud'> = {
  canopy: 'canopy', forest: 'canopy', savannah: 'canopy', ruin: 'ruin', mystic: 'ruin', cloud: 'cloud', arctic: 'cloud',
};

interface KartPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }
const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
/** Extra simulation steps per frame once the player is done, so the field
 *  finishes for real in about a second of wall time instead of being guessed. */
const FINISH_FAST_FORWARD = 24;
const MAX_FRAME = 0.25;

export interface RaceSetup {
  trackId: string;
  mode: Mode;
  laps: number;
  fieldSize: number;
  seed: number;
  /** 0.6..1.15 — scales every bot's skill. */
  difficulty: number;
  /** Time trial and bonus events run with no rivals. */
  soloGhost?: boolean;
  /** Server-run race: the field, in the server's own ids.
   *
   *  The client MUST build its racers with the ids the server uses, or every
   *  snapshot arrives describing racers this client has never heard of and is
   *  silently discarded — the race looks like it is working right up until you
   *  notice nobody is ever corrected. */
  members?: LobbyMember[];
  /** Which of those members is us. */
  localId?: string;
}

export interface RaceViewEvents {
  onRaceEvent?: (e: RaceEvent) => void;
  onKartEvent?: (racer: Racer, e: KartEvent) => void;
  onComplete?: () => void;
}

export class RaceView {
  readonly ctx: RenderContext;
  readonly track: TrackRuntime;
  readonly core: RaceCore;
  readonly setup: RaceSetup;
  private bots = new Map<string, BotDriver>();
  private rigs = new Map<string, KartRig>();
  private trackVis: TrackVisual;
  private scenery: THREE.Group;
  private hazardVis: HazardVisual;
  private particles: ParticleSystem;
  private speedLines: SpeedLines;
  private camera = new ChaseCamera();
  private accumulator = 0;
  /** Each kart's pose before the most recent sim step. The renderer blends
   *  from here to the live pose by the accumulator's remainder, so a 120 Hz
   *  sim drawn at any display rate moves smoothly instead of aliasing by up
   *  to a whole step (a third of a metre at speed) from frame to frame. */
  private prevPose = new Map<string, KartPose>();
  private viewPose = new Map<string, KartPose>();
  private inputs = new Map<string, KartInput>();
  private shake = 0;
  private lastInput: KartInput = { ...NEUTRAL_INPUT };
  private respawnFade = new Map<string, number>();
  private events: RaceViewEvents;
  private root = new THREE.Group();
  /** Wall-clock seconds since the view started, for effect phases. */
  private clock = 0;
  paused = false;
  /** Set while the player is watching the post-race camera. */
  cinematic = false;
  /** Drives the player's kart with the bot AI. Used by the attract loop on the
   *  menus and by the capture tooling; never enabled during a real race. */
  autopilot = false;
  private autoDriver: BotDriver | null = null;

  /** When set, the server owns race truth: this client sends inputs, predicts
   *  locally so steering stays instant, and is corrected from snapshots. */
  net: NetworkAdapter | null = null;
  private completed = false;

  /** Set by a click or tap while the finishing tail runs. */
  skipRequested = false;
  private tailArmed = false;
  private netTick = 0;
  private lastSnapT = -1;
  /** Largest correction applied this race, in metres — surfaced in the HUD as
   *  connection quality rather than hidden. */
  worstCorrection = 0;

  constructor(
    ctx: RenderContext,
    setup: RaceSetup,
    profile: Profile,
    private input: InputManager,
    events: RaceViewEvents = {},
  ) {
    this.ctx = ctx;
    this.setup = setup;
    this.events = events;

    const def = trackById(setup.trackId);
    this.track = new TrackRuntime(def);
    const cfg: RaceConfig = RaceCore.configFor(setup.mode, setup.trackId, setup.laps, setup.seed);
    this.core = new RaceCore(this.track, cfg);

    ctx.applyTheme(def.theme);
    ctx.scene.add(this.root);

    this.trackVis = buildTrackMesh(this.track, ctx.materials);
    this.root.add(this.trackVis.group);
    this.scenery = buildScenery(this.track, ctx.materials, ctx.quality.sceneryDensity);
    this.root.add(this.scenery);
    this.hazardVis = buildHazards(this.track, ctx.materials);
    this.root.add(this.hazardVis.group);

    this.particles = new ParticleSystem(ctx.quality.particleBudget);
    this.root.add(this.particles.mesh);
    this.speedLines = new SpeedLines();
    ctx.camera.add(this.speedLines.group);
    ctx.scene.add(ctx.camera);

    this.camera.settings = profile.settings.comfort ? { ...COMFORT_CAMERA } : { ...DEFAULT_CAMERA };

    // ---- the player -------------------------------------------------------
    const modeRules = MODE_RULES[setup.mode];
    const axie = axieById(profile.axieId);
    const kart = kartById(profile.kartId);
    const playerLoadout = resolveLoadout(axie, kart, profile.parts as LoadoutParts, {
      playerId: profile.playerId,
      budget: modeRules.statBudget,
      normalize: modeRules.ranked,
    });
    const player = this.core.addRacer(setup.localId ?? profile.playerId, profile.alias, playerLoadout, {
      isPlayer: true, colorIndex: 0,
    });
    player.kart.assists = modeRules.assistsAllowed
      ? profile.settings.assists
      : { autoAccel: false, steerAssist: false, recoveryAssist: false };
    this.addRig(player, playerLoadout, null);

    // ---- rivals -----------------------------------------------------------
    if (setup.members && setup.members.length) {
      // Server-run field: ids, Axies and karts all come from the server.
      let color = 1;
      for (const m of setup.members) {
        if (m.id === setup.localId) continue;
        const lo = resolveLoadout(axieById(m.axieId), kartById(m.kartId), profile.parts as LoadoutParts, {
          playerId: m.id,
          budget: modeRules.statBudget,
          normalize: modeRules.ranked,
        });
        const racer = this.core.addRacer(m.id, m.name, lo, {
          isBot: m.isBot, skill: 0.85, colorIndex: color,
        });
        // Only bots get a local driver. A remote human's kart is moved by the
        // server's snapshots; giving it an AI as well would fight them.
        if (m.isBot) {
          const p = RIVALS[(color - 1) % RIVALS.length];
          const bot = new BotDriver(racer, p, this.track, hashString(`${setup.seed}:${m.id}`));
          bot.difficulty = setup.difficulty;
          this.bots.set(racer.id, bot);
        }
        this.addRig(racer, lo, LIVERY[color % LIVERY.length], color + 1);
        color++;
      }
    } else if (!setup.soloGhost) {
      for (let i = 1; i < setup.fieldSize; i++) {
        const p = RIVALS[(i - 1) % RIVALS.length];
        // Rivals get a deterministic but varied pairing from the race seed, so
        // a field is never the same three karts in the same three colours.
        // `>>>` not `>>`: hashString returns a full unsigned 32-bit value, and a
        // signed shift turns anything above 2^31 negative, which indexes off
        // the front of the array and hands the resolver an undefined kart.
        const pick = hashString(`${setup.seed}:${p.name}`);
        const rAxie = AXIES[pick % AXIES.length];
        const rKart = KARTS[(pick >>> 3) % KARTS.length];
        const lo = resolveLoadout(rAxie, rKart, profile.parts as LoadoutParts, {
          playerId: `bot-${i}`,
          budget: modeRules.statBudget,
          normalize: modeRules.ranked,
        });
        const racer = this.core.addRacer(`bot-${i}`, p.name, lo, {
          isBot: true, skill: p.skill, colorIndex: i,
        });
        const bot = new BotDriver(racer, p, this.track, hashString(`${setup.seed}:${i}`));
        bot.difficulty = setup.difficulty;
        this.bots.set(racer.id, bot);
        this.addRig(racer, lo, LIVERY[i % LIVERY.length], i + 1);
      }
    }

    // Place every kart on its grid slot and point the camera at the player.
    for (const r of this.core.racers) {
      const slot = this.track.gridSlot(this.core.racers.indexOf(r));
      r.kart.reset(slot.pos, slot.yaw);
      r.kart.mode = 'frozen';
      this.track.ground(r.kart.pos, undefined, r.ground);
      this.respawnFade.set(r.id, 1);
    }
    const p0 = this.core.player!;
    this.camera.reset(p0.kart.pos.x, p0.kart.pos.y, p0.kart.pos.z, p0.kart.yaw);

    audio.startRace(AUDIO_THEME[def.theme.scenery]);
  }

  private addRig(racer: Racer, loadout: ValidatedLoadout, livery: string | null, number = 1): void {
    const kart = kartById(loadout.kartId);
    const rig = buildKart(kart, this.ctx.materials, {
      parts: loadout.parts,
      livery: livery ?? undefined,
      number,
    });
    seatAxie(rig, axieById(loadout.axieId), this.ctx);
    this.root.add(rig.root);
    this.rigs.set(racer.id, rig);
  }

  get player(): Racer {
    return this.core.player!;
  }

  /** Advance one rendered frame. */
  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, MAX_FRAME);
    this.clock += dt;

    if (!this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 12) {
        this.snapshotPoses();
        this.simulate(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      // If we fell far behind (a tab that was backgrounded), drop the debt
      // rather than spiral: a race must never fast-forward itself.
      if (this.accumulator > STEP * 12) this.accumulator = 0;
    }

    this.render(dt);
  }

  private snapshotPoses(): void {
    for (const r of this.core.racers) {
      const k = r.kart;
      let p = this.prevPose.get(r.id);
      if (!p) { p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }; this.prevPose.set(r.id, p); }
      p.x = k.pos.x; p.y = k.pos.y; p.z = k.pos.z; p.yaw = k.yaw; p.pitch = k.pitch; p.roll = k.roll;
    }
  }

  /** The pose to draw this frame: the previous and current sim poses blended
   *  by how far into the next step the frame clock has run. A jump of more
   *  than a few metres is a respawn, not motion, and is not blended. */
  private view(r: Racer): KartPose {
    const k = r.kart;
    let v = this.viewPose.get(r.id);
    if (!v) { v = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }; this.viewPose.set(r.id, v); }
    const p = this.prevPose.get(r.id);
    const a = this.paused || !p ? 1 : clamp01(this.accumulator / STEP);
    if (!p || a >= 1 || Math.hypot(k.pos.x - p.x, k.pos.z - p.z) > 6) {
      v.x = k.pos.x; v.y = k.pos.y; v.z = k.pos.z; v.yaw = k.yaw; v.pitch = k.pitch; v.roll = k.roll;
      return v;
    }
    v.x = p.x + (k.pos.x - p.x) * a;
    v.y = p.y + (k.pos.y - p.y) * a;
    v.z = p.z + (k.pos.z - p.z) * a;
    v.yaw = lerpAngle(p.yaw, k.yaw, a);
    v.pitch = lerpAngle(p.pitch, k.pitch, a);
    v.roll = lerpAngle(p.roll, k.roll, a);
    return v;
  }

  private simulate(dt: number): void {
    const core = this.core;
    this.inputs.clear();

    const player = core.player;
    if (player) {
      if (this.autopilot && !this.autoDriver) {
        this.autoDriver = new BotDriver(player, RIVALS[0], this.track, 1234);
      }
      const raw = this.cinematic || player.progress.finished
        ? NEUTRAL_INPUT
        : this.autopilot && this.autoDriver
          ? this.autoDriver.think(dt, core)
          : this.input.read();
      // On a touch screen the full meter fires itself: there is no spare thumb.
      const fired = this.input.device === 'touch' && player.kart.driftTier === 3 && !player.kart.drifting
        ? { ...raw, boost: true } : raw;
      this.lastInput = fired;
      this.inputs.set(player.id, fired);
      if (this.input.isDown(this.resetKey) && player.kart.mode === 'driving') {
        player.kart.triggerRespawn();
      }
      // Crossed the line: the tail exists so you see yourself finish, not so
      // you sit and watch. A fresh key or a tap ends it now.
      if (core.canSkipTail) {
        if (!this.tailArmed) { this.tailArmed = true; this.skipRequested = false; this.input.consumeAnyPress(); }
        else if (this.input.consumeAnyPress() || this.skipRequested) core.skipTail();
      }
    }
    for (const [id, bot] of this.bots) this.inputs.set(id, bot.think(dt, core));

    core.applyCatchUp();
    core.step(dt, this.inputs);

    // The flag is out and the player is parked. Run the rest of the field at
    // speed so the results table holds real finishing times: at a 4s tail the
    // stragglers were written off, and a win on Ruin read "seven DNF".
    if (core.phase === 'finishing' && core.player?.progress.finished) {
      const ff = core.hurry ? FINISH_FAST_FORWARD * 10 : FINISH_FAST_FORWARD;
      for (let i = 0; i < ff && core.phase === 'finishing'; i++) {
        this.inputs.clear();
        for (const [id, bot] of this.bots) this.inputs.set(id, bot.think(dt, core));
        core.applyCatchUp();
        core.step(dt, this.inputs);
      }
    }

    if (this.net) {
      this.netTick++;
      const mine = this.inputs.get(player?.id ?? '');
      if (mine) this.net.sendInput(this.netTick, mine);
      this.applySnapshot(dt);
    }

    for (const e of core.events) this.events.onRaceEvent?.(e);
    for (const r of core.racers) {
      for (const e of r.kart.events) {
        this.onKartEvent(r, e);
        this.events.onKartEvent?.(r, e);
      }
    }
    // Once, not once per frame. The race sits in `complete` for as long as the
    // results screen takes to appear, and every one of those frames was paying
    // out the purse and counting another race.
    if (core.phase === 'complete' && !this.completed) {
      this.completed = true;
      this.events.onComplete?.();
    }
  }

  /** Fold the latest authoritative snapshot into the predicted race.
   *
   *  Remote karts are placed from the server outright — there is nothing local
   *  worth preserving about them. The local kart is blended, so the steering a
   *  player feels stays theirs and only the disagreement is corrected.
   */
  private applySnapshot(dt: number): void {
    const snap = this.net?.latestSnapshot();
    if (!snap || snap.t === this.lastSnapT) return;
    this.lastSnapT = snap.t;
    const localId = this.core.player?.id;
    for (const r of snap.racers) {
      const racer = this.core.racers.find((x) => x.id === r.id);
      if (!racer) continue;
      if (racer.id === localId) {
        const before = racer.kart.snapshot();
        const err = Math.hypot(r.s[0] - before[0], r.s[1] - before[1], r.s[2] - before[2]);
        this.worstCorrection = Math.max(this.worstCorrection, err);
        racer.kart.applySnapshot(reconcile(before, r.s, dt));
      } else {
        racer.kart.applySnapshot(r.s);
      }
      // Progress is the server's, always. It is the number that decides the
      // race, so a client never gets to hold an opinion about it.
      racer.progress.raw = r.p;
      racer.progress.position = r.pos;
    }
  }

  private resetKey = 'KeyR';
  setResetKey(code: string): void {
    this.resetKey = code;
  }

  private onKartEvent(r: Racer, e: KartEvent): void {
    const isPlayer = r.isPlayer;
    const k = r.kart;
    const surf = SURFACE[r.ground.surface];

    switch (e.kind) {
      case 'driftTier':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z,
          color: ['#ffffff', '#5fb0ff', '#ffa63d', '#c79bff'][Math.min(3, e.value)],
          count: 12, speed: 2.6, life: 0.45, size: 0.30, spread: 1.2, gravity: -3,
        });
        if (isPlayer) audio.sfx('driftTier', e.value);
        break;
      case 'boostStart':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z,
          color: '#ffd166', count: 18, speed: 5.5, life: 0.55, size: 0.42, spread: 1.4, grow: 1.4,
        });
        if (isPlayer) { audio.sfx('boostStart'); this.shake = Math.max(this.shake, 0.45); }
        break;
      case 'padHit': if (isPlayer) audio.sfx('padHit'); break;
      case 'hop': if (isPlayer) audio.sfx('hop'); break;
      case 'land':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y - 0.2, z: e.pos.z,
          color: surf.dust, count: 10, speed: 3.2, life: 0.5, size: 0.38, spread: 1.0, grow: 1.6,
        });
        if (isPlayer) audio.sfx('land', e.value);
        break;
      case 'hardLand':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y - 0.2, z: e.pos.z,
          color: surf.dust, count: 18, speed: 5.0, life: 0.6, size: 0.5, spread: 1.6, grow: 2.0,
        });
        if (isPlayer) { audio.sfx('hardLand'); this.shake = Math.max(this.shake, 0.7 * e.value); }
        break;
      case 'wallHit':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z,
          color: '#ffd7a0', count: Math.round(3 + e.value * 10), speed: 3.4, life: 0.35, size: 0.22, spread: 0.9,
        });
        if (isPlayer && e.value > 0.2) { audio.sfx('wallHit', e.value); this.shake = Math.max(this.shake, e.value * 0.6); }
        break;
      case 'hazardHit':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y + 0.4, z: e.pos.z,
          color: '#ff7a3d', count: Math.round(4 + e.value * 14), speed: 4.5, life: 0.45, size: 0.34, spread: 1.4, grow: 1.2,
        });
        if (isPlayer && e.value > 0.25) {
          audio.sfx('hazardHit', e.value);
          this.shake = Math.max(this.shake, e.value * 0.8);
          audio.axieChirp(1.0, false);
        }
        break;
      case 'spin': if (isPlayer) audio.sfx('spin'); break;
      case 'trickComplete':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y, z: e.pos.z,
          color: '#c79bff', count: 22, speed: 5.5, life: 0.7, size: 0.34, spread: 2.0, grow: 1.5,
        });
        if (isPlayer) { audio.sfx('trickComplete'); audio.axieChirp(1.25, true); }
        break;
      case 'trickFail': if (isPlayer) audio.sfx('trickFail'); break;
      case 'respawnStart':
        this.particles.emit({
          x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z,
          color: '#9fe3ff', count: 14, speed: 3.0, life: 0.6, size: 0.4, spread: 1.2, grow: 1.4,
        });
        if (isPlayer) audio.sfx('respawnStart');
        this.input.releaseDrift();
        break;
      case 'respawnEnd': if (isPlayer) audio.sfx('respawnEnd'); break;
    }
    void k;
  }

  private render(dt: number): void {
    const core = this.core;
    const player = core.player!;
    const pk = player.kart;

    // Continuous trail effects, emitted here rather than in the sim so the
    // particle rate follows the frame rate instead of the physics rate.
    for (const r of core.racers) {
      const k = r.kart;
      const rig = this.rigs.get(r.id);
      if (!rig) continue;
      const near = r.isPlayer || Math.hypot(k.pos.x - pk.pos.x, k.pos.z - pk.pos.z) < 60;
      if (near && k.grounded && k.mode === 'driving') {
        const surf = SURFACE[r.ground.surface];
        const speedFrac = clamp01(k.speed / 30);
        if (k.drifting && speedFrac > 0.25) {
          const tierColor = ['#d8d8e0', '#5fb0ff', '#ffa63d', '#c79bff'][Math.min(3, k.driftTier)];
          for (const anchor of rig.sparkAnchors) {
            const p = anchor.getWorldPosition(new THREE.Vector3());
            this.particles.emit({
              x: p.x, y: p.y, z: p.z, color: tierColor,
              count: 1, speed: 1.6, life: 0.30, size: 0.16, spread: 0.5, gravity: -2, drag: 3,
            });
          }
        } else if (surf.rough > 0.2 && speedFrac > 0.2) {
          const p = rig.sparkAnchors[0]?.getWorldPosition(new THREE.Vector3());
          if (p && Math.random() < surf.rough) {
            this.particles.emit({
              x: p.x, y: p.y, z: p.z, color: surf.dust,
              count: 1, speed: 1.2, life: 0.55, size: 0.28, spread: 0.6, grow: 1.6, drag: 1.6,
            });
          }
        }
        if (k.boosting) {
          for (const anchor of [rig.sockets.exhaustL, rig.sockets.exhaustR]) {
            const p = anchor.getWorldPosition(new THREE.Vector3());
            this.particles.emit({
              x: p.x, y: p.y, z: p.z, color: '#ffb23f',
              count: 1, speed: 1.0, life: 0.28, size: 0.26, spread: 0.3, grow: 1.8, drag: 4,
            });
          }
        }
      }

      // Respawn dissolve.
      const fadeTarget = k.mode === 'respawning' ? 0 : 1;
      const fade = damp(this.respawnFade.get(r.id) ?? 1, fadeTarget, 9, dt);
      this.respawnFade.set(r.id, fade);

      // How close is the nearest rival, and on which side? The Axie looks.
      let rivalSide = 0;
      for (const o of core.racers) {
        if (o === r) continue;
        const dx = o.kart.pos.x - k.pos.x;
        const dz = o.kart.pos.z - k.pos.z;
        if (Math.hypot(dx, dz) > 9) continue;
        const side = dx * Math.cos(k.yaw) - dz * Math.sin(k.yaw);
        const ahead = dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw);
        if (Math.abs(ahead) > 6) continue;
        rivalSide = clamp(side / 4, -1, 1);
      }

      const mood = k.mode === 'finished'
        ? (r.progress.position <= 3 ? 'win' : 'lose')
        : 'race';
      const v = this.view(r);

      updateKart(rig, {
        dt,
        x: v.x, y: v.y, z: v.z,
        yaw: v.yaw, pitch: v.pitch, roll: v.roll,
        groundY: r.ground.height,
        speed: k.speed,
        topSpeed: k.h.topSpeed,
        steer: k.steerSmoothed,
        drifting: k.drifting,
        driftDir: k.driftDir,
        driftTier: k.driftTier,
        boosting: k.boosting,
        grounded: k.grounded,
        airTime: k.airTime,
        compression: k.compression,
        impact: clamp01(k.spinTimer),
        rivalSide,
        mood,
        spinTimer: k.spinTimer,
        respawnFade: fade,
      });
    }

    // ---- camera -----------------------------------------------------------
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const pv = this.view(player);
    this.camera.update(this.ctx.camera, {
      dt,
      x: pv.x, y: pv.y, z: pv.z, yaw: pv.yaw,
      speed: pk.speed, topSpeed: pk.h.topSpeed,
      boosting: pk.boosting, drifting: pk.drifting, driftDir: pk.driftDir,
      grounded: pk.grounded, airTime: pk.airTime,
      roadFwdX: player.ground.fwd.x, roadFwdZ: player.ground.fwd.z,
      shake: this.shake,
      lookBack: this.lastInput.lookBack,
    });

    // ---- weather ------------------------------------------------------------
    // Winterblue: snow falls around the camera the whole race. The flakes are
    // ordinary particles, spawned above and ahead of the camera every frame,
    // so the budget the quality tier set still holds.
    if (this.track.def.theme.scenery === 'arctic') {
      const cam = this.ctx.camera.position;
      const n = this.ctx.quality.tier === 'low' ? 1 : this.ctx.quality.tier === 'medium' ? 2 : 4;
      for (let i = 0; i < n; i++) {
        this.particles.emit({
          x: cam.x + (Math.random() - 0.5) * 60, y: cam.y + 6 + Math.random() * 10, z: cam.z + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 1.5, vy: -2.4 - Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.5,
          color: '#ffffff', count: 1, life: 4.5, size: 0.14 + Math.random() * 0.1, spread: 0, gravity: 0, drag: 0,
        });
      }
    }

    // ---- world ------------------------------------------------------------
    const countdown = core.phase === 'countdown' ? -core.time : null;
    animateTrack(this.trackVis, this.clock, countdown);
    updateHazards(this.hazardVis, core.hazards, Math.max(0, core.time));
    this.particles.update(dt, this.ctx.camera);

    const speedFrac = clamp01((pk.speed - 18) / 22);
    this.speedLines.update(
      this.camera.settings.fovKick * (speedFrac * 0.7 + (pk.boosting ? 0.5 : 0)),
      dt,
    );

    this.ctx.followSun(pk.pos.x, pk.pos.y, pk.pos.z);

    // ---- audio ------------------------------------------------------------
    audio.drive({
      speed: pk.speed,
      topSpeed: pk.h.topSpeed,
      throttle: this.lastInput.throttle,
      grounded: pk.grounded,
      surfaceRough: SURFACE[player.ground.surface].rough + (player.ground.outside > 0 ? 0.5 : 0),
      drifting: pk.drifting,
      driftTier: pk.driftTier,
      boosting: pk.boosting,
      offRoad: player.ground.outside > 0,
      covered: player.ground.covered,
    });

    this.ctx.render();
  }

  /** Swap the camera to a slow orbit for the results screen. */
  startCinematic(): void {
    this.cinematic = true;
  }

  dispose(): void {
    audio.stopRace();
    this.ctx.scene.remove(this.root);
    this.ctx.camera.remove(this.speedLines.group);
    for (const rig of this.rigs.values()) disposeKart(rig);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.root.clear();
    this.rigs.clear();
    this.bots.clear();
  }
}
