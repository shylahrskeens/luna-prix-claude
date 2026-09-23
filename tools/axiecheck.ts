/** Can every shipped Axie be assembled by the Mixer, strictly?
 *
 *  The Mixer refuses a part it does not have instead of substituting one, and
 *  it does so in the browser, at seat time, where the only symptom is a kart
 *  that never upgrades from the procedural driver. This plans each Axie in
 *  src/data/axies.ts against the installed content pack's manifest — no GPU,
 *  no fetch — and fails on a missing part, a class the pack does not carry,
 *  or a class that disagrees with the stat model's part list.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ThreeAxieMixer3D } from '@jaatster/threejs-axie-mixer3d-public';
import { AXIES } from '../src/data/axies';

const require = createRequire(import.meta.url);
const packageRoot = require.resolve('@jaatster/threejs-axie-mixer3d-public/package.json').replace(/package\.json$/, '');
const manifest = JSON.parse(readFileSync(`${packageRoot}public/assets/axie/manifest.json`, 'utf8'));
const mixer = new ThreeAxieMixer3D({ manifest });

let failures = 0;
const say = (line: string) => console.log(line);
say(`axiecheck: pack ${manifest.source.commit} (${Object.keys(manifest.assets.parts).length} parts)`);

const STAT_TYPE: Record<string, string> = { eye: 'eyes', ear: 'ears', back: 'back', mouth: 'mouth', horn: 'horn', tail: 'tail' };

for (const axie of AXIES) {
  const problems: string[] = [];
  if (axie.mixer.parts.length !== 6) problems.push(`descriptor has ${axie.mixer.parts.length} parts, not 6`);
  for (const mp of axie.mixer.parts) {
    const sp = axie.parts.find((p) => p.type === STAT_TYPE[mp.type]);
    if (!sp) problems.push(`no stat part for ${mp.type}`);
    else if (sp.class !== mp.class) problems.push(`${mp.type}: mixer class ${mp.class} != stat class ${sp.class}`);
  }
  let plan;
  try {
    plan = mixer.plan({ descriptor: axie.mixer, extensions: { quality: 'balanced', artMode: 'faithful', strict: true } });
    if (plan.missingParts.length) problems.push(`missing in pack: ${plan.missingParts.join(', ')}`);
    for (const w of plan.warnings) if (w.severity === 'error') problems.push(`plan error: ${w.message ?? w.code}`);
  } catch (err) {
    problems.push(`plan threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  const rigs = plan ? plan.partRigs.length : 0;
  if (problems.length) {
    failures++;
    say(`FAIL ${axie.name.padEnd(9)} ${axie.mixer.body}/c${axie.mixer.colorVariant}`);
    for (const p of problems) say(`     - ${p}`);
  } else {
    say(`ok   ${axie.name.padEnd(9)} ${axie.mixer.body}/c${axie.mixer.colorVariant}  ${rigs} rigs  ${plan!.partRigs.map((r) => r.partId ?? r.id ?? '').filter(Boolean).slice(0, 6).join(' ')}`);
  }
}

if (failures) {
  say(`axiecheck: ${failures} Axie(s) cannot be assembled`);
  process.exit(1);
}
say('axiecheck: every Axie assembles strictly');
