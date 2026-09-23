// Pendulum maths for the Swing station.
//
// The pendulum is simulated from its own equation rather than as a rigid body on a
// rod, because the station is *about* that equation. Integrating θ'' = −(g/L)sinθ
// directly means the curve traced on screen and the formula in the panel are the
// same object, and it is far more accurate than a constraint solver at the same cost.
//
// The fact worth stopping a passer-by for: the period contains no mass and no
// amplitude. A heavy bob and a light one, pulled back far or barely at all, keep
// time together.

/** Small-angle period, T = 2π√(L/g). */
export const pendulumPeriod = (L, g) => 2 * Math.PI * Math.sqrt(L / g);

/** Angular frequency ω = √(g/L), the number that actually drives the motion. */
export const angularFrequency = (L, g) => Math.sqrt(g / L);

/** Length that gives a wanted period — the inverse, for the "match the wave" goal. */
export const lengthForPeriod = (T, g) => (g * T * T) / (4 * Math.PI * Math.PI);

/** The small-angle solution: θ(t) = θ₀cos(ωt). A pure cosine. */
export const smallAngleTheta = (t, theta0, L, g) =>
  theta0 * Math.cos(angularFrequency(L, g) * t);

/**
 * One RK4 step of the exact nonlinear pendulum, with optional linear damping.
 *
 * State is {theta, omega}. The sinθ is what makes this interesting: for small θ,
 * sinθ ≈ θ and the motion is a perfect cosine, which is why the small-angle formula
 * works at all. Push the amplitude up and the approximation visibly fails.
 */
export function stepPendulum(state, dt, L, g, damping = 0) {
  const deriv = (s) => ({
    theta: s.omega,
    omega: -(g / L) * Math.sin(s.theta) - damping * s.omega,
  });
  const add = (s, d, h) => ({
    theta: s.theta + d.theta * h,
    omega: s.omega + d.omega * h,
  });

  const k1 = deriv(state);
  const k2 = deriv(add(state, k1, dt / 2));
  const k3 = deriv(add(state, k2, dt / 2));
  const k4 = deriv(add(state, k3, dt));

  return {
    theta: state.theta
      + (dt / 6) * (k1.theta + 2 * k2.theta + 2 * k3.theta + k4.theta),
    omega: state.omega
      + (dt / 6) * (k1.omega + 2 * k2.omega + 2 * k3.omega + k4.omega),
  };
}

/**
 * The true period at a given amplitude, to second order.
 *
 * T ≈ T₀(1 + θ₀²/16). At 30° that is about 1.7% slow, which is just visible over a
 * few swings against a drawn reference wave — a nice reward for a kid who pushes
 * the amplitude slider to the end to see if anything breaks.
 */
export const periodAtAmplitude = (L, g, theta0) =>
  pendulumPeriod(L, g) * (1 + (theta0 * theta0) / 16);

/** Bob position for a pivot at the origin, measuring θ from straight down. */
export const bobPosition = (theta, L) => ({
  x: L * Math.sin(theta),
  y: -L * Math.cos(theta),
});

/** Energy of the bob, with the datum at the lowest point of the swing. */
export function pendulumEnergy(state, L, g, m = 1) {
  const height = L * (1 - Math.cos(state.theta));
  return {
    kinetic: 0.5 * m * (L * state.omega) ** 2,
    potential: m * g * height,
  };
}

/**
 * Speed at the bottom, from energy alone: v = √(2gL(1 − cosθ₀)).
 * The station uses this to show that a longer drop means a faster swing without
 * needing the differential equation at all.
 */
export const speedAtBottom = (theta0, L, g) =>
  Math.sqrt(2 * g * L * (1 - Math.cos(theta0)));
