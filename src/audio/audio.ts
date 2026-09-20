/** Audio engine.
 *
 *  Everything is synthesised at runtime: no sample files to download, no
 *  licensing questions, and the engine note can follow load and RPM
 *  continuously instead of crossfading between clips. Four independent buses
 *  (music, SFX, engine, ambience) so the mix is controllable and a warning cue
 *  is never buried by the music.
 */
import { clamp, clamp01 } from '../core/math';

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

  //  Engine voice.
  //
  //  Modelled the way the sound is actually made: combustion produces a train
  //  of sharp pulses, and the exhaust pipe is a resonator those pulses ring.
  //  Two oscillators carrying a near-flat harmonic series ARE the pulse train
  //  (a flat spectrum in frequency is an impulse in time); the resonators give
  //  it the vowel. Two detuned voices beat against each other the way real
  //  cylinders never quite agree.
  //
  //  The previous version was a sawtooth and a square through one low-pass,
  //  which is a continuous tone with its harmonics removed — a hum.
  private engOscA: OscillatorNode | null = null;
  private engOscB: OscillatorNode | null = null;
  private engSub: OscillatorNode | null = null;
  /** Exhaust pipe: high-Q, tracks the firing rate. */
  private engPipe: BiquadFilterNode | null = null;
  /** Fixed body resonance — the part that does not move with revs. */
  private engBody: BiquadFilterNode | null = null;
  /** Load/brightness. */
  private engTone: BiquadFilterNode | null = null;
  /** Clears the sub-bass mud that reads as a hum. */
  private engHigh: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  private engDrive: WaveShaperNode | null = null;
  /** Induction roar: noise gated by the same rev band. */
  private engAir: AudioBufferSourceNode | null = null;
  private engAirFilter: BiquadFilterNode | null = null;
  private engAirGain: GainNode | null = null;
  /** Turbine whine while boosting. */
  private boostWhine: OscillatorNode | null = null;
  private boostWhineGain: GainNode | null = null;
  /** Cycle-to-cycle wobble, so the note is never perfectly steady. */
  private engJitter = 0;
  private engJitterTarget = 0;
  private engPulse: PeriodicWave | null = null;

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

    // ---- engine ----------------------------------------------------------
    //  Signal path:
    //    pulse oscillators -> soft clip -> pipe resonance -> body resonance
    //                      -> load low-pass -> gain -> bus
    //  plus an induction-noise path in parallel.
    this.engPulse = this.makePulseWave(ctx);

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    this.engTone = ctx.createBiquadFilter();
    this.engTone.type = 'lowpass';
    this.engTone.frequency.value = 2400;
    this.engTone.Q.value = 0.8;

    this.engBody = ctx.createBiquadFilter();
    this.engBody.type = 'peaking';
    this.engBody.frequency.value = 340;
    this.engBody.Q.value = 1.4;
    this.engBody.gain.value = 3.5;

    //  Clear the sub-bass.
    //
    //  Measured, the old engine put 12 dB more energy below 100 Hz than
    //  anywhere else — which is the definition of a hum. Almost none of what
    //  makes an engine recognisable lives down there; it lives in the harmonic
    //  series above it, and the mud was masking all of it.
    this.engHigh = ctx.createBiquadFilter();
    this.engHigh.type = 'highpass';
    this.engHigh.frequency.value = 72;
    this.engHigh.Q.value = 0.7;

    this.engPipe = ctx.createBiquadFilter();
    this.engPipe.type = 'bandpass';
    this.engPipe.frequency.value = 520;
    this.engPipe.Q.value = 3.2;

    this.engDrive = ctx.createWaveShaper();
    this.engDrive.curve = this.makeDriveCurve(3.4);
    this.engDrive.oversample = '2x';

    // Keep a little of the dry pulse alongside the resonated signal, or the
    // bandpass leaves nothing but the vowel and no edge.
    const dry = ctx.createGain(); dry.gain.value = 0.52;
    const wet = ctx.createGain(); wet.gain.value = 1.0;

    this.engDrive.connect(this.engPipe).connect(wet).connect(this.engBody);
    this.engDrive.connect(dry).connect(this.engBody);
    this.engBody.connect(this.engHigh).connect(this.engTone).connect(this.engGain).connect(this.busEngine);

    const mkOsc = (gainValue: number, detune: number) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.engPulse!);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gainValue;
      o.connect(g).connect(this.engDrive!);
      o.start();
      return o;
    };
    this.engOscA = mkOsc(0.5, 0);
    this.engOscB = mkOsc(0.34, 11);   // eleven cents apart: a slow beat
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'triangle';
    // The sub is a presence cue, not the sound. Loud, it is just a drone.
    const gS = ctx.createGain(); gS.gain.value = 0.22;
    this.engSub.connect(gS).connect(this.engHigh);
    this.engSub.start();

    // Induction roar. Broadband, tracks the revs, and it is most of what makes
    // an engine sound like it is working rather than humming.
    this.engAirGain = ctx.createGain(); this.engAirGain.gain.value = 0;
    this.engAirFilter = ctx.createBiquadFilter();
    this.engAirFilter.type = 'bandpass';
    this.engAirFilter.frequency.value = 900;
    this.engAirFilter.Q.value = 1.1;
    this.engAir = ctx.createBufferSource();
    this.engAir.buffer = this.noise;
    this.engAir.loop = true;
    this.engAir.connect(this.engAirFilter).connect(this.engAirGain).connect(this.busEngine);
    this.engAir.start();

    // Turbine whine, only while boosting.
    this.boostWhineGain = ctx.createGain(); this.boostWhineGain.gain.value = 0;
    this.boostWhine = ctx.createOscillator();
    this.boostWhine.type = 'sine';
    this.boostWhine.frequency.value = 2000;
    this.boostWhine.connect(this.boostWhineGain).connect(this.busEngine);
    this.boostWhine.start();

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

  /** A band-limited impulse: near-flat harmonics, phase-aligned so the time
   *  domain is a sharp pulse. This is the combustion event; the filters after
   *  it are the pipe that rings. */
  private makePulseWave(ctx: AudioContext, harmonics = 30): PeriodicWave {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      // Gentle rolloff keeps it from being painfully bright, and the small
      // alternating term stops the spectrum being mathematically perfect —
      // real exhausts are not.
      const rolloff = Math.pow(n, -0.42);
      const uneven = 1 + 0.22 * Math.sin(n * 1.9);
      real[n] = rolloff * uneven;
      imag[n] = 0;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /** Asymmetric soft clip. Asymmetry adds even harmonics, which is most of the
   *  difference between "buzzy" and "combustion". */
  private makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const bias = x + 0.12;
      curve[i] = Math.tanh(bias * amount) / Math.tanh(amount);
    }
    return curve;
  }

  stopRace(): void {
    for (const n of [this.engOscA, this.engOscB, this.engSub, this.tyreSrc,
                     this.windSrc, this.driftSrc, this.engAir, this.boostWhine]) {
      try { n?.stop(); } catch { /* already stopped */ }
    }
    this.engOscA = this.engOscB = this.engSub = null;
    this.tyreSrc = this.windSrc = this.driftSrc = null;
    this.engAir = null;
    this.boostWhine = null;
    this.engGain = this.tyreGain = this.windGain = this.driftGain = null;
    this.engAirGain = this.boostWhineGain = null;
    this.engPipe = this.engBody = this.engTone = this.engHigh = null;
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
    const rpmRaw = clamp01(s.speed / Math.max(8, s.topSpeed));

    //  Gearbox. Revs climb through a gear, then drop on the shift — the thing
    //  a continuously rising tone can never do, and the single strongest cue
    //  that an engine is working rather than droning.
    const GEARS = 5;
    const g = Math.min(GEARS - 1, Math.floor(rpmRaw * GEARS));
    const through = rpmRaw * GEARS - g;

    //  Firing frequency, as a gearbox.
    //
    //  Within a gear the note sweeps from `low` to `high`; on a shift it drops
    //  back to `low` of the next gear. Both ends climb with gear number, so
    //  there is overall progression as well as the shift.
    //
    //  The drop is about a third, which is roughly what a real change gives
    //  you. My first attempt dropped it by more than an octave — very audible,
    //  and completely wrong: no gearbox has ratios that far apart.
    const low = 96 + g * 13;
    const high = 152 + g * 17;
    const fire = low + (high - low) * through;

    // Cycle-to-cycle wobble, re-rolled a few times a second. Without it the
    // note is mathematically steady and reads as a synthesiser.
    if (Math.random() < 0.06) this.engJitterTarget = (Math.random() * 2 - 1) * 7;
    this.engJitter += (this.engJitterTarget - this.engJitter) * 0.15;
    const load = s.throttle;

    // Revs respond fast on throttle and fall slower off it, like inertia.
    const tau = load > 0.5 ? 0.045 : 0.10;
    this.engOscA.frequency.setTargetAtTime(fire, t, tau);
    this.engOscB!.frequency.setTargetAtTime(fire, t, tau);
    this.engOscA.detune.setTargetAtTime(this.engJitter, t, 0.05);
    this.engOscB!.detune.setTargetAtTime(11 - this.engJitter, t, 0.05);
    this.engSub!.frequency.setTargetAtTime(fire * 0.5, t, tau);

    //  The pipe resonance sits a few harmonics up and climbs with the revs —
    //  this is the "vowel" that makes a rev sound like a rev.
    this.engPipe!.frequency.setTargetAtTime(
      fire * (3.1 + load * 1.4) + 120 + (s.boosting ? 260 : 0), t, 0.05,
    );
    this.engPipe!.Q.setTargetAtTime(2.6 + rpmRaw * 3.4, t, 0.1);

    //  Brightness is load, not speed. Off throttle the engine goes dull and
    //  hollow (overrun); on throttle it opens right up.
    const bright = 900 + rpmRaw * 2200 + load * 4200 + (s.boosting ? 2200 : 0);
    this.engTone!.frequency.setTargetAtTime(s.covered ? bright * 0.75 : bright, t, 0.06);

    //  Level: mostly load, some revs, and quieter with the wheels off the
    //  ground because there is nothing for the engine to push against.
    const level = (0.055 + rpmRaw * 0.10 + load * 0.115) * (s.grounded ? 1 : 0.5);
    this.engGain!.gain.setTargetAtTime(level, t, 0.05);

    //  Induction roar, tracking the revs and only really present on throttle.
    this.engAirFilter!.frequency.setTargetAtTime(420 + rpmRaw * 2600, t, 0.08);
    this.engAirGain!.gain.setTargetAtTime(
      (0.018 + rpmRaw * 0.05) * (0.35 + load * 0.65) * (s.grounded ? 1 : 0.6), t, 0.07,
    );

    //  Turbine whine while boosting, an octave-ish above the pipe.
    this.boostWhine!.frequency.setTargetAtTime(fire * 8 + 900, t, 0.12);
    this.boostWhineGain!.gain.setTargetAtTime(s.boosting ? 0.016 : 0, t, 0.15);

    //  Tyres: quiet on smooth road, loud and broad on dirt. Scaled off speed
    //  so a stationary kart is actually silent.
    this.tyreFilter!.frequency.setTargetAtTime(420 + rpmRaw * 1500 + s.surfaceRough * 1200, t, 0.08);
    this.tyreFilter!.Q.setTargetAtTime(0.6 + s.surfaceRough * 1.8, t, 0.1);
    this.tyreGain!.gain.setTargetAtTime(
      s.grounded ? rpmRaw * (0.022 + s.surfaceRough * 0.14) : 0, t, 0.08,
    );

    this.windFilter!.frequency.setTargetAtTime(s.covered ? 320 : 1100, t, 0.2);
    this.windGain!.gain.setTargetAtTime(rpmRaw * rpmRaw * 0.10, t, 0.12);

    const driftLevel = s.drifting ? 0.075 + s.driftTier * 0.03 : 0;
    this.driftFilter!.frequency.setTargetAtTime(1700 + s.driftTier * 900, t, 0.06);
    this.driftGain!.gain.setTargetAtTime(driftLevel, t, 0.05);

    this.musicIntensity = rpmRaw;
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

  /** Tap the engine bus for tuning.
   *
   *  Sound is the one thing in this project that cannot be checked by looking,
   *  and "it sounds like a hum" is a measurable claim: a hum is a couple of
   *  low partials with a low crest factor, an engine is a wide harmonic series
   *  with sharp pulses in it. */
  private analyser: AnalyserNode | null = null;
  analyse(): { centroidHz: number; crest: number; bands: number[]; rolloffHz: number } | null {
    if (!this.ctx) return null;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.1;
      this.busEngine.connect(this.analyser);
    }
    const a = this.analyser;
    const freq = new Float32Array(a.frequencyBinCount);
    const time = new Float32Array(a.fftSize);
    a.getFloatFrequencyData(freq);
    a.getFloatTimeDomainData(time);

    const nyquist = this.ctx.sampleRate / 2;
    const hzPerBin = nyquist / freq.length;
    let num = 0, den = 0, total = 0;
    const lin = new Float32Array(freq.length);
    for (let i = 0; i < freq.length; i++) {
      const v = Math.pow(10, freq[i] / 20);
      lin[i] = v;
      num += v * i * hzPerBin;
      den += v;
      total += v;
    }
    // 85% spectral rolloff: where most of the energy is below.
    let acc = 0, rolloff = 0;
    for (let i = 0; i < lin.length; i++) {
      acc += lin[i];
      if (acc >= total * 0.85) { rolloff = i * hzPerBin; break; }
    }
    let peak = 0, sumSq = 0;
    for (const v of time) { peak = Math.max(peak, Math.abs(v)); sumSq += v * v; }
    const rms = Math.sqrt(sumSq / time.length);

    // Eight octave-ish bands, for a readable shape.
    const bands: number[] = [];
    const edges = [0, 100, 200, 400, 800, 1600, 3200, 6400, nyquist];
    for (let b = 0; b < 8; b++) {
      let sum = 0, n = 0;
      for (let i = 0; i < lin.length; i++) {
        const hz = i * hzPerBin;
        if (hz >= edges[b] && hz < edges[b + 1]) { sum += lin[i]; n++; }
      }
      bands.push(n ? +(20 * Math.log10(sum / n + 1e-9)).toFixed(1) : -99);
    }
    return {
      centroidHz: den > 0 ? Math.round(num / den) : 0,
      crest: rms > 1e-6 ? +(peak / rms).toFixed(2) : 0,
      bands,
      rolloffHz: Math.round(rolloff),
    };
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
