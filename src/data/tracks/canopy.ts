/** Track 1 — Lunacia Canopy Run.
 *
 *  Rhythm: a long start straight to set the field, a fast opening sweeper, a
 *  climbing hairpin that punishes greed, then the signature gator pit. After
 *  the jump the track never lets you rest: a banked right, a chicane, a long
 *  descending right into the root tunnel, and a fast exit onto the straight.
 *
 *  Set piece: the gator pit. You leave the tunnel, the jaws and the landing
 *  ramp are visible for a full two seconds before the lip, and the choice is
 *  the wide boost-pad line or the narrow inside line that saves twelve metres.
 */
import { buildRouteFull, type RouteSeg } from '../route';
import { chordBranch, at, span } from '../trackHelpers';
import type { TrackDefinition } from '../../sim/trackTypes';

const SEGS: RouteSeg[] = [
  { t: 'straight', len: 150, w: 13, mark: 'startStraight' },
  { t: 'turn', angle: 65, radius: 72, bank: 5, mark: 't1' },
  // The esses: a left-right flick that decides your entry speed for the hairpin.
  { t: 'turn', angle: -30, radius: 62, w: 12, mark: 'essA' },
  { t: 'turn', angle: 30, radius: 62, w: 12, mark: 'essB' },
  { t: 'straight', len: 25 },
  { t: 'turn', angle: 105, radius: 34, dy: 5, w: 11.5, mark: 'hairpin' },
  { t: 'straight', len: 40, dy: 4, w: 12, mark: 'climb' },
  // The log jump: a short crest over a fallen trunk. Any kart that is still
  // moving clears it; a kart that stalled on the climb does not.
  { t: 'straight', len: 16, dy: 4.5, w: 12, mark: 'logRamp' },
  { t: 'straight', len: 5, dy: 1.4, w: 12, mark: 'logGapA' },
  { t: 'straight', len: 7, dy: -2.2, w: 12, mark: 'logGapB' },
  { t: 'straight', len: 24, dy: -1.4, w: 12, mark: 'logLanding' },
  { t: 'turn', angle: -55, radius: 60, mark: 't3' },
  // The gator pit is authored as four segments so the jump is real geometry:
  // a descending approach, a 22 m ramp that climbs 7 m, the open pit, and a
  // landing slope 5 m below the lip that forgives a slow launch.
  { t: 'straight', len: 38, dy: -3, w: 14, mark: 'gatorApproach' },
  { t: 'straight', len: 24, dy: 7.5, w: 14, mark: 'gatorRamp' },
  // The first stretch of the pit keeps climbing at the ramp's slope. There is
  // no road here, so the height is invisible — but it holds the spline tangent
  // up at the lip, and that tangent IS the launch. Round the crest off and the
  // kart drops into the water instead of flying over it.
  { t: 'straight', len: 10, dy: 3.1, w: 14, mark: 'gatorPitA' },
  { t: 'straight', len: 12, dy: -8, w: 14, mark: 'gatorPitB' },
  { t: 'straight', len: 34, dy: -2, w: 14, mark: 'gatorLanding' },
  { t: 'turn', angle: 90, radius: 44, bank: 14, w: 12, mark: 'bankedRight' },
  { t: 'straight', len: 30 },
  // The vine kink: tightens just as the bridge sign appears.
  { t: 'turn', angle: 40, radius: 30, w: 10, mark: 'kinkA' },
  { t: 'turn', angle: -40, radius: 30, w: 10, mark: 'kinkB' },
  { t: 'straight', len: 20 },
  { t: 'turn', angle: -45, radius: 28, w: 10, mark: 'chicaneA' },
  { t: 'turn', angle: 45, radius: 28, w: 10, mark: 'chicaneB' },
  { t: 'straight', len: 45, w: 12 },
  { t: 'turn', angle: 70, radius: 66, dy: -9, mark: 'longRight' },
  { t: 'straight', len: 130, dy: -5, w: 11, mark: 'rootTunnel' },
  { t: 'turn', angle: -40, radius: 55, dy: 4 },
  { t: 'straight', len: 20 },
  // The double: two opposed corners with log piles on the outside of each.
  { t: 'turn', angle: 60, radius: 30, w: 11, mark: 'doubleA' },
  { t: 'straight', len: 18 },
  { t: 'turn', angle: -60, radius: 32, w: 11, mark: 'doubleB' },
  { t: 'straight', len: 20 },
  { t: 'turn', angle: 70, radius: 50, dy: 3, mark: 't6' },
  { t: 'straight', len: 70, w: 13 },
  { t: 'turn', angle: 55, radius: 85, mark: 'finalSweep' },
  { t: 'straight', len: 55, w: 13 },
];

const route = buildRouteFull(SEGS, { width: 13, spacing: 8, start: [0, 0, 0], heading: 0 });
const M = route.marks;

/** The vine bridge: leaves just before the chicane, climbs over it, and lands
 *  back on the main line at the entry to the long right. Shorter, much
 *  narrower, and it ends in a drop you have to land flat. */
const bridgeIn = at(M.bankedRight, 0.70);
const bridgeOut = at(M.chicaneB, 0.98);
const bridgeNodes = chordBranch(route.nodes, bridgeIn, bridgeOut, 0.92,
  (t) => 5.0 * Math.sin(t * Math.PI) ** 0.8, 12);

/** The root cut: a mud track straight across the inside of the long right.
 *  Shorter by a lot; mud grip and mud speed take most of it back unless you
 *  hold the kart straight. */
const cutIn = at(M.longRight, 0.06);
const cutOut = at(M.longRight, 0.94);
const cutNodes = chordBranch(route.nodes, cutIn, cutOut, 0.88, () => 0, 10);

export const CANOPY_SEGS = SEGS;

export const CANOPY: TrackDefinition = {
  id: 'canopy',
  name: 'Forest Canopy Run',
  subtitle: 'Evergreen forest • 1.5 km • 18 turns • 2 jumps',
  setPiece: 'The gator pit — a 30 metre leap over open water and moving jaws.',
  difficulty: 2,
  laps: 3,
  nodes: route.nodes,
  checkpointCount: 12,
  start: { s: 0.02, rows: 4, colGap: 7.0, rowGap: 7.5 },
  killY: -70,
  shoulder: 4.0,
  unlock: { kind: 'podium' },
  zones: [
    { from: 0, to: 1, surface: 'road', wall: 'none', shoulder: 4.5 },
    { ...span(M.hairpin, 0, 1), surface: 'road', wall: 'both', shoulder: 2.4, label: 'Carved Hairpin' },
    { ...span(M.essA, 0, 1), surface: 'road', wall: 'both', shoulder: 3.0, label: 'The Esses' },
    { ...span(M.essB, 0, 1), surface: 'road', wall: 'both', shoulder: 3.0, label: 'The Esses' },
    { ...span(M.climb, 0, 1), surface: 'dirt', wall: 'none', shoulder: 5.0, label: 'Root Climb' },
    { ...span(M.logRamp, 0, 1), surface: 'dirt', wall: 'none', shoulder: 4.0, label: 'Log Jump' },
    { ...span(M.logGapA, 0, 1), gap: true, wall: 'none', shoulder: 4.0, label: 'Log Jump' },
    { ...span(M.logGapB, 0, 1), gap: true, wall: 'none', shoulder: 4.0, label: 'Log Jump' },
    { ...span(M.logLanding, 0, 1), surface: 'dirt', wall: 'none', shoulder: 4.0, label: 'Log Jump' },
    { ...span(M.gatorApproach, 0, 1), surface: 'road', wall: 'none', shoulder: 6.0, label: 'Gator Pit' },
    { ...span(M.gatorRamp, 0, 1), surface: 'road', wall: 'none', shoulder: 3.0, label: 'Gator Pit' },
    // The pit itself: no road, just water and jaws.
    { ...span(M.gatorPitA, 0, 1), gap: true, wall: 'none', shoulder: 6.0, label: 'Gator Pit' },
    { ...span(M.gatorPitB, 0, 1), gap: true, wall: 'none', shoulder: 6.0, label: 'Gator Pit' },
    { ...span(M.gatorLanding, 0, 1), surface: 'road', wall: 'none', shoulder: 5.0, label: 'Gator Pit' },
    { ...span(M.bankedRight, 0, 1), surface: 'road', wall: 'both', shoulder: 3.0, label: 'Vine Banking' },
    { ...span(M.kinkA, 0, 1), surface: 'road', wall: 'both', shoulder: 2.4, label: 'Vine Kink' },
    { ...span(M.kinkB, 0, 1), surface: 'road', wall: 'both', shoulder: 2.4, label: 'Vine Kink' },
    { ...span(M.doubleA, 0, 1), surface: 'road', wall: 'both', shoulder: 2.6, label: 'Log Piles' },
    { ...span(M.doubleB, 0, 1), surface: 'road', wall: 'both', shoulder: 2.6, label: 'Log Piles' },
    { ...span(M.chicaneA, 0, 1), surface: 'road', wall: 'both', shoulder: 2.2, label: 'Twin Roots' },
    { ...span(M.chicaneB, 0, 1), surface: 'road', wall: 'both', shoulder: 2.2, label: 'Twin Roots' },
    { ...span(M.rootTunnel, 0, 1), surface: 'road', wall: 'both', shoulder: 1.8, covered: true, label: 'Root Tunnel' },
    { ...span(M.finalSweep, 0, 1), surface: 'road', wall: 'right', shoulder: 4.0, label: 'Canopy Reveal' },
  ],
  boostPads: [
    { s: at(M.startStraight, 0.55), lat: 0, len: 12, w: 6 },
    // The safe line over the pit: wide, and it costs you the inside.
    { s: at(M.gatorApproach, 0.55), lat: 5.5, len: 16, w: 5.5 },
    { s: at(M.climb, 0.60), lat: -4.0, len: 12, w: 5 },
    { s: at(M.rootTunnel, 0.35), lat: 0, len: 14, w: 6 },
    { s: at(M.rootTunnel, 0.78), lat: 0, len: 14, w: 6 },
    { s: at(M.t6, 0.5), lat: 3.0, len: 12, w: 5 },
  ],
  branches: [
    {
      id: 'vine-bridge',
      name: 'Vine Bridge',
      inS: bridgeIn,
      outS: bridgeOut,
      nodes: bridgeNodes,
      w: 5.2,
      surface: 'dirt',
      look: 'planks',
      sign: 'VINE BRIDGE — skips the chicane, lands hard',
      flavor: 'shorter-risky',
    },
    {
      id: 'root-cut',
      name: 'Root Cut',
      inS: cutIn,
      outS: cutOut,
      nodes: cutNodes,
      w: 5.0,
      surface: 'mud',
      sign: 'ROOT CUT — straight through the mud, if you can hold it',
      flavor: 'shorter-risky',
    },
  ],
  hazards: [
    // Item chests: a row of three after the line, one more mid-lap.
    { kind: 'chest', s: at(M.startStraight, 0.80), lat: -3.5 },
    { kind: 'chest', s: at(M.startStraight, 0.80), lat: 0 },
    { kind: 'chest', s: at(M.startStraight, 0.80), lat: 3.5 },
    { kind: 'chest', s: at(M.rootTunnel, 0.55), lat: 0 },
    // The tree golem stands over the long right and slams the inside line.
    { kind: 'boss', s: at(M.longRight, 0.5), lat: -16, period: 6.0, phase: 0.1, slamLat: -2.5, reach: 2.6, style: 'ent' },
    // Log piles on the outside of the double, and one on the inside of the
    // second corner so the lazy line clips it. Solid.
    { kind: 'stack', s: at(M.doubleA, 0.55), lat: -4.8, w: 2.2, h: 1.5, len: 3.2, style: 'logs' },
    { kind: 'stack', s: at(M.doubleB, 0.45), lat: 4.8, w: 2.2, h: 1.5, len: 3.2, style: 'logs' },
    // Four gators on staggered cycles, so the pit never reads the same twice
    // but is always learnable.
    { kind: 'gator', s: at(M.gatorPitB, 0.02), lat: -6.5, period: 3.2, phase: 0.00, reach: 12.5, scale: 2.1 },
    { kind: 'gator', s: at(M.gatorPitB, 0.28), lat: 2.0, period: 2.8, phase: 0.38, reach: 3.0, scale: 1.5 },
    { kind: 'gator', s: at(M.gatorPitB, 0.56), lat: -2.5, period: 3.5, phase: 0.64, reach: 13.5, scale: 2.3 },
    { kind: 'gator', s: at(M.gatorPitB, 0.82), lat: 7.0, period: 3.0, phase: 0.21, reach: 3.5, scale: 1.5 },
    // Swinging roots in the tunnel: timing, not damage.
    { kind: 'roller', s: at(M.rootTunnel, 0.18), lat: 0, period: 3.6, phase: 0.0, travel: 6.5, r: 2.0 },
    { kind: 'roller', s: at(M.rootTunnel, 0.58), lat: 0, period: 2.9, phase: 0.5, travel: 7.5, r: 2.0 },
    { kind: 'bumper', s: at(M.longRight, 0.45), lat: -8.5, r: 2.2 },
    { kind: 'bumper', s: at(M.t1, 0.6), lat: 9.5, r: 2.2 },
  ],
  theme: {
    // Evergreen, the forest land: deep greens, a warm low sun, mossy edges.
    sky: ['#6fb7ff', '#d9f2c9'],
    fog: '#9fcf9c',
    fogNear: 70,
    fogFar: 440,
    sun: '#fff1c8',
    sunDir: [-0.45, 0.78, 0.44],
    ambient: '#6f9a6a',
    ground: '#3b7a3a',
    roadTop: '#7a6a54',
    roadEdge: '#c9b27c',
    rail: '#7a5f3d',
    accent: '#9bf58f',
    scenery: 'forest',
  },
  schemaVersion: 3,
};

export const CANOPY_MARKS = M;
