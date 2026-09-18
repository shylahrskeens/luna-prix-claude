# Performance — what has and has not been measured

## Measured

**CPU cost per frame**, full eight-kart race on Lunacia Canopy Run, production
build, all effects active:

```
frames sampled   240
median           0.50 ms
p90              0.70 ms
p99              1.70 ms
max              2.50 ms
```

That is the simulation (two fixed 120 Hz steps), the scene-graph update for
eight karts and eight Axie rigs, hazard and particle updates, and the draw-call
submission. Against a 16.7 ms budget it leaves the frame almost entirely to the
GPU.

**Bundle size**, cold production build from a fresh clone:

```
dist/index.html                    1.7 kB   gzip   0.9 kB
dist/assets/index.css             12.9 kB   gzip   3.6 kB
dist/assets/index.js             202.6 kB   gzip  68.4 kB
dist/assets/three.js             492.5 kB   gzip 124.0 kB
                                 -------          ------
total                            704   kB         197  kB
```

No asset downloads. Everything else is generated at load.

**Cold start**: a fresh clone, `npm install && npm run build`, served as a
static directory, from page load to a running eight-kart race in about two
seconds on this machine.

**Simulation cost, headless**: 21 full three-lap races across three circuits
complete in a few seconds of wall time in node, which is what makes the race
harness usable as a check rather than a ceremony.

## NOT measured

**Frame rate on a GPU.** The automated browser this was captured from runs its
tab in the background, where the compositor never presents a frame. `render()`
queues commands and returns, so the numbers above are CPU submit cost and are a
floor, not a frame rate. A real figure needs the build opened in a foreground
tab on target hardware, which is one thing this session could not do for
itself.

**Anything on a phone.** The touch layout and the responsive breakpoints were
verified at a 414 px viewport; the thermal and GPU behaviour of an actual
handset was not.

**Memory over a long session.** No soak test was run.

The quality tier does not rely on any of this: it measures its own frame time
over the first three seconds of a race and steps down once if the p90 will not
hold 42 fps. That check runs on the player's hardware, not on assumptions made
here.
