# Luna Prix

An Axie kart racer. Three circuits, seven rivals, a rank to climb, and two
bonus events that ask for something other than a lap time.

Built for the Ronin Vibeathon. It runs in a browser with no install, no wallet
and no network connection.

---

## Play it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # bundles the server sim, typechecks, then builds to dist/
npm run preview      # serves dist/ on http://localhost:4173
```

`dist/` is a static directory. It works from any static host or from a local
file server; nothing in the game requires a backend.

Optional authoritative multiplayer server:

```bash
npm run server                            # ws://localhost:8787
# then open the game with ?server=ws://localhost:8787
```

---

## Controls

| Keyboard | Gamepad | Touch | Action |
|---|---|---|---|
| `W` / `↑` | RT or A | **GO** | Accelerate |
| `S` / `↓` | LT or B | **BRAKE** | Brake, then reverse |
| `A` `D` / `← →` | Left stick | Stick | Steer |
| `Space` | RB / LB / X | **DRIFT** | Hop, then hold to drift |
| `Space` in the air | RB in the air | **DRIFT** | Trick |
| `Q` | Y | — | Look back |
| `R` | — | — | Return to the track |
| `Esc` | Start | — | Pause |

Every binding is remappable in Settings. The control card the game shows you
matches whatever device you last touched.

**The one thing worth knowing:** hold drift through a corner to fill the boost
meter, and release it on the exit. Three tiers — blue, orange, purple. That
loop is most of the game.

---

## What is in it

**Three Axies**, built from the real Axie data shape: a class, six body parts
each with a class of their own, and HP/Speed/Skill/Morale recomputed from
those parts the way the Axie stat model does it. Class gives a passive that
shows up in every corner.

**Three karts** — Agile, Balanced, Power — with seat sockets, so three Axies ×
three karts is nine working combinations rather than nine hand-placed ones.

**Seven part slots** (chassis, engine, tires, suspension, boost, aero, paint),
data-driven, levelled, versioned, and resolved into a validated loadout before
a race starts. Ranked normalises every loadout and caps the budget, so a build
changes shape and never size.

**Three circuits**

| Track | Length | Signature moment |
|---|---|---|
| Lunacia Canopy Run | 1.35 km | The gator pit — a leap over open water and leaping jaws |
| Ruin Reactor Rally | 1.24 km | The reactor spiral into a timed bridge break |
| Cloudforge Circuit | 1.60 km | The hangar launch, over a moored airship and through a boost ring |

Each has an alternate line that is honestly labelled: two are genuinely
shorter and narrower, one is longer but carries two boost pads and dodges a
crosswind.

**Two bonus events**

- **Mega Ramp** — build speed, pick your launch, stick the landing. Scored on
  distance × landing quality × trick multiplier.
- **Gator Gauntlet** — five leaps, four sets of jaws, scored on time with a
  clean-chain bonus and a six-second penalty per reset.

**Progression** — coins, a shop, a Scrap-to-Lunacian rank ladder, per-track
records kept per rules version, and medals per bonus event.

---

## Architecture

The simulation has no renderer, no DOM and no transport dependency. That one
constraint is what makes the rest possible:

- the **race core runs headless**, so a full eight-kart race can be simulated
  and checked in a terminal without a browser or a GPU;
- the **server runs the same code the client does** — `server/sim.mjs` is the
  game's own simulation bundled for node, not a reimplementation of it;
- **hazards are pure functions of the race clock**, so every client agrees on
  the state of every gator jaw and rotating gate without sending a packet
  about any of them.

```
src/
  core/      maths, seeded RNG, formatting — no dependencies
  data/      Axies, karts, parts, tracks, bonus events, rules version
  sim/       spline, track runtime, kart physics, race core, bots, loadout
  render/    three.js: scene, track mesh, kart and Axie models, VFX, camera
  audio/     synthesised engine, surface, impact and music — no asset files
  net/       adapter interface, offline adapter, authoritative-server adapter
  ui/        screens, HUD, input, touch controls
  persist/   profile with schema versioning and migration
  game/      race view, bonus run, garage turntable
server/      authoritative race server (node + ws)
tools/       headless race harness, geometry validator, probes
```

See `docs/ARCHITECTURE.md` for the boundaries and `docs/COMPLIANCE.md` for
what is real Axie data and what is demo data.

---

## Tooling

The interesting bugs in this build were found by tools, not by playing:

```bash
npm run check:geometry     # track geometry validator
npm run check:races        # full races on every track, several seeds
```

The validator checks that every jump is clearable at a plausible speed, that
no two pieces of road are close enough to confuse lap-progress projection,
that every respawn anchor is on solid ground with enough run-up for the next
jump, and that a branch advertised as shorter actually is.

The race harness runs eight bots through three laps on each track at several
seeds and reports lap times, finishing spread, respawns, wall contacts, time
off-road, and any integrity flag.

---

## Known limits

- **Frame rate on a GPU is unmeasured.** CPU cost per frame is 0.5 ms median
  with eight karts and full effects, but the capture environment never presents
  a frame, so that is a floor and not a frame rate. See
  `docs/evidence/performance.md`. The quality tier measures its own frame time
  on the player's hardware and steps down once if it will not hold.
- The rank ladder and every leaderboard are local to the browser profile. The
  server can publish authoritative results; nothing hosted is running.
- Axie art is procedural and original. The three drivers are named for the
  models in the official Axie 3D starter toolkit so the real meshes drop into
  the same definitions; their classes, parts and colours are demo data.

## Credits and licences

All code, geometry, art and audio in this repository was written for it. There
are no third-party assets. The only runtime dependency is
[three.js](https://threejs.org) (MIT).
