# Architecture

## The one constraint

**The simulation imports nothing from three.js, the DOM, or any transport.**

Everything else in this document follows from that. It is enforced by
inspection — `src/sim/` and `src/data/` import only `src/core/` and each
other — and it buys:

| Because the sim is pure | We get |
|---|---|
| It runs in node | An eight-kart race can be simulated and validated in a terminal, with no browser and no GPU. That is how nearly every bug in this build was found. |
| It runs on a server | `server/sim.mjs` is this simulation bundled for node. The authoritative server is not a second implementation that can drift out of sync — it is the same code. |
| It is deterministic | A race replays identically from a seed and a list of inputs, which is what makes a ghost, a replay and a server-side result check the same mechanism. |

## Module boundaries

```
core/      maths, seeded RNG, formatting.               no imports
data/      content: Axies, karts, parts, tracks,         imports core
           bonus events, rules version
sim/       spline, track runtime, kart physics,          imports core, data
           race core, bots, loadout resolver
render/    three.js scene, meshes, VFX, camera           imports core, data, sim (read-only)
audio/     synthesised sound                             imports core
net/       adapter interface + two implementations       imports sim types
ui/        screens, HUD, input                           imports everything above
game/      race view, bonus run, garage turntable        glue
persist/   profile, schema version, migration            imports data
```

`render/` reads the simulation and never writes to it. `ui/` owns no race
state. `game/` is the only place the two meet.

## Race truth

Progress is **one continuous number per racer**: laps completed, with a
fraction, advanced by the signed change in lap position every tick.

```
raw += loopDelta(prevU, u, 1)
```

Lap counting, race position, wrong-way detection, split times, checkpoint
order and skip detection all read off that one accumulator instead of five
interacting special cases. A step larger than `MAX_STEP` cannot be produced by
driving, so it is rejected — that single rule is the whole anti-skip system.

Off the road, and on an alternate line, the nearest point on the track is
genuinely ambiguous and the projection can flip between two places the kart
drove between continuously. Those are re-anchored silently. On the road the
projection is unambiguous, so a jump there is a real teleport and is flagged.
A flagged result is held back rather than published.

## Hazards

Every hazard is a pure function of the race clock:

```
state = f(raceTime, period, phase)
```

Two clients on opposite sides of the world agree on the state of every gator
jaw, rotating gate and collapsing panel without exchanging a single packet
about any of them. The "synchronised dynamic objects" requirement is solved by
not having any dynamic object state to synchronise.

## Loadout resolution

```
Axie + kart + fitted parts  ──▶  ValidatedLoadout  ──▶  race
                                 (stats, handling,
                                  traits, rules version,
                                  validation token)
```

The race takes a `ValidatedLoadout` and nothing else. It has no idea what a
part is, what a wallet is, or where any of it came from. That is why a race
can never block on a chain read: there is nothing in the race loop that could
ask.

Ranked normalises every loadout 30% back toward the kart's baseline and caps
the budget. A build changes shape; it never changes size.

## Networking

```
NetworkAdapter (interface)
├── LocalAdapter   races on this device against bots, labelled as such
└── WsAdapter      sends inputs, renders from server snapshots
```

The server owns race start time, checkpoint order, lap completion, respawn
validity, loadout validity, finish order and the published result. A client's
stat block is a claim; the server recomputes it from part ids against its own
rules version. Inputs are clamped on arrival, so no client can ask for more
than full lock or more than full throttle.

Clients predict locally and are corrected toward snapshots: a small error is
blended smoothly, a large one is applied outright, because past a few metres
the prediction is simply wrong and smoothing it only keeps it wrong longer.

Kart-to-kart contact is a damped, mass-weighted impulse and never rotates a
kart directly. Losing a drift is the only rotational consequence of contact,
which keeps remote collisions predictable rather than producing the spin that
makes networked contact miserable.

## Ownership, later

`net/adapter.ts` and `sim/loadout.ts` are the only two places that would
change to put real ownership behind this:

1. An identity adapter resolves a wallet to an inventory **before**
   matchmaking, with a timeout and a cached fallback.
2. The loadout resolver takes owned part ids from that inventory instead of
   from the local profile.
3. The server keeps validating against its own rules version, because chain
   metadata is an ownership input, never a race authority.

Nothing in `sim/`, `render/` or `ui/` is touched. There is deliberately no
chain code in this build.

## Persistence

The profile carries a schema version. Migrations are explicit and additive,
and a load that references content that no longer exists repairs itself rather
than failing — a part removed in a balance pass must not brick a save. A
corrupt or unreadable save loads as a fresh profile instead of crashing on
boot.

Records are kept per rules version. Changing a handling constant means bumping
`RULES_VERSION`, which retires the old board rather than silently mixing two
sets of physics into one table.
