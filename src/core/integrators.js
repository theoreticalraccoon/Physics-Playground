// Four ways to step a differential equation forward in time, kept side by side so
// the Launch station can race them against the exact answer.
//
// The demonstration that pays off with a fair audience: under constant gravity the
// exact height is y = y0 + v0*t - g*t^2/2, and the error of each method is
// analytically known.
//
//   explicit Euler   overshoots by +g*dt*t/2   (arc lands long, and too high)
//   semi-implicit    undershoots by -g*dt*t/2  (arc lands short)
//   velocity Verlet  exact for constant acceleration
//   RK4              exact for constant acceleration
//
// Both error terms grow linearly with t, so the fan between the curves opens up as
// the shot flies — which is exactly the picture you want a 14-year-old to see.

import { Vec2 } from './vec2.js';

/**
 * @typedef {{pos: Vec2, vel: Vec2}} State
 * @typedef {(pos: Vec2, vel: Vec2, t: number) => Vec2} AccelFn
 */

/** Position and velocity update use the *old* values of both. First order. */
function euler(state, dt, accel, t = 0) {
  const a = accel(state.pos, state.vel, t);
  return {
    pos: state.pos.add(state.vel.scale(dt)),
    vel: state.vel.add(a.scale(dt)),
  };
}

/**
 * Update velocity first, then move using the *new* velocity. Still first order,
 * but symplectic: on a closed orbit or a spring the energy oscillates around the
 * true value instead of growing without bound. This is why games use it.
 */
function semiImplicit(state, dt, accel, t = 0) {
  const a = accel(state.pos, state.vel, t);
  const vel = state.vel.add(a.scale(dt));
  return { pos: state.pos.add(vel.scale(dt)), vel };
}

/** Second order, and exact whenever the acceleration is constant. */
function verlet(state, dt, accel, t = 0) {
  const a0 = accel(state.pos, state.vel, t);
  const pos = state.pos.add(state.vel.scale(dt)).add(a0.scale(0.5 * dt * dt));
  // Velocity-dependent forces make this an approximation; for gravity it is exact.
  const a1 = accel(pos, state.vel.add(a0.scale(dt)), t + dt);
  const vel = state.vel.add(a0.add(a1).scale(0.5 * dt));
  return { pos, vel };
}

/** Classic fourth-order Runge–Kutta on the coupled position/velocity system. */
function rk4(state, dt, accel, t = 0) {
  const d1v = state.vel;
  const d1a = accel(state.pos, state.vel, t);

  const p2 = state.pos.add(d1v.scale(dt / 2));
  const v2_ = state.vel.add(d1a.scale(dt / 2));
  const d2v = v2_;
  const d2a = accel(p2, v2_, t + dt / 2);

  const p3 = state.pos.add(d2v.scale(dt / 2));
  const v3 = state.vel.add(d2a.scale(dt / 2));
  const d3v = v3;
  const d3a = accel(p3, v3, t + dt / 2);

  const p4 = state.pos.add(d3v.scale(dt));
  const v4 = state.vel.add(d3a.scale(dt));
  const d4v = v4;
  const d4a = accel(p4, v4, t + dt);

  const dxdt = d1v.add(d2v.scale(2)).add(d3v.scale(2)).add(d4v).scale(1 / 6);
  const dvdt = d1a.add(d2a.scale(2)).add(d3a.scale(2)).add(d4a).scale(1 / 6);

  return {
    pos: state.pos.add(dxdt.scale(dt)),
    vel: state.vel.add(dvdt.scale(dt)),
  };
}

export const INTEGRATORS = {
  euler: {
    key: 'euler',
    name: 'Euler',
    order: 1,
    blurb: 'Move first, using the speed you had before. Always overshoots.',
    step: euler,
  },
  semi: {
    key: 'semi',
    name: 'Semi-implicit',
    order: 1,
    blurb: 'Change the speed first, then move. Undershoots, but keeps energy in check.',
    step: semiImplicit,
  },
  verlet: {
    key: 'verlet',
    name: 'Verlet',
    order: 2,
    blurb: 'Adds the ½at² term. Exact when gravity is the only force.',
    step: verlet,
  },
  rk4: {
    key: 'rk4',
    name: 'RK4',
    order: 4,
    blurb: 'Samples the slope four times per step and averages. Expensive, accurate.',
    step: rk4,
  },
};

export const INTEGRATOR_KEYS = ['euler', 'semi', 'verlet', 'rk4'];

/**
 * Run one integrator over a whole flight and return the path.
 *
 * @param {string} key           which integrator
 * @param {State} initial        starting position and velocity
 * @param {AccelFn} accel        acceleration field
 * @param {number} dt            step size — deliberately coarse for the race
 * @param {number} steps         how many steps to take
 * @param {(s: State) => boolean} [stop]  end early, e.g. when the shot lands
 */
export function trace(key, initial, accel, dt, steps, stop = null) {
  const integ = INTEGRATORS[key];
  let state = { pos: initial.pos.clone(), vel: initial.vel.clone() };
  const path = [state.pos.clone()];
  let t = 0;

  for (let i = 0; i < steps; i++) {
    state = integ.step(state, dt, accel, t);
    t += dt;
    path.push(state.pos.clone());
    if (stop && stop(state)) break;
  }
  return { path, final: state, t };
}

/**
 * The exact parabola, for the race to be measured against. Sampled finely so it
 * draws as a smooth curve rather than a competitor with its own step size.
 */
export function exactProjectile(pos, vel, g, tMax, samples = 240) {
  const path = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * tMax;
    path.push(
      new Vec2(pos.x + vel.x * t, pos.y + vel.y * t - 0.5 * g * t * t),
    );
  }
  return path;
}

/**
 * Largest distance from a traced path to the exact curve. Used to put a number on
 * "how wrong is this one", which is more convincing than the picture alone.
 */
export function maxDeviation(path, exact) {
  let worst = 0;
  for (const p of path) {
    let best = Infinity;
    for (const q of exact) {
      const d = p.dist2(q);
      if (d < best) best = d;
    }
    worst = Math.max(worst, Math.sqrt(best));
  }
  return worst;
}
