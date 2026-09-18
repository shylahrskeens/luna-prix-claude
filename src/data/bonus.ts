/** Bonus events: short, repeatable skill challenges built on the same kart.
 *
 *  Both events run through one shared interface — countdown, attempt, score,
 *  medal, personal best, instant restart, leaderboard-ready result — so a
 *  third event is a data entry and a scoring function, not a new screen.
 */
import { buildRouteFull, type RouteSeg } from './route';
import { at, span } from './trackHelpers';
import type { TrackDefinition } from '../sim/trackTypes';

export type BonusKind = 'megaRamp' | 'gauntlet';

export interface MedalThresholds {
  bronze: number;
  silver: number;
  gold: number;
}

export interface BonusEventDefinition {
  id: string;
  name: string;
  tagline: string;
  /** What the player is being asked to do, in one paragraph. */
  brief: string;
  kind: BonusKind;
  track: TrackDefinition;
  /** Higher score wins (distance) or lower wins (time). */
  higherIsBetter: boolean;
  unit: string;
  medals: MedalThresholds;
  /** Seconds before an attempt is abandoned. */
  timeLimit: number;
  /** Unlock gate. */
  unlock: { kind: 'races'; value: number } | null;
}

// ---------------------------------------------------------------------------
// Mega Ramp — the hero event.
//
// A long runway, one launch-angle decision, and a landing slope that falls away
// at 28 degrees so distance scales with how much speed you carried into the
// lip. Everything about the geometry is chosen so a competent run lands between
// 60 and 150 metres, which makes the distance markers readable and the gap
// between a bronze and a gold something a player can feel.
// ---------------------------------------------------------------------------

const RAMP_SEGS: RouteSeg[] = [
  { t: 'straight', len: 90, w: 16, mark: 'stage' },
  { t: 'straight', len: 230, w: 15, mark: 'runway' },
  { t: 'straight', len: 46, dy: 16, w: 13, mark: 'ramp' },
  // The landing hill. It starts at the lip and drops steeply, so a kart that
  // launches harder simply flies further down it.
  { t: 'straight', len: 330, dy: -175, w: 26, mark: 'landing' },
  { t: 'straight', len: 120, dy: -18, w: 26, mark: 'runout' },
  { t: 'straight', len: 90, w: 26, mark: 'catch' },
];

const rampRoute = buildRouteFull(RAMP_SEGS, { width: 16, spacing: 7, start: [0, 200, 0], heading: 0 });
const RM = rampRoute.marks;

export const MEGA_RAMP_TRACK: TrackDefinition = {
  id: 'event-megaramp',
  name: 'Mega Ramp',
  subtitle: 'Long jump • distance and style',
  setPiece: 'One ramp, one landing, one number.',
  difficulty: 2,
  laps: 1,
  closed: false,
  nodes: rampRoute.nodes,
  checkpointCount: 6,
  start: { s: 0.005, rows: 1, colGap: 5, rowGap: 6 },
  killY: -400,
  shoulder: 5,
  unlock: null,
  zones: [
    { from: 0, to: 1, surface: 'road', wall: 'both', shoulder: 5 },
    { ...span(RM.stage, 0, 1), surface: 'metal', wall: 'both', shoulder: 3, label: 'Staging' },
    { ...span(RM.runway, 0, 1), surface: 'road', wall: 'both', shoulder: 4, label: 'Runway' },
    { ...span(RM.ramp, 0, 1), surface: 'metal', wall: 'both', shoulder: 2, label: 'Ramp' },
    { ...span(RM.landing, 0, 1), surface: 'dirt', wall: 'none', shoulder: 9, label: 'Landing Hill' },
    { ...span(RM.runout, 0, 1), surface: 'dirt', wall: 'none', shoulder: 9, label: 'Run-out' },
    { ...span(RM.catch, 0, 1), surface: 'grass', wall: 'both', shoulder: 9, label: 'Catch' },
  ],
  boostPads: [
    // The risky line: a pad you can only take flat out and straight.
    { s: at(RM.runway, 0.30), lat: 0, len: 22, w: 7 },
    { s: at(RM.runway, 0.62), lat: 0, len: 22, w: 7 },
    { s: at(RM.runway, 0.88), lat: 0, len: 22, w: 6 },
  ],
  branches: [],
  hazards: [],
  theme: {
    sky: ['#4f8fd6', '#ffd2a0'],
    fog: '#cddcee',
    fogNear: 120,
    fogFar: 900,
    sun: '#fff4dc',
    sunDir: [0.5, 0.7, -0.5],
    ambient: '#8fa8c4',
    ground: '#8c9a6e',
    roadTop: '#5f6672',
    roadEdge: '#ffb23f',
    rail: '#b9c2d0',
    accent: '#ffb23f',
    scenery: 'cloud',
  },
  schemaVersion: 3,
};

// ---------------------------------------------------------------------------
// Gator Gauntlet — the second event.
//
// A chain of narrow islands over open swamp, each separated by a gap you have
// to jump, with gator jaws on fixed cycles between them. Scored on time, with
// the clean-chain bonus doing the real work: a single reset costs more than
// slowing down for a bite cycle ever does.
// ---------------------------------------------------------------------------

const island = (len: number, mark: string): RouteSeg => ({ t: 'straight', len, w: 6.5, mark });
const hop = (len: number, mark: string, rise = 0): RouteSeg => ({ t: 'straight', len, dy: rise, w: 6.5, mark });

const GAUNTLET_SEGS: RouteSeg[] = [
  island(60, 'start'),
  hop(14, 'rampA', 3.4), hop(20, 'gapA'), island(46, 'isleA'),
  { t: 'turn', angle: 38, radius: 34, w: 6.5, mark: 'bendA' },
  hop(14, 'rampB', 3.4), hop(22, 'gapB'), island(42, 'isleB'),
  { t: 'turn', angle: -46, radius: 30, w: 6.5, mark: 'bendB' },
  hop(14, 'rampC', 3.6), hop(24, 'gapC'), island(40, 'isleC'),
  { t: 'turn', angle: 34, radius: 38, w: 6.5, mark: 'bendC' },
  hop(15, 'rampD', 3.8), hop(26, 'gapD'), island(44, 'isleD'),
  { t: 'turn', angle: -30, radius: 40, w: 7, mark: 'bendD' },
  // The final leap, over the big one.
  hop(18, 'rampE', 5.0), hop(30, 'gapE'), island(90, 'finish'),
];

const gRoute = buildRouteFull(GAUNTLET_SEGS, { width: 6.5, spacing: 5, start: [0, 12, 0], heading: 0 });
const GM = gRoute.marks;

const gapZone = (mark: keyof typeof GM, label: string) => ({
  ...span(GM[mark], 0, 1), gap: true, wall: 'none' as const, shoulder: 2.5, label,
});

export const GAUNTLET_TRACK: TrackDefinition = {
  id: 'event-gauntlet',
  name: 'Gator Gauntlet',
  subtitle: 'Island chain • time and clean jumps',
  setPiece: 'Five leaps, four sets of jaws, no room to be wrong twice.',
  difficulty: 3,
  laps: 1,
  closed: false,
  nodes: gRoute.nodes,
  checkpointCount: 10,
  start: { s: 0.004, rows: 1, colGap: 4, rowGap: 5 },
  killY: -60,
  shoulder: 2.2,
  unlock: { kind: 'podium' },
  zones: [
    { from: 0, to: 1, surface: 'dirt', wall: 'none', shoulder: 2.2 },
    gapZone('gapA', 'First Leap'),
    gapZone('gapB', 'Second Leap'),
    gapZone('gapC', 'Third Leap'),
    gapZone('gapD', 'Fourth Leap'),
    gapZone('gapE', 'The Big One'),
    { ...span(GM.start, 0, 1), surface: 'road', wall: 'both', shoulder: 2.5, label: 'Launch Dock' },
    { ...span(GM.finish, 0, 1), surface: 'road', wall: 'both', shoulder: 3, label: 'Finish Dock' },
  ],
  boostPads: [
    { s: at(GM.start, 0.60), lat: 0, len: 14, w: 5 },
    { s: at(GM.isleA, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleB, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleC, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleD, 0.40), lat: 0, len: 14, w: 5 },
  ],
  branches: [],
  hazards: [
    { kind: 'gator', s: at(GM.gapA, 0.5), lat: -2.0, period: 2.6, phase: 0.0, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapB, 0.45), lat: 1.8, period: 2.3, phase: 0.35, reach: 3.4, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapB, 0.70), lat: -2.2, period: 3.0, phase: 0.6, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapC, 0.5), lat: 0.0, period: 2.1, phase: 0.2, reach: 3.8, scale: 1.1 },
    { kind: 'gator', s: at(GM.gapD, 0.40), lat: -2.4, period: 2.5, phase: 0.5, reach: 3.8, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapD, 0.72), lat: 2.4, period: 2.8, phase: 0.1, reach: 3.8, scale: 1.05 },
    // The big one at the end, twice the size and on a slow, obvious cycle.
    { kind: 'gator', s: at(GM.gapE, 0.5), lat: 0.0, period: 3.4, phase: 0.0, reach: 5.5, scale: 2.0 },
    { kind: 'bumper', s: at(GM.isleB, 0.75), lat: -3.4, r: 1.6 },
    { kind: 'bumper', s: at(GM.isleC, 0.72), lat: 3.4, r: 1.6 },
  ],
  theme: {
    sky: ['#6fbfe0', '#e8f0c0'],
    fog: '#9ec8a8',
    fogNear: 50,
    fogFar: 380,
    sun: '#fff0c8',
    sunDir: [-0.4, 0.75, 0.5],
    ambient: '#6f9470',
    ground: '#2f6a58',
    roadTop: '#6b5a3e',
    roadEdge: '#c9a86a',
    rail: '#7a6340',
    accent: '#8ef7a8',
    scenery: 'canopy',
  },
  schemaVersion: 3,
};

export const BONUS_EVENTS: BonusEventDefinition[] = [
  {
    id: 'megaramp',
    name: 'Mega Ramp',
    tagline: 'Build speed, pick your line, stick the landing.',
    brief:
      'Three boost pads down the runway and one decision: how straight are you willing to run to take all three. ' +
      'At the lip, pitch the kart with accelerate and brake, roll it level with steering, and land flat on the hill. ' +
      'A clean landing keeps your distance. A trick on the way down multiplies it. A bad landing costs you a third of it.',
    kind: 'megaRamp',
    track: MEGA_RAMP_TRACK,
    higherIsBetter: true,
    unit: 'm',
    medals: { bronze: 72, silver: 104, gold: 132 },
    timeLimit: 45,
    unlock: null,
  },
  {
    id: 'gauntlet',
    name: 'Gator Gauntlet',
    tagline: 'Five leaps. Four sets of jaws. One clean run.',
    brief:
      'Chain the jumps without a reset. Every gator runs a fixed cycle you can learn, and passing close to an open ' +
      'set of jaws pays a near-miss bonus that comes straight off your time. A reset costs six seconds — far more ' +
      'than waiting half a beat for the jaws to drop ever will.',
    kind: 'gauntlet',
    track: GAUNTLET_TRACK,
    higherIsBetter: false,
    unit: 's',
    medals: { bronze: 42, silver: 35, gold: 30 },
    timeLimit: 120,
    unlock: { kind: 'races', value: 1 },
  },
];

export function bonusById(id: string): BonusEventDefinition {
  const e = BONUS_EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown bonus event: ${id}`);
  return e;
}

export function medalFor(def: BonusEventDefinition, score: number): 'none' | 'bronze' | 'silver' | 'gold' {
  const better = (a: number, b: number) => (def.higherIsBetter ? a >= b : a <= b);
  if (better(score, def.medals.gold)) return 'gold';
  if (better(score, def.medals.silver)) return 'silver';
  if (better(score, def.medals.bronze)) return 'bronze';
  return 'none';
}
