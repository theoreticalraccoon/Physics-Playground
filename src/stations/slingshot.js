// SLINGSHOT — fling a probe past a planet and through the ring.
//
// Two things this station is for.
//
// The distance formula turns up doing real work. r = √((x−x₀)² + (y−y₀)²) is the
// same r that goes into F = GMm/r², so a piece of coordinate geometry that usually
// only ever finds the length of a line is suddenly deciding where a spacecraft goes.
//
// And squaring makes a difference you can feel. Halve the distance and the pull
// quadruples, which is why a probe that skims the planet whips round so violently
// while one that passes wide barely notices. The force arrow is drawn to scale, so
// the growth is visible rather than asserted.
//
// The word for the shape of the path is printed live while you drag. Watching it
// change from "ellipse" to "parabola" to "hyperbola" as you cross escape velocity
// is a conic-sections lesson that takes four seconds.

import { Station } from './station.js';
import { Body } from '../core/body.js';
import { World, pointGravityField } from '../core/world.js';
import { Vec2, v2, toDeg, clamp } from '../core/vec2.js';
import { C, alpha } from '../render/palette.js';
import { drawReadout } from '../render/xray.js';
import { el, button, toast, toggle } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import { INTEGRATORS } from '../core/integrators.js';
import {
  distance, gravityAt, circularSpeed, escapeSpeed, eccentricity, conicType,
  specificEnergy, periapsis, semiMajorAxis, orbitalPeriod,
} from './orbit-math.js';

const PLANET = v2(0, 0);
const PLANET_R = 2.2;
const GM = 260;
const START = v2(-19, -11);
const MAX_LAUNCH = 13;
const RING_R = 1.7;

export class SlingshotStation extends Station {
  static id = 'slingshot';
  static title = 'Slingshot';
  static tagline = 'Round the planet, through the ring';
  static goal = 'Drag from the probe to aim, and let the planet bend the path.';
  static maths = 'Inverse square · distance formula · conics';
  static icon = '◔';

  constructor(app) {
    super(app);
    /*
     * The opening aim, found by searching the trajectory space rather than guessed.
     * It bends a full half-turn around the planet, keeps 8.5 m clear of the surface,
     * and misses the ring by 5.5 m.
     *
     * A near miss is deliberate. Opening on the answer would mean pressing Launch
     * solves the station; opening on a crash makes the whole thing look impossible.
     * A dramatic curve that lands just short says "you are nearly there, move it a
     * bit", which is the only instruction this station ever needs to give.
     */
    this.launchVel = v2(1.13, 3.94);
    this.dragging = false;
    this.flying = false;
    this.showField = false;
  }

  build() {
    this.ring = v2(15, 9);
    this.world = new World({ gravity: v2(0, 0), fixedDt: 1 / 240 });
    this.world.addField(pointGravityField(PLANET, GM, 0.6));

    this.probe = Body.circle(START.x, START.y, 0.42, { density: 0.4 });
    this.probe.ignoreGravity = false;
    this.world.add(this.probe);

    this.flying = false;
    this.passed = false;
    this.trail = [];
    this.say(''); // the goal has its own permanent line
    this.refreshMaths?.();
  }

  // --- aiming -------------------------------------------------------------------

  onPointerDown(world) {
    if (this.flying) return;
    if (world.dist(START) < 6) this.dragging = true;
  }

  onPointerMove(world) {
    if (!this.dragging) return;
    this.launchVel = world.sub(START).clampLen(MAX_LAUNCH);
    this.refreshMaths();
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.launchVel.len() > 1) this.launch();
  }

  launch() {
    if (this.flying) return;
    this.beginAttempt();
    this.probe.pos = START.clone();
    this.probe.vel = this.launchVel.clone();
    this.flying = true;
    this.passed = false;
    this.trail = [];
    this.app.sound?.('launch');
  }

  reset() {
    this.probe.pos = START.clone();
    this.probe.vel = v2(0, 0);
    this.flying = false;
    this.trail = [];
  }

  update(dt) {
    super.update(dt);
    if (!this.flying) return;

    this.trail.push(this.probe.pos.clone());
    if (this.trail.length > 1400) this.trail.shift();

    const r = this.probe.pos.dist(PLANET);

    if (r < PLANET_R + this.probe.radius) {
      this.flying = false;
      this.say('Crashed into the planet. Go wider or faster.', 'warn');
      this.app.sound?.('miss');
      setTimeout(() => this.reset(), 900);
      return;
    }

    if (!this.passed && this.probe.pos.dist(this.ring) < RING_R) {
      this.passed = true;
      this.flying = false;
      const stars = this.succeed();
      const e = eccentricity(this.probe.pos, this.probe.vel, PLANET, GM);
      toast(this.app.dom.stage,
        `Through the ring — <b>${stars} ★</b>`
        + `<br><span class="toast-sub">That path was ${indefinite(conicType(e))}, e = ${e.toFixed(2)}.</span>`,
        { tone: 'good', ms: 4600 });
      this.app.sound?.('hit');
      return;
    }

    if (this.probe.pos.len() > 70) {
      this.flying = false;
      this.say('Gone. It escaped the planet altogether.', 'warn');
      this.app.sound?.('miss');
      setTimeout(() => this.reset(), 700);
    }
  }

  // --- prediction ---------------------------------------------------------------

  /**
   * Where the probe would go, integrated forward with RK4 before it is launched.
   *
   * This is the flight plan, and it is what makes the station playable rather than
   * a guessing game: you can see the inverse-square law bend the path while you are
   * still deciding, so aiming becomes reasoning.
   */
  predictPath(vel, steps = 900, dt = 0.02) {
    const accel = (pos) => {
      const d = PLANET.sub(pos);
      const r2 = d.len2() + 0.36;
      return d.scale(GM / (r2 * Math.sqrt(r2)));
    };
    let state = { pos: START.clone(), vel: vel.clone() };
    const path = [state.pos.clone()];
    let hitPlanet = false;

    for (let i = 0; i < steps; i++) {
      state = INTEGRATORS.rk4.step(state, dt, accel, i * dt);
      path.push(state.pos.clone());
      if (state.pos.dist(PLANET) < PLANET_R) {
        hitPlanet = true;
        break;
      }
      if (state.pos.len() > 60) break;
    }
    return { path, hitPlanet };
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();
    this.rLine = this.line('');
    this.fLine = this.line('', { big: true });
    this.escLine = this.line('');
    this.conicLine = this.line('', { dim: true });

    card.append(
      this.section('How far away', this.rLine),
      this.section('The pull, squared', this.fLine,
        el('p', { class: 'math-note', text: 'Halve r and F goes up four times.' })),
      this.section('Fast enough to leave?', this.escLine, this.conicLine),
    );

    const bar = this.controls();
    bar.append(
      el('div', { class: 'hint-block' },
        el('p', { class: 'hint-title', text: 'Drag from the probe' }),
        el('p', { class: 'hint-body', text: 'The longer the drag, the faster it goes. The dotted line is where it will end up.' })),
      el('div', { class: 'control-buttons' },
        toggle('Gravity field', this.showField, (on) => {
          this.showField = on;
        }),
        button('Reset', () => this.reset(), { variant: 'ghost', icon: '↺' }),
        button('Launch', () => this.launch(), { variant: 'primary', icon: '▶' })),
    );
    this.refreshMaths();
  }

  refreshMaths() {
    if (!this.rLine) return;
    const pos = this.flying ? this.probe.pos : START;
    const vel = this.flying ? this.probe.vel : this.launchVel;
    const r = distance(pos, PLANET);
    const F = gravityAt(GM, r) * this.probe.mass;
    const vEsc = escapeSpeed(GM, r);
    const speed = vel.len();
    const e = eccentricity(pos, vel, PLANET, GM);

    this.rLine.innerHTML = M.eq(
      M.sym('r'), M.op('='),
      M.sqrt(`(${M.sym('x')}−${M.sym('x')}${M.sub('0')})${M.sup('2')} + (${M.sym('y')}−${M.sym('y')}${M.sub('0')})${M.sup('2')}`),
      M.op('='), M.num(r, 1, 'accent'), M.unit('m'),
    );

    this.fLine.innerHTML = M.eq(
      M.sym('F'), M.op('='),
      M.frac(`${M.sym('GMm')}`, `${M.sym('r')}${M.sup('2')}`),
      M.op('='), M.num(F, 2, 'force'), M.unit('N'),
    );

    const escaping = speed >= vEsc;
    this.escLine.innerHTML = M.eq(
      M.sym('v'), M.sub('esc'), M.op('='),
      M.sqrt(`2${M.sym('GM')} / ${M.sym('r')}`),
      M.op('='), M.num(vEsc, 2, 'target'), M.unit('m/s'),
    );

    this.conicLine.className = `math-line is-dim${escaping ? ' is-good' : ''}`;
    this.conicLine.innerHTML = M.eq(
      M.sym('v'), M.op('='), M.num(speed, 2, 'velocity'), M.unit('m/s'),
      M.op('·'), `path is ${indefinite(conicType(e))}`,
      M.op('·'), M.sym('e'), M.op('='), M.num(e, 2),
    );
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    r.fit(v2(-24, -16), v2(24, 16), 30, this.app.insets());
    r.grid(4, 5);

    if (this.showField) this.drawField();
    this.drawRing();
    this.drawPlanet();

    if (!this.flying) this.drawPrediction();
    if (this.trail.length > 1) r.trail(this.trail, C.velocity, { width: 3 });

    this.drawProbe();

    if (this.app.xray) this.drawXray();
  }

  /** A lattice of arrows showing which way and how hard the field pulls. */
  drawField() {
    const r = this.r;
    const step = 3.6;
    for (let x = -22; x <= 22; x += step) {
      for (let y = -15; y <= 15; y += step) {
        const p = v2(x, y);
        const d = PLANET.sub(p);
        const dist = d.len();
        if (dist < PLANET_R + 1.2) continue;
        const a = gravityAt(GM, dist);
        // Cube-root the length so the near-planet arrows do not swamp the frame.
        const len = clamp(Math.cbrt(a) * 0.75, 0.3, 2.6);
        r.arrow(p, p.add(d.norm().scale(len)), {
          colour: alpha(C.force, clamp(a / 40, 0.12, 0.75)),
          width: 1.8, head: 7,
        });
      }
    }
  }

  drawPlanet() {
    const r = this.r;
    // A few faint shells, labelled, so "inverse square" has something to count on.
    for (const k of [2, 3, 4]) {
      r.ring(PLANET, PLANET_R * k, alpha(C.text, 0.07), { width: 1.5, dash: [4, 8] });
    }
    r.circle(PLANET, PLANET_R, {
      fill: '#3b4a7a', stroke: '#6d84c4', width: 3,
    });
    r.circle(PLANET, PLANET_R * 0.55, { fill: alpha('#8fa3e0', 0.35) });
    r.worldText('M', PLANET, {
      dy: 6, size: 20, weight: 800, colour: '#dbe4ff', align: 'center',
    });
  }

  drawRing() {
    const r = this.r;
    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.06;
    const done = this.passed;
    r.ring(this.ring, RING_R * pulse, done ? C.good : C.target, { width: 4 });
    r.ring(this.ring, RING_R * 0.55 * pulse, alpha(done ? C.good : C.target, 0.5), { width: 2 });
    r.worldText('RING', this.ring, {
      dy: -r.px(RING_R) - 14, size: 13, weight: 800,
      colour: done ? C.good : C.target, align: 'center', halo: true,
    });
  }

  drawPrediction() {
    const r = this.r;
    const { path, hitPlanet } = this.predictPath(this.launchVel);
    r.path(path, {
      stroke: alpha(hitPlanet ? C.bad : C.accent, 0.8),
      width: 2.5, dash: [8, 8],
    });
    if (path.length) r.dot(path[path.length - 1], 4, alpha(hitPlanet ? C.bad : C.accent, 0.9));

    // The launch velocity, as a rubber band from the probe.
    r.arrow(START, START.add(this.launchVel), {
      colour: C.velocity, width: 4,
      label: `${this.launchVel.len().toFixed(1)} m/s`, labelSize: 13,
    });
  }

  drawProbe() {
    const r = this.r;
    const p = this.flying ? this.probe.pos : START;
    r.circle(p, this.probe.radius, { fill: C.accent, stroke: '#fff', width: 2 });

    if (!this.flying) {
      r.ring(START, 0.95 + Math.sin(this.elapsed * 4) * 0.08,
        alpha(C.accent, 0.4), { width: 2, dash: [5, 5] });
      return;
    }

    // In flight, the two arrows that explain everything: where it is going, and
    // which way it is being pulled.
    const d = PLANET.sub(p);
    const dist = d.len();
    const a = gravityAt(GM, dist);
    r.arrow(p, p.add(this.probe.vel.scale(0.55)), {
      colour: C.velocity, width: 3.5,
      label: this.app.xray ? `v = ${this.probe.vel.len().toFixed(1)}` : null,
      labelSize: 12,
    });
    r.arrow(p, p.add(d.norm().scale(clamp(Math.cbrt(a) * 1.1, 0.5, 5))), {
      colour: C.force, width: 3,
      label: this.app.xray ? `F ∝ 1/r²` : null, labelSize: 12,
    });
    // The radius itself, since it is the quantity the whole station turns on.
    r.path([p, PLANET], { stroke: alpha(C.text, 0.2), width: 1.5, dash: [5, 6] });
    r.worldText(`r = ${dist.toFixed(1)}`, p.lerp(PLANET, 0.5), {
      dy: -8, size: 12, colour: alpha(C.text, 0.6), align: 'center', halo: true,
    });
  }

  drawXray() {
    const pos = this.flying ? this.probe.pos : START;
    const vel = this.flying ? this.probe.vel : this.launchVel;
    const r = distance(pos, PLANET);
    const e = eccentricity(pos, vel, PLANET, GM);
    const a = semiMajorAxis(pos, vel, PLANET, GM);
    const ins = this.app.insets();

    this.r.text('', 0, 0);
    drawReadout(this.r, this.r.width - ins.right - 260, ins.top + 20, [
      { label: 'r', value: `${r.toFixed(2)} m`, colour: C.accent },
      { label: 'g at r', value: `${gravityAt(GM, r).toFixed(2)} m/s²`, colour: C.force },
      { label: 'circular speed', value: `${circularSpeed(GM, r).toFixed(2)} m/s` },
      { label: 'escape speed', value: `${escapeSpeed(GM, r).toFixed(2)} m/s`, colour: C.target },
      { label: 'eccentricity', value: e.toFixed(3) },
      { label: 'shape', value: conicType(e), colour: C.good },
      { label: 'closest approach', value: `${periapsis(pos, vel, PLANET, GM).toFixed(2)} m` },
      {
        label: 'period',
        value: Number.isFinite(a) && a > 0
          ? `${orbitalPeriod(a, GM).toFixed(1)} s`
          : 'never returns',
      },
    ], { title: 'X-ray · orbit', width: 250 });
  }

  // --- attract ------------------------------------------------------------------

  attract(dt) {
    this.update(dt);
    if (this.flying) return;
    this.attractWait = (this.attractWait ?? 0) - dt;
    if (this.attractWait > 0) {
      // Swing the aim around so the predicted conic is visibly changing shape.
      const t = this.elapsed * 0.5;
      this.launchVel = v2(6.4 + Math.sin(t) * 2.6, 3.6 + Math.cos(t * 0.8) * 1.6);
      this.refreshMaths();
      return;
    }
    this.attractWait = 7;
    this.launch();
    this.attempts = 0;
    this.solved = false;
  }
}

/** "an ellipse" / "a hyperbola" — small thing, but it reads as written English. */
const indefinite = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
