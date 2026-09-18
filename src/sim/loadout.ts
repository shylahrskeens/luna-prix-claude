/** Loadout Resolver.
 *
 *  Takes an Axie + a kart + fitted parts and produces a ValidatedLoadout: a
 *  frozen stat block, a handling profile and a validation record stamped with
 *  the rules version. This is the single seam between "what the player owns"
 *  and "what the car does".
 *
 *  Nothing downstream of here knows about ownership, wallets, or part data.
 *  The race takes a ValidatedLoadout and nothing else, which is why a race can
 *  never be blocked on a chain read.
 */
import { clamp, hashString } from '../core/math';
import { resolveAxieStats, CLASS_TRAIT, type AxieClass, type AxieDefinition } from '../data/axies';
import type { KartDefinition, StatBlock } from '../data/karts';
import { STAT_KEYS } from '../data/karts';
import {
  DEFAULT_LOADOUT, levelCurve, partById, partCost,
  type PartTrait, type SlotId,
} from '../data/parts';
import { PER_STAT_CAP, RULES_VERSION, SCHEMA_VERSION } from '../data/rules';

export interface FittedPart {
  partId: string;
  level: number;
}
export type LoadoutParts = Record<SlotId, FittedPart>;

export function defaultParts(): LoadoutParts {
  const out = {} as LoadoutParts;
  for (const k of Object.keys(DEFAULT_LOADOUT) as SlotId[]) {
    out[k] = { partId: DEFAULT_LOADOUT[k], level: 1 };
  }
  return out;
}

/** The physical numbers the kart simulation actually consumes. */
export interface HandlingProfile {
  /** m/s on clean road with no boost. */
  topSpeed: number;
  /** m/s^2 available at a standstill. */
  accel: number;
  /** m/s^2 of braking. */
  brake: number;
  /** Peak lateral acceleration the tyres hold, m/s^2. */
  grip: number;
  /** Lateral hold while drifting (deliberately lower). */
  driftGrip: number;
  /** rad/s of yaw authority at the reference speed. */
  turnRate: number;
  /** Extra yaw authority available inside a drift. */
  driftTurnBonus: number;
  /** Drift meter fill per second at full angle. */
  driftCharge: number;
  /** Multiplier applied to top speed during a boost. */
  boostPower: number;
  /** Seconds a tier-1 boost lasts. */
  boostDuration: number;
  /** rad/s of pitch and roll authority in the air. */
  airControl: number;
  /** Landing angle, in radians, still counted as clean. */
  landingWindow: number;
  /** kg-ish. Governs who wins contact. */
  mass: number;
  /** 0..1 — fraction of incoming knockback absorbed. */
  knockResist: number;
  /** Seconds from respawn trigger to driving again. */
  respawnTime: number;
  /** Collision radius, metres. */
  radius: number;
}

export interface ValidatedLoadout {
  playerId: string;
  axieId: string;
  kartId: string;
  parts: LoadoutParts;
  /** Final 0-100 garage stats after Axie + kart + parts. */
  stats: StatBlock;
  /** Physics numbers derived from `stats`. */
  handling: HandlingProfile;
  /** Special behaviours granted by class and by parts. */
  traits: Set<PartTrait | 'class'>;
  axieClass: AxieClass;
  /** Budget points consumed and the ceiling that applied. */
  budgetUsed: number;
  budgetMax: number;
  valid: boolean;
  /** Human-readable reasons the loadout failed validation, if any. */
  problems: string[];
  rulesVersion: string;
  schemaVersion: number;
  /** Deterministic token over the inputs. A server recomputes it to confirm a
   *  client raced the loadout it claimed. Not a security boundary on its own —
   *  the server recomputes stats from part ids regardless. */
  validationToken: string;
  /** Wall-clock expiry; matchmaking refreshes rather than reusing forever. */
  expiresAt: number;
}

/** How much each Axie battle stat moves each garage stat.
 *  Axie stats run roughly 27-61; these are normalised to a -10..+10 band so an
 *  Axie is a real character choice without eclipsing the kart. */
function axieContribution(axie: AxieDefinition): StatBlock {
  const s = resolveAxieStats(axie);
  // Centre each Axie stat on 40 (the middle of the possible range).
  const sp = (s.speed - 40) / 2.2;
  const sk = (s.skill - 40) / 2.2;
  const mo = (s.morale - 40) / 2.2;
  const hp = (s.hp - 40) / 2.2;
  return {
    speed: sp * 1.15,
    accel: sp * 0.45 + mo * 0.55,
    grip: sk * 1.15,
    drift: sk * 0.55 + mo * 0.75,
    air: mo * 0.60 + sk * 0.35,
    armor: hp * 1.30,
  };
}

/** Class passives, expressed as the flags the sim reads. */
const CLASS_TRAITS: Record<AxieClass, PartTrait[]> = {
  Beast: [], Aquatic: ['water-immune'], Plant: [], Bird: [], Bug: [],
  Reptile: ['dirt-grip'], Mech: ['start-tune'], Dawn: [], Dusk: ['long-boost'],
};

/** Scalar class multipliers applied after the handling conversion. */
export function applyClassPassives(cls: AxieClass, h: HandlingProfile): HandlingProfile {
  switch (cls) {
    case 'Beast': h.boostPower += 0.055; break;                  // Wild Streak
    case 'Aquatic': break;                                        // water-immune trait
    case 'Plant': h.knockResist = clamp(h.knockResist + 0.35, 0, 0.92); break;
    case 'Bird': h.airControl *= 1.28; h.landingWindow *= 1.20; break;
    case 'Bug': h.respawnTime *= 0.60; break;
    case 'Reptile': break;                                        // dirt-grip trait
    case 'Mech': break;                                           // start-tune trait
    case 'Dawn': h.boostDuration *= 1.05; break;
    case 'Dusk': break;                                           // long-boost trait
  }
  return h;
}

/** 0-100 garage stats to physical handling numbers.
 *  Exported because the garage previews an upgrade by running this on the
 *  hypothetical stat block — the preview is the real conversion, not an
 *  approximation of it. */
export function statsToHandling(stats: StatBlock, kart: KartDefinition): HandlingProfile {
  const n = (v: number) => clamp(v, 0, 100) / 100;
  const massBase = kart.archetype === 'power' ? 210 : kart.archetype === 'agile' ? 155 : 180;
  return {
    topSpeed: 25.5 + n(stats.speed) * 16.5,              // 25.5 - 42 m/s
    accel: 11.0 + n(stats.accel) * 14.0,
    brake: 22.0 + n(stats.accel) * 8.0,
    grip: 13.5 + n(stats.grip) * 15.0,
    // A drift holds about three quarters of the grip a clean line does. The
    // cost of drifting is committing to a direction, not losing the corner —
    // set this much lower and the optimal way to play is never to drift, which
    // throws away the boost economy the whole game is built on.
    driftGrip: 10.5 + n(stats.grip) * 11.0,
    turnRate: 1.42 + n(stats.grip) * 0.50,
    driftTurnBonus: 0.52 + n(stats.drift) * 0.46,
    driftCharge: 0.62 + n(stats.drift) * 0.72,
    boostPower: 1.22 + n(stats.speed) * 0.14,
    boostDuration: 1.05 + n(stats.drift) * 0.55,
    airControl: 1.55 + n(stats.air) * 1.60,
    landingWindow: 0.42 + n(stats.air) * 0.40,
    mass: massBase * (0.86 + n(stats.armor) * 0.34),
    knockResist: clamp(n(stats.armor) * 0.55, 0, 0.7),
    respawnTime: 1.85 - n(stats.accel) * 0.35,
    radius: kart.size.width * 0.52,
  };
}

export interface ResolveOptions {
  playerId: string;
  budget: number;
  /** Ranked normalises every loadout back toward the kart baseline. */
  normalize?: boolean;
  now?: number;
}

export function resolveLoadout(
  axie: AxieDefinition,
  kart: KartDefinition,
  parts: LoadoutParts,
  opts: ResolveOptions,
): ValidatedLoadout {
  const problems: string[] = [];
  const contrib = axieContribution(axie);
  const stats = {} as StatBlock;
  for (const k of STAT_KEYS) stats[k] = kart.base[k] + contrib[k];

  const traits = new Set<PartTrait | 'class'>();
  for (const t of CLASS_TRAITS[axie.class]) traits.add(t);

  let budgetUsed = 0;
  const perStatAdd = {} as StatBlock;
  for (const k of STAT_KEYS) perStatAdd[k] = 0;

  for (const slot of Object.keys(parts) as SlotId[]) {
    const fitted = parts[slot];
    let def;
    try {
      def = partById(fitted.partId);
    } catch {
      problems.push(`Unknown part in ${slot} slot: ${fitted.partId}`);
      continue;
    }
    if (def.slot !== slot) {
      problems.push(`${def.name} does not fit the ${slot} slot.`);
      continue;
    }
    if (!kart.compatibleSlots.includes(slot)) {
      problems.push(`${kart.name} has no ${slot} slot.`);
      continue;
    }
    const level = clamp(Math.round(fitted.level), 1, def.maxLevel);
    if (level !== fitted.level) problems.push(`${def.name} level clamped to ${level}.`);
    const scale = levelCurve(level);
    for (const k of STAT_KEYS) {
      const m = (def.mods[k] ?? 0) * scale;
      if (m !== 0) perStatAdd[k] += m;
    }
    for (const t of def.traits ?? []) traits.add(t);
    budgetUsed += partCost(def, level);
  }

  // Per-stat cap, then the total budget. Both trim rather than reject, so a
  // player can always race — they just race the legal version of their kart.
  for (const k of STAT_KEYS) {
    if (perStatAdd[k] > PER_STAT_CAP) {
      problems.push(`${k} gain capped at +${PER_STAT_CAP}.`);
      perStatAdd[k] = PER_STAT_CAP;
    }
  }
  if (budgetUsed > opts.budget) {
    const scale = opts.budget / budgetUsed;
    problems.push(`Loadout over budget (${budgetUsed.toFixed(1)}/${opts.budget}); modifiers scaled to ${(scale * 100).toFixed(0)}%.`);
    for (const k of STAT_KEYS) if (perStatAdd[k] > 0) perStatAdd[k] *= scale;
    budgetUsed = opts.budget;
  }

  for (const k of STAT_KEYS) stats[k] = clamp(stats[k] + perStatAdd[k], 1, 100);

  if (opts.normalize) {
    // Ranked pulls every stat 30% of the way back to the kart's baseline. The
    // shape of a build survives; the magnitude of an advantage does not.
    for (const k of STAT_KEYS) stats[k] = stats[k] + (kart.base[k] - stats[k]) * 0.30;
  }

  const handling = applyClassPassives(axie.class, statsToHandling(stats, kart));
  if (traits.has('long-boost')) handling.boostDuration *= 1.25;
  if (traits.has('fast-charge')) handling.driftCharge *= 1.20;
  if (traits.has('soft-landing')) handling.landingWindow *= 1.25;
  if (traits.has('heavy')) { handling.mass *= 1.12; handling.turnRate *= 0.95; }

  const partSig = (Object.keys(parts) as SlotId[])
    .sort()
    .map((s) => `${s}:${parts[s].partId}@${parts[s].level}`)
    .join('|');
  const now = opts.now ?? Date.now();
  const validationToken = hashString(
    `${RULES_VERSION}|${opts.playerId}|${axie.id}|${kart.id}|${partSig}|${opts.budget}|${opts.normalize ? 'n' : 'o'}`,
  ).toString(36);

  return {
    playerId: opts.playerId,
    axieId: axie.id,
    kartId: kart.id,
    parts,
    stats,
    handling,
    traits,
    axieClass: axie.class,
    budgetUsed,
    budgetMax: opts.budget,
    valid: problems.length === 0,
    problems,
    rulesVersion: RULES_VERSION,
    schemaVersion: SCHEMA_VERSION,
    validationToken,
    expiresAt: now + 30 * 60 * 1000,
  };
}

/** Short description of the class passive, for the garage and Axie Select. */
export function classTraitText(cls: AxieClass): string {
  const t = CLASS_TRAIT[cls];
  return `${t.name} — ${t.blurb}`;
}

/** Sum of the six garage stats; used only for display ordering. */
export function statTotal(s: StatBlock): number {
  let t = 0;
  for (const k of STAT_KEYS) t += s[k];
  return t;
}
