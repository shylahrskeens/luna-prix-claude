import type { TrackDefinition } from '../../sim/trackTypes';
import { CANOPY } from './canopy';
import { RUIN } from './ruin';
import { CLOUDFORGE } from './cloudforge';

export const TRACKS: TrackDefinition[] = [CANOPY, RUIN, CLOUDFORGE];

export function trackById(id: string): TrackDefinition {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown track: ${id}`);
  return t;
}
export { CANOPY, RUIN, CLOUDFORGE };
