/** Race items — what a treasure chest hands you.
 *
 *  Three basic items, held one at a time, fired with the item key. They are
 *  deliberately simple: one attacks, one defends, one goes faster. The
 *  fourth "item" every racer has is their class special (data/specials.ts),
 *  which is the Axie's own move and recharges as they race.
 *
 *  Everything here is data; the race core resolves the effect.
 */
export type ItemKind = 'comet' | 'bubble' | 'surge';

export interface ItemDef {
  kind: ItemKind;
  name: string;
  /** One line, written for the driver. */
  blurb: string;
  /** Colour for the HUD slot and the pickup flash. */
  color: string;
  /** Short glyph for the HUD slot. */
  glyph: string;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  comet:  { kind: 'comet',  name: 'Moon Comet',    blurb: 'Fires down the road ahead and spins out the first kart it reaches.', color: '#ffd166', glyph: '☄' },
  bubble: { kind: 'bubble', name: 'Bubble Shield', blurb: 'Nothing touches you for five seconds. Drive through them.',            color: '#5fd8e8', glyph: '◯' },
  surge:  { kind: 'surge',  name: 'Lunar Surge',   blurb: 'A full tier-three boost, right now.',                                    color: '#c79bff', glyph: '➤' },
};

export const ITEM_KINDS: ItemKind[] = ['comet', 'bubble', 'surge'];

/** Which item a chest gives, by race position (1 = leading). The leader
 *  mostly gets speed and a shield; the back of the pack mostly gets comets.
 *  Weights, not rules — a leader can still draw a comet. */
export function itemWeights(position: number, fieldSize: number): Record<ItemKind, number> {
  const back = fieldSize <= 1 ? 0.5 : (position - 1) / (fieldSize - 1);   // 0 leader .. 1 last
  return {
    comet:  0.25 + back * 0.45,
    bubble: 0.40 - back * 0.15,
    surge:  0.35 - back * 0.30 + back * 0.30,
  };
}

/** How long a comet lives, in seconds, and how fast it travels (m/s). */
export const COMET_LIFE = 4.5;
export const COMET_SPEED = 52;
/** Metres of road ahead within which a comet steers toward a kart. */
export const COMET_HOMING_RANGE = 34;
/** Seconds the bubble lasts. */
export const BUBBLE_SECONDS = 5;
