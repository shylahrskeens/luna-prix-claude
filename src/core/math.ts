/** Small deterministic math toolkit. No three.js dependency: the simulation
 *  must stay renderer-free so it can run headless in tests and on a server. */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach. `rate` is per second. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}
/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export function angleLerp(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
export function angleDamp(a: number, b: number, rate: number, dt: number): number {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}
/** Wrap `v` into [0, m). Handles negatives, unlike `%`. */
export function wrap(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}
/** Shortest signed difference between two positions on a loop of length m. */
export function loopDelta(from: number, to: number, m: number): number {
  let d = wrap(to - from, m);
  if (d > m / 2) d -= m;
  return d;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const v3copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const v3set = (o: V3, x: number, y: number, z: number): V3 => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
export const v3add = (a: V3, b: V3, o: V3 = v3()): V3 => v3set(o, a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (a: V3, b: V3, o: V3 = v3()): V3 => v3set(o, a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (a: V3, s: number, o: V3 = v3()): V3 => v3set(o, a.x * s, a.y * s, a.z * s);
export const v3addScaled = (a: V3, b: V3, s: number, o: V3 = v3()): V3 =>
  v3set(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const v3dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const v3len2 = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const v3dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Horizontal (XZ) distance — used constantly for track work. */
export const v3distXZ = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const v3cross = (a: V3, b: V3, o: V3 = v3()): V3 =>
  v3set(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export function v3norm(a: V3, o: V3 = v3()): V3 {
  const l = v3len(a);
  return l > 1e-9 ? v3set(o, a.x / l, a.y / l, a.z / l) : v3set(o, 0, 0, 0);
}
export function v3lerp(a: V3, b: V3, t: number, o: V3 = v3()): V3 {
  return v3set(o, lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

/** Mulberry32 — small, fast, fully deterministic from a 32-bit seed. Every
 *  random draw in the game (bot jitter, VFX, scenery scatter) comes from a
 *  seeded stream so a race can be replayed and verified. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1 - 1e-9));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
  /** Signed value in [-1, 1]. */
  signed(): number {
    return this.next() * 2 - 1;
  }
}

/** FNV-1a over a string — used to turn ids into stable seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
export function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '-';
  const a = Math.abs(seconds);
  return `${sign}${a.toFixed(3)}`;
}
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
