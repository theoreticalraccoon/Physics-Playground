// Collision maths for the Impact station.
//
// The station's job is to make a kid solve a pair of simultaneous equations
// without ever calling them that:
//
//   momentum   m₁u₁ + m₂u₂ = m₁v₁ + m₂v₂
//   elasticity u₁ − u₂ = v₂ − v₁      (relative speed reverses)
//
// Solving the pair gives the formulas below. The station shows the algebra running
// as the sliders move, so the answer arrives as a consequence rather than a fact.

/**
 * Head-on collision in one dimension with coefficient of restitution `e`.
 * e = 1 is perfectly elastic, e = 0 is perfectly inelastic (they move off together).
 */
export function collision1D(m1, u1, m2, u2, e = 1) {
  const total = m1 + m2;
  const v1 = (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / total;
  const v2 = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / total;
  return { v1, v2 };
}

/** The perfectly elastic case, written out in its familiar form. */
export function elasticCollision1D(m1, u1, m2, u2) {
  const total = m1 + m2;
  return {
    v1: ((m1 - m2) / total) * u1 + ((2 * m2) / total) * u2,
    v2: ((2 * m1) / total) * u1 + ((m2 - m1) / total) * u2,
  };
}

/** Both bodies leave with the same velocity: the e = 0 case. */
export function perfectlyInelastic(m1, u1, m2, u2) {
  const v = (m1 * u1 + m2 * u2) / (m1 + m2);
  return { v1: v, v2: v };
}

export const momentum = (m1, u1, m2, u2) => m1 * u1 + m2 * u2;

export const kineticEnergy = (m1, u1, m2, u2) => 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;

/**
 * Energy lost to heat and noise. Zero only when e = 1, which is why a real
 * collision never quite matches the textbook one.
 */
export function energyLost(m1, u1, m2, u2, e = 1) {
  const after = collision1D(m1, u1, m2, u2, e);
  return kineticEnergy(m1, u1, m2, u2) - kineticEnergy(m1, after.v1, m2, after.v2);
}

/**
 * What mass would puck 2 need for puck 1 to stop dead?
 *
 * Setting v1 = 0 in the elastic solution gives m₂ = m₁(u₁ + e·u₁)/... which for a
 * stationary target collapses to the clean answer: equal masses. Returns null when
 * no positive mass works, which happens whenever the target is already moving away.
 */
export function massToStopFirst(m1, u1, u2, e = 1) {
  // v1 = (m1*u1 + m2*u2 + m2*e*(u2 - u1)) / (m1 + m2) = 0
  //   => m1*u1 + m2*(u2 + e*(u2 - u1)) = 0
  const denom = u2 + e * (u2 - u1);
  if (Math.abs(denom) < 1e-12) return null;
  const m2 = (-m1 * u1) / denom;
  return m2 > 0 ? m2 : null;
}

/** Centre-of-mass velocity: the frame in which total momentum is zero. */
export const centreOfMassVelocity = (m1, u1, m2, u2) => (m1 * u1 + m2 * u2) / (m1 + m2);

/**
 * A tolerance-checked "did they solve it" test, so the station and its tests agree
 * on what counts as stopping a puck dead.
 */
export const isStopped = (v, tol = 0.15) => Math.abs(v) < tol;
