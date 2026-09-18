import type { TrackDefinition } from '../../sim/trackTypes';
import { CANOPY } from './canopy';
import { RUIN } from './ruin';
import { CLOUDFORGE } from './cloudforge';
import { MEGA_RAMP_TRACK, GAUNTLET_TRACK } from '../bonus';

/** The three race circuits, in the order they unlock. */
export const TRACKS: TrackDefinition[] = [CANOPY, RUIN, CLOUDFORGE];

/** Every course the runtime can load, including the bonus-event courses. */
export const ALL_TRACKS: TrackDefinition[] = [...TRACKS, MEGA_RAMP_TRACK, GAUNTLET_TRACK];

export function trackById(id: string): TrackDefinition {
  const t = ALL_TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown track: ${id}`);
  return t;
}
export { CANOPY, RUIN, CLOUDFORGE };
