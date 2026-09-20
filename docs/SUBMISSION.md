# Luna Prix — submission

## Title

**Luna Prix**

## One line

An Axie kart racer: three circuits, seven rivals, a rank to climb, and two
bonus events that ask for something other than a lap time.

## Short description (48 words)

Pick an Axie, fit it into a kart, and go. Luna Prix is a browser kart racer
built around drift-charged boost, with three circuits, seven rival drivers, a
shop and a rank ladder. No install, no wallet, no waiting. The Axie you choose
changes how the kart drives.

## Full description (270 words)

Luna Prix is a kart racer that wants to be good before it mentions anything
else. Hold drift through a corner, watch the meter fill blue, orange, purple,
and let it go on the exit. That loop is the game, and it is the same loop on
all three circuits.

The Axie is the driver, not a decal. Each one is built from the real Axie data
shape — a class and six body parts, each with a class of its own — and its
HP, Speed, Skill and Morale are recomputed from those parts the way the Axie
stat model does it. Buba's Beast temperament makes every long drift pay more.
Puffy's Aquatic speed ignores the swamp shallows and builds a draft faster.
Pomodoro's six Plant parts simply refuse to be moved off the racing line. The
same three Axies sit correctly in all three karts through a seat-socket
contract, so the nine combinations are nine combinations, not nine one-offs.

Lunacia Canopy Run puts a thirty-metre leap over open water in the middle of a
jungle, with giant gators on cycles you can learn. Ruin Reactor Rally drops
thirty metres through a temple spiral into a bridge that breaks on a timer.
Cloudforge Circuit throws you out of a broken hangar, over a moored airship,
through a boost ring and onto a banked sky bridge. Each has an alternate line,
and the game tells you honestly whether it is shorter or merely faster.

Two bonus events reuse the same kart and ask a different question: how far can
you throw it, and how clean can you keep a chain of five leaps.

Everything is generated — models, tracks, effects, audio. There are no
imported assets.

## How Luna Prix fits the Axie world

The Axie is the mechanical centre of the game, not its skin.

`resolveAxieStats()` takes a class and six parts and returns HP, Speed, Skill
and Morale using the real model: the class base table, plus three points per
part to the stat that part's own class governs. Nothing is stored. The loadout
resolver turns those four battle stats into the six numbers a kart actually
uses, and the class contributes a passive that shows up every corner — a
bigger drift payout, grip on loose surfaces, a faster recovery, a longer
boost.

That means an Axie fetched from a wallet needs no mapping layer. Its parts go
in, its driving comes out. One of the three drivers, **Pomodoro**, shares a
name with a mascot in the official Axie 3D asset pack; Buba and Puffy are names
authored for this build. Their specific parts and colours are demo data, and
the data says so. Swapping in the official rigged meshes is a change of one
file, `src/render/axieMesh.ts`, because everything else reads the definition
rather than the model.

The rest follows the same principle. Kart parts are versioned content resolved
into a validated loadout before a race starts, so a future wallet-backed
inventory replaces one input and touches no physics. Ranked normalises every
loadout back toward the kart baseline, because ownership should change how a
kart feels and never who wins.

## Product vision

Luna Prix is built so the interesting version can exist.

The parts system is already data-driven, levelled, budgeted and versioned. The
seam where verified ownership attaches is two files wide and documented. The
race loop cannot block on a chain read because there is nothing in it that
could ask — the race takes a resolved loadout and nothing else.

There is an authoritative server, and it runs the game's own simulation rather
than a second implementation of it. It owns the race clock, checkpoints, lap
counting, respawn validity, loadout validation and the published result. A
client's stat block is a claim; the server recomputes it from part ids. That
is the foundation a competitive ladder needs, and it exists now, not in a
roadmap.

Where it goes: seasons on a rules version that already stamps every record;
ghost replays, which are the same determinism the server check already relies
on; more circuits from the route-description format, which took an afternoon
each; and part ownership that changes the shape of a kart without changing the
size of an advantage.

What it will not do is make racing worse to make ownership matter more.

## Technical feasibility

- **Runs now**, in a browser, from a static directory. No install, no backend,
  no wallet.
- **728 KB total, 202 KB gzipped**, three.js included. (Measured from
  `npm run build` on 20 Sep 2026: 493 KB three.js, 219 KB game, 13 KB CSS,
  2 KB HTML.)
- **No third-party assets.** Models, tracks, effects and audio are generated.
- **The simulation is pure** — no renderer, DOM or transport dependency. That
  is what lets the server run the same code and lets a full eight-kart race be
  validated in a terminal.
- **Tooling that found the real bugs**: a geometry validator that checks every
  jump is clearable, every respawn anchor is safe with run-up, and no two
  pieces of road can confuse lap projection; and a race harness that runs 21
  full races across three circuits and reports integrity flags, lap spread,
  respawns and time off-road.
- **Multiplayer proven end to end**: two clients, one server, one race, one
  under 80 ms latency and 3% packet loss. Log in
  `docs/evidence/multiplayer-test.md`.

## AI tools used

Written with Claude (Claude Code), in one session, from a prompt bible
supplied by the owner. The work included design, implementation, and the
validators and harnesses that found the defects — several of which were
invisible from playing and only showed up in a terminal.

## Demo video shot list (60 seconds)

| Time | Shot |
|---|---|
| 0:00–0:05 | Garage. Buba in the Moonshard, turntable, six stats moving as a part is swapped. |
| 0:05–0:12 | Lights out on Canopy, start boost, first corner, drift meter filling to orange. |
| 0:12–0:22 | The gator pit: the approach, the ramp, the leap, giant jaws breaching under the kart, the landing. |
| 0:22–0:30 | The alternate-line sign, the vine bridge, rejoining ahead of two rivals. |
| 0:30–0:38 | Ruin: the reactor spiral, then the bridge break with panels dropping. |
| 0:38–0:46 | Cloudforge: out of the hangar, over the airship, through the ring, onto the banked bridge. |
| 0:46–0:52 | Mega Ramp: three pads, the launch, a trick, the landing, the distance number. |
| 0:52–0:57 | Results: P1, rank movement, a track unlocking. |
| 0:57–1:00 | Title card. |

## Screenshots

In `docs/evidence/`: garage, the gator pit mid-leap, Cloudforge, the Ruin
temple gate, results, and the phone layout.

## Controls and supported devices

**Keyboard** — W or Up accelerate · S or Down brake and reverse · A/D or
Left/Right steer · Space or Shift hop, hold to drift · Space in the air trick ·
Q look back · R reset to the track · Esc pause. The control card on the entry
screen lists the same bindings, and they are rebindable in settings.

**Touch** — a thumb stick and pedals appear on a touch screen; the HUD scales
with the device.

**Gamepad** — not supported in this build.

**Where it runs.** Any browser with WebGL2: tested in Chrome on macOS at
1512x796 and at a 400px-wide phone layout. It needs no install, no wallet and
no backend. Quality steps itself down once if the frame time will not hold.

## Known issues

- **Multiplayer is offline.** The client and an authoritative server sim exist
  and have been run end to end as two headless Node clients on localhost, but
  no server is hosted, so the menu entry says "Offline — point it at a race
  server". Nothing in single player depends on it.
- **Rank, coins and leaderboards are local** to the browser profile. Clearing
  site data resets them. There is no account.
- **Frame rate is verified only on the development machine.** No measurement
  exists on a low-end GPU or a phone.
- **Gamepad input is not implemented.**
- The UI typeface is fetched from Google Fonts; with no network the game still
  runs and falls back to a system font.

## Links

- Playable build: **https://shylahrskeens.github.io/luna-prix-claude/**
- Repository: **https://github.com/shylahrskeens/luna-prix-claude**
