/** Input: keyboard, gamepad and touch, all producing the same KartInput.
 *
 *  The active device is detected from whatever was used last, which is what
 *  drives the control card the HUD shows — the game never tells a controller
 *  player to press Space.
 */
import { clamp, clamp01 } from '../core/math';
import type { KartInput } from '../sim/kart';
import type { Settings } from '../persist/store';

export type Device = 'keyboard' | 'gamepad' | 'touch';

export interface TouchState {
  /** -1..1 from the virtual stick. */
  steer: number;
  accel: boolean;
  brake: boolean;
  drift: boolean;
  lookBack: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private settings: Settings;
  device: Device = 'keyboard';
  touch: TouchState = { steer: 0, accel: false, brake: false, drift: false, lookBack: false };
  /** Raised once per press, consumed by the UI. */
  private pressed = new Set<string>();
  private driftToggleState = false;
  private prevDriftRaw = false;
  private listeners: (() => void)[] = [];
  /** True while any menu wants keyboard focus. */
  uiCaptured = false;

  constructor(settings: Settings) {
    this.settings = settings;
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.device = 'keyboard';
      // Stop the page scrolling out from under a race.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !this.uiCaptured) {
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.listeners.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  updateSettings(s: Settings): void {
    this.settings = s;
  }

  /** Was this key pressed since the last poll? */
  consumePress(code: string): boolean {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }
  clearPresses(): void {
    this.pressed.clear();
  }
  /** A key pressed since the last frame — not one already held. Used to cut the
   *  end-of-race tail short without inventing a dedicated key (holding the
   *  throttle over the line must not skip it). */
  consumeAnyPress(): boolean {
    if (this.pressed.size === 0) return false;
    this.pressed.clear();
    return true;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  private bind(action: string): string {
    return this.settings.keybinds[action] ?? action;
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const active = p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.2);
      if (active) this.device = 'gamepad';
      return p;
    }
    return null;
  }

  /** Build the frame's driving input. */
  read(): KartInput {
    const s = this.settings;
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let driftRaw = false;
    let lookBack = false;

    // --- keyboard ---
    if (this.keys.has(this.bind('accelerate')) || this.keys.has('ArrowUp')) throttle = 1;
    if (this.keys.has(this.bind('brake')) || this.keys.has('ArrowDown')) brake = 1;
    if (this.keys.has(this.bind('left')) || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.keys.has(this.bind('right')) || this.keys.has('ArrowRight')) steer += 1;
    if (this.keys.has(this.bind('drift')) || this.keys.has('ShiftLeft')) driftRaw = true;
    if (this.keys.has(this.bind('lookBack'))) lookBack = true;

    // --- gamepad ---
    const pad = this.gamepad();
    if (pad) {
      const dz = s.deadzone;
      const ax = pad.axes[0] ?? 0;
      const axSteer = Math.abs(ax) > dz ? (ax - Math.sign(ax) * dz) / (1 - dz) : 0;
      if (Math.abs(axSteer) > Math.abs(steer)) steer = axSteer;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt > dz ? rt : 0, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt > dz ? lt : 0, pad.buttons[1]?.pressed ? 1 : 0);
      if (pad.buttons[5]?.pressed || pad.buttons[4]?.pressed || pad.buttons[2]?.pressed) driftRaw = true;
      if (pad.buttons[3]?.pressed) lookBack = true;
      if (pad.buttons[12]?.pressed) throttle = 1;
      if (pad.buttons[13]?.pressed) brake = 1;
      if (pad.buttons[14]?.pressed) steer = -1;
      if (pad.buttons[15]?.pressed) steer = 1;
    }

    // --- touch ---
    if (this.touch.accel || this.touch.brake || this.touch.drift || Math.abs(this.touch.steer) > 0.02) {
      this.device = 'touch';
      throttle = Math.max(throttle, this.touch.accel ? 1 : 0);
      brake = Math.max(brake, this.touch.brake ? 1 : 0);
      if (Math.abs(this.touch.steer) > Math.abs(steer)) steer = this.touch.steer;
      if (this.touch.drift) driftRaw = true;
      if (this.touch.lookBack) lookBack = true;
    }

    // Drift as a toggle, for players who do not want to hold a button through
    // a thirty second corner sequence.
    let drift = driftRaw;
    if (s.driftToggle) {
      if (driftRaw && !this.prevDriftRaw) this.driftToggleState = !this.driftToggleState;
      drift = this.driftToggleState;
    } else {
      this.driftToggleState = false;
    }
    this.prevDriftRaw = driftRaw;

    //  Flip the steering to match the screen.
    //
    //  The kart's yaw convention is fwd = (sin y, 0, cos y), so increasing yaw
    //  swings the nose toward world +X. The chase camera sits behind the kart
    //  looking along +Z — and in a right-handed system, a camera looking down
    //  +Z has world +X on its LEFT. So "turn toward +X" is "turn toward screen
    //  left", and pressing right steered left.
    //
    //  Negating here rather than in the physics keeps every derived value
    //  consistent: drift direction, body lean, wheel angle and the camera's
    //  drift framing are all computed from this number, so they flip with it.
    //  The bots are untouched — they steer toward a world-space target and were
    //  always self-consistent, which is exactly why 21 clean test races never
    //  caught this. Only a human looking at a screen could.
    steer = clamp(-steer * s.steerSensitivity * (s.invertSteering ? -1 : 1), -1, 1);
    return { throttle: clamp01(throttle), brake: clamp01(brake), steer, drift, lookBack };
  }

  /** Release a held drift toggle, e.g. on respawn. */
  releaseDrift(): void {
    this.driftToggleState = false;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }
}

/** Control card copy per device — shown before the first race and in settings. */
export function controlCard(device: Device, binds: Record<string, string>): { key: string; label: string }[] {
  const pretty = (code: string) =>
    code.startsWith('Key') ? code.slice(3)
      : code.startsWith('Arrow') ? code.slice(5)
      : code === 'Space' ? 'Space'
      : code;
  if (device === 'gamepad') {
    return [
      { key: 'RT / A', label: 'Accelerate' },
      { key: 'LT / B', label: 'Brake and reverse' },
      { key: 'Left stick', label: 'Steer' },
      { key: 'RB / LB / X', label: 'Hop, then hold to drift' },
      { key: 'RB in the air', label: 'Trick' },
      { key: 'Y', label: 'Look back' },
    ];
  }
  if (device === 'touch') {
    return [
      { key: 'Left stick', label: 'Steer' },
      { key: 'GO', label: 'Accelerate' },
      { key: 'BRAKE', label: 'Brake and reverse' },
      { key: 'DRIFT', label: 'Hop, then hold to drift' },
      { key: 'DRIFT airborne', label: 'Trick' },
    ];
  }
  //  The arrow keys drive the kart alongside whatever is bound, always. The
  //  card has to say so: a player who reaches for the arrows and sees only
  //  "W" on screen assumes they do not work, and they do.
  const alt: Record<string, string> = {
    accelerate: '↑', brake: '↓', left: '←', right: '→', drift: 'Shift',
  };
  const both = (action: string) => {
    const bound = pretty(binds[action]);
    const arrow = alt[action];
    return arrow && arrow !== bound ? `${bound} or ${arrow}` : bound;
  };
  return [
    { key: both('accelerate'), label: 'Accelerate' },
    { key: both('brake'), label: 'Brake and reverse' },
    { key: `${both('left')} / ${both('right')}`, label: 'Steer' },
    { key: both('drift'), label: 'Hop, then hold to drift' },
    { key: `${pretty(binds.drift)} in the air`, label: 'Trick' },
    { key: pretty(binds.lookBack), label: 'Look back' },
    { key: pretty(binds.reset), label: 'Reset to the track' },
  ];
}
