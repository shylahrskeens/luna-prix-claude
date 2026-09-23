/** Axie content data.
 *
 *  The shape below mirrors the Sky Mavis Axie payload (id, class, six body
 *  parts each with their own class, and the four battle stats). Nothing in the
 *  game reads a made-up field: `resolveAxieStats` recomputes HP/Speed/Skill/
 *  Morale from class base + part classes exactly the way the Axie stat model
 *  does, so when a real fetched Axie replaces one of these mocks the driving
 *  numbers come out right with no extra mapping code.
 */

export type AxieClass =
  | 'Beast' | 'Aquatic' | 'Plant' | 'Bird' | 'Bug' | 'Reptile' | 'Mech' | 'Dawn' | 'Dusk';

export type PartType = 'eyes' | 'ears' | 'back' | 'mouth' | 'horn' | 'tail';

export interface AxiePart {
  id: string;
  name: string;
  /** The part's own class, which is what contributes the stat point. */
  class: AxieClass;
  type: PartType;
  specialGenes: string | null;
}

export interface AxieStats {
  hp: number;
  speed: number;
  skill: number;
  morale: number;
}

/** The Sky Mavis Mixer 3D descriptor — the same shape the toolkit decodes
 *  from a real Axie's genes (body, colour variant, six typed parts). The
 *  content pack carries the six original classes only; a Mech, Dawn or Dusk
 *  part has no mesh and tools/axiecheck.ts refuses it. */
export type MixerBody = 'normal' | 'spiky' | 'fuzzy' | 'curly' | 'sumo' | 'wetdog' | 'bigyak' | 'frosty';
export type MixerPartClass = 'Aquatic' | 'Beast' | 'Bird' | 'Bug' | 'Plant' | 'Reptile';
export type MixerPartType = 'eye' | 'mouth' | 'ear' | 'horn' | 'back' | 'tail';
export interface MixerPartDescriptor {
  type: MixerPartType;
  class: MixerPartClass;
  /** Even numbers; eye and mouth offer 2/4/8/10, the rest 2–12. */
  variant: number;
  skin: number;
  level: number;
}
export interface MixerDescriptor {
  body: MixerBody;
  /** Index into the pack's creator.colorVariants table (0–66); the planner
   *  matches on that index, not on the per-class genes value. */
  colorVariant: number;
  parts: MixerPartDescriptor[];
}

export interface AxieDefinition {
  /** Axie token id in production; a stable mock id here. */
  id: string;
  name: string;
  class: AxieClass;
  parts: AxiePart[];
  /** Colour identity used by the procedural model and the UI. */
  palette: { body: string; accent: string; shade: string };
  /** Flavour shown in Axie Select. */
  tagline: string;
  bio: string;
  /** Rig/seat contract — see render/axieMesh.ts and the seat socket system. */
  rig: {
    /** Metres. Scales the whole model so every Axie sits correctly. */
    scale: number;
    /** Offset applied at the kart's driver-seat socket, in kart local space. */
    seatOffset: [number, number, number];
    /** Extra pitch applied when seated, radians. */
    seatPitch: number;
    /** Half-extents of the driver collision proxy. */
    bounds: [number, number, number];
  };
  /** Real body and parts for the Mixer 3D character. Classes agree with
   *  `parts` above, so the stat model and the model on screen are one Axie. */
  mixer: MixerDescriptor;
  /** How the Mixer character sits: metres scale, seat-socket offset, pitch. */
  mixerSeat: { scale: number; offset: [number, number, number]; pitch: number };
  /** Where this definition came from, for the asset/IP audit trail. */
  source: 'mock-local';
  schemaVersion: number;
}

/** Axie class base stats (the classic four-stat model). */
export const CLASS_BASE: Record<AxieClass, AxieStats> = {
  Beast:   { hp: 31, speed: 35, skill: 31, morale: 43 },
  Aquatic: { hp: 39, speed: 39, skill: 35, morale: 27 },
  Plant:   { hp: 43, speed: 31, skill: 31, morale: 35 },
  Bird:    { hp: 27, speed: 43, skill: 35, morale: 35 },
  Bug:     { hp: 35, speed: 31, skill: 35, morale: 39 },
  Reptile: { hp: 39, speed: 35, skill: 31, morale: 35 },
  Mech:    { hp: 31, speed: 39, skill: 43, morale: 27 },
  Dawn:    { hp: 35, speed: 39, skill: 39, morale: 27 },
  Dusk:    { hp: 43, speed: 39, skill: 27, morale: 31 },
};

/** Which stat a part of a given class contributes its +3 to. */
const PART_STAT: Record<AxieClass, keyof AxieStats> = {
  Beast: 'morale', Bug: 'morale', Plant: 'hp', Reptile: 'hp',
  Aquatic: 'speed', Bird: 'speed', Mech: 'skill', Dawn: 'skill', Dusk: 'morale',
};
const PART_BONUS = 3;

/** base(class) + 3 per part, by the part's class. */
export function resolveAxieStats(axie: Pick<AxieDefinition, 'class' | 'parts'>): AxieStats {
  const base = CLASS_BASE[axie.class];
  const s: AxieStats = { ...base };
  for (const p of axie.parts) s[PART_STAT[p.class]] += PART_BONUS;
  return s;
}

/** Class passive — the one line of personality that shows up in every corner. */
export interface ClassTrait {
  name: string;
  blurb: string;
}
export const CLASS_TRAIT: Record<AxieClass, ClassTrait> = {
  Beast:   { name: 'Wild Streak',   blurb: 'Drift boosts release 18% stronger.' },
  Aquatic: { name: 'Slipstream',    blurb: 'Shallow water costs no speed; draft builds faster.' },
  Plant:   { name: 'Rooted',        blurb: 'Takes 35% less knockback from hits and hazards.' },
  Bird:    { name: 'Updraft',       blurb: 'Sharper air control and a longer hang time.' },
  Bug:     { name: 'Skitter',       blurb: 'Respawns 40% faster and keeps more speed.' },
  Reptile: { name: 'Scale Grip',    blurb: 'Holds grip on dirt, mud and loose stone.' },
  Mech:    { name: 'Cold Start',    blurb: 'Bigger launch window and a stronger start boost.' },
  Dawn:    { name: 'First Light',   blurb: 'Boost pads and rings recharge faster.' },
  Dusk:    { name: 'Long Shadow',   blurb: 'Boost lasts longer once lit.' },
};

const MIXER_TYPE: Record<PartType, MixerPartType> = {
  eyes: 'eye', ears: 'ear', back: 'back', mouth: 'mouth', horn: 'horn', tail: 'tail',
};

/** Build the Mixer descriptor from the same six parts the stat model reads,
 *  so a class can never disagree between the two. `variants` picks the mesh
 *  for each part type. */
function mixerFor(
  parts: AxiePart[], body: MixerBody, colorVariant: number, variants: Record<PartType, number>,
): MixerDescriptor {
  const order: PartType[] = ['eyes', 'mouth', 'ears', 'horn', 'back', 'tail'];
  return {
    body, colorVariant,
    parts: order.map((t) => {
      const p = parts.find((x) => x.type === t);
      if (!p) throw new Error(`Axie has no ${t} part`);
      return { type: MIXER_TYPE[t], class: p.class as MixerPartClass, variant: variants[t], skin: 0, level: 1 };
    }),
  };
}

const mk = (type: PartType, name: string, cls: AxieClass, special: string | null = null): AxiePart => ({
  id: `${type}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name, class: cls, type, specialGenes: special,
});

const BUBA_PARTS: AxiePart[] = [
  mk('eyes', 'Puppy', 'Beast'),
  mk('ears', 'Nut Cracker', 'Beast'),
  mk('horn', 'Little Branch', 'Plant'),
  mk('mouth', 'Axie Kiss', 'Bird'),
  mk('back', 'Ronin', 'Beast'),
  mk('tail', 'Hare', 'Beast'),
];
const PUFFY_PARTS: AxiePart[] = [
  mk('eyes', 'Gero', 'Aquatic'),
  mk('ears', 'Nimo', 'Aquatic'),
  mk('horn', 'Oranda', 'Aquatic'),
  mk('mouth', 'Risky Fish', 'Aquatic'),
  mk('back', 'Hermit', 'Bug'),
  mk('tail', 'Nimo', 'Aquatic'),
];
const POMODORO_PARTS: AxiePart[] = [
  mk('eyes', 'Papi', 'Plant'),
  mk('ears', 'Leafy', 'Plant'),
  mk('horn', 'Cactus', 'Plant'),
  mk('mouth', 'Serious', 'Plant'),
  mk('back', 'Turnip', 'Plant'),
  mk('tail', 'Carrot', 'Plant'),
];

/** The three mock drivers.
 *
 *  Named for the three models in the official Axie 3D starter toolkit so the
 *  real FBX + animation set drops straight into these definitions. Class, parts
 *  and palette below are demo data authored for this build, not fetched
 *  on-chain traits — see docs/COMPLIANCE.md.
 */
export const AXIES: AxieDefinition[] = [
  {
    id: 'mock-buba',
    name: 'Buba',
    class: 'Beast',
    parts: BUBA_PARTS,
    palette: { body: '#f6a44a', accent: '#ffe08a', shade: '#b55f1c' },
    tagline: 'All nerve, no brakes.',
    bio: 'Buba races the way Buba does everything: flat out and sideways. The highest Morale in the field turns every long drift into a bigger payoff, and the Beast temperament means the boost hits harder when it finally lets go.',
    rig: { scale: 0.92, seatOffset: [0, 0.34, -0.08], seatPitch: -0.06, bounds: [0.42, 0.40, 0.46] },
    mixer: mixerFor(BUBA_PARTS, 'normal', 4 /* beast f5a037 */, { eyes: 4, mouth: 2, ears: 6, horn: 4, back: 8, tail: 2 }),
    mixerSeat: { scale: 0.62, offset: [0, 0.16, -0.10], pitch: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
  {
    id: 'mock-puffy',
    name: 'Puffy',
    class: 'Aquatic',
    parts: PUFFY_PARTS,
    palette: { body: '#5fc8f0', accent: '#d8f6ff', shade: '#1d6f97' },
    tagline: 'Finds the fast water.',
    bio: 'Puffy has the highest raw Speed on the grid and does not lose a metre to the swamp shallows or the reactor coolant. Slipstream builds faster behind a rival, so Puffy is happiest sitting second until the last sector.',
    rig: { scale: 0.88, seatOffset: [0, 0.32, -0.06], seatPitch: -0.04, bounds: [0.40, 0.38, 0.44] },
    mixer: mixerFor(PUFFY_PARTS, 'normal', 15 /* aquatic 00b8ff */, { eyes: 2, mouth: 8, ears: 4, horn: 10, back: 6, tail: 12 }),
    mixerSeat: { scale: 0.60, offset: [0, 0.15, -0.08], pitch: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
  {
    id: 'mock-pomodoro',
    name: 'Pomodoro',
    class: 'Plant',
    parts: POMODORO_PARTS,
    palette: { body: '#7fd46a', accent: '#e9ffd4', shade: '#2f7a2c' },
    tagline: 'Nothing moves Pomodoro.',
    bio: 'Six Plant parts stack the highest HP in the game into pure contact tolerance. Gator jaws, reactor gates and a rival diving up the inside all bounce off. Slowest to spin up, hardest to shift off the racing line.',
    rig: { scale: 0.95, seatOffset: [0, 0.35, -0.09], seatPitch: -0.05, bounds: [0.44, 0.41, 0.47] },
    mixer: mixerFor(POMODORO_PARTS, 'sumo', 10 /* plant 99ff73 */, { eyes: 10, mouth: 4, ears: 12, horn: 6, back: 4, tail: 8 }),
    mixerSeat: { scale: 0.64, offset: [0, 0.17, -0.11], pitch: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
];

export function axieById(id: string): AxieDefinition {
  const a = AXIES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown axie: ${id}`);
  return a;
}
