#!/usr/bin/env node
/** Copy the slice of the Mixer content pack the shipped Axies need.
 *
 *  The full pack is 510 MB and never enters the repository. The five drivers
 *  in src/data/axies.ts load a measured subset — tools/axiepack.list, recorded
 *  by the dev server's LUNA_PACK_LOG while each Axie was built — and this
 *  copies that subset, plus the manifest and the integrity receipt, into
 *  public/assets/axie/ so the Pages build carries real Axies.
 *
 *  Re-record the list (LUNA_PACK_LOG=<file> npm run dev, open each Axie in
 *  the garage from a fresh origin) whenever a driver's descriptor changes.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('@jaatster/threejs-axie-mixer3d-public/package.json'));
const source = path.join(packageRoot, 'public/assets/axie');
const target = path.resolve('public/assets/axie');
const list = readFileSync(new URL('./axiepack.list', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const files = ['manifest.json', ...list];
let bytes = 0, copied = 0, missing = 0;
for (const rel of files) {
  const from = path.join(source, rel);
  if (!existsSync(from)) { console.error(`missing in pack: ${rel}`); missing++; continue; }
  const to = path.join(target, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  bytes += statSync(from).size;
  copied++;
}
copyFileSync(path.join(packageRoot, 'content-integrity.json'), path.join(target, 'content-integrity.json'));
copyFileSync(path.join(packageRoot, 'RIGHTS.md'), path.join(target, 'RIGHTS.md'));
console.log(`axiepack: ${copied} files, ${(bytes / 1048576).toFixed(1)} MB → public/assets/axie${missing ? ` (${missing} missing)` : ''}`);
if (missing) process.exit(1);
