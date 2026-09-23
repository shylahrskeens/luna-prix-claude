/** Track 0 — Goldenwind Sprint.
 *
 *  Goldenwind is the savannah of Lunacia: golden grass to the horizon,
 *  flat-topped acacias, termite mounds, ochre rock. The circuit is the fast
 *  one — long sight lines, a dune flick, a river jump, a canyon with walls
 *  and boulders, and a hairpin around a lone rock that the dry riverbed cuts
 *  straight through.
 */
import { buildRouteFull, type RouteSeg } from '../route';
import { chordBranch, at, span } from '../trackHelpers';
import type { TrackDefinition } from '../../sim/trackTypes';

const SEGS: RouteSeg[] = [
  { t: 'straight', len: 160, w: 14, mark: 'grid' },
  { t: 'turn', angle: 50, radius: 80, bank: 6, mark: 't1' },
  { t: 'straight', len: 40 },
  // The dune flick: a fast left-right over a low crest.
  { t: 'turn', angle: -28, radius: 95, w: 14, dy: 2, mark: 'duneA' },
  { t: 'turn', angle: 28, radius: 95, w: 14, dy: -2, mark: 'duneB' },
  { t: 'straight', len: 30, dy: 2 },
  // The river jump.
  // Same recipe as the gator pit: the first stretch of open water keeps the
  // ramp's slope so the spline tangent stays UP at the lip, then the far bank
  // sits well below the near one so any moving kart makes it.
  // Segments are at least two node spacings long: a six-metre segment gets a
  // single node and the spline overshoots the crest. Gator-pit proportions.
  { t: 'straight', len: 24, dy: 7.0, w: 13, mark: 'riverRamp' },
  { t: 'straight', len: 10, dy: 3.0, w: 13, mark: 'riverGapA' },
  { t: 'straight', len: 14, dy: -9.0, w: 13, mark: 'riverGapB' },
  { t: 'straight', len: 34, dy: -2.5, w: 13, mark: 'riverLanding' },
  { t: 'turn', angle: 95, radius: 45, bank: 10, w: 12, mark: 'baobabBend' },
  // The canyon: walls, boulders, and a left-right between the rock faces.
  { t: 'straight', len: 70, w: 12, mark: 'canyon' },
  { t: 'turn', angle: -60, radius: 54, w: 12, mark: 'canyonA' },
  { t: 'turn', angle: 60, radius: 54, w: 12, mark: 'canyonB' },
  { t: 'straight', len: 50 },
  { t: 'turn', angle: 110, radius: 60, dy: 4, mark: 'loneRock' },
  { t: 'straight', len: 90, w: 13, mark: 'plain' },
  { t: 'turn', angle: -25, radius: 55, mark: 't7' },
  { t: 'straight', len: 40 },
  { t: 'turn', angle: 130, radius: 70, bank: 8, mark: 'finalArc' },
  { t: 'straight', len: 60, w: 14 },
];

const route = buildRouteFull(SEGS, { width: 14, spacing: 8, start: [0, 0, 0], heading: 0 });
const M = route.marks;

/** The dry riverbed: straight across the inside of the lone-rock hairpin, on
 *  mud. Much shorter; the mud takes most of it back unless you hold it straight. */
const bedIn = at(M.loneRock, 0.05);
const bedOut = at(M.loneRock, 0.95);
const bedNodes = chordBranch(route.nodes, bedIn, bedOut, 0.86, () => 0, 10);

export const SAVANNAH_SEGS = SEGS;

export const SAVANNAH: TrackDefinition = {
  id: 'savannah',
  name: 'Savannah Sprint',
  subtitle: 'Goldenwind savannah • 1.2 km • 13 turns • 1 jump',
  setPiece: 'The river jump into the baobab bend, and a canyon full of boulders.',
  difficulty: 1,
  laps: 3,
  nodes: route.nodes,
  checkpointCount: 12,
  start: { s: 0.02, rows: 4, colGap: 7.0, rowGap: 7.5 },
  killY: -70,
  shoulder: 5.0,
  unlock: null,
  zones: [
    { from: 0, to: 1, surface: 'road', wall: 'none', shoulder: 5.0 },
    { ...span(M.duneA, 0, 1), surface: 'road', wall: 'none', shoulder: 6.0, label: 'Dune Sweep' },
    { ...span(M.duneB, 0, 1), surface: 'road', wall: 'none', shoulder: 6.0, label: 'Dune Sweep' },
    { ...span(M.riverRamp, 0, 1), surface: 'road', wall: 'none', shoulder: 4.0, label: 'River Jump' },
    { ...span(M.riverGapA, 0, 1), gap: true, wall: 'none', shoulder: 4.0, label: 'River Jump' },
    { ...span(M.riverGapB, 0, 1), gap: true, wall: 'none', shoulder: 4.0, label: 'River Jump' },
    { ...span(M.riverLanding, 0, 1), surface: 'road', wall: 'none', shoulder: 4.0, label: 'River Jump' },
    { ...span(M.baobabBend, 0, 1), surface: 'road', wall: 'right', shoulder: 3.0, label: 'Baobab Bend' },
    { ...span(M.canyon, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Canyon' },
    { ...span(M.canyonA, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Canyon' },
    { ...span(M.canyonB, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Canyon' },
    { ...span(M.loneRock, 0, 1), surface: 'dirt', wall: 'none', shoulder: 5.0, label: 'Lone Rock' },
    { ...span(M.plain, 0, 1), surface: 'road', wall: 'none', shoulder: 6.0, label: 'Golden Plain' },
    { ...span(M.finalArc, 0, 1), surface: 'road', wall: 'none', shoulder: 5.0, label: 'Final Arc' },
  ],
  boostPads: [
    { s: at(M.grid, 0.55), lat: 0, len: 12, w: 6 },
    { s: at(M.canyon, 0.25), lat: 0, len: 12, w: 6 },
    { s: at(M.plain, 0.30), lat: -3.5, len: 14, w: 5 },
    { s: at(M.plain, 0.70), lat: 3.5, len: 14, w: 5 },
    { s: at(M.finalArc, 0.5), lat: 0, len: 12, w: 6 },
  ],
  branches: [
    {
      id: 'riverbed',
      name: 'Dry Riverbed',
      inS: bedIn,
      outS: bedOut,
      nodes: bedNodes,
      w: 5.0,
      surface: 'mud',
      sign: 'DRY RIVERBED — straight through the mud',
      flavor: 'shorter-risky',
    },
  ],
  hazards: [
    // Item chests: a row of three after the line, one more mid-lap.
    { kind: 'chest', s: at(M.grid, 0.75), lat: -3.5 },
    { kind: 'chest', s: at(M.grid, 0.75), lat: 0 },
    { kind: 'chest', s: at(M.grid, 0.75), lat: 3.5 },
    { kind: 'chest', s: at(M.plain, 0.15), lat: 0 },
    // The Chimera prowls the golden plain and hammers the middle of the road.
    { kind: 'boss', s: at(M.plain, 0.55), lat: -16, period: 6.5, phase: 0.0, slamLat: -1.5, reach: 2.8, style: 'chimera' },
    // Boulder heaps on the canyon edges; a rolling boulder across the plain.
    { kind: 'stack', s: at(M.canyon, 0.50), lat: 4.4, w: 2.2, h: 1.6, len: 2.8, style: 'boulders' },
    { kind: 'stack', s: at(M.canyonA, 0.55), lat: -4.0, w: 2.0, h: 1.5, len: 2.6, style: 'boulders' },
    { kind: 'stack', s: at(M.canyonB, 0.55), lat: 4.0, w: 2.0, h: 1.5, len: 2.6, style: 'boulders' },
    { kind: 'roller', s: at(M.plain, 0.50), lat: 0, period: 4.0, phase: 0.3, travel: 6.0, r: 2.0 },
  ],
  theme: {
    // Goldenwind, the savannah: gold grass, ochre rock, a big warm sky.
    sky: ['#7cc5ff', '#ffe1a8'],
    fog: '#e8d9a8',
    fogNear: 90,
    fogFar: 520,
    sun: '#fff0c8',
    sunDir: [0.40, 0.72, 0.56],
    ambient: '#c9b07a',
    ground: '#c9a85a',
    roadTop: '#8a6a45',
    roadEdge: '#e8c47a',
    rail: '#a3763e',
    accent: '#ffd166',
    scenery: 'savannah',
  },
  schemaVersion: 3,
};

export const SAVANNAH_MARKS = M;
