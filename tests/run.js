// Engine checks against closed-form answers.
//
// The point of these is not coverage, it is that a station can claim a physical
// fact on screen and be telling the truth. If the range formula shown next to the
// cannon does not match where the ball lands, the exhibit is teaching a lie.
//
//   node tests/run.js

import { Vec2, v2, toRad, toDeg } from '../src/core/vec2.js';
import { Body, polyMassData } from '../src/core/body.js';
import { World, pointGravityField } from '../src/core/world.js';
import { collide } from '../src/core/collide.js';
import { INTEGRATORS, trace, exactProjectile } from '../src/core/integrators.js';
import { pendulumPeriod, stepPendulum, periodAtAmplitude } from '../src/stations/swing-math.js';
import { elasticCollision1D } from '../src/stations/impact-math.js';
import { solveLaunchAngle } from '../src/stations/launch-math.js';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(name, actual, expected, tol) {
  const d = Math.abs(actual - expected);
  ok(name, d <= tol, `got ${actual.toPrecision(8)}, want ${expected.toPrecision(8)} (tol ${tol})`);
}

const G = 9.81;

// --- vectors -----------------------------------------------------------------

{
  const a = v2(3, 4);
  near('vec: length of (3,4)', a.len(), 5, 1e-12);
  near('vec: dot', v2(1, 2).dot(v2(3, 4)), 11, 1e-12);
  near('vec: cross', v2(1, 0).cross(v2(0, 1)), 1, 1e-12);
  near('vec: perp is a quarter turn', v2(1, 0).perp().angle(), Math.PI / 2, 1e-12);
  ok('vec: zero normalises to zero, not NaN', v2(0, 0).norm().isFinite());
  near('vec: rotate 90 deg', v2(1, 0).rotate(Math.PI / 2).y, 1, 1e-12);
  near('vec: projection onto axis', v2(3, 4).compAlong(v2(1, 0)), 3, 1e-12);
}

// --- mass properties ---------------------------------------------------------

{
  // A 2x4 box, density 1: area 8, and I = m(w^2+h^2)/12 = 8*(4+16)/12.
  const box = Body.box(0, 0, 2, 4, { density: 1 });
  near('mass: box area', box.mass, 8, 1e-9);
  near('mass: box inertia', box.inertia, (8 * (4 + 16)) / 12, 1e-9);

  const disc = Body.circle(0, 0, 2, { density: 1 });
  near('mass: disc area', disc.mass, Math.PI * 4, 1e-9);
  near('mass: disc inertia', disc.inertia, 0.5 * Math.PI * 4 * 4, 1e-9);

  // Inertia must be measured about the centroid, not the vertex frame the caller
  // happened to supply.
  const offset = Body.polygon(0, 0, [v2(10, 10), v2(12, 10), v2(12, 14), v2(10, 14)], { density: 1 });
  near('mass: offset polygon recentred', offset.inertia, (8 * (4 + 16)) / 12, 1e-9);

  const { area } = polyMassData([v2(0, 0), v2(3, 0), v2(3, 3), v2(0, 3)]);
  near('mass: polygon area helper', area, 9, 1e-9);
}

// --- collision detection -----------------------------------------------------

{
  const a = Body.circle(0, 0, 1);
  const b = Body.circle(1.5, 0, 1);
  const m = collide(a, b);
  ok('collide: overlapping circles report a manifold', m !== null);
  near('collide: penetration depth', m.penetration, 0.5, 1e-9);
  near('collide: normal points A to B', m.normal.x, 1, 1e-9);

  ok('collide: separated circles do not', collide(Body.circle(0, 0, 1), Body.circle(3, 0, 1)) === null);

  // A box sitting 0.1 into the ground.
  const ground = Body.box(0, -0.5, 20, 1, { isStatic: true });
  const crate = Body.box(0, 0.4, 1, 1);
  const gm = collide(ground, crate);
  ok('collide: box on ground reports contact', gm !== null);
  near('collide: box/ground depth', gm.penetration, 0.1, 1e-6);
  ok('collide: box/ground has two contact points', gm.contacts.length === 2,
    `got ${gm.contacts.length}`);
}

// --- projectile range vs v^2 sin(2t)/g ---------------------------------------

{
  const speed = 20;
  for (const deg of [15, 30, 45, 60, 75]) {
    const w = new World({ gravity: v2(0, -G), fixedDt: 1 / 480 });
    const ball = Body.circle(0, 0, 0.01, { density: 1 });
    ball.vel = Vec2.fromAngle(toRad(deg), speed);
    w.add(ball);

    let prev = ball.pos.clone();
    let landedX = null;
    for (let i = 0; i < 20000 && landedX === null; i++) {
      w.substep(w.fixedDt);
      if (ball.pos.y <= 0 && prev.y > 0) {
        // Linear interpolation back to the exact y = 0 crossing.
        const t = prev.y / (prev.y - ball.pos.y);
        landedX = prev.x + (ball.pos.x - prev.x) * t;
      }
      prev = ball.pos.clone();
    }

    const expected = (speed * speed * Math.sin(2 * toRad(deg))) / G;
    near(`projectile: range at ${deg} deg`, landedX, expected, expected * 0.002);
  }

  // The complementary-angle fact the Launch station shows off.
  const r30 = (400 * Math.sin(toRad(60))) / G;
  const r60 = (400 * Math.sin(toRad(120))) / G;
  near('projectile: 30 and 60 degrees give the same range', r30, r60, 1e-9);
}

// --- the integrator race -----------------------------------------------------

{
  const g = v2(0, -G);
  const accel = () => g;
  const start = { pos: v2(0, 0), vel: Vec2.fromAngle(toRad(45), 20) };
  const dt = 0.25;
  const steps = 11;
  const tMax = dt * steps;
  const exact = exactProjectile(start.pos, start.vel, G, tMax, 2000);

  const errs = {};
  for (const key of ['euler', 'semi', 'verlet', 'rk4']) {
    const { final } = trace(key, start, accel, dt, steps);
    const t = tMax;
    const trueY = start.vel.y * t - 0.5 * G * t * t;
    errs[key] = final.pos.y - trueY;
  }

  // The analytic error terms: Euler is high by g*dt*t/2, semi-implicit low by the
  // same amount, and the two second-order-or-better methods are exact here.
  const predicted = (G * dt * tMax) / 2;
  near('integrators: Euler overshoots by g*dt*t/2', errs.euler, predicted, 1e-9);
  near('integrators: semi-implicit undershoots by the same', errs.semi, -predicted, 1e-9);
  near('integrators: Verlet is exact under constant gravity', errs.verlet, 0, 1e-9);
  near('integrators: RK4 is exact under constant gravity', errs.rk4, 0, 1e-9);
  ok('integrators: exact curve starts at the muzzle', exact[0].equals(start.pos));

  // On a spring, where acceleration is not constant, the order of accuracy shows.
  const k = 30;
  const springAccel = (p) => p.scale(-k);
  const s0 = { pos: v2(1, 0), vel: v2(0, 0) };
  const T = 2 * Math.PI / Math.sqrt(k);
  const h = T / 40;
  const n = 40;
  const trueEnd = Math.cos(Math.sqrt(k) * h * n);

  const err = {};
  for (const key of ['euler', 'semi', 'verlet', 'rk4']) {
    err[key] = Math.abs(trace(key, s0, springAccel, h, n).final.pos.x - trueEnd);
  }
  ok('integrators: RK4 beats Verlet on a spring', err.rk4 < err.verlet,
    `rk4 ${err.rk4.toExponential(2)} vs verlet ${err.verlet.toExponential(2)}`);
  ok('integrators: Verlet beats semi-implicit on a spring', err.verlet < err.semi,
    `verlet ${err.verlet.toExponential(2)} vs semi ${err.semi.toExponential(2)}`);
  ok('integrators: semi-implicit beats explicit Euler on a spring', err.semi < err.euler,
    `semi ${err.semi.toExponential(2)} vs euler ${err.euler.toExponential(2)}`);

  // The symplectic property: over many periods the energy of the semi-implicit run
  // oscillates within a fixed band and never escapes it, while explicit Euler grows
  // without bound. "Bounded" is the claim, so track the whole run rather than
  // sampling the last step.
  //
  // The band is not zero-width: semi-implicit Euler conserves a slightly different
  // quantity than the true energy, so E wobbles by about omega*h/2 either side —
  // here 2*pi/40/2, near 8%. That wobble is the method being symplectic, not drift.
  const energy = (st) => 0.5 * st.vel.len2() + 0.5 * k * st.pos.len2();
  const e0 = energy(s0);
  const band = (Math.sqrt(k) * h) / 2;

  const sweep = (key, steps) => {
    const integ = INTEGRATORS[key];
    let st = { pos: s0.pos.clone(), vel: s0.vel.clone() };
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < steps; i++) {
      st = integ.step(st, h, springAccel, i * h);
      const e = energy(st) / e0;
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    return { lo, hi };
  };

  const semiSweep = sweep('semi', 4000);
  const eulerSweep = sweep('euler', 4000);

  ok('integrators: semi-implicit energy stays inside its band over 100 periods',
    semiSweep.hi < 1 + band * 1.3 && semiSweep.lo > 1 - band * 1.3,
    `range ${semiSweep.lo.toFixed(3)}..${semiSweep.hi.toFixed(3)}, band +/-${band.toFixed(3)}`);
  ok('integrators: explicit Euler gains energy without bound',
    eulerSweep.hi > 5,
    `peak ratio ${eulerSweep.hi.toFixed(1)}`);
}

// --- collisions: momentum and energy -----------------------------------------

{
  // Analytic 1D elastic collision, which the Impact station shows being solved.
  const r = elasticCollision1D(2, 3, 1, -1);
  near('impact: analytic v1', r.v1, (2 - 1) / 3 * 3 + (2 * 1) / 3 * -1, 1e-12);
  near('impact: momentum conserved analytically', 2 * r.v1 + 1 * r.v2, 2 * 3 + 1 * -1, 1e-12);
  near('impact: energy conserved analytically',
    2 * r.v1 ** 2 + 1 * r.v2 ** 2, 2 * 9 + 1 * 1, 1e-9);

  // Equal masses, head-on, fully elastic: they swap velocities. This is the
  // "stop it dead" solution the station asks the kid to find.
  const swap = elasticCollision1D(1, 4, 1, 0);
  near('impact: equal masses swap velocities (v1)', swap.v1, 0, 1e-12);
  near('impact: equal masses swap velocities (v2)', swap.v2, 4, 1e-12);

  // And the same thing in the actual engine.
  const w = new World({ gravity: v2(0, 0), fixedDt: 1 / 480, velocityIterations: 20 });
  const p1 = Body.circle(-3, 0, 0.5, { restitution: 1, friction: 0 });
  const p2 = Body.circle(3, 0, 0.5, { restitution: 1, friction: 0 });
  p1.setMass(1);
  p2.setMass(1);
  p1.vel = v2(4, 0);
  w.add(p1, p2);

  const p0 = w.momentum().x;
  const k0 = w.kineticEnergy();
  for (let i = 0; i < 2000; i++) w.substep(w.fixedDt);

  near('engine: momentum conserved through a collision', w.momentum().x, p0, 1e-6);
  near('engine: energy conserved when restitution is 1', w.kineticEnergy(), k0, k0 * 0.02);
  ok('engine: the moving puck stopped dead', Math.abs(p1.vel.x) < 0.05,
    `v1 = ${p1.vel.x.toFixed(4)}`);
  ok('engine: the struck puck took the velocity', Math.abs(p2.vel.x - 4) < 0.05,
    `v2 = ${p2.vel.x.toFixed(4)}`);
}

// --- resting contact ---------------------------------------------------------

{
  const w = new World({ gravity: v2(0, -G), fixedDt: 1 / 120 });
  w.add(Body.box(0, -0.5, 40, 1, { isStatic: true, friction: 0.6 }));
  const crate = Body.box(0, 2, 1, 1, { friction: 0.6, restitution: 0.1 });
  w.add(crate);

  for (let i = 0; i < 900; i++) w.substep(w.fixedDt);

  near('engine: crate settles on the ground surface', crate.pos.y, 0.5, 0.02);
  ok('engine: crate has come to rest', crate.vel.len() < 0.05,
    `|v| = ${crate.vel.len().toFixed(4)}`);
  ok('engine: crate has not sunk through the floor', crate.pos.y > 0.4);
  ok('engine: crate stayed put horizontally', Math.abs(crate.pos.x) < 0.05);
}

// --- a stack, which is what actually stresses the solver ---------------------

{
  const w = new World({ gravity: v2(0, -G), fixedDt: 1 / 120, velocityIterations: 12 });
  w.add(Body.box(0, -0.5, 40, 1, { isStatic: true, friction: 0.8 }));
  const boxes = [];
  for (let i = 0; i < 5; i++) {
    const b = Body.box(0, 0.5 + i * 1.02, 1, 1, { friction: 0.8, restitution: 0 });
    boxes.push(b);
    w.add(b);
  }
  for (let i = 0; i < 1200; i++) w.substep(w.fixedDt);

  ok('engine: a five-box stack stays standing',
    boxes.every((b, i) => Math.abs(b.pos.y - (0.5 + i)) < 0.15),
    boxes.map((b) => b.pos.y.toFixed(2)).join(', '));
  ok('engine: the stack is asleep', boxes.every((b) => b.vel.len() < 0.1));
}

// --- orbits ------------------------------------------------------------------

{
  // Circular orbit: v = sqrt(GM/r) should keep the radius fixed.
  const GM = 60;
  const r = 6;
  const w = new World({ gravity: v2(0, 0), fixedDt: 1 / 480 });
  w.addField(pointGravityField(v2(0, 0), GM, 0));
  const probe = Body.circle(r, 0, 0.05, { density: 0.1 });
  probe.vel = v2(0, Math.sqrt(GM / r));
  w.add(probe);

  let minR = Infinity;
  let maxR = 0;
  const period = 2 * Math.PI * Math.sqrt((r * r * r) / GM);
  const steps = Math.round((period * 3) / w.fixedDt);
  for (let i = 0; i < steps; i++) {
    w.substep(w.fixedDt);
    const d = probe.pos.len();
    minR = Math.min(minR, d);
    maxR = Math.max(maxR, d);
  }
  ok('orbit: a circular orbit stays circular over three periods',
    (maxR - minR) / r < 0.01, `radius ${minR.toFixed(3)}..${maxR.toFixed(3)}`);

  // Escape velocity is the boundary between coming back and not.
  const vEsc = Math.sqrt((2 * GM) / r);
  ok('orbit: escape velocity formula', Math.abs(vEsc - Math.sqrt(2) * Math.sqrt(GM / r)) < 1e-12);
}

// --- the pendulum ------------------------------------------------------------

{
  for (const L of [0.5, 1, 2, 4]) {
    near(`pendulum: T = 2*pi*sqrt(L/g) at L=${L}`,
      pendulumPeriod(L, G), 2 * Math.PI * Math.sqrt(L / G), 1e-12);
  }

  // Four times the length is twice the period — the square-root law the station
  // asks kids to discover.
  near('pendulum: 4x length doubles the period',
    pendulumPeriod(4, G) / pendulumPeriod(1, G), 2, 1e-12);

  // Integrating the real nonlinear ODE should reproduce the small-angle period.
  const L = 1.5;
  const T = pendulumPeriod(L, G);
  const h = T / 4000;

  /**
   * Time between two successive downward zero crossings, which is one whole period.
   * Measuring from t = 0 instead would give 5T/4, because the bob is released at
   * its amplitude and takes a quarter period to reach the bottom the first time.
   * The crossing time is interpolated so the answer is not quantised to h.
   */
  function measuredPeriod(theta0, steps) {
    let st = { theta: theta0, omega: 0 };
    let prev = st.theta;
    const times = [];
    for (let i = 1; i <= steps && times.length < 2; i++) {
      st = stepPendulum(st, h, L, G);
      if (prev > 0 && st.theta <= 0) {
        const frac = prev / (prev - st.theta);
        times.push((i - 1 + frac) * h);
      }
      prev = st.theta;
    }
    return times.length === 2 ? times[1] - times[0] : NaN;
  }

  near('pendulum: simulated period matches the formula at small angle',
    measuredPeriod(0.06, 12000), T, T * 0.001);

  // At large amplitude the real period is longer, because sin(theta) < theta.
  const tBig = measuredPeriod(1.8, 30000);
  ok('pendulum: large swings take longer than the small-angle formula',
    tBig > T * 1.05, `${tBig.toFixed(3)}s vs ${T.toFixed(3)}s`);

  // And the second-order correction T0(1 + theta0^2/16) should predict how much
  // longer, at least while the amplitude is still moderate.
  const tMid = measuredPeriod(0.5, 20000);
  near('pendulum: amplitude correction predicts the stretch',
    tMid, periodAtAmplitude(L, G, 0.5), T * 0.005);
}

// --- the launch solver -------------------------------------------------------

{
  // theta = asin(g*d / v^2) / 2 should hit a target at distance d.
  const v = 22;
  const d = 30;
  const theta = solveLaunchAngle(d, v, G);
  ok('launch: a reachable target has a solution', theta !== null);
  near('launch: solved angle lands on the target',
    (v * v * Math.sin(2 * theta)) / G, d, 1e-9);

  const tooFar = solveLaunchAngle(500, v, G);
  ok('launch: an unreachable target returns null', tooFar === null);

  // Maximum range is at 45 degrees.
  const maxRange = (v * v) / G;
  near('launch: max range is v^2/g at 45 degrees',
    (v * v * Math.sin(2 * toRad(45))) / G, maxRange, 1e-9);
}

// --- report ------------------------------------------------------------------

const total = passed + failed;
console.log('');
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log('');
console.log(`  ${passed}/${total} checks passed${failed ? `, ${failed} failed` : ''}`);
console.log('');
process.exit(failed ? 1 : 0);
