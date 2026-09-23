// Rigid bodies: a circle or a convex polygon, with the mass properties worked out
// from the shape and a density rather than typed in by hand. Getting the moment of
// inertia right is what makes a tipping crate look like a crate.

import { Vec2, v2 } from './vec2.js';

export const SHAPE = { CIRCLE: 'circle', POLY: 'poly' };

let nextId = 1;

export class Body {
  constructor(opts = {}) {
    this.id = nextId++;
    this.label = opts.label ?? '';

    this.shape = opts.shape ?? SHAPE.CIRCLE;
    this.radius = opts.radius ?? 0.5;
    // Polygon vertices in local space, anticlockwise, centred on the centroid.
    this.verts = opts.verts ?? null;

    this.pos = opts.pos ? opts.pos.clone() : v2(0, 0);
    this.vel = opts.vel ? opts.vel.clone() : v2(0, 0);
    this.angle = opts.angle ?? 0;
    this.angVel = opts.angVel ?? 0;

    this.force = v2(0, 0);
    this.torque = 0;

    this.density = opts.density ?? 1;
    this.restitution = opts.restitution ?? 0.3;
    this.friction = opts.friction ?? 0.4;
    // Per-body drag, applied as v *= (1 - linearDamping*dt).
    this.linearDamping = opts.linearDamping ?? 0;
    this.angularDamping = opts.angularDamping ?? 0.02;

    // Static bodies have infinite mass and never move: ground, walls, the ramp.
    this.isStatic = opts.isStatic ?? false;
    // Sensors report overlaps but generate no impulse: goals, trigger zones.
    this.isSensor = opts.isSensor ?? false;
    // Bodies that ignore world gravity: orbiting probes use their own field.
    this.ignoreGravity = opts.ignoreGravity ?? false;

    this.colour = opts.colour ?? null;
    // Free-form slot for stations to hang their own state off a body.
    this.data = opts.data ?? {};

    if (this.shape === SHAPE.POLY && this.verts) {
      this.recentrePoly();
    }
    this.computeMass();

    // Filled by the renderer/x-ray; kept on the body so trails survive a station
    // rebuilding its display list each frame.
    this.trail = [];
    this.trailMax = opts.trailMax ?? 0;
  }

  // --- constructors for the shapes the stations actually use -----------------

  static circle(x, y, r, opts = {}) {
    return new Body({ ...opts, shape: SHAPE.CIRCLE, radius: r, pos: v2(x, y) });
  }

  static polygon(x, y, verts, opts = {}) {
    return new Body({ ...opts, shape: SHAPE.POLY, verts, pos: v2(x, y) });
  }

  static box(x, y, w, h, opts = {}) {
    const hw = w / 2;
    const hh = h / 2;
    return Body.polygon(
      x,
      y,
      [v2(-hw, -hh), v2(hw, -hh), v2(hw, hh), v2(-hw, hh)],
      opts,
    );
  }

  /** Regular n-gon, handy for dice-like debris and the slingshot probe. */
  static regular(x, y, r, n, opts = {}) {
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      verts.push(Vec2.fromAngle(a, r));
    }
    return Body.polygon(x, y, verts, opts);
  }

  // --- mass properties -------------------------------------------------------

  /**
   * Shift local vertices so the centroid sits at the origin, and move `pos` to
   * compensate. Everything downstream assumes rotation happens about the centre of
   * mass, so this has to be true before inertia is computed.
   */
  recentrePoly() {
    const c = polyCentroid(this.verts);
    this.verts = this.verts.map((p) => p.sub(c));
    this.pos = this.pos.add(c);
  }

  computeMass() {
    if (this.isStatic) {
      this.mass = Infinity;
      this.invMass = 0;
      this.inertia = Infinity;
      this.invInertia = 0;
      return;
    }

    if (this.shape === SHAPE.CIRCLE) {
      const r = this.radius;
      this.mass = this.density * Math.PI * r * r;
      // Solid disc about its centre.
      this.inertia = 0.5 * this.mass * r * r;
    } else {
      const { area, inertiaOverDensity } = polyMassData(this.verts);
      this.mass = this.density * area;
      this.inertia = this.density * inertiaOverDensity;
    }

    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
  }

  /** Override the computed mass, keeping the shape's inertia proportional. */
  setMass(m) {
    if (this.isStatic) return;
    const ratio = m / this.mass;
    this.mass = m;
    this.inertia *= ratio;
    this.invMass = 1 / this.mass;
    this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
    this.density = this.shape === SHAPE.CIRCLE
      ? m / (Math.PI * this.radius * this.radius)
      : m / polyMassData(this.verts).area;
  }

  // --- forces ----------------------------------------------------------------

  applyForce(f, atWorld = null) {
    this.force = this.force.add(f);
    if (atWorld) {
      const r = atWorld.sub(this.pos);
      this.torque += r.cross(f);
    }
  }

  /** An instantaneous change in momentum, used by the collision solver. */
  applyImpulse(j, atWorld = null) {
    if (this.isStatic) return;
    this.vel = this.vel.add(j.scale(this.invMass));
    if (atWorld) {
      const r = atWorld.sub(this.pos);
      this.angVel += this.invInertia * r.cross(j);
    }
  }

  clearForces() {
    this.force = v2(0, 0);
    this.torque = 0;
  }

  // --- queries ---------------------------------------------------------------

  /** Vertices in world space. Circles return null. */
  worldVerts() {
    if (this.shape !== SHAPE.POLY) return null;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return this.verts.map(
      (p) => new Vec2(
        this.pos.x + p.x * c - p.y * s,
        this.pos.y + p.x * s + p.y * c,
      ),
    );
  }

  /** Velocity of the material point at a world position, including spin. */
  velocityAt(world) {
    const r = world.sub(this.pos);
    return this.vel.add(v2(-this.angVel * r.y, this.angVel * r.x));
  }

  containsPoint(p) {
    if (this.shape === SHAPE.CIRCLE) {
      return p.dist2(this.pos) <= this.radius * this.radius;
    }
    const vs = this.worldVerts();
    // Convex, anticlockwise: inside means left of every edge.
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      if (b.sub(a).cross(p.sub(a)) < 0) return false;
    }
    return true;
  }

  /** Axis-aligned bounds, used for broadphase and for fitting the camera. */
  aabb() {
    if (this.shape === SHAPE.CIRCLE) {
      return {
        min: v2(this.pos.x - this.radius, this.pos.y - this.radius),
        max: v2(this.pos.x + this.radius, this.pos.y + this.radius),
      };
    }
    const vs = this.worldVerts();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of vs) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { min: v2(minX, minY), max: v2(maxX, maxY) };
  }

  kineticEnergy() {
    if (this.isStatic) return 0;
    return 0.5 * this.mass * this.vel.len2() + 0.5 * this.inertia * this.angVel ** 2;
  }

  /** Gravitational PE relative to y = datum, for the energy bars. */
  potentialEnergy(g, datum = 0) {
    if (this.isStatic) return 0;
    return this.mass * g * (this.pos.y - datum);
  }

  momentum() {
    return this.vel.scale(this.mass);
  }

  pushTrail() {
    if (this.trailMax <= 0) return;
    this.trail.push(this.pos.clone());
    if (this.trail.length > this.trailMax) this.trail.shift();
  }
}

// --- polygon geometry --------------------------------------------------------

/** Area-weighted centroid of a simple polygon. */
export function polyCentroid(verts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const cross = p.cross(q);
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) return v2(0, 0);
  return v2(cx / (6 * a), cy / (6 * a));
}

/**
 * Area and second moment about the centroid, per unit density.
 *
 * Both come from the same walk over the edges: summing the signed cross products
 * gives twice the area, and the standard polygon inertia formula weights each
 * triangle by (p·p + p·q + q·q).
 */
export function polyMassData(verts) {
  const c = polyCentroid(verts);
  let area = 0;
  let inertia = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i].sub(c);
    const q = verts[(i + 1) % verts.length].sub(c);
    const cross = Math.abs(p.cross(q));
    area += cross;
    inertia += cross * (p.dot(p) + p.dot(q) + q.dot(q));
  }
  return { area: area / 2, inertiaOverDensity: inertia / 12 };
}
