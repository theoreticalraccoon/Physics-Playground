// Projectile maths for the Launch station.
//
// Everything here is the closed-form answer, kept separate from the simulation so
// the station can draw the exact curve next to the simulated one and show that
// they agree. If they ever stop agreeing, the tests say so before a child does.

/** Height of the trajectory above the muzzle at horizontal distance x. */
export function heightAt(x, speed, theta, g) {
  const c = Math.cos(theta);
  if (Math.abs(c) < 1e-9) return Number.NEGATIVE_INFINITY; // fired straight up
  return x * Math.tan(theta) - (g * x * x) / (2 * speed * speed * c * c);
}

/** Horizontal distance back to launch height: R = v² sin(2θ) / g. */
export function range(speed, theta, g) {
  return (speed * speed * Math.sin(2 * theta)) / g;
}

/** Greatest height reached: v² sin²θ / 2g. */
export function apex(speed, theta, g) {
  const s = Math.sin(theta);
  return (speed * speed * s * s) / (2 * g);
}

/** Time from muzzle back down to launch height. */
export function flightTime(speed, theta, g) {
  return (2 * speed * Math.sin(theta)) / g;
}

/**
 * The two coefficients of y = ax + bx², so the station can print the quadratic
 * with the numbers filled in and have it be literally the curve on screen.
 */
export function quadraticCoefficients(speed, theta, g) {
  const c = Math.cos(theta);
  return {
    a: Math.tan(theta),
    b: -g / (2 * speed * speed * c * c),
  };
}

/**
 * The launch angle that lands a shot exactly `d` away, or null if the target is
 * out of reach at this speed.
 *
 * From R = v²sin(2θ)/g, so sin(2θ) = gd/v². There are two solutions whenever
 * there is one — θ and 90° − θ — which is the complementary-angle surprise the
 * station reveals after a hit. This returns the low one.
 */
export function solveLaunchAngle(d, speed, g) {
  const s = (g * d) / (speed * speed);
  if (s > 1 || s < -1) return null; // beyond v²/g, the maximum range
  return Math.asin(s) / 2;
}

/** The other angle that hits the same target. */
export function complementAngle(theta) {
  return Math.PI / 2 - theta;
}

/**
 * Roots of the trajectory: where it crosses launch height. One at the muzzle and
 * one at the range — the two x-intercepts of the quadratic, which is the bit of
 * the syllabus this station is really about.
 */
export function roots(speed, theta, g) {
  return [0, range(speed, theta, g)];
}

/** The speed needed to reach a target at distance d at a given angle. */
export function speedForTarget(d, theta, g) {
  const s = Math.sin(2 * theta);
  if (s <= 1e-9) return null;
  return Math.sqrt((g * d) / s);
}

/** Sampled points of the exact trajectory, in world units, for drawing. */
export function trajectoryPoints(origin, speed, theta, g, samples = 96, maxX = null) {
  const r = maxX ?? range(speed, theta, g);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * r;
    pts.push({ x: origin.x + x, y: origin.y + heightAt(x, speed, theta, g) });
  }
  return pts;
}
