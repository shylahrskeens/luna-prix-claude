/** Versioned competition rules.
 *
 *  Every race result, leaderboard entry and validated loadout is stamped with
 *  RULES_VERSION. Changing a stat budget or a handling constant means bumping
 *  this string, which retires old records into their own board rather than
 *  silently mixing them with new ones.
 */
export const RULES_VERSION = 'lp-1.0.0';
export const SCHEMA_VERSION = 3;

/** Ranked play bounds how far a loadout can move the car. Upgrades change the
 *  shape of the kart, never the size of it — this is the pay-to-win guardrail. */
export const RANKED_STAT_BUDGET = 12;   // total points a loadout may add in ranked
export const OPEN_STAT_BUDGET = 28;     // casual / time-trial ceiling
export const PER_STAT_CAP = 6;          // no single stat may be pushed past this

export type Mode = 'grandPrix' | 'quickRace' | 'timeTrial' | 'ranked' | 'bonus';

export interface ModeRules {
  id: Mode;
  label: string;
  /** Loadout budget applied to this mode. */
  statBudget: number;
  /** Rubber-banding strength for bots, 0 = none. Ranked is always 0. */
  catchUp: number;
  /** Whether results may be published to a ranked board. */
  ranked: boolean;
  /** Driving assists permitted. */
  assistsAllowed: boolean;
  laps: number;
}

/** Review build: every circuit and event is open from the first launch. The
 *  unlock rules (podium for the forest, rating for the arctic and mystic)
 *  stay in the track data and are what a release would switch back on. */
export const UNLOCK_EVERYTHING = true;

export const MODE_RULES: Record<Mode, ModeRules> = {
  quickRace: { id: 'quickRace', label: 'Quick Race', statBudget: OPEN_STAT_BUDGET, catchUp: 0.35, ranked: false, assistsAllowed: true, laps: 3 },
  grandPrix: { id: 'grandPrix', label: 'Grand Prix', statBudget: OPEN_STAT_BUDGET, catchUp: 0.25, ranked: false, assistsAllowed: true, laps: 3 },
  ranked:    { id: 'ranked',    label: 'Ranked',     statBudget: RANKED_STAT_BUDGET, catchUp: 0, ranked: true, assistsAllowed: false, laps: 3 },
  timeTrial: { id: 'timeTrial', label: 'Time Trial', statBudget: OPEN_STAT_BUDGET, catchUp: 0, ranked: false, assistsAllowed: true, laps: 3 },
  bonus:     { id: 'bonus',     label: 'Bonus Event', statBudget: OPEN_STAT_BUDGET, catchUp: 0, ranked: false, assistsAllowed: true, laps: 1 },
};

/** Rank ladder. Promotion is on rating thresholds, not on win streaks, so a
 *  player can always see exactly how far they are from the next division. */
export interface Division {
  id: string;
  name: string;
  minRating: number;
  color: string;
}

export const DIVISIONS: Division[] = [
  { id: 'scrap',    name: 'Scrap',      minRating: 0,    color: '#8d8378' },
  { id: 'bronze',   name: 'Bronze',     minRating: 900,  color: '#c07a3e' },
  { id: 'silver',   name: 'Silver',     minRating: 1150, color: '#c7ced8' },
  { id: 'gold',     name: 'Gold',       minRating: 1400, color: '#e8bf42' },
  { id: 'moon',     name: 'Moonstone',  minRating: 1650, color: '#9ad7f2' },
  { id: 'lunacian', name: 'Lunacian',   minRating: 1900, color: '#c79bff' },
];

export function divisionFor(rating: number): Division {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (rating >= x.minRating) d = x;
  return d;
}
export function nextDivision(rating: number): Division | null {
  for (const x of DIVISIONS) if (rating < x.minRating) return x;
  return null;
}

/** Rating change from a finishing position in a field of `n`.
 *  Symmetric around the middle of the field, scaled by division so climbing
 *  slows near the top. Deliberately simple and fully disclosed. */
export function ratingDelta(rating: number, finish: number, fieldSize: number): number {
  const mid = (fieldSize + 1) / 2;
  const norm = (mid - finish) / Math.max(1, mid - 1); // +1 for a win, -1 for last
  const k = rating < 1150 ? 34 : rating < 1400 ? 28 : rating < 1650 ? 22 : rating < 1900 ? 18 : 14;
  return Math.round(norm * k);
}
