/** On-screen controls for phones and tablets.
 *
 *  A stick that only reports the horizontal axis (steering is the only analogue
 *  input a kart needs) and three buttons sized for thumbs, positioned inside
 *  the safe area so a notch or a home bar never eats the accelerator.
 */
import { el } from './dom';
import { clamp } from '../core/math';
import type { InputManager } from './input';

export class TouchControls {
  readonly root: HTMLElement;
  private knob: HTMLElement;
  private stick: HTMLElement;
  private stickId: number | null = null;
  private centre = { x: 0, y: 0 };
  private input: InputManager;

  constructor(input: InputManager) {
    this.input = input;
    this.knob = el('div', { class: 'knob' });
    this.stick = el('div', { class: 'tstick' }, this.knob);
    const go = el('div', { class: 'tbtn go', text: 'GO' });
    const drift = el('div', { class: 'tbtn drift', text: 'DRIFT' });
    const brake = el('div', { class: 'tbtn brake', text: 'BRAKE' });
    this.root = el('div', { id: 'touch' }, this.stick, go, drift, brake);

    this.bindStick();
    this.bindButton(go, 'accel');
    this.bindButton(drift, 'drift');
    this.bindButton(brake, 'brake');
  }

  private bindStick(): void {
    const start = (e: PointerEvent) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      const r = this.stick.getBoundingClientRect();
      this.centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      const r = this.stick.getBoundingClientRect();
      const max = r.width / 2 - 14;
      const dx = clamp(e.clientX - this.centre.x, -max, max);
      const dy = clamp(e.clientY - this.centre.y, -max, max);
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // A small dead zone so resting a thumb does not steer.
      const raw = dx / max;
      this.input.touch.steer = Math.abs(raw) < 0.10 ? 0 : (raw - Math.sign(raw) * 0.10) / 0.90;
      e.preventDefault();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.knob.style.transform = '';
      this.input.touch.steer = 0;
    };
    this.stick.addEventListener('pointerdown', start);
    this.stick.addEventListener('pointermove', move);
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
  }

  private bindButton(node: HTMLElement, key: 'accel' | 'brake' | 'drift'): void {
    const down = (e: PointerEvent) => {
      this.input.touch[key] = true;
      node.classList.add('held');
      node.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      this.input.touch[key] = false;
      node.classList.remove('held');
      e.preventDefault();
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
    if (!on) {
      this.input.touch.accel = false;
      this.input.touch.brake = false;
      this.input.touch.drift = false;
      this.input.touch.steer = 0;
    }
  }
}

/** Coarse pointer and no hover is the reliable signal for "this is a phone",
 *  rather than sniffing user agents. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}
