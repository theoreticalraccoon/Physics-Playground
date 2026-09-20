# Physics Playground

Six physics stations for a fair stand, aimed at 10–16 year olds on a touchscreen,
where the maths is the thing you operate rather than a caption beside it.

It is one `index.html`, plain ES modules, Canvas 2D, and no dependencies at all —
no build step, no CDN, nothing to download at the venue. Serve the folder and it
runs. GitHub Pages serves it as-is.

```bash
python -m http.server 8080     # ES modules need http://, not file://
```

Then open <http://localhost:8080>. To put it on Pages: push, then Settings →
Pages → deploy from branch, root.

## The problem this is shaped around

A kid at a fair gives you about eight seconds. That rules out a sandbox, which is
only fun after five minutes of exploring, and it rules out anything with
instructions on screen. So:

- every station opens in a state where the obvious gesture — drag something —
  does something immediately
- a station is winnable in about 45 seconds and losing costs nothing
- 30 seconds idle and the whole thing resets to the attract loop, so nobody has to
  babysit the stand between visitors
- large type, heavy contrast, no hover, no target under 48 px

## The maths is the controller

The usual failure is a simulation with an equation panel next to it. Kids watch
the simulation and never read the panel, because nothing they do changes it and it
changes nothing they do.

Here the equation is what you are operating. Aiming the cannon *is* editing the
coefficients of a quadratic: the dotted curve on screen is the graph of the
equation in the panel, drawn from the same two numbers, on the same frame.

| Station | The hook | The maths |
|---|---|---|
| **Launch** | Target practice with a cannon | `y = x·tanθ − gx²/(2v²cos²θ)`; roots, range, the `sin 2θ` complementary-angle reveal |
| **Resultant** | Drag force arrows to push a crate to a door | Components, Pythagoras, `tan⁻¹(Fy/Fx)` |
| **Slingshot** | Fling a probe past a planet | Inverse-square law, distance formula, escape velocity, conic sections |
| **Impact** | Set up a collision that stops a puck dead | Simultaneous equations, momentum and energy |
| **Swing** | Match a pendulum to a drawn wave | `T = 2π√(L/g)`, square-root scaling |
| **Slope** | Tilt a ramp until the block slips | Gradient, `tanθ = μ`, an inequality that flips |

Two carry a real surprise, which is what people remember from a fair. In **Swing**
the period contains no mass and no amplitude — the mass slider is real, moves a
real number, and changes nothing. In **Slope** the surface has a friction
coefficient nobody tells you, and you measure it with an angle.

**Launch** has the best moment: having hit the target at 34°, you are shown that
56° hits it too, because `sin 2θ = sin(180° − 2θ)`.

### The X-ray toggle

One switch, on every station, drawing the same things in the same colours:
velocity split into its components with live numbers, force arrows labelled,
energy bars. Six stations then read as one idea seen six ways rather than six
unrelated toys. Colour never changes meaning — cyan is velocity everywhere, in the
equations as well as on the canvas.

On **Slope** it doubles as the hint: with it off, μ shows as `?` and the grip bar
is hidden, so the only way through is to find the edge.

### The integrator race

A mode inside Launch: the same shot computed by explicit Euler, semi-implicit
Euler, Verlet and RK4 at a deliberately coarse 0.25 s step, fanning out from the
exact parabola as it flies.

The two first-order methods are wrong by exactly `g·dt·t/2` in opposite
directions — Euler high, semi-implicit low — which is a better fact than "Euler is
bad", and the tests check it to twelve significant figures. It makes "your
computer is only approximating" into something you can point at.

## The engine

Hand-written, no physics library, because the maths is the exhibit and it cannot
live inside a dependency.

- fixed-timestep accumulator, semi-implicit Euler, decoupled from frame rate
- circles and convex polygons, SAT with face clipping for contact points
- sequential-impulse solver with accumulated impulses, restitution and Coulomb
  friction
- spring, rod and pin constraints
- deterministic: same inputs, same run, so "three stars, first try" means something

```
src/core/      vec2, body, collide, solver, constraints, integrators, world
src/render/    renderer, xray, mathtype, palette, ui
src/stations/  station + six stations, each with its maths in a separate module
src/fair/      scores, sound
```

Each station's physics is a plain module with no rendering in it — `swing-math.js`
knows about pendulums and nothing about canvases — which is what makes the claims
on screen testable.

## Scores

Enter a name and a class once, collect stars (3 for solving a station first try,
2 by the third go, 1 after that), and the total goes on the board. The board
filters by class, which is the point: it turns the stand into 9B against 9C, and a
class that gets ahead sends people back to defend it.

**To start a fresh leaderboard**, open the board — **Leaderboard** on the attract
screen, or from the menu — and use **Clear the board** in the footer. It asks first,
tells you how many runs will go, and offers the CSV export on the way past, because
there is no copy anywhere else. The same controls are behind a long-press on the
station title, which is the way in when a class is midway through a run.

### One consequence of GitHub Pages

Pages serves static files and runs no server, so there is nowhere to put a shared
database. **The board lives in `localStorage` on the tablet it was played on.**

For a single stand that is the right answer rather than a compromise: it survives
the venue wifi dying, needs no accounts, and children's names never leave the
device. But two tablets keep two boards and they cannot be merged live — export
both to CSV if you need one list. A genuinely shared board needs a backend and is
a different piece of work.

A service worker caches everything on first load, so the stand keeps running if
the wifi drops mid-morning.

## Running it on the day

Open it, then add to home screen — the manifest asks for fullscreen landscape, so
there is no browser chrome for a child to wander into. Sound is synthesised, so
there are no audio files to go missing.

`?station=slope` opens the stand straight onto one station, if you want the tablet
parked on whatever goes with today's lesson. `?warm=6` runs it forward six seconds
first. `x` toggles X-ray, `Escape` goes back.

## Tests

```bash
node tests/run.js      # 65 checks: the physics against closed-form answers
node tests/smoke.js    # 58 checks: every station builds, runs 600 frames and draws
```

The first suite is the one that matters. A station that prints `R = v²sin2θ/g`
next to a cannon has to land the ball there, so the tests check the simulated
range against the formula at five angles, the pendulum period against `2π√(L/g)`,
the elastic collision against the analytic solution, a circular orbit staying
circular over three periods, and the integrator error terms against their
predicted values. An exhibit that teaches a formula and then quietly misses is
worse than no exhibit.

`tests/smoke.js` drives every station through build, drag, 600 frames, X-ray and
attract against a stub DOM, which catches the crashes that would otherwise only
turn up in front of a queue.

## Where the techniques come from

Nothing here is ported code — unlike [Orbital Bench](https://github.com/theoreticalraccoon/Orbital-Bench),
which took its maths from an existing C++ project, this engine was written from the
standard published approach to 2D rigid bodies. These are the sources that approach
comes from, and where each part of it ended up:

| Source | What it gives | Where it lives |
|---|---|---|
| [Nilson Souto, *Video Game Physics I–III*](https://www.toptal.com/game/video-game-physics-part-i-an-introduction-to-rigid-body-dynamics) (Toptal) | Unconstrained rigid body motion: linear and angular state, torque, moment of inertia, semi-implicit Euler | `body.js`, `world.js` |
| [Randy Gale, *How to Create a Custom Physics Engine*](https://code.tutsplus.com/c/game-development) (Tuts+) | SAT with reference/incident face clipping, manifold generation, impulse resolution, positional correction | `collide.js`, `solver.js` |
| [Allen Chou, *Game Physics Series*](http://allenchou.net/game-physics-series/) | Constraints and sequential impulse; the stability pair — penetration slop and warm starting | `solver.js`, `constraints.js` |
| [*Broad-Phase Collision Detection*](http://buildnewgames.com/broad-phase-collision-detection/) and [*Game Physics*](http://buildnewgames.com/gamephysics/) (Build New Games) | Spatial partitioning, and when brute force is the better call | `world.js` — see below |
| [Adam Ranfelt, *Build a simple 2D physics engine for JavaScript games*](https://developer.ibm.com/tutorials/wa-build2dphysicsengine/) (IBM) | Canvas and `requestAnimationFrame` structure for a JS engine | `renderer.js`, `main.js` |
| [*3D Physics Engine Tutorial*](https://www.youtube.com/playlist?list=PLEETnX-uPtBXm1KEr_2zQ6K_0hoGH6JJ0) (YouTube) | The same pipeline in 3D, useful for seeing which parts are dimension-agnostic | — |

### Where this deliberately diverges

**Broad phase is all-pairs, not a tree.** Allen Chou builds a dynamic AABB tree and
Build New Games works through spatial hashing and quadtrees. Both are the right call
at a few hundred bodies. A station here runs a few dozen, where maintaining the
structure costs more than the tests it saves, and an O(n²) sweep is trivially
deterministic — which matters, because a station that promises "three stars, first
try" has to mean it. The AABB reject in `aabbOverlap` does the actual work.

**Impulses accumulate within a step but are not warm-started across steps.** Warm
starting needs contact points matched frame to frame by feature ID, and it buys
stability in tall stacks. The tallest thing in this exhibit is five boxes in a test,
and that stack already stands. Not worth the machinery here; it is the first thing
to add if the engine is ever reused for something heavier.

**GJK/EPA is not implemented.** SAT is enough for circles and convex polygons, which
is all six stations need, and it produces a contact normal you can draw an arrow
along — which matters more here than generality, because the X-ray overlay has to
show the maths, not just use it.

## Not built

Ragdolls, fluids, soft bodies, WebGL, accounts, multi-device sync, a level editor.
All fun; none of them help a kid who is here for 45 seconds.
