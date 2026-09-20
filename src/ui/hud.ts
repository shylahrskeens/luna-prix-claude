/** The race HUD.
 *
 *  Priority order, top to bottom: where am I, how much race is left, what is
 *  my boost doing, what is about to happen. Everything else is secondary and
 *  gets out of the way. The minimap is drawn to a canvas from the same spline
 *  the physics uses, so it cannot disagree with the track.
 */
import { el, clear, mount } from './dom';
import { formatTime, clamp01, wrap } from '../core/math';
import { DRIFT_TIERS, TIER_COLOR } from '../sim/kart';
import type { RaceCore, Racer } from '../sim/race';
import type { TrackRuntime } from '../sim/track';
import { controlCard, type Device } from './input';

export interface HudOptions {
  hudScale: number;
  highContrast: boolean;
  showPrompts: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private posEl: HTMLElement;
  private lapEl: HTMLElement;
  private timeEl: HTMLElement;
  private splitEl: HTMLElement;
  private speedEl: HTMLElement;
  private boostFill: HTMLElement;
  private boostLabel: HTMLElement;
  private centre: HTMLElement;
  private warnEl: HTMLElement;
  private sectorEl: HTMLElement;
  private routeEl: HTMLElement;
  private promptEl: HTMLElement;
  private minimap: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private toastTimer = 0;
  private toastNode: HTMLElement | null = null;
  private trackPath: { x: number; y: number }[] = [];
  private branchPaths: { x: number; y: number }[][] = [];
  private bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  private opts: HudOptions;
  private promptUntil = 0;

  constructor(opts: HudOptions) {
    this.opts = opts;
    this.posEl = el('div', { class: 'pos-big' });
    this.lapEl = el('div', { class: 'lap-big' });
    this.timeEl = el('div', { class: 'mono', style: 'font-size:22px;font-weight:700' });
    this.splitEl = el('div', { class: 'mono', style: 'font-size:13px;color:var(--muted);margin-top:2px' });
    this.speedEl = el('div', { class: 'speed-big' });
    this.boostFill = el('div', { class: 'boost-fill' });
    this.boostLabel = el('div', { class: 'hint', style: 'margin-top:4px' });
    this.centre = el('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:9vh;text-align:center' });
    this.warnEl = el('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:10px' });
    this.sectorEl = el('div', { class: 'hint', style: 'letter-spacing:0.12em;text-transform:uppercase' });
    this.routeEl = el('div', { style: 'margin-top:8px' });
    this.promptEl = el('div', { class: 'hint', style: 'margin-top:6px;max-width:260px' });

    this.minimap = el('canvas', { id: 'minimap', width: 190, height: 190 });
    this.mctx = this.minimap.getContext('2d')!;

    const boost = el('div', { class: 'boost-meter' },
      this.boostFill,
      el('div', { class: 'boost-ticks' }, el('i'), el('i'), el('i')),
    );

    this.root = el('div', { id: 'hud', class: 'layer' },
      el('div', { class: 'hud-tl' },
        el('div', { class: 'hud-box' },
          this.posEl,
          el('div', { style: 'margin-top:6px' }, this.lapEl),
        ),
        el('div', { class: 'hud-box', style: 'margin-top:8px' }, this.sectorEl),
        this.routeEl,
        this.promptEl,
      ),
      el('div', { class: 'hud-tr' },
        el('div', { class: 'hud-box' }, this.timeEl, this.splitEl),
        el('div', { style: 'margin-top:8px' }, this.minimap),
      ),
      el('div', { class: 'hud-br' },
        el('div', { class: 'hud-box' },
          this.speedEl,
          el('div', { style: 'margin-top:8px' }, boost),
          this.boostLabel,
        ),
      ),
      el('div', { class: 'hud-c' }, this.centre, this.warnEl),
    );
    this.setScale(opts.hudScale);
  }

  setScale(v: number): void {
    this.root.style.setProperty('--hud-scale', String(v));
  }
  setOptions(o: Partial<HudOptions>): void {
    this.opts = { ...this.opts, ...o };
    if (o.hudScale) this.setScale(o.hudScale);
  }

  /** Pre-compute the minimap outline once per track. */
  prepare(track: TrackRuntime): void {
    this.trackPath = [];
    track.main.forEachSample((i, p) => {
      if (i % 3 === 0) this.trackPath.push({ x: p.x, y: p.z });
    });
    this.branchPaths = [];
    for (const [, b] of track.branches) {
      const pts: { x: number; y: number }[] = [];
      b.spline.forEachSample((i, p) => { if (i % 3 === 0) pts.push({ x: p.x, y: p.z }); });
      this.branchPaths.push(pts);
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.trackPath) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }

  private mapPoint(x: number, y: number): [number, number] {
    const b = this.bounds;
    const w = this.minimap.width, h = this.minimap.height;
    //  Mirror X to match what the player is looking at.
    //
    //  The chase camera looks along +Z, which puts world +X on the LEFT of the
    //  screen. A minimap that draws +X to the right is therefore a mirror of
    //  the view: the dot slides left when the kart goes right, and the whole
    //  track is handed the wrong way. The only reference a player has is the
    //  3D view, so the map has to agree with it.
    const sx = 1 - (x - b.minX) / (b.maxX - b.minX);
    const sy = (y - b.minY) / (b.maxY - b.minY);
    const scale = Math.min(w, h);
    const ox = (w - scale) / 2, oy = (h - scale) / 2;
    return [ox + sx * scale, oy + sy * scale];
  }

  private drawMinimap(core: RaceCore, player: Racer): void {
    const c = this.mctx;
    const w = this.minimap.width, h = this.minimap.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(10,12,18,0.60)';
    c.beginPath();
    c.roundRect(0, 0, w, h, 12);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.stroke();

    const line = (pts: { x: number; y: number }[], style: string, width: number, close: boolean) => {
      if (pts.length < 2) return;
      c.beginPath();
      const [x0, y0] = this.mapPoint(pts[0].x, pts[0].y);
      c.moveTo(x0, y0);
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = this.mapPoint(pts[i].x, pts[i].y);
        c.lineTo(x, y);
      }
      if (close) c.closePath();
      c.strokeStyle = style;
      c.lineWidth = width;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke();
    };
    line(this.trackPath, 'rgba(255,255,255,0.26)', 7, true);
    line(this.trackPath, 'rgba(255,255,255,0.55)', 2.5, true);
    for (const b of this.branchPaths) line(b, 'rgba(199,155,255,0.75)', 2.2, false);

    // Rivals first, player last, so the player dot is never hidden.
    for (const r of core.racers) {
      if (r === player) continue;
      const [x, y] = this.mapPoint(r.kart.pos.x, r.kart.pos.z);
      c.beginPath();
      c.arc(x, y, 3.4, 0, Math.PI * 2);
      c.fillStyle = this.opts.highContrast ? '#ffffff' : '#ff9d5c';
      c.fill();
    }
    const [px, py] = this.mapPoint(player.kart.pos.x, player.kart.pos.z);
    c.save();
    c.translate(px, py);
    c.rotate(Math.atan2(player.kart.pos.x - px, 0) * 0);
    c.beginPath();
    c.arc(0, 0, 5.4, 0, Math.PI * 2);
    c.fillStyle = '#c79bff';
    c.fill();
    c.strokeStyle = '#0a0c12';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
  }

  /** Per-frame update. */
  update(core: RaceCore, player: Racer, dt: number, device: Device, binds: Record<string, string>): void {
    const k = player.kart;
    const p = player.progress;
    const n = core.racers.length;

    this.posEl.innerHTML = `${p.position}<span class="of">/${n}</span>`;
    const lap = Math.min(core.cfg.laps, Math.max(1, p.lap + 1));
    this.lapEl.innerHTML = `LAP ${lap}<span class="of" style="font-size:15px;color:var(--muted)">/${core.cfg.laps}</span>`;

    const t = Math.max(0, core.time);
    this.timeEl.textContent = formatTime(t);
    const best = isFinite(p.bestLap) ? `BEST ${formatTime(p.bestLap)}` : 'BEST --:--.---';
    const gap = p.position > 1 ? `  ▲ ${p.gapAhead.toFixed(0)} m` : '';
    this.splitEl.textContent = best + gap;

    this.speedEl.innerHTML = `${Math.round(k.speed * 3.6)}<span class="unit">km/h</span>`;

    // Boost meter: drift charge while drifting, remaining boost while boosting.
    if (k.boosting) {
      const frac = clamp01(k.boostTime / Math.max(0.2, k.h.boostDuration * 2.2));
      this.boostFill.style.width = `${frac * 100}%`;
      this.boostFill.style.background = TIER_COLOR[Math.min(3, k.boostTier)];
      this.boostLabel.textContent = 'BOOST';
      this.boostLabel.style.color = TIER_COLOR[Math.min(3, k.boostTier)];
    } else {
      const frac = clamp01(k.driftCharge / DRIFT_TIERS[2]);
      this.boostFill.style.width = `${frac * 100}%`;
      this.boostFill.style.background = TIER_COLOR[Math.min(3, k.driftTier)];
      this.boostLabel.textContent = k.drifting
        ? (k.driftTier === 0 ? 'CHARGING' : `TIER ${k.driftTier} — RELEASE`)
        : 'DRIFT TO CHARGE';
      this.boostLabel.style.color = k.driftTier > 0 ? TIER_COLOR[k.driftTier] : 'var(--muted)';
    }

    this.sectorEl.textContent = core.track.zoneAt(player.ground.u)?.label ?? core.track.def.name;

    // Route choice cue, shown only while a split is actually approaching.
    clear(this.routeEl);
    for (const [, b] of core.track.branches) {
      const dist = wrap(b.def.inS - player.ground.u, 1) * core.track.lapLength;
      if (dist > 130 || dist < -12) continue;
      const delta = core.track.branchDelta(b.def.id);
      const tag = b.def.flavor === 'shorter-risky'
        ? `${Math.abs(delta).toFixed(0)} m shorter`
        : b.def.flavor === 'longer-faster' ? `${delta.toFixed(0)} m longer, two pads` : 'safer';
      this.routeEl.appendChild(el('div', { class: 'hud-box', style: 'margin-top:6px;max-width:230px' },
        el('div', { style: 'font-weight:700;font-size:13px;color:var(--accent)', text: b.def.name.toUpperCase() }),
        el('div', { class: 'hint', text: `${tag} · ${dist.toFixed(0)} m` }),
      ));
    }

    // Warnings.
    clear(this.warnEl);
    if (k.wrongWay) this.warnEl.appendChild(el('div', { class: 'warn-strip', text: 'WRONG WAY' }));
    if (player.ground.outside > 0.5 && k.mode === 'driving') {
      this.warnEl.appendChild(el('div', { class: 'warn-strip', text: 'OFF TRACK' }));
    }
    if (k.mode === 'respawning') {
      this.warnEl.appendChild(el('div', { class: 'toast', text: 'RECOVERING' }));
    }

    // Countdown and toasts.
    clear(this.centre);
    if (core.phase === 'countdown') {
      const secs = Math.ceil(-core.time);
      this.centre.appendChild(el('div', { class: 'countdown', text: secs > 0 ? String(secs) : 'GO' }));
      if (k.launchCharge > 0) {
        const good = k.launchCharge <= 0.55;
        this.centre.appendChild(el('div', {
          class: 'hud-box',
          style: `color:${good ? 'var(--good)' : 'var(--bad)'};font-weight:700;letter-spacing:0.08em`,
          text: good ? 'HOLDING THE LAUNCH' : 'TOO EARLY — EASE OFF',
        }));
      } else if (this.opts.showPrompts) {
        this.centre.appendChild(el('div', { class: 'hud-box hint', style: 'max-width:320px', text: 'Hold accelerate just before the lights go out for a start boost' }));
      }
    } else if (this.toastNode && this.toastTimer > 0) {
      this.toastTimer -= dt;
      this.centre.appendChild(this.toastNode);
      if (this.toastTimer <= 0) this.toastNode = null;
    }

    // Contextual teaching prompts, which stop once the player has done the thing.
    clear(this.promptEl);
    if (this.opts.showPrompts && performance.now() < this.promptUntil && this.promptText) {
      this.promptEl.appendChild(el('div', { class: 'hud-box', text: this.promptText }));
    }
    void controlCard(device, binds);

    this.drawMinimap(core, player);
  }

  private promptText = '';
  /** Show a teaching line for a few seconds. */
  prompt(text: string, seconds = 4): void {
    this.promptText = text;
    this.promptUntil = performance.now() + seconds * 1000;
  }

  /** Bonus-event live readout: the big number, a sub-line and a coaching hint.
   *  Replaces the lap/position block, which a solo event has no use for. */
  toastLive(live: { primary: string; secondary: string; hint: string }): void {
    this.posEl.textContent = live.primary;
    this.posEl.style.fontSize = '34px';
    this.lapEl.textContent = live.secondary;
    this.lapEl.style.fontSize = '14px';
    this.lapEl.style.color = 'var(--muted)';
    this.sectorEl.textContent = live.hint;
  }

  toast(text: string, seconds = 1.6, color?: string): void {
    this.toastNode = el('div', { class: 'toast', text, style: color ? `color:${color}` : '' });
    this.toastTimer = seconds;
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('active', on);
  }

  /** Touch controls occupy the bottom of the screen; the HUD gets out of
   *  their way rather than sitting underneath a thumb. */
  setTouchLayout(on: boolean): void {
    this.root.classList.toggle('with-touch', on);
  }

  /** The control card, shown before the first race. */
  static controlCardPanel(device: Device, binds: Record<string, string>): HTMLElement {
    const rows = controlCard(device, binds);
    return el('div', { class: 'panel' },
      el('h3', { text: 'Controls' }),
      el('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:2px' },
        ...rows.map((r) => el('div', { class: 'kv' },
          el('span', { class: 'v mono', style: 'color:var(--accent-2);font-weight:700', text: r.key }),
          el('span', { class: 'k', text: r.label }),
        )),
      ),
    );
  }
}

export { mount };
