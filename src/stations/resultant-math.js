// Vector addition for the Resultant station.
//
// Adding forces is the first genuinely useful thing vectors do, and it is where the
// syllabus quietly becomes physics: break each arrow into components, add the
// components, put it back together with Pythagoras and a tangent.
//
//   ΣFx = Σ Fᵢ cos θᵢ        ΣFy = Σ Fᵢ sin θᵢ
//   |F|  = √(ΣFx² + ΣFy²)     θ  = tan⁻¹(ΣFy / ΣFx)

/** Split a magnitude and direction into components. */
export const components = (magnitude, theta) => ({
  x: magnitude * Math.cos(theta),
  y: magnitude * Math.sin(theta),
});

/** Add up a list of {magnitude, theta} arrows. */
export function resultant(forces) {
  let x = 0;
  let y = 0;
  for (const f of forces) {
    x += f.magnitude * Math.cos(f.theta);
    y += f.magnitude * Math.sin(f.theta);
  }
  return {
    x,
    y,
    magnitude: Math.hypot(x, y),
    // atan2 rather than atan: it keeps the quadrant, which plain tan⁻¹ throws away.
    theta: Math.atan2(y, x),
  };
}

/** Magnitude from components. Pythagoras, wearing a hat. */
export const magnitude = (x, y) => Math.hypot(x, y);

/** Direction from components, in radians, measured from the +x axis. */
export const direction = (x, y) => Math.atan2(y, x);

/** True when the arrows cancel — the crate stays put. */
export const isBalanced = (forces, tol = 0.5) => resultant(forces).magnitude < tol;

/**
 * The single arrow that would cancel the lot. Same size, opposite direction — the
 * "equilibrant", and the reason a tug-of-war can be a draw.
 */
export function equilibrant(forces) {
  const r = resultant(forces);
  return {
    magnitude: r.magnitude,
    theta: r.theta + Math.PI,
  };
}

/**
 * Angle between a resultant and a target direction, wrapped to [0, π]. The station
 * scores on this: point the resultant at the door and the crate arrives.
 */
export function angleError(theta, targetTheta) {
  let d = Math.abs(theta - targetTheta) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * Whether a set of arrows makes a recognisable right-angled triangle, so the
 * station can call out a 3-4-5 when a kid stumbles into one. Small delight, costs
 * nothing, and it is the moment Pythagoras stops being homework.
 */
export function isPythagorean(forces, tol = 0.02) {
  if (forces.length !== 2) return false;
  const [a, b] = forces;
  const between = angleError(a.theta, b.theta);
  if (Math.abs(between - Math.PI / 2) > 0.05) return false;

  const h = Math.hypot(a.magnitude, b.magnitude);
  // Is the hypotenuse close to a whole number when the legs are?
  const whole = (x) => Math.abs(x - Math.round(x)) < tol * Math.max(1, x);
  return whole(a.magnitude) && whole(b.magnitude) && whole(h);
}
