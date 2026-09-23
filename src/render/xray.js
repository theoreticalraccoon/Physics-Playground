// The X-ray overlay: the same maths drawn the same way on every station.
//
// This is the piece that turns six toys into one exhibit. A kid works out at the
// cannon that a cyan arrow is velocity and the dashed lines under it are its
// components, and that knowledge transfers unchanged to the orbit, the collision
// and the ramp. Nothing here is station-specific on purpose.

import { Vec2, v2, toDeg } from '../core/vec2.js';
import { C, alpha } from './palette.js';

/**
 * The right-angled triangle under a vector: run across, rise up, hypotenuse.
 *
 * This single drawing is most of what the stand is trying to teach. Everything
 * about it is deliberate — the components are dashed so they read as construction
 * lines rather than as forces in their own right, the right-angle tick says the
 * triangle really is right-angled, and the labels carry live numbers so the
 * relationship is arithmetic rather than decorative.
 */
export function drawComponents(r, origin, vec, colour, opts = {}) {
  const scale = opts.scale ?? 1;
  const v = vec.scale(scale);
  if (v.len() * r.camera.scale < 12) return; // too short to decompose legibly

  const corner = origin.add(v2(v.x, 0));
  const tip = origin.add(v);
  const dim = alpha(colour, 0.5);
  const dash = [6, 5];

  // Run, then rise.
  r.arrow(origin, corner, {
    colour: dim, width: 2, dash, head: 9,
    label: opts.labels === false ? null : fmtComponent(opts.symbol ?? '', 'x', vec.x, opts.unit),
    labelSize: 12,
  });
  r.arrow(corner, tip, {
    colour: dim, width: 2, dash, head: 9,
    label: opts.labels === false ? null : fmtComponent(opts.symbol ?? '', 'y', vec.y, opts.unit),
    labelSize: 12,
  });

  if (Math.abs(v.x) * r.camera.scale > 18 && Math.abs(v.y) * r.camera.scale > 18) {
    r.rightAngle(corner, v2(-Math.sign(v.x), 0), v2(0, Math.sign(v.y)), 10, dim);
  }

  // The resultant, drawn last so it sits on top of its own construction.
  r.arrow(origin, tip, {
    colour,
    width: opts.width ?? 3.5,
    label: opts.labels === false ? null : fmtMagnitude(opts.symbol ?? '', vec.len(), opts.unit),
    labelSize: 13,
  });

  // The angle it makes with the horizontal.
  if (opts.angle !== false && v.len() * r.camera.scale > 45) {
    r.angleArc(origin, 0, vec.angle(), 26, alpha(colour, 0.75),
      `${toDeg(vec.angle()).toFixed(0)}°`);
  }
}

const fmtComponent = (sym, axis, value, unit = '') =>
  `${sym}${axis} = ${value.toFixed(1)}${unit ? ` ${unit}` : ''}`;

const fmtMagnitude = (sym, value, unit = '') =>
  `|${sym || 'v'}| = ${value.toFixed(1)}${unit ? ` ${unit}` : ''}`;

/** Velocity of a body, in the house cyan, with its components. */
export function drawVelocity(r, body, opts = {}) {
  if (body.isStatic || body.vel.len() < 0.05) return;
  drawComponents(r, body.pos, body.vel, C.velocity, {
    scale: opts.scale ?? 0.25,
    symbol: 'v',
    unit: opts.unit ?? 'm/s',
    ...opts,
  });
}

/** Net force on a body, in amber. */
export function drawForce(r, body, force, opts = {}) {
  if (force.len() < 1e-6) return;
  drawComponents(r, body.pos, force, C.force, {
    scale: opts.scale ?? 0.02,
    symbol: 'F',
    unit: opts.unit ?? 'N',
    ...opts,
  });
}

/** A plain labelled arrow, when the components would be clutter. */
export function drawVector(r, origin, vec, colour, label, opts = {}) {
  const scale = opts.scale ?? 1;
  r.arrow(origin, origin.add(vec.scale(scale)), {
    colour,
    width: opts.width ?? 3,
    label,
    labelSize: opts.labelSize ?? 13,
    dash: opts.dash,
  });
}

/** Contact points and the impulse that was applied there. */
export function drawContacts(r, world) {
  for (const m of world.manifolds) {
    for (const p of m.contacts) {
      r.dot(p, 3.5, C.bad);
    }
    if (m.contacts.length && m.appliedImpulse > 0.01) {
      const p = m.contacts[0];
      r.arrow(p, p.add(m.normal.scale(Math.min(m.appliedImpulse * 0.05, 1.5))), {
        colour: alpha(C.bad, 0.8), width: 2, head: 8,
      });
    }
  }
}

/**
 * Kinetic and potential energy as stacked bars, with the total marked.
 *
 * Drawn in screen space at a fixed spot. The total is the point: watching KE fall
 * as PE rises, with the sum holding still, is conservation of energy arriving
 * without anyone having said the words.
 */
export function drawEnergyBars(r, x, y, w, { kinetic, potential, reference }) {
  const total = kinetic + potential;
  const ref = reference ?? total;
  const h = 14;
  const gap = 26;

  r.text('ENERGY', x, y - 10, { size: 11, weight: 800, colour: C.textDim, letterSpacing: 1 });

  r.text('KE', x, y + h - 2, { size: 12, weight: 700, colour: C.energyK });
  r.bar(x + 30, y, w - 30, h, ref > 0 ? kinetic / ref : 0, C.energyK);
  r.text(`${kinetic.toFixed(0)} J`, x + w + 8, y + h - 2, { size: 12, colour: C.textDim, mono: true });

  r.text('PE', x, y + gap + h - 2, { size: 12, weight: 700, colour: C.energyP });
  r.bar(x + 30, y + gap, w - 30, h, ref > 0 ? potential / ref : 0, C.energyP);
  r.text(`${potential.toFixed(0)} J`, x + w + 8, y + gap + h - 2, { size: 12, colour: C.textDim, mono: true });

  // The sum, which is the thing that should not move.
  r.text('TOTAL', x, y + gap * 2 + h - 2, { size: 12, weight: 700, colour: C.text });
  r.bar(x + 30, y + gap * 2, w - 30, h, ref > 0 ? total / ref : 0, C.text);
  r.text(`${total.toFixed(0)} J`, x + w + 8, y + gap * 2 + h - 2, { size: 12, colour: C.text, mono: true, weight: 700 });
}

/**
 * A live readout block: rows of label/value pairs in a translucent card.
 * Returns the height used so callers can stack several.
 */
export function drawReadout(r, x, y, rows, opts = {}) {
  const w = opts.width ?? 220;
  const rowH = opts.rowH ?? 24;
  const padY = 14;
  const titleH = opts.title ? 24 : 0;
  const h = padY * 2 + titleH + rows.length * rowH;

  r.roundRect(x, y, w, h, 12, {
    fill: C.bgPanel,
    stroke: C.rule,
  });

  let cy = y + padY + 12;
  if (opts.title) {
    r.text(opts.title.toUpperCase(), x + 14, cy, {
      size: 11, weight: 800, colour: opts.titleColour ?? C.textDim,
    });
    cy += titleH;
  }

  for (const row of rows) {
    r.text(row.label, x + 14, cy + 12, {
      size: 13, colour: row.colour ?? C.textDim, weight: 500,
    });
    r.text(row.value, x + w - 14, cy + 12, {
      size: 14, colour: row.valueColour ?? row.colour ?? C.text,
      weight: 700, align: 'right', mono: true,
    });
    cy += rowH;
  }
  return h;
}

/** Trace of where a body has been, in its own colour. */
export function drawTrail(r, body, colour = C.velocity) {
  if (body.trail.length > 1) r.trail(body.trail, colour, { width: 2.5 });
}

export { Vec2, v2 };
