/** Kart content data.
 *
 *  A kart is an archetype (Agile / Balanced / Power) plus a seat contract.
 *  The seat sockets are what make "three Axies x three karts" nine working
 *  combinations instead of nine hand-placed one-offs.
 */

export type KartArchetype = 'agile' | 'balanced' | 'power';

/** The six stats a player sees in the garage, 0-100. Everything the physics
 *  needs is derived from these, so the UI never lies about the car. */
export interface StatBlock {
  speed: number;
  accel: number;
  grip: number;
  drift: number;
  air: number;
  armor: number;
}
export type StatKey = keyof StatBlock;
export const STAT_KEYS: StatKey[] = ['speed', 'accel', 'grip', 'drift', 'air', 'armor'];
export const STAT_LABEL: Record<StatKey, string> = {
  speed: 'Top Speed',
  accel: 'Acceleration',
  grip: 'Grip',
  drift: 'Drift Charge',
  air: 'Air Control',
  armor: 'Armor',
};
export const STAT_BLURB: Record<StatKey, string> = {
  speed: 'How fast the kart will ultimately run on a straight.',
  accel: 'How quickly it reaches that speed, and recovers after a hit.',
  grip: 'How much cornering force it holds before the tyres let go.',
  drift: 'How fast a held drift fills the boost meter.',
  air: 'Pitch and roll authority in the air, and landing forgiveness.',
  armor: 'Resistance to knockback from rivals, walls and hazards.',
};

export interface SeatSockets {
  /** Driver seat, in kart local space (x right, y up, z forward). */
  seat: [number, number, number];
  /** Where the driver's hands rest. */
  handle: [number, number, number];
  /** Foot / pedal contact. */
  pedal: [number, number, number];
  /** Where the chase camera anchors. */
  cameraLook: [number, number, number];
  /** Exhaust / boost flame origin, mirrored on x. */
  exhaust: [number, number, number];
}

export interface KartDefinition {
  id: string;
  name: string;
  archetype: KartArchetype;
  tagline: string;
  bio: string;
  /** Base stats before the Axie and any parts are applied. */
  base: StatBlock;
  /** What the vehicle is: a kart on four wheels, a motorcycle, or a hover
   *  glider. Physics is shared; the body decides the model and its idle motion. */
  body: 'kart' | 'bike' | 'hover' | 'quad' | 'sled';
  /** Physical dimensions, metres — drives the model and the collision radius. */
  size: { length: number; width: number; height: number; wheelRadius: number; wheelbase: number };
  sockets: SeatSockets;
  palette: { body: string; trim: string; metal: string };
  /** Slots this chassis exposes. All three expose all seven in this build. */
  compatibleSlots: string[];
  schemaVersion: number;
}

export const KARTS: KartDefinition[] = [
  {
    id: 'kart-dartwing',
    body: 'kart',
    name: 'Dartwing',
    archetype: 'agile',
    tagline: 'Turns in before you finish the thought.',
    bio: 'A light open-frame kart built around a short wheelbase. It changes direction faster than anything else on the grid and fills the drift meter quickest, but it gives ground back on the long straights and it does not like being hit.',
    base: { speed: 62, accel: 78, grip: 74, drift: 84, air: 76, armor: 46 },
    size: { length: 2.35, width: 1.42, height: 0.78, wheelRadius: 0.30, wheelbase: 1.55 },
    sockets: {
      seat: [0, 0.40, -0.16],
      handle: [0, 0.62, 0.42],
      pedal: [0, 0.22, 0.60],
      cameraLook: [0, 0.70, 0.30],
      exhaust: [0.34, 0.38, -1.05],
    },
    palette: { body: '#ff7a52', trim: '#ffd166', metal: '#3a3f4b' },
    compatibleSlots: ['chassis', 'engine', 'tires', 'suspension', 'boost', 'aero', 'paint'],
    schemaVersion: 3,
  },
  {
    id: 'kart-moonshard',
    body: 'bike',
    name: 'Moonshard',
    archetype: 'balanced',
    tagline: 'No weak sector.',
    bio: 'The tuning baseline. Moonshard has no standout number and no hole either, which makes it the kart to learn a new track on and the hardest one to argue with once a lap is memorised.',
    base: { speed: 72, accel: 76, grip: 64, drift: 74, air: 70, armor: 60 },
    size: { length: 2.55, width: 1.52, height: 0.82, wheelbase: 1.72, wheelRadius: 0.33 },
    sockets: {
      seat: [0, 0.42, -0.14],
      handle: [0, 0.64, 0.46],
      pedal: [0, 0.23, 0.66],
      cameraLook: [0, 0.72, 0.32],
      exhaust: [0.38, 0.40, -1.16],
    },
    palette: { body: '#7c8cff', trim: '#d8e0ff', metal: '#2f3442' },
    compatibleSlots: ['chassis', 'engine', 'tires', 'suspension', 'boost', 'aero', 'paint'],
    schemaVersion: 3,
  },
  {
    id: 'kart-terrapin',
    body: 'hover',
    name: 'Terrapin',
    archetype: 'power',
    tagline: 'Arrives, and stays arrived.',
    bio: 'Heavy, wide and stubborn. Terrapin launches hardest, lands flattest off the big jumps and simply does not move when a rival leans on it. The price is a lazy rotation that punishes anyone who brakes late.',
    base: { speed: 80, accel: 60, grip: 64, drift: 58, air: 56, armor: 88 },
    size: { length: 2.78, width: 1.66, height: 0.88, wheelbase: 1.88, wheelRadius: 0.36 },
    sockets: {
      seat: [0, 0.45, -0.18],
      handle: [0, 0.68, 0.50],
      pedal: [0, 0.25, 0.72],
      cameraLook: [0, 0.76, 0.34],
      exhaust: [0.44, 0.44, -1.28],
    },
    palette: { body: '#3fbf7f', trim: '#d9f7c0', metal: '#2a3630' },
    compatibleSlots: ['chassis', 'engine', 'tires', 'suspension', 'boost', 'aero', 'paint'],
    schemaVersion: 3,
  },
  {
    id: 'kart-dunerunner',
    body: 'quad',
    name: 'Dunerunner',
    archetype: 'balanced',
    tagline: 'Four fat tyres and no manners.',
    bio: 'A quad bike on balloon tyres, tuned to the Moonshard baseline so the choice is the ride, not the numbers. It sits the driver up high with the bars in hand and squats hard on the landings.',
    base: { speed: 72, accel: 68, grip: 84, drift: 58, air: 66, armor: 68 },
    size: { length: 2.35, width: 1.62, height: 0.90, wheelbase: 1.50, wheelRadius: 0.40 },
    sockets: {
      seat: [0, 0.60, -0.10],
      handle: [0, 0.86, 0.44],
      pedal: [0, 0.30, 0.60],
      cameraLook: [0, 0.80, 0.30],
      exhaust: [0.30, 0.44, -1.05],
    },
    palette: { body: '#f2a33a', trim: '#3a3f4b', metal: '#4a4f5b' },
    compatibleSlots: ['chassis', 'engine', 'tires', 'suspension', 'boost', 'aero', 'paint'],
    schemaVersion: 3,
  },
  {
    id: 'kart-frostsled',
    body: 'sled',
    name: 'Frostsled',
    archetype: 'balanced',
    tagline: 'Skis up front, a track behind.',
    bio: 'A snow racer: two steering skis and a driven rear track, tuned to the Moonshard baseline. It looks born for Winterblue and it runs the same everywhere else.',
    base: { speed: 72, accel: 62, grip: 66, drift: 86, air: 60, armor: 70 },
    size: { length: 2.70, width: 1.40, height: 0.86, wheelbase: 1.80, wheelRadius: 0.32 },
    sockets: {
      seat: [0, 0.52, -0.20],
      handle: [0, 0.80, 0.42],
      pedal: [0, 0.26, 0.60],
      cameraLook: [0, 0.76, 0.30],
      exhaust: [0.26, 0.42, -1.20],
    },
    palette: { body: '#5fc8e8', trim: '#f4f9ff', metal: '#3a4a58' },
    compatibleSlots: ['chassis', 'engine', 'tires', 'suspension', 'boost', 'aero', 'paint'],
    schemaVersion: 3,
  },
];

export function kartById(id: string): KartDefinition {
  const k = KARTS.find((x) => x.id === id);
  if (!k) throw new Error(`Unknown kart: ${id}`);
  return k;
}
