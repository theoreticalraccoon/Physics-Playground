// The simulation. Fixed timestep, semi-implicit Euler, sequential-impulse contacts.
//
// The timestep is fixed and decoupled from the frame rate on purpose. A fair stand
// runs on whatever tablet is to hand, and a station that promises "three stars,
// first try" has to behave identically at 30 fps and 120 fps.

import { Vec2, v2 } from './vec2.js';
import { collide, aabbOverlap } from './collide.js';
import { prepareContacts, solveVelocities, solvePositions } from './solver.js';

export class World {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? v2(0, -9.81);
    this.bodies = [];
    this.joints = [];
    // Extra acceleration fields, e.g. the inverse-square pull of a planet. Each is
    // (body, world) => Vec2 acceleration.
    this.fields = [];

    this.fixedDt = opts.fixedDt ?? 1 / 120;
    this.velocityIterations = opts.velocityIterations ?? 8;
    this.positionIterations = opts.positionIterations ?? 3;

    this.accumulator = 0;
    this.time = 0;
    this.steps = 0;

    this.manifolds = [];
    this.sensorPairs = [];
    // Pair keys touching last step, so a first touch can be told from a rest.
    this.prevTouching = new Set();

    /** @type {(m: import('./collide.js').Manifold, speed: number) => void} */
    this.onImpact = null;
    /** @type {(sensor: any, other: any) => void} */
    this.onSensor = null;

    this.paused = false;
  }

  // --- contents ---------------------------------------------------------------

  add(...bodies) {
    for (const b of bodies) this.bodies.push(b);
    return bodies.length === 1 ? bodies[0] : bodies;
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this.joints = this.joints.filter((j) => j.a !== body && j.b !== body);
  }

  addJoint(j) {
    this.joints.push(j);
    return j;
  }

  addField(fn) {
    this.fields.push(fn);
    return fn;
  }

  clear() {
    this.bodies.length = 0;
    this.joints.length = 0;
    this.fields.length = 0;
    this.manifolds.length = 0;
    this.sensorPairs.length = 0;
    this.prevTouching.clear();
    this.accumulator = 0;
    this.time = 0;
    this.steps = 0;
  }

  // --- the loop ---------------------------------------------------------------

  /**
   * Advance by real elapsed time, running as many fixed substeps as fit.
   *
   * Long frames are clamped rather than caught up on. If the tab is backgrounded
   * for ten seconds we do not want to run 1200 substeps on the way back and throw
   * everything through the floor.
   */
  step(dt) {
    if (this.paused) return 0;
    this.accumulator += Math.min(dt, 0.25);

    let ran = 0;
    while (this.accumulator >= this.fixedDt) {
      this.substep(this.fixedDt);
      this.accumulator -= this.fixedDt;
      ran++;
      if (ran > 8) {
        // Still behind after eight substeps: drop the backlog and stay responsive.
        this.accumulator = 0;
        break;
      }
    }
    return ran;
  }

  substep(h) {
    const bodies = this.bodies;

    // 1. Forces. Gravity, custom fields, then springs on top.
    for (const b of bodies) {
      b.clearForces();
      if (b.isStatic) continue;
      if (!b.ignoreGravity) b.applyForce(this.gravity.scale(b.mass));
      for (const field of this.fields) {
        const a = field(b, this);
        if (a) b.applyForce(a.scale(b.mass));
      }
    }
    for (const j of this.joints) {
      if (j.apply) j.apply();
    }

    // 2. Integrate velocities, and apply damping as a multiplicative decay.
    for (const b of bodies) {
      if (b.isStatic) continue;
      b.vel = b.vel.add(b.force.scale(b.invMass * h));
      b.angVel += b.torque * b.invInertia * h;
      if (b.linearDamping) b.vel = b.vel.scale(1 / (1 + b.linearDamping * h));
      if (b.angularDamping) b.angVel /= 1 + b.angularDamping * h;
    }

    // 3. Find contacts.
    this.narrowphase();

    // 4. Solve velocity constraints: contacts and rigid joints together.
    prepareContacts(this.manifolds);
    for (const j of this.joints) {
      if (j.prepare) j.prepare(h);
    }
    for (let i = 0; i < this.velocityIterations; i++) {
      solveVelocities(this.manifolds);
      for (const j of this.joints) {
        if (j.solve) j.solve();
      }
    }

    // 5. Integrate positions.
    for (const b of bodies) {
      if (b.isStatic) continue;
      b.pos = b.pos.add(b.vel.scale(h));
      b.angle += b.angVel * h;
    }

    // 6. Push out any remaining overlap.
    for (let i = 0; i < this.positionIterations; i++) {
      solvePositions(this.manifolds);
    }

    this.time += h;
    this.steps++;
    this.fireEvents();
  }

  /**
   * All-pairs broadphase with an AABB reject. O(n^2), which is the right call at
   * the few dozen bodies a station uses — a grid would cost more to maintain than
   * it saves, and this is trivially deterministic.
   */
  narrowphase() {
    this.manifolds.length = 0;
    this.sensorPairs.length = 0;
    const bodies = this.bodies;

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (a.isStatic && b.isStatic) continue;
        if (a.invMass === 0 && b.invMass === 0) continue;
        if (!aabbOverlap(a, b)) continue;

        const m = collide(a, b);
        if (!m) continue;

        if (a.isSensor || b.isSensor) {
          this.sensorPairs.push(m);
        } else {
          this.manifolds.push(m);
        }
      }
    }
  }

  /** Report first touches, so stations can score a hit and play a sound once. */
  fireEvents() {
    const touching = new Set();

    for (const m of this.manifolds) {
      const key = m.a.id < m.b.id ? `${m.a.id}:${m.b.id}` : `${m.b.id}:${m.a.id}`;
      touching.add(key);
      if (!this.prevTouching.has(key) && this.onImpact) {
        const p = m.contacts[0] ?? m.a.pos;
        const speed = Math.abs(m.b.velocityAt(p).sub(m.a.velocityAt(p)).dot(m.normal));
        this.onImpact(m, speed);
      }
    }

    for (const m of this.sensorPairs) {
      const key = m.a.id < m.b.id ? `s${m.a.id}:${m.b.id}` : `s${m.b.id}:${m.a.id}`;
      touching.add(key);
      if (!this.prevTouching.has(key) && this.onSensor) {
        const sensor = m.a.isSensor ? m.a : m.b;
        const other = m.a.isSensor ? m.b : m.a;
        this.onSensor(sensor, other);
      }
    }

    this.prevTouching = touching;
  }

  // --- queries ----------------------------------------------------------------

  bodyAt(point) {
    // Back to front, so the body drawn on top is the one you grab.
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      if (this.bodies[i].containsPoint(point)) return this.bodies[i];
    }
    return null;
  }

  /** Nearest body within `radius`. Forgiving version of bodyAt, for fingers. */
  bodyNear(point, radius) {
    let best = null;
    let bestD = radius;
    for (const b of this.bodies) {
      if (b.isStatic || b.isSensor) continue;
      const d = b.pos.dist(point);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  kineticEnergy() {
    return this.bodies.reduce((s, b) => s + b.kineticEnergy(), 0);
  }

  potentialEnergy(datum = 0) {
    const g = this.gravity.len();
    return this.bodies.reduce((s, b) => s + b.potentialEnergy(g, datum), 0);
  }

  /** Total linear momentum. Should be conserved when nothing external acts. */
  momentum() {
    return this.bodies.reduce(
      (s, b) => (b.isStatic ? s : s.add(b.momentum())),
      v2(0, 0),
    );
  }

  /** Bounds of every non-static body, for auto-fitting the camera. */
  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.bodies) {
      const { min, max } = b.aabb();
      minX = Math.min(minX, min.x);
      minY = Math.min(minY, min.y);
      maxX = Math.max(maxX, max.x);
      maxY = Math.max(maxY, max.y);
    }
    return { min: v2(minX, minY), max: v2(maxX, maxY) };
  }
}

/**
 * A Newtonian point-mass field: a = -GM * r / |r|^3.
 *
 * Softened at very small radius so a probe that flies straight into the planet
 * does not receive an infinite kick and vanish to NaN.
 */
export function pointGravityField(centre, GM, softening = 0.35) {
  return (body) => {
    const d = centre.sub(body.pos);
    const r2 = d.len2() + softening * softening;
    const r = Math.sqrt(r2);
    return d.scale(GM / (r2 * r));
  };
}

export { Vec2, v2 };
