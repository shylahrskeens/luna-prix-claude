import type { TrackDefinition } from '../../sim/trackTypes';
import { CANOPY } from './canopy';
import { RUIN } from './ruin';
import { CLOUDFORGE } from './cloudforge';
import { BONUS_EVENTS } from '../bonus';

/** The three race circuits, in the order they unlock. */
export const TRACKS: TrackDefinition[] = [CANOPY, RUIN, CLOUDFORGE];

/** Every course the runtime can load.
 *
 *  Bonus courses come from the event list rather than being named one by one:
 *  adding an event registered its track automatically, and forgetting to add
 *  it here was a "Unknown track" crash that only showed up at the moment a
 *  player pressed start on it. */
export const ALL_TRACKS: TrackDefinition[] = [...TRACKS, ...BONUS_EVENTS.map((e) => e.track)];

export function trackById(id: string): TrackDefinition {
  const t = ALL_TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown track: ${id}`);
  return t;
}
export { CANOPY, RUIN, CLOUDFORGE };
