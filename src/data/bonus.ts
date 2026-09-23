/** Bonus events: short, repeatable skill challenges built on the same kart.
 *
 *  Both events run through one shared interface — countdown, attempt, score,
 *  medal, personal best, instant restart, leaderboard-ready result — so a
 *  third event is a data entry and a scoring function, not a new screen.
 */
import { buildRouteFull, type RouteSeg } from './route';
import { at, span } from './trackHelpers';
import type { TrackDefinition } from '../sim/trackTypes';

export type BonusKind = 'gauntlet' | 'launch';

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
// so distance scales with how much speed you carried into the lip. The runway,
// the kicker and the hill were all lengthened so the jump reads as a jump: a
// competent run now lands between roughly 100 and 240 metres, and there are
// hoops down the flight path worth real metres if you can steer to them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Gator Gauntlet — the second event.
//
// A chain of narrow islands over open swamp, each separated by a gap you have
// to jump, with gator jaws on fixed cycles between them. Scored on time, with
// the clean-chain bonus doing the real work: a single reset costs more than
// slowing down for a bite cycle ever does.
// ---------------------------------------------------------------------------

const island = (len: number, mark: string): RouteSeg => ({ t: 'straight', len, w: 6.5, mark });

/** One leap: a ramp, then the void in two parts.
 *
 *  The first part of the void continues the ramp's slope. There is no road
 *  there, so the height is invisible — but it is what holds the spline tangent
 *  up at the lip, and that tangent IS the launch. Round the crest off and the
 *  kart drops into the water instead of flying over it.
 */
const leap = (name: string, rampLen: number, rise: number, voidLen: number, drop: number): RouteSeg[] => [
  { t: 'straight', len: rampLen, dy: rise, w: 6.5, mark: `ramp${name}` },
  { t: 'straight', len: 5, dy: (rise / rampLen) * 5, w: 6.5, mark: `gap${name}A` },
  { t: 'straight', len: voidLen, dy: -drop, w: 6.5, mark: `gap${name}` },
];

const GAUNTLET_SEGS: RouteSeg[] = [
  island(70, 'start'),
  ...leap('A', 16, 4.2, 7, 3.0), island(56, 'isleA'),
  { t: 'turn', angle: 38, radius: 34, w: 6.5, mark: 'bendA' },
  ...leap('B', 16, 4.2, 8, 3.2), island(52, 'isleB'),
  { t: 'turn', angle: -46, radius: 30, w: 6.5, mark: 'bendB' },
  ...leap('C', 16, 4.4, 9, 3.4), island(60, 'isleC'),
  { t: 'turn', angle: 34, radius: 38, w: 6.5, mark: 'bendC' },
  ...leap('D', 17, 4.8, 10, 3.6), island(54, 'isleD'),
  { t: 'turn', angle: -30, radius: 40, w: 7, mark: 'bendD' },
  // The first encounter with Kilnbane, on a wide island.
  ...leap('E', 18, 5.0, 11, 3.8), island(80, 'isleE'),
  { t: 'turn', angle: 52, radius: 36, w: 7, mark: 'bendE' },
  ...leap('F', 16, 4.4, 9, 3.4), island(56, 'isleF'),
  { t: 'turn', angle: -40, radius: 34, w: 6.5, mark: 'bendF' },
  ...leap('G', 17, 4.8, 10, 3.6), island(58, 'isleG'),
  { t: 'turn', angle: 44, radius: 32, w: 6.5, mark: 'bendG' },
  // The second encounter.
  ...leap('H', 18, 5.2, 11, 3.8), island(84, 'isleH'),
  { t: 'turn', angle: -36, radius: 38, w: 7, mark: 'bendH' },
  ...leap('I', 17, 4.8, 10, 3.6), island(56, 'isleI'),
  { t: 'turn', angle: 30, radius: 40, w: 7, mark: 'bendI' },
  // The final leap, over the big one, and the last stand at the dock.
  ...leap('J', 20, 6.0, 13, 4.5), island(140, 'finish'),
];

const gRoute = buildRouteFull(GAUNTLET_SEGS, { width: 6.5, spacing: 5, start: [0, 12, 0], heading: 0, closed: false });
const GM = gRoute.marks;

const gapZone = (mark: keyof typeof GM, label: string) => ({
  ...span(GM[mark], 0, 1), gap: true, wall: 'none' as const, shoulder: 2.5, label,
});
/** Both halves of a leap's void are one hole. */
const leapZones = (name: string, label: string) => [
  gapZone(`gap${name}A` as keyof typeof GM, label),
  gapZone(`gap${name}` as keyof typeof GM, label),
];

export const GAUNTLET_TRACK: TrackDefinition = {
  id: 'event-gauntlet',
  name: 'Gator Gauntlet',
  subtitle: 'Island chain • ten leaps, a boss, five hearts',
  setPiece: 'Ten leaps over the jaws, chests on every island, and Kilnbane waiting three times.',
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
    ...leapZones('A', 'First Leap'),
    ...leapZones('B', 'Second Leap'),
    ...leapZones('C', 'Third Leap'),
    ...leapZones('D', 'Fourth Leap'),
    ...leapZones('E', 'Fifth Leap'),
    ...leapZones('F', 'Sixth Leap'),
    ...leapZones('G', 'Seventh Leap'),
    ...leapZones('H', 'Eighth Leap'),
    ...leapZones('I', 'Ninth Leap'),
    ...leapZones('J', 'The Big One'),
    { ...span(GM.isleE, 0, 1), surface: 'dirt', wall: 'both', shoulder: 3, label: 'Kilnbane' },
    { ...span(GM.isleH, 0, 1), surface: 'dirt', wall: 'both', shoulder: 3, label: 'Kilnbane' },
    { ...span(GM.start, 0, 1), surface: 'road', wall: 'both', shoulder: 2.5, label: 'Launch Dock' },
    { ...span(GM.finish, 0, 1), surface: 'road', wall: 'both', shoulder: 3, label: 'Last Stand' },
  ],
  boostPads: [
    { s: at(GM.start, 0.60), lat: 0, len: 14, w: 5 },
    { s: at(GM.isleA, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleB, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleC, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleD, 0.40), lat: 0, len: 14, w: 5 },
    { s: at(GM.isleE, 0.30), lat: 0, len: 12, w: 5 },
    { s: at(GM.isleF, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleG, 0.45), lat: 0, len: 12, w: 4.5 },
    { s: at(GM.isleH, 0.30), lat: 0, len: 12, w: 5 },
    { s: at(GM.isleI, 0.40), lat: 0, len: 14, w: 5 },
    { s: at(GM.finish, 0.15), lat: 0, len: 14, w: 5 },
  ],
  branches: [],
  hazards: [
    // ---- chests on every island: the ammunition ---------------------------
    { kind: 'chest', s: at(GM.start, 0.35), lat: -1.8 },
    { kind: 'chest', s: at(GM.start, 0.35), lat: 1.8 },
    { kind: 'chest', s: at(GM.isleA, 0.70), lat: 0 },
    { kind: 'chest', s: at(GM.isleB, 0.70), lat: -1.5 },
    { kind: 'chest', s: at(GM.isleC, 0.25), lat: 1.5 },
    { kind: 'chest', s: at(GM.isleC, 0.70), lat: -1.5 },
    { kind: 'chest', s: at(GM.isleD, 0.65), lat: 0 },
    { kind: 'chest', s: at(GM.isleE, 0.12), lat: -1.8 },
    { kind: 'chest', s: at(GM.isleE, 0.12), lat: 1.8 },
    { kind: 'chest', s: at(GM.isleF, 0.70), lat: 0 },
    { kind: 'chest', s: at(GM.isleG, 0.25), lat: -1.5 },
    { kind: 'chest', s: at(GM.isleG, 0.70), lat: 1.5 },
    { kind: 'chest', s: at(GM.isleH, 0.12), lat: -1.8 },
    { kind: 'chest', s: at(GM.isleH, 0.12), lat: 1.8 },
    { kind: 'chest', s: at(GM.isleI, 0.65), lat: 0 },
    { kind: 'chest', s: at(GM.finish, 0.08), lat: -1.8 },
    { kind: 'chest', s: at(GM.finish, 0.08), lat: 1.8 },
    // ---- the gators: two or three sets of jaws in every gap ---------------
    { kind: 'gator', s: at(GM.gapA, 0.5), lat: -2.0, period: 2.6, phase: 0.0, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapA, 0.5), lat: 2.2, period: 2.6, phase: 0.5, reach: 3.2, scale: 0.9 },
    { kind: 'gator', s: at(GM.gapB, 0.45), lat: 1.8, period: 2.3, phase: 0.35, reach: 3.4, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapB, 0.70), lat: -2.2, period: 3.0, phase: 0.6, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapC, 0.5), lat: 0.0, period: 2.1, phase: 0.2, reach: 3.8, scale: 1.1 },
    { kind: 'gator', s: at(GM.gapC, 0.8), lat: -2.6, period: 2.7, phase: 0.7, reach: 3.2, scale: 0.9 },
    { kind: 'gator', s: at(GM.gapD, 0.40), lat: -2.4, period: 2.5, phase: 0.5, reach: 3.8, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapD, 0.72), lat: 2.4, period: 2.8, phase: 0.1, reach: 3.8, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapE, 0.5), lat: 0.0, period: 2.4, phase: 0.0, reach: 4.2, scale: 1.3 },
    { kind: 'gator', s: at(GM.gapE, 0.8), lat: 2.8, period: 2.9, phase: 0.5, reach: 3.2, scale: 0.9 },
    { kind: 'gator', s: at(GM.gapF, 0.45), lat: -2.0, period: 2.2, phase: 0.3, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapF, 0.75), lat: 2.0, period: 2.6, phase: 0.8, reach: 3.4, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapG, 0.3), lat: 2.4, period: 2.5, phase: 0.1, reach: 3.6, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapG, 0.55), lat: -2.4, period: 2.5, phase: 0.6, reach: 3.6, scale: 1.05 },
    { kind: 'gator', s: at(GM.gapG, 0.8), lat: 0.5, period: 3.1, phase: 0.35, reach: 3.2, scale: 0.9 },
    { kind: 'gator', s: at(GM.gapH, 0.5), lat: 0.0, period: 2.6, phase: 0.0, reach: 4.4, scale: 1.4 },
    { kind: 'gator', s: at(GM.gapH, 0.8), lat: -2.8, period: 2.9, phase: 0.5, reach: 3.2, scale: 0.9 },
    { kind: 'gator', s: at(GM.gapI, 0.4), lat: 2.2, period: 2.4, phase: 0.2, reach: 3.6, scale: 1.0 },
    { kind: 'gator', s: at(GM.gapI, 0.7), lat: -2.2, period: 2.7, phase: 0.7, reach: 3.6, scale: 1.0 },
    // The big one at the end, twice the size and on a slow, obvious cycle.
    { kind: 'gator', s: at(GM.gapJ, 0.5), lat: 0.0, period: 3.4, phase: 0.0, reach: 5.5, scale: 2.0 },
    // ---- Kilnbane: three encounters, one health bar ----------------------
    // The pot golem stands off the verge and hammers the road. A Moon Comet
    // fired at it takes a bar off; six bars and it goes down. Reach the dock
    // with any left and the run is lost.
    { kind: 'boss', s: at(GM.isleE, 0.55), lat: -13, period: 5.0, phase: 0.0, slamLat: -1.5, reach: 2.8, style: 'kilnbane' },
    { kind: 'boss', s: at(GM.isleH, 0.55), lat: 13, period: 4.6, phase: 0.4, slamLat: 1.5, reach: 2.8, style: 'kilnbane' },
    { kind: 'boss', s: at(GM.finish, 0.55), lat: -13, period: 4.2, phase: 0.2, slamLat: -1.0, reach: 3.0, style: 'kilnbane' },
    // ---- the rest of the menagerie ----------------------------------------
    { kind: 'roller', s: at(GM.isleC, 0.50), lat: 0, period: 3.4, phase: 0.2, travel: 2.6, r: 1.5 },
    { kind: 'roller', s: at(GM.isleG, 0.50), lat: 0, period: 3.0, phase: 0.6, travel: 2.6, r: 1.5 },
    { kind: 'stack', s: at(GM.isleF, 0.40), lat: -2.2, w: 1.6, h: 1.3, len: 2.4, style: 'logs' },
    { kind: 'stack', s: at(GM.isleI, 0.30), lat: 2.2, w: 1.6, h: 1.3, len: 2.4, style: 'logs' },
    { kind: 'bumper', s: at(GM.isleB, 0.75), lat: -3.4, r: 1.6 },
    { kind: 'bumper', s: at(GM.isleD, 0.80), lat: 3.4, r: 1.6 },
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


// ---------------------------------------------------------------------------
// Luna Launch — the stunt yard.
//
// A long descent to build speed, a kicker at the bottom, and then one flight
// that has to do three things at once: thread the rings in the air, clear the
// obstacles on the ground, and come down inside the target.
//
// The reason this plays differently from the Mega Ramp is that the target is
// at a FIXED distance. On the Mega Ramp more speed is always better. Here,
// overshooting the gold ring costs exactly as much as falling short of it, so
// the skill is hitting a number rather than maximising one — and the rings and
// obstacles push you to want more distance than the target wants to give you.
// ---------------------------------------------------------------------------

const LAUNCH_SEGS: RouteSeg[] = [
  { t: 'straight', len: 60, w: 14, mark: 'stage' },
  // The big one: two hundred and twenty metres at twenty-three degrees.
  { t: 'straight', len: 220, dy: -92, w: 13, mark: 'dropIn' },
  { t: 'straight', len: 40, dy: -4, w: 13, mark: 'runout' },
  // Thirty-one degrees of kicker...
  { t: 'straight', len: 46, dy: 28, w: 12, mark: 'kicker' },
  // ...and a held lip, which is what keeps the spline tangent pointing UP at
  // the edge (the Mega Ramp lesson: without it the tangent averages flat and
  // the kart leaves low).
  { t: 'straight', len: 10, dy: 6, w: 12, mark: 'lip' },
  // The cliff. Solid, so a short flight lands on the face and slides down to
  // the yard rather than respawning — but the arc goes a long way over it.
  { t: 'straight', len: 110, dy: -120, w: 26, mark: 'cliff' },
  { t: 'straight', len: 340, dy: -8, w: 30, mark: 'yard' },
  { t: 'straight', len: 80, dy: -2, w: 30, mark: 'catch' },
];

const launchRoute = buildRouteFull(LAUNCH_SEGS, {
  width: 14, spacing: 6, start: [0, 200, 0], heading: 0, closed: false,
});
const LM = launchRoute.marks;

/** Where the flight is, MEASURED (tools/rampprobe.ts launch, Dartwing, no
 *  boost), in WORLD metres relative to the lip: [forward, up, sideways] every
 *  tenth of a second. Everything on this course is placed in world space and
 *  then converted to a route position, because an airborne kart over a
 *  47-degree cliff projects onto the spline perpendicularly — its "distance
 *  along the road" runs far ahead of where it actually is, so anything placed
 *  by arc length lands behind and below the flight. (That is exactly what the
 *  first cut of this course did.) Re-run the probe and paste the table
 *  whenever the ramp changes. */
const LAUNCH_LIP_WORLD: [number, number, number] = [-1.4, 136.2, 372.6];
const LAUNCH_ARC: [number, number, number][] = [[0.0, 0.0, 0.0],[3.3, 1.5, -0.1],[6.5, 2.7, -0.2],[9.8, 3.7, -0.3],[13.0, 4.4, -0.4],[16.3, 5.0, -0.5],[19.6, 5.2, -0.6],[22.8, 5.3, -0.6],[26.1, 5.0, -0.7],[29.4, 4.6, -0.8],[32.6, 3.9, -0.9],[35.9, 3.0, -1.0],[39.1, 1.8, -1.1],[42.4, 0.4, -1.2],[45.7, -1.3, -1.3],[48.9, -3.1, -1.4],[52.2, -5.3, -1.5],[55.5, -7.6, -1.6],[58.7, -10.3, -1.7],[62.0, -13.1, -1.8],[65.2, -16.2, -1.9],[68.5, -19.5, -1.9],[71.8, -23.1, -2.0],[75.0, -26.9, -2.1],[78.3, -30.9, -2.2],[81.6, -35.2, -2.3],[84.8, -39.8, -2.4],[88.1, -44.5, -2.5],[91.3, -49.5, -2.6],[94.6, -54.8, -2.7],[97.9, -60.3, -2.8],[101.1, -66.0, -2.9],[104.4, -72.0, -3.0],[107.7, -78.2, -3.1],[110.9, -84.6, -3.1],[114.2, -91.3, -3.2],[117.4, -98.3, -3.3],[120.7, -105.4, -3.4],[124.0, -112.8, -3.5]];

/** Height of the measured arc above the lip, `d` metres forward of it. */
/** Sideways drift of the measured flight, `d` metres out (the kart wanders
 *  a few metres left over the whole arc; the rings follow it). */
function arcSide(d: number): number {
  const t = LAUNCH_ARC;
  if (d <= t[0][0]) return t[0][2];
  for (let i = 1; i < t.length; i++) {
    if (d <= t[i][0]) {
      const f = (d - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return t[i - 1][2] + (t[i][2] - t[i - 1][2]) * f;
    }
  }
  return t[t.length - 1][2];
}

function arcHeight(d: number): number {
  const t = LAUNCH_ARC;
  if (d <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (d <= t[i][0]) {
      const f = (d - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * f;
    }
  }
  // Past the table: keep falling at the last measured rate.
  const [d1, y1] = t[t.length - 1]; const [d0, y0] = t[t.length - 2];
  return y1 + (d - d1) * (y1 - y0) / (d1 - d0);
}

/** Convert a world point to the route's (s, lat, h): the node polyline is
 *  scanned in the horizontal plane for the segment the point is over, and the
 *  height is measured from the road there. Fractions are of the polyline's 3D
 *  length, which is what the sim scales `s` by. */
function worldToRoute(x: number, y: number, z: number): { s: number; lat: number; h: number } {
  const nodes = launchRoute.nodes;
  const cums: number[] = [0];
  for (let i = 1; i < nodes.length; i++) {
    const [x0, y0, z0] = nodes[i - 1]; const [x1, y1, z1] = nodes[i];
    cums.push(cums[i - 1] + Math.hypot(x1 - x0, y1 - y0, z1 - z0));
  }
  const total = cums[cums.length - 1];
  let best = { d2: Infinity, s: 0, lat: 0, h: 0 };
  for (let i = 1; i < nodes.length; i++) {
    const [x0, y0, z0] = nodes[i - 1]; const [x1, y1, z1] = nodes[i];
    const ex = x1 - x0, ez = z1 - z0; const len2 = ex * ex + ez * ez || 1e-9;
    const f = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / len2));
    const px = x0 + ex * f, pz = z0 + ez * f, py = y0 + (y1 - y0) * f;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < best.d2) {
      const hl = Math.sqrt(len2);
      // Right-hand side of the direction of travel is positive lat.
      const lat = ((x - px) * (ez / hl) - (z - pz) * (ex / hl));
      best = { d2, s: (cums[i - 1] + (cums[i] - cums[i - 1]) * f) / total, lat, h: y - py };
    }
  }
  return { s: best.s, lat: best.lat, h: best.h };
}

/** A hoop `d` metres past the lip, centred on the measured arc, `side`
 *  metres to the right of the flight line. */
function arcRing(d: number, side: number, r: number, extra: Partial<Extract<TrackDefinition['hazards'][number], { kind: 'ring' }>> = {}) {
  const [lx, ly, lz] = LAUNCH_LIP_WORLD;
  const p = worldToRoute(lx + arcSide(d) + side, ly + arcHeight(d), lz + d);
  return { kind: 'ring' as const, s: p.s, lat: p.lat, h: p.h, r, ...extra };
}

/** Something on the ground `d` metres past the lip, on the flight line. */
function onGround(d: number): { s: number; lat: number } {
  const [lx, , lz] = LAUNCH_LIP_WORLD;
  const p = worldToRoute(lx, 0, lz + d);
  return { s: p.s, lat: p.lat };
}

// Twelve hoops every nine metres along the arc, in a gentle S so threading
// all of them needs a line, not a held stick. The late ones are wider: a
// faster kart flies a flatter arc and comes through them higher.
const LAUNCH_RINGS = Array.from({ length: 12 }, (_, i) => {
  const d = 10 + i * 9;
  return arcRing(d, Math.sin(i * 0.7) * 3.0, 5.6 + i * 0.25);
});
// Four bonus bullseyes that sweep across the flight path, out of phase with
// each other, worth a flat bounty each.
const LAUNCH_TARGETS = [24, 50, 76, 100].map((d, i) =>
  arcRing(d, 0, 4.2 + i * 0.3, { sweep: 8, period: 3.4 + i * 0.5, phase: i * 0.25, bonus: true, points: 800 }),
);

export const LUNA_LAUNCH_TRACK: TrackDefinition = {
  id: 'event-launch',
  name: 'Luna Launch',
  subtitle: 'Stunt yard • rings, bullseyes and a moving landing target',
  setPiece: 'One flight, three jobs: thread it, hit it, land on it.',
  difficulty: 3,
  laps: 1,
  closed: false,
  nodes: launchRoute.nodes,
  checkpointCount: 6,
  start: { s: 0.004, rows: 1, colGap: 5, rowGap: 6 },
  killY: -400,
  shoulder: 6,
  unlock: { kind: 'podium' },
  zones: [
    { from: 0, to: 1, surface: 'road', wall: 'both', shoulder: 6 },
    { ...span(LM.stage, 0, 1), surface: 'metal', wall: 'both', shoulder: 3, label: 'Staging' },
    { ...span(LM.dropIn, 0, 1), surface: 'road', wall: 'both', shoulder: 4, label: 'The Drop' },
    { ...span(LM.runout, 0, 1), surface: 'road', wall: 'both', shoulder: 4, label: 'Run-out' },
    { ...span(LM.kicker, 0, 1), surface: 'metal', wall: 'both', shoulder: 2, label: 'Kicker' },
    { ...span(LM.lip, 0, 1), surface: 'metal', wall: 'none', shoulder: 2, label: 'Kicker' },
    // Solid ground under the whole flight. Falling short is a bad score, not
    // a respawn — which is what makes the retry loop fast enough to learn on.
    { ...span(LM.cliff, 0, 1), surface: 'dirt', wall: 'none', shoulder: 12, label: 'The Cliff' },
    { ...span(LM.yard, 0, 1), surface: 'dirt', wall: 'none', shoulder: 12, label: 'The Yard' },
    { ...span(LM.catch, 0, 1), surface: 'dirt', wall: 'both', shoulder: 12, label: 'Catch' },
  ],
  boostPads: [
    { s: at(LM.dropIn, 0.18), lat: 0, len: 18, w: 6 },
    { s: at(LM.dropIn, 0.42), lat: 0, len: 18, w: 6 },
    { s: at(LM.dropIn, 0.66), lat: 0, len: 18, w: 6 },
    // The greedy one: right on the edge, and taking it straight costs you the
    // line into the kicker.
    { s: at(LM.dropIn, 0.88), lat: 4.8, len: 20, w: 5 },
    { s: at(LM.runout, 0.45), lat: 0, len: 16, w: 6 },
  ],
  branches: [],
  hazards: [
    ...LAUNCH_RINGS,
    ...LAUNCH_TARGETS,
    // ---- the landing zone -------------------------------------------------
    // A painted strip on the yard, and inside it a bullseye that slides side
    // to side. The measured run touches down about 128 m past the lip; the
    // gold is 14 m beyond that, so it takes the pads (or a boost off the
    // kicker) to reach — and overshooting costs exactly as much as falling
    // short.
    { kind: 'zone', ...onGround(160), w: 26, len: 90, label: 'LANDING ZONE' },
    { kind: 'target', ...onGround(142),
      rings: [13, 9, 5.5, 2.6], points: [300, 800, 1600, 3000], sweep: 5.5, period: 5.2 },
  ],
  theme: {
    sky: ['#4a7fd6', '#ffcf9a'],
    fog: '#cbd9e8',
    fogNear: 110,
    fogFar: 800,
    sun: '#fff2d6',
    // Sun ahead of the course, not behind it: a 21-degree descent faces
    // forward, so a sun at your back leaves the entire ramp in shadow and the
    // thing you are about to drive down reads as a black hole.
    sunDir: [0.40, 0.70, 0.59],
    ambient: '#9fb4cc',
    ground: '#7e8a5e',
    roadTop: '#8a8172',
    roadEdge: '#ffb23f',
    rail: '#b2bccb',
    accent: '#ffd166',
    scenery: 'canopy',
    // An open yard: you have to be able to see the rings and the target from
    // the air, and a forest at the roadside is exactly what blocks that.
    sceneryScale: 0.3,
  },
  schemaVersion: 3,
};

export const BONUS_EVENTS: BonusEventDefinition[] = [
  {
    id: 'launch',
    name: 'Luna Launch',
    tagline: 'Down the big one. Thread it, hit it, land on it.',
    brief:
      'Two hundred and twenty metres of descent to build speed, then a kicker and one very long flight over a cliff. ' +
      'Every metre of flight is worth points, so speed off the lip is the base of the score. ' +
      'Twelve rings hang on the arc — thread them in a row and each one pays more than the last — ' +
      'and four bullseyes sweep across the flight path for a flat bounty each. ' +
      'The landing zone is painted on the yard and the target inside it is moving, so aim for where it will be. ' +
      'Pitch with accelerate and brake, roll level with steering, and land flat in the gold.',
    kind: 'launch',
    track: LUNA_LAUNCH_TRACK,
    higherIsBetter: true,
    unit: 'pts',
    medals: { bronze: 3000, silver: 7000, gold: 12000 },
    timeLimit: 75,
    unlock: null,
  },
  {
    id: 'gauntlet',
    name: 'Gator Gauntlet',
    tagline: 'Ten leaps. Twenty sets of jaws. One boss. Five hearts.',
    brief:
      'A long island chain over the swamp with two or three gators in every gap, and Kilnbane the pot golem waiting on the wide islands. ' +
      'You have five hearts: a bite, a slam, a boulder, a rival\'s comet costs one (a fall costs six seconds instead). Kilnbane has six bars, and only a Moon Comet fired at it takes one off — ' +
      'so grab the chest on every island and fire at the golem while it is in range. Two rival Axies run the chain with you and will use their items too. ' +
      'Reach the dock with the boss still standing and the run is lost; bring it down and your time is the score, minus near misses, plus six seconds a reset.',
    kind: 'gauntlet',
    track: GAUNTLET_TRACK,
    higherIsBetter: false,
    unit: 's',
    medals: { bronze: 120, silver: 100, gold: 85 },
    timeLimit: 240,
    unlock: null,
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
