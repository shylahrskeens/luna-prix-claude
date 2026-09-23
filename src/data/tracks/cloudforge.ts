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
import { offsetBranch, chordBranch, at, span } from '../trackHelpers';
import type { TrackDefinition } from '../../sim/trackTypes';

const SEGS: RouteSeg[] = [
  { t: 'straight', len: 190, w: 14, mark: 'forgeStraight' },
  { t: 'turn', angle: 60, radius: 95, bank: 7, mark: 't1' },
  { t: 'straight', len: 30, dy: 2, w: 13 },
  // The forge esses, between the furnace stacks.
  { t: 'turn', angle: -35, radius: 45, w: 12, mark: 'forgeEssA' },
  { t: 'turn', angle: 35, radius: 45, w: 12, mark: 'forgeEssB' },
  { t: 'straight', len: 30, dy: 4, w: 13 },
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
  { t: 'straight', len: 25 },
  // The gantry hop: a second, smaller break in the sky bridge.
  { t: 'straight', len: 12, dy: 3.0, w: 12, mark: 'gantryRamp' },
  { t: 'straight', len: 6, dy: 0.8, w: 12, mark: 'gantryGapA' },
  { t: 'straight', len: 7, dy: -2.6, w: 12, mark: 'gantryGapB' },
  { t: 'straight', len: 22, dy: -1.2, w: 12, mark: 'gantryLanding' },
  { t: 'straight', len: 10 },
  { t: 'turn', angle: 55, radius: 34, w: 10, mark: 'chicaneA' },
  { t: 'turn', angle: -55, radius: 34, w: 10, mark: 'chicaneB' },
  { t: 'straight', len: 60, dy: 4, w: 12 },
  { t: 'turn', angle: 95, radius: 76, dy: -6, bank: 8, mark: 'dockSweeper' },
  { t: 'straight', len: 100, w: 13, mark: 'dockStraight' },
  { t: 'turn', angle: -45, radius: 60, mark: 't9' },
  { t: 'straight', len: 25, dy: 2 },
  // The cranes: a right-left between the dock cranes.
  { t: 'turn', angle: 50, radius: 34, w: 11, mark: 'cranesA' },
  { t: 'turn', angle: -50, radius: 34, w: 11, mark: 'cranesB' },
  { t: 'straight', len: 20, dy: 3 },
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

/** The vent shaft: a metal duct straight across the inside of the dock
 *  sweeper. Dips two metres under the deck and rejoins on the dock straight. */
const ventIn = at(M.dockSweeper, 0.06);
const ventOut = at(M.dockSweeper, 0.94);
const ventNodes = chordBranch(route.nodes, ventIn, ventOut, 0.82, (t) => -2.0 * Math.sin(t * Math.PI), 10);

export const CLOUDFORGE_SEGS = SEGS;

export const CLOUDFORGE: TrackDefinition = {
  id: 'cloudforge',
  name: 'Arctic Skyway',
  subtitle: 'Winterblue arctic sky • 1.7 km • 17 turns • 2 jumps',
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
    // Winterblue: the sky bridge and the dock sweeper are sheet ice.
    { ...span(M.skyBridge, 0, 1), surface: 'ice', wall: 'both', shoulder: 1.2, label: 'Sky Bridge (ice)' },
    { ...span(M.dockSweeper, 0.15, 0.85), surface: 'ice', wall: 'both', shoulder: 1.2, label: 'Dock Sweeper (ice)' },
    { ...span(M.gantryRamp, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, label: 'Gantry Hop' },
    { ...span(M.gantryGapA, 0, 1), gap: true, wall: 'none', shoulder: 1.5, label: 'Gantry Hop' },
    { ...span(M.gantryGapB, 0, 1), gap: true, wall: 'none', shoulder: 1.5, label: 'Gantry Hop' },
    { ...span(M.gantryLanding, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, label: 'Gantry Hop' },
    { ...span(M.forgeEssA, 0, 1), surface: 'road', wall: 'both', shoulder: 1.6, label: 'Forge Esses' },
    { ...span(M.forgeEssB, 0, 1), surface: 'road', wall: 'both', shoulder: 1.6, label: 'Forge Esses' },
    { ...span(M.cranesA, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, label: 'The Cranes' },
    { ...span(M.cranesB, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, label: 'The Cranes' },
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
    {
      id: 'vent-shaft',
      name: 'Vent Shaft',
      inS: ventIn,
      outS: ventOut,
      nodes: ventNodes,
      w: 4.6,
      surface: 'metal',
      sign: 'VENT SHAFT — under the deck and out the other side',
      flavor: 'shorter-risky',
    },
  ],
  hazards: [
    // Item chests: a row of three after the line, one more mid-lap.
    { kind: 'chest', s: at(M.forgeStraight, 0.55), lat: -3.5 },
    { kind: 'chest', s: at(M.forgeStraight, 0.55), lat: 0 },
    { kind: 'chest', s: at(M.forgeStraight, 0.55), lat: 3.5 },
    { kind: 'chest', s: at(M.dockStraight, 0.15), lat: 0 },
    // A frost Kilnbane guards the dock straight from an ice floe.
    { kind: 'boss', s: at(M.dockStraight, 0.50), lat: 15, period: 6.0, phase: 0.5, slamLat: 2.5, reach: 2.6, style: 'kilnbane' },
    // Cargo crates on the dock straight and between the cranes. Solid.
    { kind: 'stack', s: at(M.dockStraight, 0.30), lat: 4.6, w: 2.4, h: 1.6, len: 3.0, style: 'cargo' },
    { kind: 'stack', s: at(M.dockStraight, 0.62), lat: -4.6, w: 2.4, h: 1.6, len: 3.0, style: 'cargo' },
    { kind: 'stack', s: at(M.cranesA, 0.6), lat: -3.8, w: 2.0, h: 1.4, len: 2.6, style: 'cargo' },
    { kind: 'stack', s: at(M.forgeEssB, 0.5), lat: 4.0, w: 2.2, h: 1.5, len: 2.8, style: 'cargo' },
    { kind: 'bumper', s: at(M.cranesB, 0.5), lat: 6.0, r: 1.8 },
    { kind: 'roller', s: at(M.forgeEssA, 0.5), lat: 0, period: 3.6, phase: 0.1, travel: 6.0, r: 2.0 },
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
    // Winterblue, the arctic land: ice-blue sky, snow, a cold bright sun.
    sky: ['#7fc4ff', '#eaf6ff'],
    fog: '#dbeeff',
    fogNear: 90,
    fogFar: 540,
    sun: '#ffffff',
    sunDir: [0.52, 0.66, 0.54],
    ambient: '#b8d4ee',
    ground: '#eef5fb',
    roadTop: '#6f7f92',
    roadEdge: '#9fd8ff',
    rail: '#cfe5f5',
    accent: '#7fe0ff',
    scenery: 'arctic',
  },
  schemaVersion: 3,
};

export const CLOUDFORGE_MARKS = M;
