# Sky Mavis Mixer 3D in Luna Prix

Written 2026-09-23. Round 2 of the Vibeathon "expects a complete game loop, a
live approved Mixer, and meaningful Axie Core integration" (rules 1.0.2). This
is the Mixer half.

## What ships

Every driver on the grid is a real Axie body with real parts, assembled at
seat time by the **Three.js Axie Mixer 3D** toolkit
(<https://github.com/jaatster/threejs-axie-mixer3d-public>, commit `812f0ee`,
installed from that pinned revision — see `package.json`). The game's own
procedural Axie is seated first, instantly, and is swapped for the Mixer
character the moment it loads. If the pack is unreachable or a part is
missing, the procedural driver stays and the race is unaffected.

Each of the three drivers in `src/data/axies.ts` carries a `mixer` descriptor
(body, colour variant, six parts). The descriptor is built from the **same six
parts the stat model reads**, so the class that sets HP/Speed/Skill/Morale is
the class of the mesh on screen. A descriptor is exactly what the toolkit
decodes from a real Axie's genes, so a fetched Axie drops into the same slot:
`mixer.createFromGenes({ genes })` instead of `mixer.create({ descriptor })`.

## Files

| File | Role |
| --- | --- |
| `src/render/axieDriver.ts` | The seat contract (`DriverRig`) and the two drivers: procedural and Mixer. The Mixer driver turns the character to face +Z, scales it to the seat, and layers the kart's lean / crouch / flinch / cheer on top of the Axie's own animation. |
| `src/render/axieMixer.ts` | `AxieMixerService`: one per renderer, boots the toolkit lazily, creates characters, and switches itself off for the session on the first failure. `?mixer=0` disables it. |
| `src/render/kartMesh.ts` | `seatAxie` seats procedural, then upgrades; `disposeKart` releases the character's GPU leases. A seat token drops a character that arrives after the seat changed hands. |
| `tools/axiecheck.ts` | `npm run check:axies` plans every shipped Axie against the pack manifest under strict assembly, with no GPU. Runs inside `npm run check`. |
| `vite.config.ts` | Streams the content pack from `node_modules` for `dev` and `preview`. Nothing is copied into `public/` or `dist/`. |

## Animation mapping

The toolkit models Unity's Axie animator: a Move Speed blend (Idle / Walk /
Run) plus Attack, Skill, Stun and Dead. Seated in a kart:

- normal driving: Idle (breathing), with the kart's lean and crouch on the pose group
- boost, or a podium finish: Move Speed 3 (Run) — legs going
- a hit or a spin: `Action.IdleGetHit` once per impact
- finishing off the podium: Stunned until the result screen

## Hosting the pack — decided: a measured subset ships with the build

The full pack is 510 MB and never enters the repository. The five drivers
load a measured subset: `tools/axiepack.list` is the list of pack files the
dev server actually served (`LUNA_PACK_LOG=<file> npm run dev`, each Axie
opened in the garage from a fresh origin so nothing came from the browser
cache), and `node tools/axiepack.mjs` copies those files plus the manifest,
the integrity receipt and `RIGHTS.md` into `public/assets/axie/`. That is
77 MB on disk (464 files; 51 MB of it is the animation set for the two body
types), and it is committed, so the Pages build carries real Axies with no
second host. `AXIE_ASSET_BASE` is relative (`assets/axie/`) so a sub-path
deploy finds it; `VITE_AXIE_ASSET_BASE` still overrides it.

Re-record the list whenever a driver's descriptor changes, or the strict
assembler will refuse the new part at seat time and the kart keeps its
procedural driver.

## Rights

`RIGHTS.md` in the toolkit: the runtime and Sky Mavis-owned content "may be
used to create, test, demonstrate, submit, and maintain projects for Axie
Vibeathon", and "a qualifying project may bundle the parts of the runtime and
content pack needed to operate that project". Not open source; not
redistributable as a standalone pack. `docs/COMPLIANCE.md` records the
dependency.

## Verified 2026-09-23 (dev server, automated Chrome, backgrounded tab)

- Garage: the seat upgrades from procedural to the Mixer character; Puffy
  renders as a real Aquatic Axie facing the kart's nose at a believable size.
- Race: all 8 karts on Lunacia Canopy Run received Mixer drivers
  (`ctx.mixer.liveCharacters` = 8, every `rig.driver.kind` = `mixer`).
- `npm run check` passes with the new `check:axies` step: every shipped Axie
  plans strictly, 7 rigs each.
- `npm run build` passes; dist is 2.9 MB on disk. The toolkit adds three
  chunks (index 403 kB, mystic materials 497 kB, add-on adapter 1.5 MB) —
  ~217 kB gzipped between them. The pack is not in dist.
- Console after a clean load: no errors, no "multiple instances of three".

Two things found on the way, both fixed:

- **The service worker cached dev modules.** `public/sw.js` v1 was cache-first
  for every same-origin GET, so a browser that had opened the dev server on
  Sep 18 served that day's `src/data/axies.ts` five days later. v2 caches
  only hashed build bundles, and `index.html` never registers a worker on
  localhost (and unregisters any it finds).
- **Two copies of three.js.** The same stale cache held the old optimized
  `three.js`, so the toolkit's chunk and the app each got one. Cleared with
  the cache; `resolve.dedupe: ['three']` in `vite.config.ts` keeps it that way.

## Not done

- No visual tuning has been signed off. `mixerSeat` (scale, offset, pitch) per
  Axie was set by eye on the body bounds in the manifest and needs a look in
  the garage.
- No real-Axie fetch. Resolving an Axie by ID needs a Sky Mavis API key on a
  server; the toolkit ships a resolver shape (`createHttpAxieResolver`) for
  when there is one.
- Frame cost of eight Mixer characters is unmeasured.
