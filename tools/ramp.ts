import { trackById } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
const id = process.argv[2] ?? 'canopy';
const def = trackById(id);
const track = new TrackRuntime(def);
const L = track.lapLength;
const gapZones = def.zones.filter((z) => z.gap).sort((a, b) => a.from - b.from);
const from = gapZones[0].from, to = gapZones[gapZones.length - 1].to;
console.log(`${def.name}: gap u ${from.toFixed(4)}..${to.toFixed(4)} = s ${(from*L).toFixed(1)}..${(to*L).toFixed(1)} m`);
for (let s = from * L - 40; s <= to * L + 30; s += 3) {
  const sm = track.main.sample(s);
  const u = (s / L + 1) % 1;
  const z = track.zoneAt(u);
  console.log(`  s=${s.toFixed(0).padStart(5)} u=${u.toFixed(4)} y=${sm.pos.y.toFixed(2).padStart(7)} slope=${sm.fwd.y.toFixed(3).padStart(7)} ${z?.gap ? 'GAP' : z?.label ?? ''}`);
}
