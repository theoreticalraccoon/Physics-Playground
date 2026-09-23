// Ramp and friction maths for the Slope station.
//
// This is the best measurement in the whole stand. A block sits on a ramp; you tilt
// it; at one particular angle it starts to slide. That angle tells you a number you
// were never given:
//
//   mg sinθ  >  μ mg cosθ        the block slips when the pull beats the grip
//         tanθ > μ               mass cancels — it does not matter how heavy it is
//
// So μ = tan(θ_critical). A kid measures an angle with their finger and walks away
// having determined a physical constant by trigonometry.

/** Component of weight down the slope. */
export const gravityAlongSlope = (m, g, theta) => m * g * Math.sin(theta);

/** Component of weight pressing into the slope — the normal reaction. */
export const normalForce = (m, g, theta) => m * g * Math.cos(theta);

/** The most friction the surface can supply before it gives way. */
export const maxStaticFriction = (m, g, theta, mu) => mu * normalForce(m, g, theta);

/** The angle at which the block breaks away: θ = tan⁻¹(μ). */
export const criticalAngle = (mu) => Math.atan(mu);

/** Recovering μ from a measured angle, which is the station's whole point. */
export const frictionFromAngle = (theta) => Math.tan(theta);

/** True once the slope is steep enough for the block to move. */
export const slips = (theta, mu) => Math.tan(theta) > mu;

/**
 * Acceleration down the slope once it is sliding, using kinetic friction.
 * a = g(sinθ − μcosθ). Mass has cancelled again.
 */
export function slidingAcceleration(g, theta, muKinetic) {
  const a = g * (Math.sin(theta) - muKinetic * Math.cos(theta));
  return Math.max(a, 0);
}

/** Rise over run — the gradient of the ramp, in the sense a maths lesson means it. */
export const gradient = (theta) => Math.tan(theta);

/**
 * How close the block is to letting go, as a fraction. 1.0 is exactly on the point
 * of slipping. Drives the two racing bars in the display.
 */
export function slipRatio(theta, mu) {
  const grip = mu * Math.cos(theta);
  if (grip < 1e-9) return Infinity;
  return Math.sin(theta) / grip;
}

/** Distance travelled from rest in time t under constant acceleration. */
export const slideDistance = (a, t) => 0.5 * a * t * t;

/**
 * Time to slide a distance d from rest. Used to predict when the block reaches the
 * bottom so the station can score the run.
 */
export const slideTime = (a, d) => (a > 1e-9 ? Math.sqrt((2 * d) / a) : Infinity);
