/** Track authoring format.
 *
 *  Positions along a track are authored in normalised lap units (0..1) rather
 *  than metres, so a route can be re-shaped without renumbering every zone,
 *  pad and hazard on it.
 */
import type { V3 } from '../core/math';

export type Surface = 'road' | 'dirt' | 'mud' | 'water' | 'metal' | 'ice' | 'grass' | 'boost';

export interface SurfaceProps {
  /** Multiplier on available lateral grip. */
  grip: number;
  /** Multiplier on top speed while on this surface. */
  speed: number;
  /** Extra linear drag, m/s^2. */
  drag: number;
  /** Particle colour for tyre spray. */
  dust: string;
  /** Rumble intensity 0..1 for camera and audio. */
  rough: number;
}

export const SURFACE: Record<Surface, SurfaceProps> = {
  road:  { grip: 1.00, speed: 1.00, drag: 0.0, dust: '#cfd6e0', rough: 0.05 },
  boost: { grip: 1.00, speed: 1.00, drag: 0.0, dust: '#ffd479', rough: 0.05 },
  metal: { grip: 1.06, speed: 1.00, drag: 0.0, dust: '#9fb4c8', rough: 0.02 },
  dirt:  { grip: 0.80, speed: 0.95, drag: 1.2, dust: '#b9905c', rough: 0.35 },
  mud:   { grip: 0.66, speed: 0.87, drag: 3.4, dust: '#6b5334', rough: 0.55 },
  water: { grip: 0.74, speed: 0.90, drag: 2.6, dust: '#9fe3ff', rough: 0.30 },
  ice:   { grip: 0.40, speed: 1.02, drag: 0.0, dust: '#dff4ff', rough: 0.10 },
  grass: { grip: 0.62, speed: 0.78, drag: 5.0, dust: '#79a15a', rough: 0.70 },
};

/** A stretch of track with non-default properties. `from`/`to` are 0..1 and
 *  may wrap past 1 (e.g. 0.94 -> 0.06 covers the start line). */
export interface ZoneDef {
  from: number;
  to: number;
  surface?: Surface;
  /** Barrier on the left/right edge. Without one, leaving the road means
   *  shoulder, then out-of-bounds, then respawn. */
  wall?: 'both' | 'left' | 'right' | 'none';
  /** Width of the rough shoulder outside the road edge, metres. */
  shoulder?: number;
  /** No road at all here — this is the gator pit / reactor gap. Drive in and
   *  you fall. */
  gap?: boolean;
  /** Tunnel or covered section: changes lighting and audio reverb. */
  covered?: boolean;
  /** Label shown on the sector readout. */
  label?: string;
}

export interface BoostPadDef {
  /** Lap position 0..1. */
  s: number;
  /** Lateral offset from the centreline, metres. */
  lat: number;
  /** Length along the track, metres. */
  len: number;
  /** Width, metres. */
  w: number;
  /** Which branch this pad sits on; omit for the main line. */
  branch?: string;
}

/** Deterministic hazards. Every one of these is a pure function of the race
 *  clock, so two clients ten thousand kilometres apart agree on the state of
 *  every gator jaw without sending a single packet about it. */
export type HazardDef =
  | { kind: 'gator';   s: number; lat: number; period: number; phase: number; reach: number; scale?: number }
  | { kind: 'gate';    s: number; lat: number; period: number; phase: number; span: number }
  | { kind: 'panel';   s: number; lat: number; period: number; phase: number; w: number; len: number }
  | { kind: 'roller';  s: number; lat: number; period: number; phase: number; travel: number; r: number }
  | { kind: 'turbine'; s: number; lat: number; strength: number; len: number }
  | { kind: 'bumper';  s: number; lat: number; r: number }
  | { kind: 'ring';    s: number; lat: number; h: number; r: number };

export interface BranchDef {
  id: string;
  name: string;
  /** Where it leaves and rejoins the main line, in lap units. */
  inS: number;
  outS: number;
  /** Control points in world space; the runtime stitches them to the main line. */
  nodes: [number, number, number][];
  w: number;
  surface?: Surface;
  /** Copy shown on the route sign before the split. */
  sign: string;
  /** How the branch is meant to play, for the route-choice HUD cue.
   *  - `shorter-risky`: less distance, narrower, punishes a mistake.
   *  - `longer-faster`: more distance but a higher average speed (boost pads,
   *    no hazard), so it pays only if you keep it clean.
   *  - `safer-slower`: the forgiving way round. */
  flavor: 'shorter-risky' | 'longer-faster' | 'safer-slower';
}

export interface StartLineDef {
  /** Lap position of the start/finish line. */
  s: number;
  /** Rows x columns of the starting grid. */
  rows: number;
  /** Lateral spacing between grid slots, metres. */
  colGap: number;
  /** Longitudinal spacing between rows, metres. */
  rowGap: number;
}

export interface TrackTheme {
  sky: [string, string];
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunDir: [number, number, number];
  ambient: string;
  ground: string;
  roadTop: string;
  roadEdge: string;
  rail: string;
  accent: string;
  /** Procedural scenery generator key. */
  scenery: 'canopy' | 'ruin' | 'cloud';
}

export interface TrackDefinition {
  id: string;
  name: string;
  subtitle: string;
  /** One-line description of the signature moment, shown on track select. */
  setPiece: string;
  difficulty: 1 | 2 | 3;
  laps: number;
  /** Centreline control points: [x, y, z, halfWidth, bankDegrees]. */
  nodes: [number, number, number, number, number][];
  checkpointCount: number;
  start: StartLineDef;
  zones: ZoneDef[];
  boostPads: BoostPadDef[];
  branches: BranchDef[];
  hazards: HazardDef[];
  theme: TrackTheme;
  /** Y below which a kart is considered fallen. */
  killY: number;
  /** Default shoulder width when a zone does not override it. */
  shoulder: number;
  /** Unlock gate: null means available from the start. */
  unlock: { kind: 'podium' } | { kind: 'rating'; value: number } | null;
  schemaVersion: number;
}

/** What a kart needs to know about the ground beneath it. */
export interface GroundInfo {
  height: number;
  normal: V3;
  surface: Surface;
  /** Arc length along the MAIN spline — always the progress authority. */
  s: number;
  /** Normalised lap position 0..1. */
  u: number;
  lat: number;
  width: number;
  /** 0 when on the road, otherwise metres past the edge. */
  outside: number;
  /** True while still on drivable surface (road or a branch). */
  onRoad: boolean;
  /** True while on the rough shoulder. */
  onShoulder: boolean;
  /** Beyond the shoulder — respawn territory. */
  outOfBounds: boolean;
  /** A barrier is present at the edge the kart is crossing. */
  wall: boolean;
  /** Signed direction of the wall push (+1 push left, -1 push right). */
  wallSign: number;
  /** No road here at all. */
  gap: boolean;
  covered: boolean;
  /** Which spline produced this reading. */
  onBranch: string | null;
  curvature: number;
  /** Forward direction of the road under the kart. */
  fwd: V3;
}
