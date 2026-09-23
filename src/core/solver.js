// Sequential-impulse contact solver.
//
// Each contact gets an impulse along the normal that removes the approaching part
// of the relative velocity, plus a tangential impulse for friction clamped by
// Coulomb's law. Impulses are accumulated and clamped across iterations rather than
// applied independently, which is what lets a stack of boxes settle instead of
// sinking and shuddering.

import { v2 } from './vec2.js';

// Below this approach speed, restitution is switched off. Without it a resting body
// bounces forever on the numerical noise in its own contact.
const RESTITUTION_THRESHOLD = 0.8;

// Contacts are allowed to overlap by this much before position correction kicks in.
// A little permanent overlap keeps neighbouring contacts from fighting each other.
const PENETRATION_SLOP = 0.005;
const POSITION_CORRECTION = 0.4;

class ContactPoint {
  constructor(point) {
    this.point = point;
    this.rA = v2(0, 0);
    this.rB = v2(0, 0);
    this.normalMass = 0;
    this.tangentMass = 0;
    this.bias = 0;
    this.normalImpulse = 0;
    this.tangentImpulse = 0;
  }
}

/**
 * Work out the per-contact constants that do not change between iterations: the
 * lever arms, the effective mass along the normal and tangent, and the restitution
 * bias. Doing this once per step rather than per iteration is most of the reason
 * the solver is cheap enough to run at 120 Hz on a tablet.
 */
export function prepareContacts(manifolds) {
  for (const m of manifolds) {
    const { a, b, normal } = m;
    const tangent = normal.perp();

    m.restitution = Math.min(a.restitution, b.restitution);
    // Geometric mean: two slippery surfaces stay slippery, and one grippy surface
    // cannot rescue a frictionless one.
    m.friction = Math.sqrt(a.friction * b.friction);
    m.points = [];

    for (const p of m.contacts) {
      const cp = new ContactPoint(p);
      cp.rA = p.sub(a.pos);
      cp.rB = p.sub(b.pos);

      const rnA = cp.rA.cross(normal);
      const rnB = cp.rB.cross(normal);
      const kNormal = a.invMass + b.invMass
        + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      cp.normalMass = kNormal > 0 ? 1 / kNormal : 0;

      const rtA = cp.rA.cross(tangent);
      const rtB = cp.rB.cross(tangent);
      const kTangent = a.invMass + b.invMass
        + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
      cp.tangentMass = kTangent > 0 ? 1 / kTangent : 0;

      // Restitution, evaluated once from the approach speed at the start of the
      // step. Recomputing it per iteration would let energy creep in.
      const rv = b.velocityAt(p).sub(a.velocityAt(p));
      const vn = rv.dot(normal);
      cp.bias = vn < -RESTITUTION_THRESHOLD ? -m.restitution * vn : 0;

      m.points.push(cp);
    }
  }
}

/** One velocity-solving pass over every contact. Call several times per step. */
export function solveVelocities(manifolds) {
  for (const m of manifolds) {
    const { a, b, normal } = m;
    if (a.isSensor || b.isSensor) continue;
    const tangent = normal.perp();

    for (const cp of m.points) {
      // --- normal impulse ---
      let rv = b.velocityAt(cp.point).sub(a.velocityAt(cp.point));
      const vn = rv.dot(normal);

      let dPn = cp.normalMass * -(vn - cp.bias);
      // Clamp the *accumulated* impulse to be non-negative, not this increment.
      // Contacts may pull during an iteration as long as the total never does.
      const oldPn = cp.normalImpulse;
      cp.normalImpulse = Math.max(oldPn + dPn, 0);
      dPn = cp.normalImpulse - oldPn;

      const Pn = normal.scale(dPn);
      a.applyImpulse(Pn.neg(), cp.point);
      b.applyImpulse(Pn, cp.point);

      // --- friction impulse ---
      rv = b.velocityAt(cp.point).sub(a.velocityAt(cp.point));
      const vt = rv.dot(tangent);

      let dPt = cp.tangentMass * -vt;
      // Coulomb: the friction impulse cannot exceed mu times the normal impulse.
      const maxPt = m.friction * cp.normalImpulse;
      const oldPt = cp.tangentImpulse;
      cp.tangentImpulse = Math.max(-maxPt, Math.min(oldPt + dPt, maxPt));
      dPt = cp.tangentImpulse - oldPt;

      const Pt = tangent.scale(dPt);
      a.applyImpulse(Pt.neg(), cp.point);
      b.applyImpulse(Pt, cp.point);
    }

    m.appliedImpulse = m.points.reduce((s, cp) => s + cp.normalImpulse, 0);
  }
}

/**
 * Push overlapping bodies apart. This moves positions directly rather than adding
 * velocity, so it removes overlap without feeding energy back into the simulation.
 */
export function solvePositions(manifolds) {
  for (const m of manifolds) {
    const { a, b, normal } = m;
    if (a.isSensor || b.isSensor) continue;

    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) continue;

    const depth = Math.max(m.penetration - PENETRATION_SLOP, 0);
    if (depth <= 0) continue;

    const correction = normal.scale((depth / invSum) * POSITION_CORRECTION);
    a.pos = a.pos.sub(correction.scale(a.invMass));
    b.pos = b.pos.add(correction.scale(b.invMass));
  }
}
