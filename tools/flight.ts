/** Flight profile probe for Luna Launch: where does a kart actually go?
 *  Placement of the rings, obstacles and target is read off this, not guessed. */
import { trackById } from '../src/data/tracks/index';
import { TrackRuntime } from '../src/sim/track';
import { RaceCore } from '../src/sim/race';
import { resolveLoadout, defaultParts } from '../src/sim/loadout';
import { axieById } from '../src/data/axies';
import { kartById } from '../src/data/karts';
import { MODE_RULES } from '../src/data/rules';
import type { KartInput } from '../src/sim/kart';

const DT = 1 / 120;
const def = trackById('event-launch');
const track = new TrackRuntime(def);
const L = track.lapLength;
const yard = def.zones.find((z) => z.label === 'The Yard')!;
const kicker = def.zones.find((z) => z.label === 'Kicker')!;
const yardStartS = yard.from * L;
const yardLenS = (yard.to - yard.from) * L;

console.log(`course ${L.toFixed(0)} m · kicker ends ${(kicker.to * L).toFixed(0)} m · yard ${yardStartS.toFixed(0)}–${(yard.to * L).toFixed(0)} m (${yardLenS.toFixed(0)} m long)\n`);

for (const [label, kartId] of [['Dartwing (agile)', 'kart-dartwing'], ['Moonshard (balanced)', 'kart-moonshard'], ['Terrapin (power)', 'kart-terrapin']] as const) {
  const core = new RaceCore(track, RaceCore.configFor('bonus', 'event-launch', 1, 1));
  const lo = resolveLoadout(axieById('mock-buba'), kartById(kartId), defaultParts(), {
    playerId: 'p', budget: MODE_RULES.bonus.statBudget,
  });
  const r = core.addRacer('p', 'probe', lo, { isPlayer: true });
  const inputs = new Map<string, KartInput>();
  let t = 0, lipSpeed = 0, launchS = 0, apex = 0, launched = false, landed = -1, apexAbove = 0;
  const dbg: string[] = [];
  const clearance: (number | undefined)[] = [];
  const ringMiss: (number | undefined)[] = [];
  let targetDist = 999;
  const hz = core.hazards.length ? core.hazards : track.initHazards();
  const stackIdx = hz.map((h, i) => (h.def.kind === 'stack' ? i : -1)).filter((i) => i >= 0);
  const ringIdx = hz.map((h, i) => (h.def.kind === 'ring' ? i : -1)).filter((i) => i >= 0);
  const targetIdx = hz.findIndex((h) => h.def.kind === 'target');
  const ringPrev = new Map<number, number>();
  while (t < 45) {
    // Drive it properly: no throttle during the countdown (holding it bogs the
    // start, which is correct game behaviour and ruins the measurement), and
    // steer toward the road so it does not grind along a wall.
    const kk = r.kart, gg = r.ground;
    let err = Math.atan2(gg.fwd.x, gg.fwd.z) - kk.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    err -= gg.lat * 0.02;
    inputs.set('p', {
      throttle: core.phase === 'countdown' ? 0 : 1,
      brake: 0,
      steer: Math.max(-1, Math.min(1, err * 2.2)),
      drift: false, lookBack: false,
    });
    core.step(DT, inputs);
    t += DT;
    const k = r.kart, g = r.ground;
    if (!launched && !k.grounded && g.s > kicker.to * L - 10) {
      launched = true; launchS = g.s; lipSpeed = k.speed;
    }
    if (launched && !k.grounded) {
      const above = k.pos.y - g.height;
      if (above > apexAbove) { apexAbove = above; apex = g.s - launchS; }
    }
    // Clearance over each obstacle, measured as it passes.
    stackIdx.forEach((hi, n) => {
      const h = hz[hi];
      const d2 = h.def as Extract<typeof h.def, { kind: 'stack' }>;
      const along = (k.pos.x - h.anchor.x) * h.fwd.x + (k.pos.z - h.anchor.z) * h.fwd.z;
      if (Math.abs(along) < 1.2 && clearance[n] === undefined) {
        clearance[n] = k.pos.y - (h.anchor.y + d2.h);
      }
    });
    // Radial miss distance at each ring's plane.
    ringIdx.forEach((hi, n) => {
      const h = hz[hi];
      const dx = k.pos.x - h.pos.x, dy = k.pos.y - h.pos.y, dz = k.pos.z - h.pos.z;
      const along = dx * h.fwd.x + dz * h.fwd.z;
      const prev = ringPrev.get(hi);
      ringPrev.set(hi, along);
      if (prev !== undefined && prev <= 0 && along > 0 && ringMiss[n] === undefined) {
        const lat = dx * h.right.x + dz * h.right.z;
        ringMiss[n] = Math.hypot(lat, dy);
      }
    });
    if (launched && k.grounded && landed < 0 && t > 1) {
      landed = g.s - launchS;
      if (targetIdx >= 0) {
        const ht = hz[targetIdx];
        targetDist = Math.hypot(k.pos.x - ht.anchor.x, k.pos.z - ht.anchor.z);
      }
      break;
    }
    if (dbg.length < 12 && Math.abs(t % 1) < DT) {
      dbg.push(`t=${t.toFixed(0)} s=${g.s.toFixed(0)} lat=${g.lat.toFixed(1)} out=${g.outside.toFixed(1)} ` +
        `v=${(k.speed*3.6).toFixed(0)} vf=${k.forwardSpeed.toFixed(1)} yaw=${(k.yaw*180/Math.PI).toFixed(0)} ` +
        `roadYaw=${(Math.atan2(g.fwd.x,g.fwd.z)*180/Math.PI).toFixed(0)} spin=${k.spinTimer.toFixed(1)} gnd=${k.grounded}`);
    }
  }
  if (!launched) { console.log(`  ${label}: NEVER LAUNCHED`); dbg.forEach(d => console.log('    ' + d)); }
  // Clearance over every obstacle, and whether each ring was threaded.
  const stacks = def.hazards.filter((h) => h.kind === 'stack') as Extract<typeof def.hazards[number], { kind: 'stack' }>[];
  const rings = def.hazards.filter((h) => h.kind === 'ring') as Extract<typeof def.hazards[number], { kind: 'ring' }>[];
  const target = def.hazards.find((h) => h.kind === 'target') as Extract<typeof def.hazards[number], { kind: 'target' }> | undefined;
  console.log('   obstacles: ' + stacks.map((st, i) => {
    const c = clearance[i];
    return `${(st.style ?? 'crates')} ${c === undefined ? 'n/a' : c.toFixed(1) + 'm'}`;
  }).join(' · '));
  console.log('   rings:     ' + rings.map((rg, i) => {
    const m = ringMiss[i];
    return m === undefined ? '—' : (m <= rg.r ? `HIT (${m.toFixed(1)}/${rg.r})` : `miss by ${(m - rg.r).toFixed(1)}m`);
  }).join(' · '));
  if (target) {
    const d = targetDist;
    const names = ['outer', 'bronze', 'silver', 'GOLD'];
    let ringName = 'missed';
    for (let i = target.rings.length - 1; i >= 0; i--) if (d <= target.rings[i]) { ringName = names[i]; break; }
    console.log(`   target:    landed ${d.toFixed(1)} m from centre → ${ringName}`);
  }

  const asYardFrac = (metresPastLip: number) =>
    ((launchS + metresPastLip) - yardStartS) / yardLenS;
  console.log(`${label.padEnd(22)} lip ${(lipSpeed * 3.6).toFixed(0).padStart(3)} km/h · ` +
    `apex ${apexAbove.toFixed(1)} m up at ${apex.toFixed(0)} m · lands ${landed.toFixed(0)} m out ` +
    `(yard frac ${asYardFrac(landed).toFixed(3)})`);
  if (label.startsWith('Moonshard')) {
    console.log('\n  placement guide, as yard fractions:');
    for (const d of [15, 25, 35, 45, 55, 65, 75, 85]) {
      console.log(`    ${String(d).padStart(3)} m out → ${asYardFrac(d).toFixed(3)}`);
    }
    console.log('');
  }
}
