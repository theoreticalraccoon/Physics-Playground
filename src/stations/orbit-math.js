// Orbital maths for the Slingshot station.
//
// Two ideas carry this one. First, the distance formula from coordinate geometry
// turns up as a physical law: r = √((x−x₀)² + (y−y₀)²) is the same r that goes into
// F = GMm/r². Second, squaring that r has consequences you can feel — halve the
// distance and the pull quadruples, which is why a probe skimming a planet whips
// round so violently.

/** Distance between two points. The coordinate-geometry formula, doing physics. */
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Magnitude of the gravitational acceleration at distance r. */
export const gravityAt = (GM, r) => GM / (r * r);

/** How much stronger gravity is at r₂ than at r₁ — the inverse-square ratio. */
export const inverseSquareRatio = (r1, r2) => (r1 * r1) / (r2 * r2);

/** Speed for a circular orbit of radius r: v = √(GM/r). */
export const circularSpeed = (GM, r) => Math.sqrt(GM / r);

/** Escape speed at radius r: v = √(2GM/r), exactly √2 times circular speed. */
export const escapeSpeed = (GM, r) => Math.sqrt((2 * GM) / r);

/** Total energy per unit mass. Negative means bound, positive means gone. */
export const specificEnergy = (v, GM, r) => (v * v) / 2 - GM / r;

/** Angular momentum per unit mass — conserved, which is Kepler's second law. */
export const specificAngularMomentum = (pos, vel, centre) => {
  const rx = pos.x - centre.x;
  const ry = pos.y - centre.y;
  return rx * vel.y - ry * vel.x;
};

/**
 * Eccentricity from the conserved quantities. Sorts the trajectory into the three
 * conic sections, which is a genuinely satisfying thing to watch a shape become.
 */
export function eccentricity(pos, vel, centre, GM) {
  const r = distance(pos, centre);
  const v = Math.hypot(vel.x, vel.y);
  const h = specificAngularMomentum(pos, vel, centre);
  const E = specificEnergy(v, GM, r);
  const e2 = 1 + (2 * E * h * h) / (GM * GM);
  return Math.sqrt(Math.max(e2, 0));
}

/**
 * Name the conic. The station prints this live as the probe is dragged back, so the
 * word changes under the kid's finger as they cross escape velocity.
 */
export function conicType(e) {
  if (e < 0.02) return 'circle';
  if (e < 0.98) return 'ellipse';
  if (e < 1.02) return 'parabola';
  return 'hyperbola';
}

/** Semi-major axis. Infinite for a parabola, negative for a hyperbola. */
export function semiMajorAxis(pos, vel, centre, GM) {
  const r = distance(pos, centre);
  const v = Math.hypot(vel.x, vel.y);
  const E = specificEnergy(v, GM, r);
  if (Math.abs(E) < 1e-9) return Infinity;
  return -GM / (2 * E);
}

/** Kepler's third law: T² ∝ a³. */
export function orbitalPeriod(a, GM) {
  if (!Number.isFinite(a) || a <= 0) return Infinity;
  return 2 * Math.PI * Math.sqrt((a * a * a) / GM);
}

/** Closest approach. If this is inside the planet, the probe is going to crash. */
export function periapsis(pos, vel, centre, GM) {
  const a = semiMajorAxis(pos, vel, centre, GM);
  const e = eccentricity(pos, vel, centre, GM);
  if (!Number.isFinite(a)) {
    const h = specificAngularMomentum(pos, vel, centre);
    return (h * h) / (2 * GM); // parabolic case
  }
  return a * (1 - e);
}

/** Apoapsis, or Infinity if the orbit is not closed. */
export function apoapsis(pos, vel, centre, GM) {
  const a = semiMajorAxis(pos, vel, centre, GM);
  const e = eccentricity(pos, vel, centre, GM);
  if (!Number.isFinite(a) || e >= 1) return Infinity;
  return a * (1 + e);
}
