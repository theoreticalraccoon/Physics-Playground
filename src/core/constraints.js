// Constraints: things that hold bodies at a distance from each other or from a
// fixed point. Springs push with a force; rods are solved with impulses, which
// stays stiff at large masses where a very strong spring would explode.

import { v2 } from './vec2.js';

/** Shared plumbing for anything joining a body to another body or a world point. */
class Joint {
  /**
   * @param a       first body
   * @param b       second body, or null to anchor to a fixed world point
   * @param anchorA attachment point in A's local frame
   * @param anchorB attachment point in B's local frame, or the world point if b is null
   */
  constructor(a, b, anchorA = v2(0, 0), anchorB = v2(0, 0)) {
    this.a = a;
    this.b = b;
    this.anchorA = anchorA;
    this.anchorB = anchorB;
  }

  worldA() {
    return this.anchorA.rotate(this.a.angle).add(this.a.pos);
  }

  worldB() {
    return this.b ? this.anchorB.rotate(this.b.angle).add(this.b.pos) : this.anchorB;
  }
}

/**
 * Hooke's law with damping: F = -k*x - c*v.
 *
 * Soft by nature — it stretches under load, which is the point when you want to
 * *see* the restoring force. Use a Rod when the length must actually hold.
 */
export class Spring extends Joint {
  constructor(a, b, opts = {}) {
    super(a, b, opts.anchorA, opts.anchorB);
    this.restLength = opts.restLength ?? this.worldB().dist(this.worldA());
    this.stiffness = opts.stiffness ?? 40;
    this.damping = opts.damping ?? 1.5;
  }

  apply() {
    const pa = this.worldA();
    const pb = this.worldB();
    const d = pb.sub(pa);
    const len = d.len();
    if (len < 1e-9) return;

    const n = d.scale(1 / len);
    const x = len - this.restLength;

    // Damping acts on the closing speed only, so it never fights motion across
    // the spring's axis.
    const va = this.a.velocityAt(pa);
    const vb = this.b ? this.b.velocityAt(pb) : v2(0, 0);
    const closingSpeed = vb.sub(va).dot(n);

    const f = n.scale(this.stiffness * x + this.damping * closingSpeed);
    this.a.applyForce(f, pa);
    if (this.b) this.b.applyForce(f.neg(), pb);
  }

  /** Elastic PE stored in the spring, for the energy bars. */
  energy() {
    const x = this.worldB().dist(this.worldA()) - this.restLength;
    return 0.5 * this.stiffness * x * x;
  }
}

/**
 * A rigid distance constraint, solved with impulses over several iterations.
 *
 * `bias` is Baumgarte stabilisation: a fraction of the current length error is fed
 * back as extra velocity so drift is pulled out over a few frames rather than
 * accumulating.
 */
export class Rod extends Joint {
  constructor(a, b, opts = {}) {
    super(a, b, opts.anchorA, opts.anchorB);
    this.length = opts.length ?? this.worldB().dist(this.worldA());
    this.beta = opts.beta ?? 0.2;
    // A rope resists stretching but not slack; a rod resists both.
    this.ropeOnly = opts.ropeOnly ?? false;
    this.impulse = 0;
  }

  prepare(dt) {
    const pa = this.worldA();
    const pb = this.worldB();
    const d = pb.sub(pa);
    const len = d.len();
    if (len < 1e-9) {
      this.normalMass = 0;
      return;
    }

    this.n = d.scale(1 / len);
    this.rA = pa.sub(this.a.pos);
    this.rB = this.b ? pb.sub(this.b.pos) : v2(0, 0);

    const invMassB = this.b ? this.b.invMass : 0;
    const invInertiaB = this.b ? this.b.invInertia : 0;
    const rnA = this.rA.cross(this.n);
    const rnB = this.rB.cross(this.n);

    const k = this.a.invMass + invMassB
      + this.a.invInertia * rnA * rnA + invInertiaB * rnB * rnB;
    this.normalMass = k > 0 ? 1 / k : 0;

    this.C = len - this.length;
    this.slack = this.ropeOnly && this.C < 0;
    this.bias = (this.beta / dt) * this.C;
    this.impulse = 0;
  }

  solve() {
    if (!this.normalMass || this.slack) return;

    const pa = this.worldA();
    const pb = this.worldB();
    const va = this.a.velocityAt(pa);
    const vb = this.b ? this.b.velocityAt(pb) : v2(0, 0);
    const vn = vb.sub(va).dot(this.n);

    const lambda = -this.normalMass * (vn + this.bias);
    this.impulse += lambda;

    const P = this.n.scale(lambda);
    this.a.applyImpulse(P.neg(), pa);
    if (this.b) this.b.applyImpulse(P, pb);
  }
}

/** Holds a body's anchor point at a fixed spot in the world. A hinge. */
export class Pin extends Joint {
  constructor(a, worldPoint, opts = {}) {
    super(a, null, opts.anchorA ?? v2(0, 0), worldPoint);
    this.beta = opts.beta ?? 0.3;
  }

  prepare(dt) {
    this.rA = this.anchorA.rotate(this.a.angle);
    this.dtInv = 1 / dt;
  }

  solve() {
    // Two scalar passes, one per axis, is enough at these iteration counts and
    // avoids assembling and inverting the 2x2 effective mass matrix.
    for (const axis of [v2(1, 0), v2(0, 1)]) {
      const pa = this.a.pos.add(this.rA);
      const C = pa.sub(this.anchorB).dot(axis);
      const rn = this.rA.cross(axis);
      const k = this.a.invMass + this.a.invInertia * rn * rn;
      if (k <= 0) continue;

      const vn = this.a.velocityAt(pa).dot(axis);
      const lambda = -(vn + this.beta * this.dtInv * C) / k;
      this.a.applyImpulse(axis.scale(lambda), pa);
    }
  }
}
