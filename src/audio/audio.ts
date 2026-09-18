/** Audio engine.
 *
 *  Everything is synthesised at runtime: no sample files to download, no
 *  licensing questions, and the engine note can follow load and RPM
 *  continuously instead of crossfading between clips. Four independent buses
 *  (music, SFX, engine, ambience) so the mix is controllable and a warning cue
 *  is never buried by the music.
 */
import { clamp, clamp01, lerp } from '../core/math';

export interface MixSettings {
  master: number;
  music: number;
  sfx: number;
  engine: number;
  ambience: number;
}
export const DEFAULT_MIX: MixSettings = { master: 0.8, music: 0.5, sfx: 0.85, engine: 0.7, ambience: 0.55 };

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // Slightly brown noise: less harsh than white for tyre and wind beds.
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private busMusic!: GainNode;
  private busSfx!: GainNode;
  private busEngine!: GainNode;
  private busAmb!: GainNode;
  private noise!: AudioBuffer;
  private started = false;
  mix: MixSettings = { ...DEFAULT_MIX };
  muted = false;

  // engine voices
  private engOscA: OscillatorNode | null = null;
  private engOscB: OscillatorNode | null = null;
  private engSub: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;

  // continuous beds
  private tyreSrc: AudioBufferSourceNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;
  private tyreGain: GainNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private driftSrc: AudioBufferSourceNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;

  // music
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicKey: number[] = [0, 3, 5, 7, 10];
  private musicRoot = 110;
  private musicIntensity = 0;

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = this.mix.master;
    // A limiter keeps a stack of impacts from clipping the whole mix.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp).connect(ctx.destination);

    const bus = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.master);
      return g;
    };
    this.busMusic = bus(this.mix.music);
    this.busSfx = bus(this.mix.sfx);
    this.busEngine = bus(this.mix.engine);
    this.busAmb = bus(this.mix.ambience);

    this.started = true;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  get ready(): boolean {
    return this.started && this.ctx !== null;
  }

  applyMix(m: Partial<MixSettings>): void {
    this.mix = { ...this.mix, ...m };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.mix.master, t, 0.05);
    this.busMusic.gain.setTargetAtTime(this.mix.music, t, 0.05);
    this.busSfx.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.busEngine.gain.setTargetAtTime(this.mix.engine, t, 0.05);
    this.busAmb.gain.setTargetAtTime(this.mix.ambience, t, 0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMix({});
  }

  // ---- race audio ---------------------------------------------------------

  startRace(theme: 'canopy' | 'ruin' | 'cloud'): void {
    if (!this.ctx) return;
    this.stopRace();
    const ctx = this.ctx;

    // Engine: two detuned saws plus a sub, through a moving low-pass. The
    // filter is what makes the difference between "on throttle" and "coasting"
    // audible without a second sample set.
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;
    this.engFilter.Q.value = 3.5;
    this.engGain.connect(this.engFilter).connect(this.busEngine);

    this.engOscA = ctx.createOscillator();
    this.engOscA.type = 'sawtooth';
    this.engOscB = ctx.createOscillator();
    this.engOscB.type = 'square';
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'triangle';
    const gA = ctx.createGain(); gA.gain.value = 0.55;
    const gB = ctx.createGain(); gB.gain.value = 0.22;
    const gS = ctx.createGain(); gS.gain.value = 0.42;
    this.engOscA.connect(gA).connect(this.engGain);
    this.engOscB.connect(gB).connect(this.engGain);
    this.engSub.connect(gS).connect(this.engGain);
    this.engOscA.start(); this.engOscB.start(); this.engSub.start();

    // Tyre / surface bed.
    this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0;
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 900;
    this.tyreFilter.Q.value = 0.9;
    this.tyreSrc = ctx.createBufferSource();
    this.tyreSrc.buffer = this.noise;
    this.tyreSrc.loop = true;
    this.tyreSrc.connect(this.tyreFilter).connect(this.tyreGain).connect(this.busAmb);
    this.tyreSrc.start();

    // Wind.
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = 600;
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noise;
    this.windSrc.loop = true;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.busAmb);
    this.windSrc.start();

    // Drift scrub.
    this.driftGain = ctx.createGain(); this.driftGain.gain.value = 0;
    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 2200;
    this.driftFilter.Q.value = 4;
    this.driftSrc = ctx.createBufferSource();
    this.driftSrc.buffer = this.noise;
    this.driftSrc.loop = true;
    this.driftSrc.connect(this.driftFilter).connect(this.driftGain).connect(this.busSfx);
    this.driftSrc.start();

    this.musicRoot = theme === 'canopy' ? 110 : theme === 'ruin' ? 98 : 123.47;
    this.musicKey = theme === 'ruin' ? [0, 2, 3, 7, 8] : theme === 'cloud' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
    this.startMusic();
  }

  stopRace(): void {
    for (const n of [this.engOscA, this.engOscB, this.engSub, this.tyreSrc, this.windSrc, this.driftSrc]) {
      try { n?.stop(); } catch { /* already stopped */ }
    }
    this.engOscA = this.engOscB = this.engSub = null;
    this.tyreSrc = this.windSrc = this.driftSrc = null;
    this.engGain = this.tyreGain = this.windGain = this.driftGain = null;
    this.stopMusic();
  }

  /** Per-frame engine and bed update. */
  drive(s: {
    speed: number; topSpeed: number; throttle: number; grounded: boolean;
    surfaceRough: number; drifting: boolean; driftTier: number; boosting: boolean;
    offRoad: boolean; covered: boolean;
  }): void {
    if (!this.ctx || !this.engOscA) return;
    const t = this.ctx.currentTime;
    const rpm = clamp01(s.speed / Math.max(8, s.topSpeed));
    // Gear steps give the note somewhere to go instead of a single long ramp.
    const gear = Math.min(4, Math.floor(rpm * 5));
    const inGear = (rpm * 5) - gear;
    const base = this.engOscA.frequency.value;
    const target = 52 + gear * 14 + inGear * 78 + (s.boosting ? 26 : 0);
    const smooth = lerp(base, target, 0.25);
    this.engOscA!.frequency.setTargetAtTime(smooth, t, 0.03);
    this.engOscB!.frequency.setTargetAtTime(smooth * 1.505, t, 0.03);
    this.engSub!.frequency.setTargetAtTime(smooth * 0.5, t, 0.04);
    this.engFilter!.frequency.setTargetAtTime(
      420 + rpm * 2600 + s.throttle * 900 + (s.boosting ? 1400 : 0), t, 0.05,
    );
    this.engGain!.gain.setTargetAtTime(
      (0.12 + rpm * 0.16 + s.throttle * 0.07) * (s.grounded ? 1 : 0.55), t, 0.06,
    );

    this.tyreFilter!.frequency.setTargetAtTime(500 + rpm * 1400 + s.surfaceRough * 900, t, 0.08);
    this.tyreGain!.gain.setTargetAtTime(
      s.grounded ? (0.03 + rpm * 0.10) * (0.5 + s.surfaceRough * 1.6) : 0, t, 0.08,
    );

    this.windFilter!.frequency.setTargetAtTime(s.covered ? 300 : 900, t, 0.2);
    this.windGain!.gain.setTargetAtTime(rpm * rpm * 0.12, t, 0.12);

    const driftLevel = s.drifting ? 0.09 + s.driftTier * 0.035 : 0;
    this.driftFilter!.frequency.setTargetAtTime(1700 + s.driftTier * 900, t, 0.06);
    this.driftGain!.gain.setTargetAtTime(driftLevel, t, 0.05);

    this.musicIntensity = rpm;
  }

  // ---- one-shots ----------------------------------------------------------

  private env(dest: AudioNode, attack: number, decay: number, peak: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private tone(freq: number, type: OscillatorType, attack: number, decay: number, peak: number, bend = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, ctx.currentTime + attack + decay);
    o.connect(this.env(this.busSfx, attack, decay, peak));
    o.start();
    o.stop(ctx.currentTime + attack + decay + 0.05);
  }

  private burst(filterType: BiquadFilterType, freq: number, decay: number, peak: number, q = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.Q.value = q;
    src.connect(f).connect(this.env(this.busSfx, 0.004, decay, peak));
    src.start();
    src.stop(ctx.currentTime + decay + 0.1);
  }

  sfx(kind: string, value = 1): void {
    if (!this.ctx) return;
    switch (kind) {
      case 'hop': this.tone(520, 'square', 0.005, 0.10, 0.10, 1.7); break;
      case 'driftTier': this.tone(360 + value * 180, 'triangle', 0.005, 0.16, 0.13, 1.5); break;
      case 'boostStart': {
        this.burst('bandpass', 700, 0.45, 0.30, 0.7);
        this.tone(140, 'sawtooth', 0.01, 0.40, 0.16, 3.2);
        break;
      }
      case 'padHit': this.tone(280, 'square', 0.005, 0.22, 0.12, 2.6); break;
      case 'land': this.burst('lowpass', 420, 0.18, 0.22 * value, 1); break;
      case 'hardLand': this.burst('lowpass', 200, 0.32, 0.40, 1.4); break;
      case 'wallHit': this.burst('bandpass', 260 + value * 400, 0.16, 0.16 + value * 0.25, 1.6); break;
      case 'hazardHit': this.burst('bandpass', 180, 0.28, 0.20 + value * 0.3, 1.2); break;
      case 'spin': this.tone(220, 'sawtooth', 0.01, 0.55, 0.16, 0.35); break;
      case 'respawnStart': this.tone(600, 'sine', 0.01, 0.35, 0.12, 0.4); break;
      case 'respawnEnd': this.tone(420, 'sine', 0.01, 0.20, 0.12, 1.8); break;
      case 'trickComplete': {
        this.tone(660, 'triangle', 0.005, 0.12, 0.13, 1.6);
        window.setTimeout(() => this.tone(990, 'triangle', 0.005, 0.16, 0.11, 1.4), 90);
        break;
      }
      case 'trickFail': this.tone(180, 'square', 0.005, 0.22, 0.12, 0.5); break;
      case 'checkpoint': this.tone(880, 'sine', 0.003, 0.09, 0.07, 1.0); break;
      case 'lap': {
        this.tone(660, 'triangle', 0.005, 0.14, 0.14, 1.0);
        window.setTimeout(() => this.tone(880, 'triangle', 0.005, 0.20, 0.13, 1.0), 110);
        break;
      }
      case 'countdown': this.tone(440, 'square', 0.005, 0.20, 0.18); break;
      case 'go': {
        this.tone(880, 'square', 0.005, 0.45, 0.22, 1.0);
        this.burst('highpass', 2000, 0.4, 0.2);
        break;
      }
      case 'finish': {
        [523, 659, 784, 1047].forEach((f, i) =>
          window.setTimeout(() => this.tone(f, 'triangle', 0.005, 0.30, 0.15), i * 110));
        break;
      }
      case 'uiMove': this.tone(720, 'sine', 0.003, 0.05, 0.05); break;
      case 'uiSelect': this.tone(960, 'triangle', 0.003, 0.09, 0.08, 1.3); break;
      case 'uiBack': this.tone(380, 'sine', 0.003, 0.09, 0.07, 0.8); break;
      case 'uiBuy': {
        this.tone(700, 'triangle', 0.004, 0.10, 0.10, 1.2);
        window.setTimeout(() => this.tone(1050, 'triangle', 0.004, 0.16, 0.09, 1.1), 90);
        break;
      }
      case 'uiDenied': this.tone(200, 'square', 0.004, 0.16, 0.10, 0.7); break;
      case 'warn': this.tone(320, 'square', 0.004, 0.12, 0.13, 0.85); break;
      case 'medal': {
        [784, 988, 1175].forEach((f, i) =>
          window.setTimeout(() => this.tone(f, 'sine', 0.005, 0.28, 0.13), i * 90));
        break;
      }
    }
  }

  /** Short vocal-ish chirp for an Axie reaction. */
  axieChirp(pitch: number, happy: boolean): void {
    if (!this.ctx) return;
    const f = 380 * pitch;
    this.tone(f, 'triangle', 0.006, 0.12, 0.09, happy ? 1.5 : 0.65);
  }

  // ---- music --------------------------------------------------------------

  private startMusic(): void {
    if (!this.ctx) return;
    this.musicStep = 0;
    const tick = () => {
      if (!this.ctx) return;
      const step = this.musicStep++;
      const intensity = clamp01(this.musicIntensity);
      // The bed is always there; the top voice only arrives at speed, so the
      // music lifts when the driving does without a crossfade.
      const deg = this.musicKey[step % this.musicKey.length];
      const oct = step % 8 < 4 ? 1 : 2;
      const freq = this.musicRoot * Math.pow(2, deg / 12) * oct;
      if (step % 2 === 0) this.musicNote(this.musicRoot / 2, 'triangle', 0.45, 0.06);
      this.musicNote(freq, 'square', 0.22, 0.020 + intensity * 0.022);
      if (intensity > 0.55 && step % 4 === 2) {
        this.musicNote(freq * 2, 'triangle', 0.16, 0.016);
      }
      this.musicTimer = window.setTimeout(tick, 250 - intensity * 40);
    };
    tick();
  }

  private musicNote(freq: number, type: OscillatorType, decay: number, peak: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    o.connect(g).connect(f).connect(this.busMusic);
    o.start();
    o.stop(t + decay + 0.05);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  /** Menu ambience: a slow pad, no percussion. */
  menuMusic(on: boolean): void {
    if (!this.ctx) return;
    if (on && this.musicTimer === null) {
      this.musicIntensity = 0;
      this.musicRoot = 98;
      this.musicKey = [0, 3, 7, 10, 7, 3];
      this.startMusic();
    } else if (!on) {
      this.stopMusic();
    }
  }

  dispose(): void {
    this.stopRace();
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

export const audio = new AudioEngine();
export { clamp };
