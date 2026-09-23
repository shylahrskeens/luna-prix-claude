/** Luna Prix — application shell.
 *
 *  Owns the canvas, the render context, the screen router and the frame loop.
 *  Exactly one requestAnimationFrame drives everything: menus, the garage
 *  turntable and a live race all take their time from the same clock, so
 *  nothing keeps running in the background after it stops being visible.
 */
import './ui/styles.css';
import { RenderContext, type QualityTier } from './render/scene';
import { RaceView } from './game/raceView';
import { BonusRun } from './game/bonusRun';
import { Showcase } from './game/showcase';
import { InputManager, prettyKey } from './ui/input';
import { TouchControls, isTouchDevice } from './ui/touch';
import { Hud } from './ui/hud';
import { el, mount, clear } from './ui/dom';
import {
  homeScreen, axieScreen, garageScreen, shopScreen, trackSelectScreen,
  resultsScreen, boardsScreen, settingsScreen, bonusSelectScreen,
  bonusResultsScreen, multiplayerScreen, pauseOverlay,
  type AppApi, type ScreenName, type ResultsParams, type BonusResultParams,
} from './ui/screens';
import { loadProfile, saveProfile, submitRecord, submitBonus, type Profile } from './persist/store';
import { ITEMS } from './data/items';
import { audio } from './audio/audio';
import { MODE_RULES, ratingDelta, divisionFor, type Mode } from './data/rules';
import { trackById, TRACKS } from './data/tracks/index';
import { bonusById, medalFor } from './data/bonus';
import { formatTime } from './core/math';
import { LocalAdapter } from './net/local';
import { WsAdapter } from './net/ws';
import { serverUrl, type LobbyMember, type LobbyState, type NetworkAdapter } from './net/adapter';
import { resolveLoadout, type LoadoutParts } from './sim/loadout';
import { axieById } from './data/axies';
import { kartById } from './data/karts';

type Mode_ = Mode;

class App implements AppApi {
  profile: Profile;
  private canvas: HTMLCanvasElement;
  private ctx: RenderContext;
  private screens: HTMLElement;
  private hud: Hud;
  private touch: TouchControls;
  input: InputManager;
  private showcaseView: Showcase;
  private race: RaceView | null = null;
  private bonus: BonusRun | null = null;
  private pause: HTMLElement | null = null;
  private current: ScreenName = 'home';
  private history: ScreenName[] = [];
  private lastFrame = 0;
  private fpsSamples: number[] = [];
  private autoQualityChecked = false;

  constructor() {
    this.profile = loadProfile();
    this.canvas = document.getElementById('stage') as HTMLCanvasElement;
    this.screens = document.getElementById('screens') as HTMLElement;

    const tier = this.pickQuality();
    this.ctx = new RenderContext(this.canvas, tier);
    this.input = new InputManager(this.profile.settings);
    this.hud = new Hud({
      hudScale: this.profile.settings.hudScale,
      highContrast: this.profile.settings.highContrast,
      showPrompts: this.profile.settings.showTutorialPrompts,
    });
    this.touch = new TouchControls(this.input);
    this.showcaseView = new Showcase(this.ctx);
    this.showcaseView.bind(this.canvas);

    const app = document.getElementById('app')!;
    app.appendChild(this.hud.root);
    app.appendChild(this.touch.root);

    // A tap also ends the end-of-race tail. Consumed every frame so a click
    // from earlier in the race cannot skip it the moment it starts.
    window.addEventListener('pointerdown', () => { this.pointerPressed = true; });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();

    // Audio needs a gesture. Start it on the first interaction of any kind.
    const unlock = () => {
      void audio.start().then(() => {
        audio.applyMix(this.profile.settings.mix);
        if (!this.race) audio.menuMusic(true);
      });
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.race && !this.pause) this.togglePause(true);
    });

    this.initNet();
    this.go('home');
    document.getElementById('loading')?.remove();

    // Debug/automation hook. Harmless in production and it is what the
    // evidence tooling drives the game with, so a smoke test exercises the
    // same code path a player does rather than a parallel one.
    (window as unknown as { lunaPrix: unknown }).lunaPrix = {
      app: this,
      get race() { return (this as { app: App }).app.debugRace; },
      state: () => this.debugState(),
      step: (seconds: number) => this.debugStep(seconds),
      press: (code: string, seconds: number) => this.debugPress(code, seconds),
      autopilot: (on: boolean) => { if (this.race) this.race.autopilot = on; },
      audio: () => audio.analyse(),
      /** Step the race on autopilot until the player reaches lap position `u`,
       *  so a capture can be taken at a named part of the track. */
      driveTo: (u: number, maxSeconds = 90) => {
        const r = this.race;
        if (!r) return false;
        r.autopilot = true;
        const start = r.core.time;
        while (r.core.time - start < maxSeconds) {
          this.debugStep(0.25);
          const g = r.player.ground.u;
          if (Math.abs(g - u) < 0.006) return true;
        }
        return false;
      },
    };

    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- quality -----------------------------------------------------------

  private pickQuality(): QualityTier {
    const s = this.profile.settings.quality;
    if (s !== 'auto') return s;
    // Coarse heuristic to start from; the frame-time watchdog does the rest.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (isTouchDevice() || mem <= 2 || cores <= 4) return 'medium';
    return 'high';
  }

  /** Step the quality down once if the first seconds of a race cannot hold up.
   *  Measured, not guessed, and it only ever moves in the safe direction. */
  private watchFrameTime(dt: number): void {
    if (this.profile.settings.quality !== 'auto' || this.autoQualityChecked || !this.race) return;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 180) return;
    this.autoQualityChecked = true;
    const sorted = [...this.fpsSamples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    if (p90 > 1 / 42) {
      const next = this.ctx.quality.tier === 'high' ? 'medium' : 'low';
      this.ctx.setQuality(next);
      this.hud.toast(`Graphics set to ${next}`, 2.2);
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.resize(w, h);
  }

  // ---- AppApi ------------------------------------------------------------

  save(): void {
    saveProfile(this.profile);
  }

  sfx(kind: string, value = 1): void {
    audio.sfx(kind, value);
  }

  get device() {
    return this.input.device;
  }

  get screenHost(): HTMLElement {
    return this.screens;
  }

  applySettings(): void {
    const s = this.profile.settings;
    audio.applyMix(s.mix);
    this.input.updateSettings(s);
    this.hud.setOptions({
      hudScale: s.hudScale,
      highContrast: s.highContrast,
      showPrompts: s.showTutorialPrompts,
    });
    if (s.quality !== 'auto') this.ctx.setQuality(s.quality);
    if (this.race) this.race.setResetKey(s.keybinds.reset);
  }

  showcase(on: boolean): void {
    if (on) {
      this.showcaseView.show(this.profile.axieId, this.profile.kartId, this.profile.parts);
    } else {
      this.showcaseView.hide();
    }
  }

  back(): void {
    const prev = this.history.pop();
    this.go(prev ?? 'home');
  }

  go(screen: ScreenName, params: Record<string, unknown> = {}): void {
    if (this.race) this.endRace();
    if (this.current !== screen) this.history.push(this.current);
    this.current = screen;
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    this.screens.classList.add('active', 'interactive');
    this.input.uiCaptured = true;
    audio.menuMusic(true);

    const usesShowcase = screen === 'home' || screen === 'axie' || screen === 'garage' || screen === 'shop';
    this.showcase(usesShowcase);
    if (!usesShowcase) this.ctx.renderer.setClearColor(0x0a0c12, 1);

    let node: HTMLElement;
    switch (screen) {
      case 'home': node = homeScreen(this); break;
      case 'axie': node = axieScreen(this); break;
      case 'garage': node = garageScreen(this); break;
      case 'shop': node = shopScreen(this); break;
      case 'trackSelect': node = trackSelectScreen(this, params); break;
      case 'results': node = resultsScreen(this, params); break;
      case 'boards': node = boardsScreen(this); break;
      case 'settings': node = settingsScreen(this); break;
      case 'bonusSelect': node = bonusSelectScreen(this); break;
      case 'bonusResults': node = bonusResultsScreen(this, params); break;
      case 'multiplayer': node = multiplayerScreen(this); break;
      default: node = homeScreen(this); break;
    }
    mount(this.screens, node);
  }

  // ---- multiplayer -------------------------------------------------------

  private adapter: NetworkAdapter = new LocalAdapter();
  private netUrl: string | null = null;
  private netLobby: LobbyState | null = null;
  private netError: string | null = null;
  private netFns: (() => void)[] = [];
  private netOff: (() => void)[] = [];
  private pendingNetStart = false;

  private initNet(): void {
    const stored = (() => {
      try { return localStorage.getItem('lunaprix.server'); } catch { return null; }
    })();
    this.netUrl = serverUrl() ?? stored;
    this.rebuildAdapter();
  }

  private rebuildAdapter(): void {
    for (const off of this.netOff) off();
    this.netOff = [];
    this.adapter.disconnect();
    this.adapter = this.netUrl ? new WsAdapter(this.netUrl) : new LocalAdapter();
    this.netOff.push(this.adapter.onLobby((l) => { this.netLobby = l; this.netChanged(); }));
    this.netOff.push(this.adapter.onError((m) => { this.netError = m; this.netChanged(); }));
    this.netOff.push(this.adapter.onStart((info) => this.startNetRace(info)));
    this.netLobby = null;
    this.netError = null;
    this.netChanged();
  }

  private netChanged(): void {
    for (const f of this.netFns) f();
  }

  get net(): AppApi['net'] {
    return {
      url: this.netUrl,
      setUrl: (url: string | null) => {
        this.netUrl = url;
        try {
          if (url) localStorage.setItem('lunaprix.server', url);
          else localStorage.removeItem('lunaprix.server');
        } catch { /* storage blocked: the session still works */ }
        this.rebuildAdapter();
      },
      status: () => this.adapter.statusText,
      lobby: () => this.netLobby,
      connectAndJoin: async (trackId: string, mode: Mode) => {
        this.netError = null;
        const p = this.profile;
        const lo = resolveLoadout(axieById(p.axieId), kartById(p.kartId), p.parts as LoadoutParts, {
          playerId: p.playerId,
          budget: MODE_RULES[mode].statBudget,
          normalize: MODE_RULES[mode].ranked,
        });
        try {
          await this.adapter.connect();
          this.netLobby = await this.adapter.joinRoom({
            trackId, mode, laps: MODE_RULES[mode].laps, name: p.alias, loadout: lo,
          });
          this.pendingNetStart = true;
        } catch (err) {
          this.netError = `Could not join: ${(err as Error).message}`;
        }
        this.netChanged();
      },
      setReady: (ready: boolean) => this.adapter.setReady(ready),
      leave: () => { this.adapter.leaveRoom(); this.netLobby = null; this.pendingNetStart = false; this.netChanged(); },
      onChange: (fn: () => void) => {
        this.netFns.push(fn);
        return () => { this.netFns = this.netFns.filter((f) => f !== fn); };
      },
      lastError: this.netError,
    };
  }

  /** The server said go. Build the race and hand truth over to it. */
  private startNetRace(info: { seed: number; startAt: number; members: LobbyMember[] }): void {
    if (!this.pendingNetStart || !this.netLobby) return;
    this.pendingNetStart = false;
    const lobby = this.netLobby;
    this.endRace();
    clear(this.screens);
    this.screens.classList.remove('interactive');
    this.input.uiCaptured = false;
    this.showcase(false);
    audio.menuMusic(false);

    const view = new RaceView(this.ctx, {
      trackId: lobby.trackId,
      mode: lobby.mode,
      laps: lobby.laps,
      fieldSize: Math.max(2, info.members.length),
      seed: info.seed,
      difficulty: 1,
      members: info.members,
      localId: (this.adapter as WsAdapter).localId,
    }, this.profile, this.input, {
      onRaceEvent: (e) => this.onRaceEvent(e),
      onComplete: () => this.finishRace(),
    });
    view.net = this.adapter;
    view.setResetKey(this.profile.settings.keybinds.reset);
    this.race = view;
    this.hud.prepare(view.track);
    this.hud.setVisible(true);
    const touch = isTouchDevice();
    this.touch.setVisible(touch);
    this.hud.setTouchLayout(touch);
    this.hud.toast('Server race', 1.6);
  }

  // ---- race lifecycle ----------------------------------------------------

  startRace(mode: Mode_, trackId: string): void {
    this.endRace();
    const rules = MODE_RULES[mode];
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    // Bot difficulty tracks the player's division, so the field is a contest
    // from the first race without ever touching the bots mid-race.
    const rating = this.profile.rating;
    const difficulty = rating < 1000 ? 0.80 : rating < 1200 ? 0.90 : rating < 1450 ? 1.0 : rating < 1700 ? 1.08 : 1.15;

    clear(this.screens);
    this.screens.classList.remove('interactive');
    this.input.uiCaptured = false;
    this.input.clearPresses();
    this.showcase(false);
    audio.menuMusic(false);

    const view = new RaceView(this.ctx, {
      trackId, mode, laps: rules.laps,
      fieldSize: mode === 'timeTrial' ? 1 : 8,
      seed, difficulty,
      soloGhost: mode === 'timeTrial',
    }, this.profile, this.input, {
      onRaceEvent: (e) => this.onRaceEvent(e),
      onComplete: () => this.finishRace(),
    });
    view.setResetKey(this.profile.settings.keybinds.reset);
    this.race = view;
    this.hud.prepare(view.track);
    this.hud.setVisible(true);
    const touch = isTouchDevice();
    this.touch.setVisible(touch);
    this.hud.setTouchLayout(touch);
    this.fpsSamples.length = 0;
    this.autoQualityChecked = false;

    if (this.profile.settings.showTutorialPrompts && this.profile.races < 3) {
      this.hud.prompt('Hold the drift button through a corner to charge a boost. Release it on the exit.', 7);
    }
  }

  startBonus(eventId: string): void {
    this.endRace();
    const def = bonusById(eventId);
    clear(this.screens);
    this.screens.classList.remove('interactive');
    this.input.uiCaptured = false;
    this.input.clearPresses();
    this.showcase(false);
    audio.menuMusic(false);

    const view = new RaceView(this.ctx, {
      trackId: def.track.id, mode: 'bonus', laps: 1,
      // The boss gauntlet runs with two rival Axies; the launch is a solo flight.
      fieldSize: def.kind === 'gauntlet' ? 3 : 1, seed: 1, difficulty: 1, soloGhost: def.kind !== 'gauntlet',
    }, this.profile, this.input, {
      onKartEvent: (racer, e) => this.bonus?.onKartEvent(racer, e),
      // Race events too: item pickups and boss hits are what the gauntlet is
      // scored on, and the toasts for them come from the same handler.
      onRaceEvent: (e) => this.onRaceEvent(e),
    });
    view.setResetKey(this.profile.settings.keybinds.reset);
    this.race = view;
    this.bonus = new BonusRun(def, view);
    this.hud.prepare(view.track);
    this.hud.setVisible(true);
    const touch = isTouchDevice();
    this.touch.setVisible(touch);
    this.hud.setTouchLayout(touch);
    this.hud.prompt(def.tagline, 5);
  }

  private onRaceEvent(e: { kind: string; value: number; racerId: string; text?: string }): void {
    const view = this.race;
    if (!view) return;
    this.bonus?.onRaceEvent(e);
    const player = view.player;
    if (e.kind === 'countdown' && e.value > 0) audio.sfx('countdown');
    if (e.kind === 'go') { audio.sfx('go'); this.hud.toast('GO', 0.9, 'var(--good)'); }
    if (e.racerId !== player.id) return;
    if (e.kind === 'lap') {
      audio.sfx('lap');
      const lapTime = player.progress.lapTimes[player.progress.lapTimes.length - 1];
      this.hud.toast(`LAP ${e.value} — ${formatTime(lapTime)}`, 1.6);
    }
    if (e.kind === 'lastLap') this.hud.toast('FINAL LAP', 1.8, 'var(--warm)');
    if (e.kind === 'item') {
      const it = ITEMS[(e as { text?: string }).text as keyof typeof ITEMS];
      if (it && e.value === 0) { audio.sfx('padHit'); this.hud.toast(`${it.name.toUpperCase()} — press ${prettyKey(this.profile.settings.keybinds.item ?? 'KeyF')}`, 1.6, it.color); }
      if (it && e.value === 1) { audio.sfx(it.kind === 'surge' ? 'boostStart' : it.kind === 'bubble' ? 'checkpoint' : 'hop'); this.hud.toast(it.name.toUpperCase(), 0.9, it.color); }
    }
    if (e.kind === 'itemHit') { audio.sfx('spin'); this.hud.toast('HIT BY A MOON COMET', 1.4, 'var(--warm)'); }
    if (e.kind === 'bossHit') { audio.sfx('hazardHit', 1); this.hud.toast('KILNBANE HIT', 1.0, 'var(--good)'); }
    if (e.kind === 'checkpoint' && e.value >= 0) audio.sfx('checkpoint');
    if (e.kind === 'finish') {
      audio.sfx('finish');
      this.hud.toast('FINISHED — press anything for the results', 2.6, 'var(--good)');
    }
  }

  private finishRace(): void {
    const view = this.race;
    if (!view || this.bonus) return;
    const result = view.core.buildResult();
    const p = this.profile;
    const me = result.entries.find((x) => x.isPlayer)!;
    const rules = MODE_RULES[result.mode];

    // ---- rewards ---------------------------------------------------------
    const purse = [150, 110, 80, 60, 45, 35, 28, 20];
    // A time trial is a field of one, so "finished 1st" means nothing: paying the
    // winner's purse there handed out a 100% win rate and unlocked a podium track
    // without ever passing a rival.
    const contested = result.entries.length > 1;
    const coins = me.dnf ? 10 : contested ? purse[Math.min(purse.length - 1, me.finish - 1)] : 40;
    p.coins += coins;
    p.races++;
    if (contested && me.finish === 1) p.wins++;
    if (contested && me.finish <= 3) p.podiums++;

    let delta = 0;
    let promoted: string | null = null;
    if (rules.ranked && me.integrity.length === 0 && !me.dnf) {
      const before = divisionFor(p.rating).name;
      const ratingBefore = p.rating;
      delta = ratingDelta(p.rating, me.finish, result.entries.length);
      p.rating = Math.max(0, p.rating + delta);
      const after = divisionFor(p.rating).name;
      // Only upwards. This used to announce "Promoted to Scrap" after a demotion.
      if (after !== before && p.rating > ratingBefore) promoted = after;
    }

    const improved = submitRecord(p, result.trackId, me.bestLap, me.dnf ? 0 : me.totalTime, me.axieId, me.kartId);

    // ---- unlocks ---------------------------------------------------------
    const unlocked: string[] = [];
    for (const t of TRACKS) {
      if (p.unlockedTracks.includes(t.id) || !t.unlock) continue;
      const ok = t.unlock.kind === 'podium' ? (contested && me.finish <= 3) : p.rating >= t.unlock.value;
      if (ok) { p.unlockedTracks.push(t.id); unlocked.push(t.name); }
    }
    this.save();

    view.startCinematic();
    const params: ResultsParams = {
      result, ratingDelta: delta, coins, improved, unlocked, promoted,
    };
    // Let the finish play out for a moment before the screen appears — but the
    // wait is skippable, because it used to stack a fixed 1.8s on top of the
    // tail and a key press could not touch it.
    this.showResults = () => {
      this.showResults = null;
      if (this.resultsTimer !== null) { window.clearTimeout(this.resultsTimer); this.resultsTimer = null; }
      if (this.race === view) this.go('results', params as unknown as Record<string, unknown>);
    };
    this.resultsTimer = window.setTimeout(() => this.showResults?.(), 1200);
  }

  private finishBonus(): void {
    const run = this.bonus;
    const view = this.race;   // captured so the navigation timer below can check it is still the live one
    if (!run || !view || !run.result) return;
    const p = this.profile;
    const def = run.def;
    const score = run.result;
    const isBest = score.valid && submitBonus(p, def.id, score.score, score.medal, def.higherIsBetter);
    const coins = !score.valid ? 5
      : score.medal === 'gold' ? 120 : score.medal === 'silver' ? 80 : score.medal === 'bronze' ? 50 : 25;
    p.coins += coins;
    this.save();
    if (score.medal !== 'none') audio.sfx('medal');

    const params: BonusResultParams = { eventId: def.id, score, isBest, coins };
    this.bonus = null;
    window.setTimeout(() => {
      // Quit to the menu inside this window and the timer used to throw the
      // player back onto a bonus-results screen from Home.
      if (this.race === view) this.go('bonusResults', params as unknown as Record<string, unknown>);
    }, 1400);
    void medalFor;
  }

  private endRace(): void {
    if (this.resultsTimer !== null) { window.clearTimeout(this.resultsTimer); this.resultsTimer = null; }
    this.showResults = null;
    if (this.pause) { this.pause.remove(); this.pause = null; }
    this.race?.dispose();
    this.race = null;
    this.bonus = null;
    this.hud.setVisible(false);
    this.touch.setVisible(false);
  }

  private togglePause(force?: boolean): void {
    if (!this.race) return;
    const want = force ?? !this.pause;
    if (want && !this.pause) {
      this.race.paused = true;
      this.input.uiCaptured = true;
      this.pause = pauseOverlay(this,
        () => this.togglePause(false),
        () => {
          const setup = this.race!.setup;
          if (this.bonus) this.startBonus(this.bonus.def.id);
          else this.startRace(setup.mode, setup.trackId);
        },
        () => this.go('home'),
      );
      document.getElementById('app')!.appendChild(this.pause);
    } else if (!want && this.pause) {
      this.pause.remove();
      this.pause = null;
      this.race.paused = false;
      this.input.uiCaptured = false;
      this.input.clearPresses();
    }
  }

  /** Read-only view of the running race, for tooling. */
  get debugRace(): RaceView | null {
    return this.race;
  }

  /** A compact snapshot of what the app is doing right now. */
  debugState(): Record<string, unknown> {
    const r = this.race;
    const p = r?.player;
    return {
      screen: this.current,
      paused: !!this.pause,
      fps: this.fpsMeter.toFixed(1),
      race: r ? {
        track: r.setup.trackId,
        mode: r.setup.mode,
        phase: r.core.phase,
        time: +r.core.time.toFixed(2),
        racers: r.core.racers.length,
        player: p ? {
          pos: p.progress.position,
          lap: p.progress.lap,
          raw: +p.progress.raw.toFixed(3),
          speed: +p.kart.speed.toFixed(1),
          mode: p.kart.mode,
          grounded: p.kart.grounded,
          y: +p.kart.pos.y.toFixed(2),
          groundY: +p.ground.height.toFixed(2),
          outside: +p.ground.outside.toFixed(2),
          surface: p.ground.surface,
        } : null,
      } : null,
    };
  }

  private fpsMeter = 0;
  private pointerPressed = false;
  /** Set while the short pause between the flag and the results screen runs. */
  private showResults: (() => void) | null = null;
  private resultsTimer: number | null = null;

  /** Advance the game by `seconds` of simulated frames, without waiting on the
   *  display. Used by the screenshot and smoke-test tooling, which runs in a
   *  background tab where requestAnimationFrame is throttled to nothing. */
  debugStep(seconds: number, fps = 60): void {
    const dt = 1 / fps;
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) this.tick(dt);
  }

  /** Hold a key for a while, stepping the game as it is held. */
  debugPress(code: string, seconds: number): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    this.debugStep(seconds);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  // ---- frame -------------------------------------------------------------

  private frame(now: number): void {
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.25) : 1 / 60;
    this.lastFrame = now;
    try {
      this.tick(dt);
    } catch (err) {
      // One bad frame must not end the session. Without this the throw escapes
      // before requestAnimationFrame is called again and the game silently
      // freezes with no way back.
      this.onFrameError(err as Error);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private frameErrors = 0;
  private bailedOut = false;
  private onFrameError(err: Error): void {
    this.frameErrors++;
    console.error('[Luna Prix] frame error', err);
    if (this.frameErrors === 1) {
      this.hud.toast('Something went wrong — returning to the menu', 3);
    }
    if (this.frameErrors >= 3 && !this.bailedOut) {
      // Repeated failures mean the race state is not recoverable. Bail out to
      // the menu ONCE — resetting the counter here used to rebuild the home
      // screen about twenty times a second with no way out.
      this.bailedOut = true;
      try { this.go('home'); } catch { /* last resort: leave the menu alone */ }
    }
  }

  private tick(dt: number): void {
    this.fpsMeter = this.fpsMeter * 0.92 + (1 / Math.max(1e-4, dt)) * 0.08;

    if (this.race) {
      if (this.input.consumePress(this.profile.settings.keybinds.pause)) this.togglePause();
      if (this.race.core.canSkipTail && this.pointerPressed) this.race.skipRequested = true;
      // Once the flag is out, anything at all brings the results up now.
      if (this.showResults && (this.pointerPressed || this.input.consumeAnyPress())) this.showResults();
      this.pointerPressed = false;
      if (!this.pause) {
        this.race.update(dt);
        this.hud.update(
          this.race.core, this.race.player, dt,
          this.input.device, this.profile.settings.keybinds,
        );
        if (this.bonus) {
          this.bonus.update(dt);
          this.hud.toastLive(this.bonus.live);
          if (this.bonus.finished) this.finishBonus();
        }
        this.watchFrameTime(dt);
      } else {
        this.ctx.render();
      }
    } else if (this.showcaseView.active) {
      this.showcaseView.update(dt);
    } else {
      this.ctx.renderer.clear();
    }
  }
}

function boot(): void {
  try {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl2') ?? test.getContext('webgl');
    if (!gl) throw new Error('WebGL is not available');
    new App();
  } catch (err) {
    const note = document.getElementById('loading-note');
    if (note) {
      note.textContent = `Could not start: ${(err as Error).message}. Luna Prix needs WebGL.`;
      note.style.color = '#ff6b5e';
    }
    console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { el, trackById };
