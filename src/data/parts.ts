/** Kart part definitions — the upgrade-ready, ownership-ready content layer.
 *
 *  A part is pure data: a slot, a level curve, a stat budget cost and a set of
 *  modifiers. The race code never reads a part; it reads the ValidatedLoadout
 *  that the resolver produces. That is the whole seam that lets a future
 *  wallet-backed inventory replace the local one without touching physics.
 */
import type { StatBlock, StatKey } from './karts';
import { SCHEMA_VERSION, RULES_VERSION } from './rules';

export type SlotId = 'chassis' | 'engine' | 'tires' | 'suspension' | 'boost' | 'aero' | 'paint';

export const SLOTS: { id: SlotId; label: string; blurb: string }[] = [
  { id: 'chassis',    label: 'Chassis',    blurb: 'Mass, durability and silhouette.' },
  { id: 'engine',     label: 'Engine',     blurb: 'Acceleration curve, top speed and engine note.' },
  { id: 'tires',      label: 'Tires',      blurb: 'Grip, drift response and surface specialty.' },
  { id: 'suspension', label: 'Suspension', blurb: 'Landing control and bump absorption.' },
  { id: 'boost',      label: 'Boost Unit', blurb: 'Charge behaviour and boost output.' },
  { id: 'aero',       label: 'Aero Kit',   blurb: 'Air control and high-speed stability.' },
  { id: 'paint',      label: 'Paint',      blurb: 'Pure expression. No stat effect, ever.' },
];

export type Rarity = 'common' | 'rare' | 'epic';
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa6b8', rare: '#5fb0ff', epic: '#c79bff',
};

export interface PartDefinition {
  id: string;
  slot: SlotId;
  name: string;
  /** Level 1..maxLevel. Modifiers scale along the level curve. */
  maxLevel: number;
  rarity: Rarity;
  /** Modifier at level 1. Level L adds `mods * levelCurve(L)`. */
  mods: Partial<StatBlock>;
  /** Special behaviours the sim reads by name; keeps parts expressive without
   *  giving every part a bespoke code path. */
  traits?: PartTrait[];
  /** Coins to buy, then to upgrade each level. */
  price: number;
  upgradeCost: number;
  blurb: string;
  /** Visual variant key consumed by the kart mesh builder. */
  visual: string;
  rulesVersion: string;
  schemaVersion: number;
}

export type PartTrait =
  | 'dirt-grip'        // no grip loss on dirt/mud
  | 'water-immune'     // no drag in shallow water
  | 'long-boost'       // +25% boost duration
  | 'fast-charge'      // +20% drift charge rate
  | 'soft-landing'     // wider landing-quality window
  | 'heavy'            // wins kart-to-kart contact, slower rotation
  | 'start-tune';      // wider start-boost window

const p = (
  id: string, slot: SlotId, name: string, rarity: Rarity, maxLevel: number,
  mods: Partial<StatBlock>, price: number, upgradeCost: number, blurb: string,
  visual: string, traits?: PartTrait[],
): PartDefinition => ({
  id, slot, name, maxLevel, rarity, mods, traits, price, upgradeCost, blurb, visual,
  rulesVersion: RULES_VERSION, schemaVersion: SCHEMA_VERSION,
});

export const PARTS: PartDefinition[] = [
  // --- chassis ---------------------------------------------------------
  p('chassis-stock',   'chassis', 'Stock Frame',     'common', 1, {}, 0, 0,
    'The frame the kart shipped with. Honest, and free.', 'stock'),
  p('chassis-lattice', 'chassis', 'Lunar Lattice',   'rare',   3, { accel: 1.4, grip: 0.8, armor: -0.6 }, 240, 180,
    'Hollowed spars shed mass. Quicker off the line, easier to shove around.', 'lattice'),
  p('chassis-bulwark', 'chassis', 'Bulwark Cage',    'rare',   3, { armor: 2.0, speed: 0.5, accel: -0.8 }, 240, 180,
    "A roll cage that treats contact as someone else's problem.", 'bulwark', ['heavy']),

  // --- engine ----------------------------------------------------------
  p('engine-stock',    'engine', 'Stock Drive',      'common', 1, {}, 0, 0,
    'Reliable. Unremarkable.', 'stock'),
  p('engine-emberII',  'engine', 'Ember II',         'common', 3, { speed: 1.6, accel: 0.4 }, 180, 140,
    'More top end, at the cost of a slightly lazier midrange.', 'ember'),
  p('engine-quickfire','engine', 'Quickfire',        'rare',   3, { accel: 1.8, speed: -0.3 }, 220, 170,
    'Short gearing. Wins the run out of a hairpin, loses the back straight.', 'quickfire', ['start-tune']),
  p('engine-moonrush', 'engine', 'Moonrush',         'epic',   4, { speed: 1.5, accel: 1.1 }, 520, 300,
    'The one everyone saves for. No downside, and priced like it.', 'moonrush'),

  // --- tires -----------------------------------------------------------
  p('tires-stock',     'tires', 'Stock Slicks',      'common', 1, {}, 0, 0,
    'Fine on clean road, vague everywhere else.', 'stock'),
  p('tires-cleat',     'tires', 'Root Cleats',       'common', 3, { grip: 1.7, speed: -0.4 }, 190, 140,
    'Deep tread that bites mud and loose stone.', 'cleat', ['dirt-grip']),
  p('tires-glasswing', 'tires', 'Glasswing',         'rare',   3, { drift: 1.9, grip: -0.5 }, 230, 170,
    'Breaks away early and predictably. Built for drivers who live sideways.', 'glasswing', ['fast-charge']),
  p('tires-tidewalker','tires', 'Tidewalker',        'rare',   3, { grip: 1.2, accel: 0.6 }, 250, 180,
    'Channelled compound that ignores standing water.', 'tidewalker', ['water-immune']),

  // --- suspension ------------------------------------------------------
  p('susp-stock',      'suspension', 'Stock Struts', 'common', 1, {}, 0, 0,
    'Enough travel to survive a kerb.', 'stock'),
  p('susp-canopy',     'suspension', 'Canopy Coils', 'common', 3, { air: 1.5, armor: 0.5 }, 180, 140,
    'Long travel. Turns a bad landing into a survivable one.', 'canopy', ['soft-landing']),
  p('susp-hardline',   'suspension', 'Hardline',     'rare',   3, { grip: 1.4, drift: 0.7, air: -0.6 }, 240, 180,
    'Stiff and flat. Rewards a driver who never leaves the ground.', 'hardline'),

  // --- boost -----------------------------------------------------------
  p('boost-stock',     'boost', 'Stock Injector',    'common', 1, {}, 0, 0,
    'One charge, one push.', 'stock'),
  p('boost-emberbloom','boost', 'Emberbloom',        'common', 3, { drift: 1.6 }, 200, 150,
    'Fills faster from a held drift.', 'emberbloom', ['fast-charge']),
  p('boost-longtail',  'boost', 'Longtail',          'rare',   3, { speed: 0.9, drift: 0.6 }, 260, 190,
    'Less punch, but the push keeps going well past the exit.', 'longtail', ['long-boost']),
  p('boost-starfall',  'boost', 'Starfall',          'epic',   4, { drift: 1.6, speed: 1.0 }, 540, 310,
    'Charges fast and runs long. The endgame boost unit.', 'starfall', ['long-boost', 'fast-charge']),

  // --- aero ------------------------------------------------------------
  p('aero-stock',      'aero', 'Bare Body',          'common', 1, {}, 0, 0,
    'Nothing to catch the wind, nothing to steer it either.', 'stock'),
  p('aero-kitewing',   'aero', 'Kitewing',           'common', 3, { air: 1.9, speed: -0.3 }, 190, 150,
    'Broad surfaces you can actually steer against in the air.', 'kitewing'),
  p('aero-slipcowl',   'aero', 'Slipcowl',           'rare',   3, { speed: 1.5, air: -0.4 }, 240, 180,
    'Closes the body in. Faster in a straight line, clumsier off a ramp.', 'slipcowl'),

  // --- paint (cosmetic only) -------------------------------------------
  p('paint-factory',   'paint', 'Factory',           'common', 1, {}, 0, 0, 'As delivered.', 'factory'),
  p('paint-duskfade',  'paint', 'Duskfade',          'common', 1, {}, 120, 0, 'Deep violet into ember.', 'duskfade'),
  p('paint-reeflight', 'paint', 'Reeflight',         'common', 1, {}, 120, 0, 'Teal with a wet sheen.', 'reeflight'),
  p('paint-mosswork',  'paint', 'Mosswork',          'common', 1, {}, 120, 0, 'Weathered green and brass.', 'mosswork'),
  p('paint-lunacian',  'paint', 'Lunacian',          'epic',   1, {}, 400, 0, 'Pearl white with a moon-shard glow. Lunacian division only.', 'lunacian'),
];

/** Modifier scale at a given level. Level 1 = 1.0, and each level adds 55% of
 *  the base modifier — deliberately sublinear so a maxed part is a meaningful
 *  but not decisive edge. */
export function levelCurve(level: number): number {
  return 1 + (Math.max(1, level) - 1) * 0.55;
}

/** Budget cost of a fitted part: the sum of its positive stat movement. */
export function partCost(part: PartDefinition, level: number): number {
  const scale = levelCurve(level);
  let cost = 0;
  for (const k of Object.keys(part.mods) as StatKey[]) {
    const v = (part.mods[k] ?? 0) * scale;
    if (v > 0) cost += v;
  }
  return cost;
}

export function partById(id: string): PartDefinition {
  const x = PARTS.find((q) => q.id === id);
  if (!x) throw new Error(`Unknown part: ${id}`);
  return x;
}
export function partsForSlot(slot: SlotId): PartDefinition[] {
  return PARTS.filter((x) => x.slot === slot);
}
/** The free starter part for each slot, fitted to every new profile. */
export const DEFAULT_LOADOUT: Record<SlotId, string> = {
  chassis: 'chassis-stock',
  engine: 'engine-stock',
  tires: 'tires-stock',
  suspension: 'susp-stock',
  boost: 'boost-stock',
  aero: 'aero-stock',
  paint: 'paint-factory',
};
