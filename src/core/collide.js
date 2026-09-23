// Collision detection. Produces a manifold — normal, penetration depth and up to
// two contact points — for each touching pair. Circles are analytic; polygons use
// the separating-axis theorem, then clip one face against the other to find where
// they actually touch.
//
// Convention throughout: the normal points from A to B, and penetration is positive
// when the shapes overlap.

import { Vec2, v2 } from './vec2.js';
import { SHAPE } from './body.js';

const EPS = 1e-6;

export class Manifold {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.normal = v2(0, 0);
    this.penetration = 0;
    this.contacts = [];
    // Filled in by the solver so the x-ray can draw the impulse that was applied.
    this.appliedImpulse = 0;
  }
}

/** Outward unit normals, one per edge i joining verts[i] to verts[i+1]. */
export function faceNormals(verts) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const d = q.sub(p);
    // Anticlockwise winding: rotating the edge by -90 degrees points outwards.
    out.push(v2(d.y, -d.x).norm());
  }
  return out;
}

/** Vertex furthest along `dir`. */
function support(verts, dir) {
  let best = verts[0];
  let bestDot = verts[0].dot(dir);
  for (let i = 1; i < verts.length; i++) {
    const d = verts[i].dot(dir);
    if (d > bestDot) {
      bestDot = d;
      best = verts[i];
    }
  }
  return best;
}

/**
 * The axis on which A and B are least overlapped, from A's faces only.
 * A positive distance means a separating axis exists and the pair cannot collide.
 */
function leastPenetrationAxis(vertsA, normalsA, vertsB) {
  let bestDist = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < vertsA.length; i++) {
    const n = normalsA[i];
    // The point of B furthest *into* A along this axis.
    const s = support(vertsB, n.neg());
    const d = n.dot(s.sub(vertsA[i]));
    if (d > bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return { dist: bestDist, index: bestIndex };
}

/** Face of the incident body most opposed to the reference normal. */
function incidentFace(vertsInc, normalsInc, refNormal) {
  let bestDot = Infinity;
  let bestIndex = 0;
  for (let i = 0; i < normalsInc.length; i++) {
    const d = normalsInc[i].dot(refNormal);
    if (d < bestDot) {
      bestDot = d;
      bestIndex = i;
    }
  }
  return [vertsInc[bestIndex], vertsInc[(bestIndex + 1) % vertsInc.length]];
}

/**
 * Clip a segment to the half-space n·x <= c. Returns the surviving points, which
 * is 0, 1 or 2 of them — the standard Sutherland–Hodgman step for one plane.
 */
function clipSegment(n, c, face) {
  const out = [];
  const d1 = n.dot(face[0]) - c;
  const d2 = n.dot(face[1]) - c;

  if (d1 <= 0) out.push(face[0].clone());
  if (d2 <= 0) out.push(face[1].clone());

  // The segment crosses the plane: add the intersection point.
  if (d1 * d2 < 0) {
    const t = d1 / (d1 - d2);
    out.push(face[0].lerp(face[1], t));
  }
  return out.slice(0, 2);
}

// --- pair tests ---------------------------------------------------------------

function circleCircle(a, b) {
  const d = b.pos.sub(a.pos);
  const r = a.radius + b.radius;
  const dist2 = d.len2();
  if (dist2 > r * r) return null;

  const m = new Manifold(a, b);
  const dist = Math.sqrt(dist2);

  if (dist < EPS) {
    // Exactly concentric. Any direction is as good as another; pick one so the
    // solver has something finite to push along.
    m.normal = v2(0, 1);
    m.penetration = a.radius;
    m.contacts = [a.pos.clone()];
  } else {
    m.normal = d.scale(1 / dist);
    m.penetration = r - dist;
    m.contacts = [a.pos.add(m.normal.scale(a.radius))];
  }
  return m;
}

/** Polygon A against circle B. */
function polyCircle(a, b) {
  const vertsA = a.worldVerts();
  const normalsA = faceNormals(vertsA);
  const c = b.pos;
  const r = b.radius;

  // Face of A the circle centre is least far inside.
  let bestSep = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < vertsA.length; i++) {
    const s = normalsA[i].dot(c.sub(vertsA[i]));
    if (s > r) return null; // separating axis found
    if (s > bestSep) {
      bestSep = s;
      bestIndex = i;
    }
  }

  const m = new Manifold(a, b);
  const v1 = vertsA[bestIndex];
  const v2v = vertsA[(bestIndex + 1) % vertsA.length];

  // Centre is inside the polygon: push straight out through the nearest face.
  if (bestSep < EPS) {
    m.normal = normalsA[bestIndex].clone();
    m.penetration = r - bestSep;
    m.contacts = [c.sub(m.normal.scale(r))];
    return m;
  }

  // Otherwise work out which Voronoi region of the face the centre sits in.
  const edge = v2v.sub(v1);
  const d1 = c.sub(v1).dot(edge);
  const d2 = c.sub(v2v).dot(edge.neg());

  if (d1 <= 0) {
    // Nearest feature is the first vertex.
    const dist = c.dist(v1);
    if (dist > r) return null;
    m.normal = c.sub(v1).norm();
    m.penetration = r - dist;
    m.contacts = [v1.clone()];
  } else if (d2 <= 0) {
    // Nearest feature is the second vertex.
    const dist = c.dist(v2v);
    if (dist > r) return null;
    m.normal = c.sub(v2v).norm();
    m.penetration = r - dist;
    m.contacts = [v2v.clone()];
  } else {
    // Nearest feature is the face itself.
    m.normal = normalsA[bestIndex].clone();
    m.penetration = r - bestSep;
    m.contacts = [c.sub(m.normal.scale(r))];
  }
  return m;
}

function polyPoly(a, b) {
  const vertsA = a.worldVerts();
  const vertsB = b.worldVerts();
  const normalsA = faceNormals(vertsA);
  const normalsB = faceNormals(vertsB);

  const penA = leastPenetrationAxis(vertsA, normalsA, vertsB);
  if (penA.dist > 0) return null;
  const penB = leastPenetrationAxis(vertsB, normalsB, vertsA);
  if (penB.dist > 0) return null;

  // Prefer A's face unless B's is meaningfully deeper. The bias stops the reference
  // face flickering between the two when depths are nearly equal, which otherwise
  // shows up as a box jittering on the ground.
  const useA = penA.dist > penB.dist - 0.001 * Math.abs(penA.dist) - 1e-5;

  const refVerts = useA ? vertsA : vertsB;
  const refNormals = useA ? normalsA : normalsB;
  const incVerts = useA ? vertsB : vertsA;
  const incNormals = useA ? normalsB : normalsA;
  const refIndex = useA ? penA.index : penB.index;

  const refNormal = refNormals[refIndex];
  const r1 = refVerts[refIndex];
  const r2 = refVerts[(refIndex + 1) % refVerts.length];

  let inc = incidentFace(incVerts, incNormals, refNormal);

  // Trim the incident face to the width of the reference face.
  const sideDir = r2.sub(r1).norm();
  inc = clipSegment(sideDir.neg(), sideDir.neg().dot(r1), inc);
  if (inc.length < 2) return null;
  inc = clipSegment(sideDir, sideDir.dot(r2), inc);
  if (inc.length < 2) return null;

  // Whatever is left behind the reference face is a real contact.
  const refC = refNormal.dot(r1);
  const contacts = [];
  let deepest = 0;
  for (const p of inc) {
    const sep = refNormal.dot(p) - refC;
    if (sep <= 0) {
      contacts.push(p);
      deepest = Math.max(deepest, -sep);
    }
  }
  if (contacts.length === 0) return null;

  const m = new Manifold(a, b);
  // refNormal points out of the reference body. If that was B, flip it so the
  // manifold keeps its A-to-B promise.
  m.normal = useA ? refNormal.clone() : refNormal.neg();
  m.penetration = deepest;
  m.contacts = contacts;
  return m;
}

/**
 * Test one pair. Returns a manifold or null. Order does not matter to the caller:
 * a circle/polygon pair is flipped internally and the normal corrected.
 */
export function collide(a, b) {
  if (a.shape === SHAPE.CIRCLE && b.shape === SHAPE.CIRCLE) {
    return circleCircle(a, b);
  }
  if (a.shape === SHAPE.POLY && b.shape === SHAPE.CIRCLE) {
    return polyCircle(a, b);
  }
  if (a.shape === SHAPE.CIRCLE && b.shape === SHAPE.POLY) {
    const m = polyCircle(b, a);
    if (!m) return null;
    // Rebuild with the original ordering so normal still runs A to B.
    const flipped = new Manifold(a, b);
    flipped.normal = m.normal.neg();
    flipped.penetration = m.penetration;
    flipped.contacts = m.contacts;
    return flipped;
  }
  return polyPoly(a, b);
}

/** Cheap rejection test so the narrow phase only sees plausible pairs. */
export function aabbOverlap(a, b) {
  const A = a.aabb();
  const B = b.aabb();
  return A.min.x <= B.max.x && A.max.x >= B.min.x
    && A.min.y <= B.max.y && A.max.y >= B.min.y;
}
