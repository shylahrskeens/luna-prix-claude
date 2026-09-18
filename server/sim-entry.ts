/** Everything the server needs from the game simulation, in one entry point.
 *  Bundled to `server/sim.mjs` so node runs the SAME code the browser does. */
export { TrackRuntime } from '../src/sim/track';
export { RaceCore } from '../src/sim/race';
export { BotDriver, RIVALS } from '../src/sim/ai';
export { resolveLoadout, defaultParts } from '../src/sim/loadout';
export { NEUTRAL_INPUT } from '../src/sim/kart';
export { AXIES, axieById } from '../src/data/axies';
export { KARTS, kartById } from '../src/data/karts';
export { trackById, TRACKS } from '../src/data/tracks/index';
export { MODE_RULES, RULES_VERSION, ratingDelta, divisionFor } from '../src/data/rules';
export { partById } from '../src/data/parts';
export { hashString } from '../src/core/math';
