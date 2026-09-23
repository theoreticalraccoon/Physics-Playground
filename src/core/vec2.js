// 2D vectors. Immutable by default: every operation returns a new vector, which
// costs allocations but removes a whole class of aliasing bug that is miserable to
// find in a solver. Body counts here are in the dozens, so it does not matter.

export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  static of(x, y) {
    return new Vec2(x, y);
  }

  /** Unit vector at `a` radians, measured anticlockwise from +x. */
  static fromAngle(a, len = 1) {
    return new Vec2(Math.cos(a) * len, Math.sin(a) * len);
  }

  static zero() {
    return new Vec2(0, 0);
  }

  clone() {
    return new Vec2(this.x, this.y);
  }

  add(v) {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v) {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  scale(s) {
    return new Vec2(this.x * s, this.y * s);
  }

  neg() {
    return new Vec2(-this.x, -this.y);
  }

  /** Componentwise, for things like per-axis damping. */
  mul(v) {
    return new Vec2(this.x * v.x, this.y * v.y);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /** The z component of the 3D cross product. Signed area of the parallelogram. */
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  /** Cross of this vector with a scalar angular quantity: gives r x w. */
  crossScalar(s) {
    return new Vec2(s * this.y, -s * this.x);
  }

  len() {
    return Math.hypot(this.x, this.y);
  }

  /** Cheaper than len() when you only need to compare distances. */
  len2() {
    return this.x * this.x + this.y * this.y;
  }

  dist(v) {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  dist2(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  /** Zero vector normalises to zero rather than NaN. */
  norm() {
    const l = Math.hypot(this.x, this.y);
    return l > 1e-12 ? new Vec2(this.x / l, this.y / l) : new Vec2(0, 0);
  }

  /** Rotated a quarter turn anticlockwise. */
  perp() {
    return new Vec2(-this.y, this.x);
  }

  rotate(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  /** Rotate about `pivot` rather than the origin. */
  rotateAbout(a, pivot) {
    return this.sub(pivot).rotate(a).add(pivot);
  }

  angle() {
    return Math.atan2(this.y, this.x);
  }

  /** Clamped to at most `max` long, keeping direction. */
  clampLen(max) {
    const l = Math.hypot(this.x, this.y);
    return l > max && l > 1e-12 ? this.scale(max / l) : this.clone();
  }

  lerp(v, t) {
    return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }

  /** Scalar projection of this onto `v` — the component along v. */
  compAlong(v) {
    const n = v.norm();
    return this.dot(n);
  }

  /** Vector projection of this onto `v`. */
  projOnto(v) {
    const n = v.norm();
    return n.scale(this.dot(n));
  }

  equals(v, eps = 1e-9) {
    return Math.abs(this.x - v.x) < eps && Math.abs(this.y - v.y) < eps;
  }

  isFinite() {
    return Number.isFinite(this.x) && Number.isFinite(this.y);
  }

  toString(dp = 2) {
    return `(${this.x.toFixed(dp)}, ${this.y.toFixed(dp)})`;
  }
}

export const v2 = (x, y) => new Vec2(x, y);

// Small scalar helpers used all over the stations and the renderer.

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Map x from one range to another, without clamping. */
export const remap = (x, a0, a1, b0, b1) => b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

export const toDeg = (r) => r * DEG;
export const toRad = (d) => d * RAD;

/** Wrap an angle into (-pi, pi]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Deterministic PRNG (mulberry32). The engine promises the same run for the same
 * inputs so a station can honestly say "three stars, first try" — Math.random would
 * break that promise.
 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
