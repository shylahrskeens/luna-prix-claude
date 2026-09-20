# Official Axie Vibeathon assets

Research + download log, 2026-09-20. Everything below was verified by fetching the page or
inspecting the downloaded bytes on this machine; nothing here is quoted from memory.

## 1. Where the resources live

The canonical list is the Vibeathon resources page, `https://vibeathon.axieinfinity.ai/resources`.
The four entries this project cares about:

| Resource | Source label | URL | Got it? |
| --- | --- | --- | --- |
| **Animated Axie and Sapidae 3D Assets** | Axie Vibeathon (Official) | https://github.com/jaatster/axie-3d-assets | **Yes — cloned** |
| Axie Origins Battle Kit | Axie Infinity (Official) | https://github.com/axieinfinity/axie-origins-asset-kit | Reachable, not cloned (see §6) |
| Tales of Lunacia | Axie Infinity (Official) | https://axieinfinity.com/lore | **Blocked — HTTP 403** (see §6) |
| Lunalog | Axie Infinity (Official) | https://app.axieinfinity.com/lunalog/catalog/ | **Blocked — HTTP 403** (see §6) |

Related official entries from the same page, for reference: `@axieinfinity/mixer`
(https://www.npmjs.com/package/@axieinfinity/mixer), Three.js Axie Mixer 3D beta
(https://github.com/jaatster/threejs-axie-mixer3d-public — labelled **Community**, not official),
Axie Media Kit (https://skymavis.notion.site/Axie-Infinity-b8d4b60d82a04b14a998394a439b89e1).

Note the resources page explicitly says of the Mixer 3D beta: *"It may not work smoothly in every
project; use the provided animated 3D models for initial prototypes."* That is a direct steer
toward the GLB pack we downloaded.

## 2. What was downloaded

```
git clone --depth 1 https://github.com/jaatster/axie-3d-assets.git
```

- Location: `/Users/shylahskeens/luna-prix/assets-incoming/axie-3d-assets` (121 MB incl. `.git`)
- 24 `.glb` files: 7 mascots, 10 Sapidae, 7 static equipment props
- **`assets-incoming/` is already in `.gitignore` (line 9, commit f735b1b), and `git status` is
  clean — no binary will be committed.** Nothing under `src/` or `public/` was touched.
- Full checksum manifest: `assets-incoming/SHA256SUMS.txt` (24 lines, `shasum -a 256`)

The seven mascots — the only files a kart racer realistically ships:

| File | Size | sha256 |
| --- | --- | --- |
| `assets/mascots/bing.glb` | 1.5 MB | `69d8b2a6878a8c416bf17ad25ac86c1daa5a38cb03deaf0fd9fb8fd6ef0e4aad` |
| `assets/mascots/kibo.glb` | 1.9 MB | `816d2d3013f1e306f8e1db5285cf89f819b2fa68dd0c00b9218633fe67154214` |
| `assets/mascots/kotaro.glb` | 946 KB | `62ea95a83782cc047cafcd34d183112066b82dd94bf785e43ab3d5c41dcf4404` |
| `assets/mascots/paladill.glb` | 2.8 MB | `e422949a05dfeaeff479ceca1b4ba39a571e642a586815285abc5616caba68e7` |
| `assets/mascots/pomodoro.glb` | 1.2 MB | `59019cd483f27fc9c5ca94a407d577a0406af36d05c02c32fedc120832ad2601` |
| `assets/mascots/tripp.glb` | 7.1 MB | `72af631b8d02a23c0a2d3a55f6e91802d7857031ed7f238688e0a44f90518080` |
| `assets/mascots/xia.glb` | 3.0 MB | `99b54efc08f99d04ec776e75e918f5625c7242119d5fd1f4f57b44cf46fa98b8` |

## 3. Licence — quoted, not paraphrased

Source file: `assets-incoming/axie-3d-assets/RIGHTS.md`, titled "Limited-use asset permission".
The grant, in full:

> The Sky Mavis-owned models, textures, animations, and related Axie materials in this repository
> may be used to create, test, demonstrate, submit, and maintain projects for Axie Vibeathon or
> another Axie program explicitly approved by Sky Mavis. An approved project may include the asset
> files it needs to run.

> This permission does not allow you to:
>
> - sell or redistribute these files as a standalone asset pack;
> - sublicense or relicense the assets;
> - claim ownership of Axie or Sapidae names, characters, artwork, models, animations, or textures;
> - use the assets outside an approved Axie project; or
> - use third-party software or content beyond the permission granted by its owner.

> Sky Mavis and its licensors retain all rights not expressly granted here. The assets are provided
> as-is, without a promise of continued availability, compatibility, support, or fitness for a
> particular purpose.

**What this means for Luna Prix:** we are a Vibeathon entry, so shipping the GLBs inside the built
game is expressly permitted ("An approved project may include the asset files it needs to run").
**RIGHTS.md states no attribution requirement** — there is no attribution clause in the file. The
"claim ownership" prohibition still means our credits must not imply the art is ours; a line such as
"Axie and Sapidae characters © Sky Mavis, used under the Axie Vibeathon limited-use permission" is
the safe form. The permission dies if the project stops being an approved Axie program.

`assets-incoming/axie-3d-assets/THIRD_PARTY_NOTICES.md` adds:

> The downloadable GLB files are self-contained and do not require this repository's JavaScript
> dependencies at runtime.

The Origins Battle Kit is governed separately by its own `LICENSE.md`, which states use is
*"limited to Axie Vibeathon and other Sky Mavis-approved programs"* and warns *"Do not redistribute
Epic Toon FX or any other third-party Unity Asset Store package."*

## 4. What is actually inside the GLBs

Measured locally with a dependency-free glTF-2.0 JSON-chunk parser (script kept at
`$SCRATCH/inspect_glb.mjs`), not read off the repo's catalog. Every file: binary glTF 2.0,
generator `Khronos glTF Blender I/O v4.0.44`, extensions `KHR_materials_specular` +
`KHR_materials_ior`, textures embedded as PNG, Y-up, origin near the feet.

### Mascots — one mesh, one material, one texture each

| Character | Tris | Verts | Bones | Texture | Clips |
| --- | --- | --- | --- | --- | --- |
| Bing | 3,264 | 2,162 | 62 | 1024² | 10 |
| Kibo | 5,305 | 3,654 | 60 | 2048² | 10 |
| **Kotaro** | 5,036 | 2,960 | 47 | 1024² (209 KB) | 10 |
| Paladill | 5,614 | 4,569 | 69 | 2048² (1.7 MB) | 10 |
| Pomodoro | 4,478 | 2,970 | 57 | 1024² | 9 |
| Tripp | 5,722 | 3,933 | 89 | 2048² (**6.4 MB**) | 5 |
| Xia | 4,256 | 3,058 | 51 | 2048² (2.1 MB) | 10 |

Clip names + measured durations (from each animation sampler's input-accessor `max`):

- Common to all: `Idle` ≈2.03 s (Tripp 2.5 s), `Walk` ≈1.0 s, `Run` ≈0.667 s (Xia 1.167 s)
- Most also have `Greeting` ≈1.37 s and `Dead` ≈0.97 s (Pomodoro has no Greeting; Tripp has neither)
- Weapon variants, prefixed per character: `Cannon.*` (Bing), `Hammer.*` (Kibo, Paladill),
  `Sword.*` (Kotaro), `Staff.*` (Pomodoro), `Axe.*` (Tripp, Xia) — each set is
  `.Idle/.Walk/.Run/.Attack/.Skill`, attacks 0.8–1.8 s, Xia's `Axe.Skill` the longest at 4.3 s.

### Sapidae — humanoid NPCs, 14 bones, but 7–9 meshes and 7–9 materials each

4,069–5,690 tris, 3.3–4.4 MB, clips `Idle` 2.042 s / `Walk` 1.042 s / `Run` 0.708 s only.

### Equipment — static props, no skin, no clips

76–874 tris, 42–95 KB, 512² texture each. One per mascot.

### Performance read for a 60 fps browser racer

Triangles are a non-issue: eight mascot drivers is ~38k tris. The real costs are (a) **eight
skinned meshes with 47–89 bones**, and (b) **PNG texture weight — Tripp alone is a 6.4 MB embedded
PNG**. Recommendations: use **mascots, not Sapidae**, as drivers (1 draw call vs 7–9); prefer the
1024² characters (Kotaro, Bing, Pomodoro) for the grid; and run the shipped set through
`gltf-transform` (`resize --width 1024`, `webp`, `draco`) before it lands in `public/` —
Tripp in particular should not ship at 7.1 MB.

## 5. How to load this in our three.js scene

Our installed `three` is **0.169.0** — verified present at
`node_modules/three/examples/jsm/loaders/GLTFLoader.js`, and verified to contain handlers for both
`KHR_materials_specular` and `KHR_materials_ior`, so these GLBs need no upgrade (the pack's own
guide suggests 0.178.0; we do not need it).

**Loader:** `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`, plus `THREE.AnimationMixer`
and `THREE.AnimationClip.findByName`.

**Code path to replace — `src/render/axieMesh.ts`.** That file hand-builds the Axie from primitives
and exposes three things the rest of the renderer depends on:

- `buildAxie(def: AxieDefinition, mats: MaterialLibrary): AxieRig`
- `updateAxie(rig: AxieRig, s: AxieDriveState): void`
- `poseForShowcase(rig: AxieRig, t: number): void`

The only consumer is `src/render/kartMesh.ts` (`seatAxie()` at line 239 calls `buildAxie`;
line 304 calls `updateAxie`). So the swap is contained: keep those three signatures, change the
bodies. `AxieRig` currently exposes named part groups (`head`, `earL`, `tail`, …) that `updateAxie`
rotates by hand; a GLB-backed rig should keep `root` and add `{ mixer, actions }`, and the
per-part fields become either bone lookups or get dropped as `updateAxie` starts driving clips.

Two things to plan for before writing code:

1. **Loading is async, `buildAxie` is sync.** Pre-load all GLBs once at boot into a cache
   (`Map<string, GLTF>`), then have `buildAxie` do `SkeletonUtils.clone(cached.scene)` —
   `three/examples/jsm/utils/SkeletonUtils.js`. A plain `.clone()` will **not** clone a skeleton
   correctly and every kart will share one pose.
2. **There is no seated clip.** The pack ships Idle/Walk/Run/Greeting/Dead/weapon sets — nothing for
   sitting in a kart. Verified options: pose the skeleton directly (Kotaro's rig exposes usable
   named joints — `Root_Character, Hip_JNT, Spine01_JNT, Head_JNT, Thin_L/R_JNT, Knee_L/R_JNT,
   Fool_L/R_JNT`, plus `Weapon_L/R_JNT` sockets for the equipment props), or play `Idle` and let the
   driver stand in the kart. Map our existing `AxieDriveState` (lean, crouch, cheer, flinch) onto
   `Greeting` for podium/showcase and additive bone rotations for lean.

Sketch, matching the pack's own Three.js guide:

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('/axies/kotaro.glb');   // preload once
const scene = cloneSkinned(gltf.scene);                              // per kart
const mixer = new THREE.AnimationMixer(scene);
mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'Idle')).play();
// then mixer.update(dt) from the same place kartMesh.ts calls updateAxie()
```

Files move `assets-incoming/axie-3d-assets/assets/mascots/*.glb` → `public/axies/*.glb` (after
compression) so Vite serves them at `/axies/`.

## 6. Not downloaded, and exactly why

- **Axie Origins Battle Kit** — public and clonable; `git ls-remote` returned HEAD `069a59b7`, so no
  login is needed. Not cloned because it is Unity prefabs + a PixiJS **2D** battle stack (63 skill
  VFX prefabs, 152 SFX, 131 status icons, Spine animations) with no 3D kart use, and it is large.
  Clone it with `git clone https://github.com/axieinfinity/axie-origins-asset-kit` if we ever want
  the SFX or status icons; read its `LICENSE.md` first.
- **Tales of Lunacia** (`https://axieinfinity.com/lore`) and **Lunalog**
  (`https://app.axieinfinity.com/lunalog/catalog/`) — both returned **HTTP 403** to `curl` with a
  normal browser User-Agent and to WebFetch. That is bot filtering at the edge, not necessarily a
  login wall; **I have not verified whether they open in a real browser.** Both are reference/lore
  reading rather than downloadable assets, so nothing is blocked on them. **Owner action if we want
  them:** open those two URLs in Chrome directly — no click-through or account was identified.
