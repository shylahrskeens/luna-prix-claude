/** Class specials — the move an Axie brings to the race.
 *
 *  This is the Axie doing something only that Axie can do. The class is not a
 *  colour: it picks the move, and the move changes how the corner in front of
 *  you plays out. Everything here is data, so the server resolves the same
 *  move from the same class without a second implementation.
 */
import type { AxieClass } from './axies';

export type SpecialKind =
  | 'ram'        // shove everyone just ahead of you out of shape
  | 'wake'       // leave something behind that ruins the kart behind you
  | 'root'       // pin the kart in front
  | 'gust'       // shove the nearest karts sideways
  | 'sting'      // kill the leader's boost and take the edge off their speed
  | 'shell'      // nothing touches you for a moment
  | 'overdrive'  // a long, sustained boost
  | 'draft'      // take the tow you have not earned
  | 'hex';       // the kart ahead cannot boost

export interface Special {
  kind: SpecialKind;
  name: string;
  /** One line, written for the driver, not the engineer. */
  blurb: string;
  /** Metres of reach. Self-only moves ignore it. */
  range: number;
  /** Seconds the effect lasts on a target. */
  duration: number;
}

export const SPECIALS: Record<AxieClass, Special> = {
  Beast:   { kind: 'ram',       name: 'Ram',       blurb: 'Shoulder-charge: anything just ahead of you loses its line.', range: 16, duration: 0 },
  Aquatic: { kind: 'wake',      name: 'Wake',      blurb: 'Leave a wash behind you. Whoever is following slides.',       range: 18, duration: 1.1 },
  Plant:   { kind: 'root',      name: 'Root',      blurb: 'Pin the kart in front to the floor for a moment.',            range: 45, duration: 1.0 },
  Bird:    { kind: 'gust',      name: 'Gust',      blurb: 'A downdraught that shoves the nearest karts off line.',       range: 26, duration: 0 },
  Bug:     { kind: 'sting',     name: 'Sting',     blurb: 'Take the boost and the top end off the kart ahead.',          range: 40, duration: 1.4 },
  Reptile: { kind: 'shell',     name: 'Shell',     blurb: 'Nothing touches you for four seconds. Go through them.',      range: 0,  duration: 4 },
  Mech:    { kind: 'overdrive', name: 'Overdrive', blurb: 'A long, flat boost. No tiers, no payout, just drive.',        range: 0,  duration: 3.2 },
  Dawn:    { kind: 'draft',     name: 'Slipstream', blurb: 'Take the tow off the kart ahead as if you had sat there.',   range: 55, duration: 2.5 },
  Dusk:    { kind: 'hex',       name: 'Hex',       blurb: 'The kart ahead cannot boost. Watch them try.',                range: 50, duration: 3 },
};

/** How much of the meter a move costs. Everything costs the lot for now: one
 *  charge, one move, so the decision is when rather than how many. */
export const SPECIAL_COST = 1;
