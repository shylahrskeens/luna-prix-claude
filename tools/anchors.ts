import { TRACKS } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
for (const def of TRACKS) {
  const t = new TrackRuntime(def);
  const L = t.lapLength;
  console.log(`\n${def.name}  gaps: ${t.gaps.map(g => `${g.from.toFixed(3)}-${g.to.toFixed(3)}`).join(', ')}`);
  for (const c of t.checkpoints) {
    const g = TrackRuntime.emptyGround();
    t.ground(c.respawnPos, undefined, g);
    const flag = g.gap ? '  <<< ANCHOR IN GAP' : g.outside > 0.5 ? `  <<< ${g.outside.toFixed(1)}m OFF ROAD` : '';
    console.log(`  cp${String(c.index).padStart(2)} gate u=${c.u.toFixed(3)}  anchor u=${g.u.toFixed(3)} y=${c.respawnPos.y.toFixed(1)} gap=${g.gap} out=${g.outside.toFixed(1)}${flag}`);
    void L;
  }
}
