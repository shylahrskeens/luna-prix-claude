/** Track 2 — Ruin Reactor Rally.
 *
 *  Rhythm: compact and technical. Short straights, heavy braking, two rotating
 *  temple gates that change the line every lap, and a reactor spiral that
 *  drops thirty metres in two linked corners. It rewards precision where the
 *  Canopy rewards commitment.
 *
 *  Set piece: the reactor spiral into the timed bridge break — the panels drop
 *  on a four-second cycle and the exit lands in a half-open cavern.
 */
import { buildRouteFull, type RouteSeg } from '../route';
import { chordBranch, at, span } from '../trackHelpers';
import type { TrackDefinition } from '../../sim/trackTypes';

const SEGS: RouteSeg[] = [
  { t: 'straight', len: 120, w: 12, mark: 'startStraight' },
  { t: 'turn', angle: -80, radius: 60, bank: 6, mark: 't1' },
  // The colonnade esses, through the fallen pillars.
  { t: 'turn', angle: 30, radius: 62, w: 13, mark: 'ruinEssA' },
  { t: 'turn', angle: -30, radius: 62, w: 13, mark: 'ruinEssB' },
  // The full forty metres the original had before the descent: the bots (and
  // you) need the sight line to brake for a tightening downhill left.
  { t: 'straight', len: 40 },
  { t: 'turn', angle: -80, radius: 40, dy: -6, w: 11, mark: 'gateTurn' },
  { t: 'straight', len: 70, dy: -8, w: 10, mark: 'causeway' },
  { t: 'turn', angle: 50, radius: 45, mark: 't3' },
  { t: 'straight', len: 50, w: 11 },
  { t: 'turn', angle: -80, radius: 38, dy: -10, bank: 10, w: 10, mark: 'spiralA' },
  { t: 'turn', angle: -60, radius: 32, dy: -9, bank: 12, w: 10, mark: 'spiralB' },
  { t: 'straight', len: 55, dy: -4, w: 11, mark: 'chamberExit' },
  { t: 'turn', angle: 60, radius: 50, mark: 't5' },
  // The crypt kink: a narrow left-right under the vault, right before the bridge.
  { t: 'turn', angle: -25, radius: 48, w: 12, mark: 'cryptA' },
  { t: 'straight', len: 20, w: 12 },
  { t: 'turn', angle: 25, radius: 48, w: 12, mark: 'cryptB' },
  // The bridge break: a short ramp, a 14 m gap, and a flat landing. Small
  // enough that any kart clears it at racing speed, big enough that a kart
  // slowed by the panels ahead of it will not.
  { t: 'straight', len: 38, dy: 3, w: 12, mark: 'bridgeApproach' },
  { t: 'straight', len: 16, dy: 4.0, w: 12, mark: 'bridgeRamp' },
  { t: 'straight', len: 5, dy: 1.25, w: 12, mark: 'bridgeGapA' },
  { t: 'straight', len: 6, dy: -4, w: 12, mark: 'bridgeGapB' },
  { t: 'straight', len: 24, dy: 0, w: 12, mark: 'brokenBridge' },
  { t: 'turn', angle: -70, radius: 55, dy: 8, mark: 't6' },
  { t: 'straight', len: 20 },
  // The altar leap: a second, smaller break in the causeway.
  { t: 'straight', len: 12, dy: 3.0, w: 12, mark: 'altarRamp' },
  { t: 'straight', len: 6, dy: 0.7, w: 12, mark: 'altarGapA' },
  { t: 'straight', len: 6, dy: -2.4, w: 12, mark: 'altarGapB' },
  { t: 'straight', len: 20, dy: -1.0, w: 12, mark: 'altarLanding' },
  { t: 'straight', len: 10 },
  { t: 'turn', angle: -45, radius: 70, dy: 7, mark: 't7' },
  { t: 'straight', len: 75, w: 12 },
  { t: 'turn', angle: 45, radius: 36, w: 10, mark: 'crystalA' },
  { t: 'turn', angle: -45, radius: 36, w: 10, mark: 'crystalB' },
  { t: 'turn', angle: 45, radius: 48, w: 11, mark: 'crystalC' },
  { t: 'turn', angle: -45, radius: 48, w: 11, mark: 'crystalD' },
  { t: 'straight', len: 20 },
  { t: 'turn', angle: -55, radius: 62, mark: 'surgeTurn' },
  { t: 'straight', len: 95, dy: 10, w: 12, mark: 'powerSurge' },
];

const route = buildRouteFull(SEGS, { width: 12, spacing: 8, start: [0, 0, 0], heading: 0 });
const M = route.marks;

/** The precision tunnel: a tight interior line through the crystal chicane
 *  that trades the outside speed for a much shorter path. */
const tunnelIn = at(M.t7, 0.80);
const tunnelOut = at(M.crystalB, 0.98);
const tunnelNodes = chordBranch(route.nodes, tunnelIn, tunnelOut, 0.95,
  (t) => -1.4 * Math.sin(t * Math.PI), 12);

/** The altar steps: a dirt cut across the inside of the climbing left after
 *  the bridge. Shorter, steeper, and it rejoins right at the altar ramp. */
const stepsIn = at(M.t6, 0.06);
const stepsOut = at(M.t6, 0.94);
const stepsNodes = chordBranch(route.nodes, stepsIn, stepsOut, 0.85, () => 0, 10);

export const RUIN_SEGS = SEGS;

export const RUIN: TrackDefinition = {
  id: 'ruin',
  name: 'Ruin Reactor Rally',
  subtitle: 'Sunken temple • 1.4 km • 20 turns • 2 jumps',
  setPiece: 'The reactor spiral — thirty metres down into a timed bridge break.',
  difficulty: 2,
  laps: 3,
  nodes: route.nodes,
  checkpointCount: 14,
  start: { s: 0.02, rows: 4, colGap: 6.6, rowGap: 7.2 },
  killY: -140,
  shoulder: 2.6,
  unlock: { kind: 'podium' },
  zones: [
    { from: 0, to: 1, surface: 'road', wall: 'both', shoulder: 2.6 },
    { ...span(M.causeway, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.4, covered: true, label: 'Temple Gate' },
    { ...span(M.spiralA, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.6, covered: true, label: 'Reactor Spiral' },
    { ...span(M.spiralB, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.4, covered: true, label: 'Reactor Spiral' },
    { ...span(M.chamberExit, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.6, covered: true, label: 'Core Chamber' },
    // The bridge break. Panels drop on a cycle; the gap in the middle is real.
    { ...span(M.bridgeApproach, 0, 1), surface: 'metal', wall: 'none', shoulder: 1.2, label: 'Bridge Break' },
    { ...span(M.bridgeRamp, 0, 1), surface: 'metal', wall: 'none', shoulder: 1.0, label: 'Bridge Break' },
    { ...span(M.bridgeGapA, 0, 1), gap: true, wall: 'none', shoulder: 0.8, label: 'Bridge Break' },
    { ...span(M.bridgeGapB, 0, 1), gap: true, wall: 'none', shoulder: 0.8, label: 'Bridge Break' },
    { ...span(M.brokenBridge, 0, 1), surface: 'metal', wall: 'none', shoulder: 1.0, label: 'Bridge Break' },
    { ...span(M.crystalA, 0, 1), surface: 'road', wall: 'both', shoulder: 1.8, label: 'Crystal Chicane' },
    { ...span(M.crystalB, 0, 1), surface: 'road', wall: 'both', shoulder: 1.8, label: 'Crystal Chicane' },
    { ...span(M.crystalC, 0, 1), surface: 'road', wall: 'both', shoulder: 1.8, label: 'Crystal Chicane' },
    { ...span(M.crystalD, 0, 1), surface: 'road', wall: 'both', shoulder: 1.8, label: 'Crystal Chicane' },
    { ...span(M.ruinEssA, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Colonnade' },
    { ...span(M.ruinEssB, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Colonnade' },
    { ...span(M.cryptA, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, covered: true, label: 'Crypt' },
    { ...span(M.cryptB, 0, 1), surface: 'metal', wall: 'both', shoulder: 1.2, covered: true, label: 'Crypt' },
    { ...span(M.altarRamp, 0, 1), surface: 'metal', wall: 'none', shoulder: 1.2, label: 'Altar Leap' },
    { ...span(M.altarGapA, 0, 1), gap: true, wall: 'none', shoulder: 1.0, label: 'Altar Leap' },
    { ...span(M.altarGapB, 0, 1), gap: true, wall: 'none', shoulder: 1.0, label: 'Altar Leap' },
    { ...span(M.altarLanding, 0, 1), surface: 'metal', wall: 'none', shoulder: 1.2, label: 'Altar Leap' },
    { ...span(M.powerSurge, 0, 1), surface: 'road', wall: 'both', shoulder: 3.0, label: 'Power Surge' },
    { ...span(M.gateTurn, 0, 1), surface: 'road', wall: 'both', shoulder: 2.0, label: 'Temple Descent' },
  ],
  boostPads: [
    { s: at(M.startStraight, 0.60), lat: 0, len: 12, w: 6 },
    { s: at(M.causeway, 0.45), lat: 0, len: 14, w: 5 },
    { s: at(M.chamberExit, 0.55), lat: 0, len: 16, w: 6 },
    { s: at(M.bridgeApproach, 0.55), lat: 0, len: 14, w: 7 },
    { s: at(M.powerSurge, 0.30), lat: 0, len: 16, w: 7 },
    { s: at(M.powerSurge, 0.68), lat: 0, len: 16, w: 7 },
    { s: 0.5, lat: 0, len: 10, w: 5, branch: 'precision-tunnel' },
  ],
  branches: [
    {
      id: 'precision-tunnel',
      name: 'Precision Tunnel',
      inS: tunnelIn,
      outS: tunnelOut,
      nodes: tunnelNodes,
      w: 4.2,
      surface: 'metal',
      sign: 'PRECISION TUNNEL — shorter, and it does not forgive',
      flavor: 'shorter-risky',
    },
    {
      id: 'altar-steps',
      name: 'Altar Steps',
      inS: stepsIn,
      outS: stepsOut,
      nodes: stepsNodes,
      w: 4.6,
      surface: 'dirt',
      sign: 'ALTAR STEPS — cuts the climb, lands you on the ramp',
      flavor: 'shorter-risky',
    },
  ],
  hazards: [
    // Fallen pillar drums along the edges of the surge straight. Solid: the
    // wide line through the last sector costs a moment of care.
    { kind: 'stack', s: at(M.powerSurge, 0.40), lat: 4.9, w: 1.8, h: 1.5, len: 3.0, style: 'drums' },
    { kind: 'stack', s: at(M.powerSurge, 0.80), lat: -4.9, w: 1.8, h: 1.5, len: 3.0, style: 'drums' },
    { kind: 'bumper', s: at(M.ruinEssA, 0.5), lat: -8.5, r: 2.0 },
    { kind: 'bumper', s: at(M.ruinEssB, 0.5), lat: 8.5, r: 2.0 },
    // Rotating temple gates. The opening sweeps across the road, so the line
    // through the gate is different every lap but never random.
    { kind: 'gate', s: at(M.causeway, 0.55), lat: 0, period: 5.2, phase: 0.0, span: 7.5 },
    { kind: 'gate', s: at(M.chamberExit, 0.28), lat: 0, period: 4.4, phase: 0.35, span: 7.5 },
    // Collapsing bridge panels on a four-second cycle.
    { kind: 'panel', s: at(M.bridgeApproach, 0.55), lat: 0, period: 4.0, phase: 0.0, w: 10, len: 6 },
    { kind: 'panel', s: at(M.brokenBridge, 0.45), lat: 0, period: 4.0, phase: 0.5, w: 10, len: 6 },
    // Crystal rollers sweeping the chicane.
    { kind: 'roller', s: at(M.crystalA, 0.5), lat: 0, period: 3.2, phase: 0.0, travel: 5.0, r: 1.9 },
    { kind: 'roller', s: at(M.crystalB, 0.5), lat: 0, period: 3.2, phase: 0.5, travel: 5.0, r: 1.9 },
    { kind: 'bumper', s: at(M.t3, 0.5), lat: -7.5, r: 2.0 },
    { kind: 'bumper', s: at(M.t6, 0.4), lat: 8.0, r: 2.0 },
  ],
  theme: {
    sky: ['#241b38', '#7a3f63'],
    fog: '#33264a',
    fogNear: 40,
    fogFar: 280,
    sun: '#ffcf9a',
    sunDir: [0.36, 0.62, -0.70],
    ambient: '#4b3d63',
    ground: '#2a2436',
    roadTop: '#6a6577',
    roadEdge: '#c79a54',
    rail: '#463f55',
    accent: '#5ef0d8',
    scenery: 'ruin',
  },
  schemaVersion: 3,
};

export const RUIN_MARKS = M;
