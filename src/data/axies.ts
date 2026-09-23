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
  /** The chassis this Axie is paired with by default: the one whose base
   *  stats cover the class's weakest contribution (Beast/Bing → the agile
   *  Dartwing; Bird's low HP → the armoured Terrapin; Bug's low speed → the
   *  Moonshard; Aquatic's low morale (drift/air) → the Frostsled; Reptile's
   *  low skill (grip) → the Dunerunner). Picking the Axie picks this too. */
  defaultKart: string;
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
  /** The official mascot model this driver IS — a self-contained glb from
   *  the Axie 3D asset pack (jaatster/axie-3d-assets). Seated in preference
   *  to the Mixer build; the Mixer descriptor stays as the fallback. */
  mascot?: { file: string; scale: number; offset: [number, number, number]; pitch: number; yaw: number };
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

// Bing — Beast, the white pup with the ice-cream cone (Atia's Legacy trainee
// soldier; cards: Puppy, Toy Ball, Cone Shell, Shiba).
const BING_PARTS: AxiePart[] = [
  mk('eyes', 'Puppy', 'Beast'),
  mk('ears', 'Puppy', 'Beast'),
  mk('horn', 'Cone Shell', 'Aquatic'),
  mk('mouth', 'Shiba', 'Beast'),
  mk('back', 'Toy Ball', 'Beast'),
  mk('tail', 'Shiba', 'Beast'),
];
const PUFFY_PARTS: AxiePart[] = [
  mk('eyes', 'Gero', 'Aquatic'),
  mk('ears', 'Nimo', 'Aquatic'),
  mk('horn', 'Oranda', 'Aquatic'),
  mk('mouth', 'Risky Fish', 'Aquatic'),
  mk('back', 'Hermit', 'Bug'),
  mk('tail', 'Nimo', 'Aquatic'),
];
// Pomodoro is a Bug — an Origins starter unlocked by mission, "good at
// granting Shields". Part names below are demo data; the class is the truth.
const POMODORO_PARTS: AxiePart[] = [
  mk('eyes', 'Bookworm', 'Bug'),
  mk('ears', 'Larva', 'Bug'),
  mk('horn', 'Antenna', 'Bug'),
  mk('mouth', 'Mosquito', 'Bug'),
  mk('back', 'Sandal', 'Bug'),
  mk('tail', 'Gravel Ant', 'Bug'),
];

// Momo — Bird. Pink, with feathery ears and a big-sister bow (her cards:
// Feathery Dart, Big Sister, Lil Bro, Death Shower, Feathery Earrings).
const MOMO_PARTS: AxiePart[] = [
  mk('eyes', 'Mavis', 'Bird'),
  mk('ears', 'Feathery Earrings', 'Bird'),
  mk('horn', 'Feather Spear', 'Bird'),
  mk('mouth', 'Little Owl', 'Bird'),
  mk('back', 'Balloon', 'Bird'),
  mk('tail', 'Feather Fan', 'Bird'),
];
// Venoki — Reptile. Purple, poisonous, a death-shroom on the back and a
// centipede tail (her cards: Funky, Chemical Fang, Venom Hall, Poison Tube,
// Death Shroom, Centipede, Poison Vial).
const VENOKI_PARTS: AxiePart[] = [
  mk('eyes', 'Gecko', 'Reptile'),
  mk('ears', 'Funky', 'Reptile'),
  mk('horn', 'Poison Tube', 'Reptile'),
  mk('mouth', 'Chemical Fang', 'Reptile'),
  mk('back', 'Death Shroom', 'Plant'),
  mk('tail', 'Centipede', 'Bug'),
];

/** The five drivers: the three Origins starters and the two Season 5 ones.
 *
 *  Named for the three models in the official Axie 3D starter toolkit so the
 *  real FBX + animation set drops straight into these definitions. Class, parts
 *  and palette below are demo data authored for this build, not fetched
 *  on-chain traits — see docs/COMPLIANCE.md.
 */
export const AXIES: AxieDefinition[] = [
  {
    id: 'mock-bing',
    defaultKart: 'kart-dartwing',
    name: 'Bing',
    class: 'Beast',
    parts: BING_PARTS,
    palette: { body: '#e9e4d6', accent: '#e9d84a', shade: '#8a7a66' },
    tagline: 'Trainee soldier. All nerve, no brakes.',
    bio: 'Bing races the way a pup chases a ball: flat out and sideways. The highest Morale in the field turns every long drift into a bigger payoff, and the Beast temperament means the boost hits harder when it finally lets go.',
    rig: { scale: 0.92, seatOffset: [0, 0.34, -0.08], seatPitch: -0.06, bounds: [0.42, 0.40, 0.46] },
    mixer: mixerFor(BING_PARTS, 'normal', 0 /* beast fdfcf2: white */, { eyes: 4, mouth: 2, ears: 6, horn: 4, back: 8, tail: 2 }),
    mixerSeat: { scale: 0.62, offset: [0, 0.16, -0.10], pitch: 0 },
    mascot: { file: 'axies/mascots/bing.glb', scale: 0.52, offset: [0, 0.12, -0.04], pitch: 0, yaw: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
  {
    id: 'mock-puffy',
    defaultKart: 'kart-frostsled',
    name: 'Puffy',
    class: 'Aquatic',
    parts: PUFFY_PARTS,
    palette: { body: '#4fb8ff', accent: '#e0f4ff', shade: '#1d6f97' },
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
    defaultKart: 'kart-moonshard',
    name: 'Pomodoro',
    class: 'Bug',
    parts: POMODORO_PARTS,
    palette: { body: '#e8574f', accent: '#9fe07a', shade: '#8a2a2a' },
    tagline: 'Shields up. Nothing moves Pomodoro.',
    bio: 'A Bug through and through: six Bug parts pour their Morale into Skitter, so a respawn costs Pomodoro less than anyone, and the shielded temperament shrugs off gator jaws, gates and a rival diving up the inside.',
    rig: { scale: 0.95, seatOffset: [0, 0.35, -0.09], seatPitch: -0.05, bounds: [0.44, 0.41, 0.47] },
    mixer: mixerFor(POMODORO_PARTS, 'sumo', 19 /* bug ff606c */, { eyes: 10, mouth: 4, ears: 12, horn: 6, back: 4, tail: 8 }),
    mixerSeat: { scale: 0.64, offset: [0, 0.17, -0.11], pitch: 0 },
    mascot: { file: 'axies/mascots/pomodoro.glb', scale: 0.56, offset: [0, 0.13, -0.05], pitch: 0, yaw: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
];

AXIES.push(
  {
    id: 'mock-momo',
    defaultKart: 'kart-terrapin',
    name: 'Momo',
    class: 'Bird',
    parts: MOMO_PARTS,
    palette: { body: '#ff9ec2', accent: '#fff0f6', shade: '#c2557f' },
    tagline: 'Big sister energy.',
    bio: 'Momo is the fastest thing in the air: Bird speed and Updraft hang time turn every jump into a shortcut, and a Feathery Dart of a class special that gets her clear of a scrap.',
    rig: { scale: 0.88, seatOffset: [0, 0.32, -0.06], seatPitch: -0.04, bounds: [0.40, 0.38, 0.44] },
    mixer: mixerFor(MOMO_PARTS, 'normal', 24 /* bird ff99b0 */, { eyes: 2, mouth: 8, ears: 4, horn: 6, back: 10, tail: 2 }),
    mixerSeat: { scale: 0.60, offset: [0, 0.15, -0.08], pitch: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
  {
    id: 'mock-venoki',
    defaultKart: 'kart-dunerunner',
    name: 'Venoki',
    class: 'Reptile',
    parts: VENOKI_PARTS,
    palette: { body: '#a86fd0', accent: '#e8c8ff', shade: '#5a2f7a' },
    tagline: 'Everything she touches wilts.',
    bio: 'Venoki holds grip on the loose stuff — dirt, mud, ice — where everyone else is sliding, and her Poison Vial special leaves a slick behind her that the pack has to steer around.',
    rig: { scale: 0.92, seatOffset: [0, 0.34, -0.08], seatPitch: -0.06, bounds: [0.42, 0.40, 0.46] },
    mixer: mixerFor(VENOKI_PARTS, 'normal', 30 /* reptile 9967fb */, { eyes: 10, mouth: 4, ears: 8, horn: 12, back: 6, tail: 4 }),
    mixerSeat: { scale: 0.62, offset: [0, 0.16, -0.10], pitch: 0 },
    source: 'mock-local',
    schemaVersion: 4,
  },
);

export function axieById(id: string): AxieDefinition {
  const a = AXIES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown axie: ${id}`);
  return a;
}
