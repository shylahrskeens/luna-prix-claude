/** Track 3 — Cloudforge Circuit.
 *
 *  Rhythm: the fast one. Long straights, high minimum speeds, a turbine
 *  corridor that pushes the kart sideways the whole way through, and the
 *  biggest jump in the game. Mistakes here cost more because there is nothing
 *  under the track but sky.
 *
 *  Set piece: the hangar launch — out of a broken hangar, over a moored
 *  airship, through a boost ring, onto a banked sky bridge.
 */
import { buildRouteFull, type RouteSeg } from '../route';
import { offsetBranch, at, span } from '../trackHelpers';
import type { TrackDefinition } from '../../sim/trackTypes';

const SEGS: RouteSeg[] = [
  { t: 'straight', len: 190, w: 14, mark: 'forgeStraight' },
  { t: 'turn', angle: 60, radius: 95, bank: 7, mark: 't1' },
  { t: 'straight', len: 80, dy: 6, w: 13 },
  { t: 'turn', angle: 85, radius: 42, dy: 4, w: 11, mark: 'turbineEntry' },
  { t: 'straight', len: 110, w: 11, mark: 'turbineTunnel' },
  { t: 'turn', angle: -50, radius: 70, dy: -5, mark: 'hangarApproach' },
  // The hangar launch: run up through the broken hangar, a 26 m ramp that
  // climbs 8 m, 34 m of open sky over the airship, and a landing 6 m below.
  { t: 'straight', len: 45, dy: -4, w: 15, mark: 'hangarRun' },
  { t: 'straight', len: 28, dy: 8.75, w: 15, mark: 'hangarRamp' },
  { t: 'straight', len: 12, dy: 3.75, w: 15, mark: 'hangarLaunch' },
  { t: 'straight', len: 22, dy: -11, w: 15, mark: 'hangarVoid' },
  { t: 'straight', len: 40, dy: -4, w: 15, mark: 'hangarLanding' },
  { t: 'turn', angle: 90, radius: 58, bank: 16, dy: 6, w: 12, mark: 'skyBridge' },
  { t: 'straight', len: 70 },
  { t: 'turn', angle: 55, radius: 34, w: 10, mark: 'chicaneA' },
  { t: 'turn', angle: -55, radius: 34, w: 10, mark: 'chicaneB' },
  { t: 'straight', len: 60, dy: 4, w: 12 },
  { t: 'turn', angle: 95, radius: 76, dy: -6, bank: 8, mark: 'dockSweeper' },
  { t: 'straight', len: 100, w: 13, mark: 'dockStraight' },
  { t: 'turn', angle: -45, radius: 60, mark: 't9' },
  { t: 'straight', len: 70, dy: 5 },
  { t: 'turn', angle: 80, radius: 46, bank: 18, w: 10, mark: 'corkscrew' },
  { t: 'turn', angle: 45, radius: 90, mark: 'finalSweep' },
  { t: 'straight', len: 80, w: 14 },
];

const route = buildRouteFull(SEGS, { width: 13, spacing: 8, start: [0, 120, 0], heading: 0 });
const M = route.marks;

/** The outer rail: exposed, windy, but it carries three boost pads and skips
 *  the turbine corridor's crosswind entirely. */
const railIn = at(M.t1, 0.7);
const railOut = at(M.turbineTunnel, 0.95);
// Swung to the OUTSIDE of the turn, so it is genuinely longer than the main
// line. It pays for the extra distance with two boost pads and by staying out
// of the turbine crosswind entirely — a trade, not a free upgrade.
const railNodes = offsetBranch(route.nodes, railIn, railOut, (t) => ({
  lat: -19 * Math.sin(t * Math.PI),
  lift: 2.5 * Math.sin(t * Math.PI),
}), 12);

export const CLOUDFORGE: TrackDefinition = {
  id: 'cloudforge',
  name: 'Cloudforge Circuit',
  subtitle: 'Sky forge • 1.58 km • 11 turns',
  setPiece: 'The hangar launch — over a moored airship and through a boost ring.',
  difficulty: 3,
  laps: 3,
  nodes: route.nodes,
  checkpointCount: 13,
  start: { s: 0.02, rows: 4, colGap: 7.4, rowGap: 8.0 },
  killY: 0,
  shoulder: 1.8,
  unlock: { kind: 'rating', value: 1150 },
  zones: [
    // Nothing but sky beyond the rail: every edge is a barrier, and past the
    // barrier is a fall.
    { from: 0, to: 1, surface: 'road', wall: 'both', shoulder: 1.8 },
    { ...span(M.turbineTunnel, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.0, covered: true, label: 'Turbine Corridor' },
    { ...span(M.hangarApproach, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.4, label: 'Hangar Approach' },
    { ...span(M.hangarRun, 0, 1), surface: 'metal', wall: 'both', shoulder: 2.0, label: 'Hangar Launch' },
    { ...span(M.hangarRamp, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.6, label: 'Hangar Launch' },
    { ...span(M.hangarLaunch, 0, 1), gap: true, wall: 'none', shoulder: 2.0, label: 'Hangar Launch' },
    { ...span(M.hangarVoid, 0, 1), gap: true, wall: 'none', shoulder: 2.0, label: 'Hangar Launch' },
    { ...span(M.hangarLanding, 0, 1), surface: 'metal', wall: 'both', shoulder: 2.0, label: 'Hangar Launch' },
    { ...span(M.skyBridge, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, label: 'Sky Bridge' },
    { ...span(M.corkscrew, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.0, label: 'Corkscrew' },
    { ...span(M.chicaneA, 0, 1), surface: 'road', wall: 'both', shoulder: 1.2, label: 'Dock Chicane' },
    { ...span(M.chicaneB, 0, 1), surface: 'road', wall: 'both', shoulder: 1.2, label: 'Dock Chicane' },
    { ...span(M.forgeStraight, 0, 1), surface: 'road', wall: 'both', shoulder: 2.4, label: 'Forge Straight' },
  ],
  boostPads: [
    { s: at(M.forgeStraight, 0.35), lat: -4, len: 14, w: 5 },
    { s: at(M.forgeStraight, 0.72), lat: 4, len: 14, w: 5 },
    { s: at(M.hangarRun, 0.50), lat: 0, len: 18, w: 8 },
    { s: at(M.skyBridge, 0.55), lat: 0, len: 14, w: 6 },
    { s: at(M.dockStraight, 0.45), lat: 0, len: 16, w: 6 },
    { s: at(M.corkscrew, 0.5), lat: 0, len: 12, w: 5 },
    { s: 0.3, lat: 0, len: 14, w: 5, branch: 'outer-rail' },
    { s: 0.7, lat: 0, len: 14, w: 5, branch: 'outer-rail' },
  ],
  branches: [
    {
      id: 'outer-rail',
      name: 'Outer Rail',
      inS: railIn,
      outS: railOut,
      nodes: railNodes,
      w: 5.0,
      surface: 'metal',
      sign: 'OUTER RAIL — longer, but no crosswind and two more pads',
      flavor: 'longer-faster',
    },
  ],
  hazards: [
    // The turbine corridor: a constant crosswind, not damage. It is a line
    // problem, and it is the reason the outer rail exists.
    { kind: 'turbine', s: at(M.turbineTunnel, 0.30), lat: 0, strength: 9.5, len: 40 },
    { kind: 'turbine', s: at(M.turbineTunnel, 0.72), lat: 0, strength: -9.5, len: 40 },
    // The boost ring at the apex of the hangar jump.
    { kind: 'ring', s: at(M.hangarVoid, 0.20), lat: 0, h: 5.0, r: 6.5 },
    { kind: 'roller', s: at(M.dockSweeper, 0.5), lat: 0, period: 3.8, phase: 0.0, travel: 8.0, r: 2.2 },
    { kind: 'bumper', s: at(M.chicaneA, 0.5), lat: -6.5, r: 1.9 },
    { kind: 'bumper', s: at(M.chicaneB, 0.5), lat: 6.5, r: 1.9 },
    { kind: 'roller', s: at(M.t9, 0.5), lat: 0, period: 4.4, phase: 0.3, travel: 6.0, r: 2.0 },
  ],
  theme: {
    sky: ['#6fb6ff', '#ffd9a8'],
    fog: '#cfe2f7',
    fogNear: 90,
    fogFar: 520,
    sun: '#fff7e2',
    sunDir: [0.52, 0.66, 0.54],
    ambient: '#a8c4e6',
    ground: '#e4edf8',
    roadTop: '#787f8f',
    roadEdge: '#ffb23f',
    rail: '#ced6e4',
    accent: '#ffb23f',
    scenery: 'cloud',
  },
  schemaVersion: 3,
};

export const CLOUDFORGE_MARKS = M;
