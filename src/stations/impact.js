// IMPACT — set up a collision that stops a puck dead.
//
// Two pucks on a frictionless track. You set the masses and the speed, and before
// anything moves the station solves the pair of simultaneous equations and prints
// what will happen. Then you press Go and watch it happen exactly as predicted.
//
// That order matters. Predict, then check, is how physics actually works, and it
// is far more convincing than a simulation that only tells you the answer after the
// fact. The maths on the panel is not describing the collision — it is forecasting
// it, and it is right every time.
//
// The target — stop puck A dead — has a clean answer: equal masses, head on,
// perfectly elastic. A swaps its velocity with B and stops. Newton's cradle, from
// two lines of algebra.

import { Station } from './station.js';
import { Body } from '../core/body.js';
import { World } from '../core/world.js';
import { Vec2, v2, clamp } from '../core/vec2.js';
import { C, alpha } from '../render/palette.js';
import { drawReadout } from '../render/xray.js';
import { el, slider, button, toast, segmented } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import {
  collision1D, momentum, kineticEnergy, energyLost, isStopped, centreOfMassVelocity,
} from './impact-math.js';

const TRACK_Y = 0;
const START_A = -7;
const START_B = 2.5;

export class ImpactStation extends Station {
  static id = 'impact';
  static title = 'Impact';
  static tagline = 'Stop the puck dead';
  static goal = 'Set the masses so the blue puck stops on impact.';
  static maths = 'Simultaneous equations · momentum · energy';
  static icon = '◐';

  constructor(app) {
    super(app);
    this.m1 = 3;
    this.m2 = 1;
    this.u1 = 5;
    this.e = 1;
    this.running = false;
  }

  build() {
    this.world = new World({
      gravity: v2(0, 0), fixedDt: 1 / 480, velocityIterations: 20,
    });

    this.a = Body.circle(START_A, TRACK_Y, 0.7, { restitution: this.e, friction: 0 });
    this.b = Body.circle(START_B, TRACK_Y, 0.7, { restitution: this.e, friction: 0 });
    this.a.colour = C.velocity;
    this.b.colour = C.target;
    this.a.setMass(this.m1);
    this.b.setMass(this.m2);
    this.world.add(this.a, this.b);

    /*
     * The collision has to be caught through the world's event, not by looking at
     * world.manifolds after each frame.
     *
     * The world runs eight 1/480 s substeps per 60 fps frame and rebuilds its
     * manifold list on every one of them. Two elastic pucks touch and separate
     * inside those substeps, so by the time a frame ends the list is empty again —
     * it was empty on every single frame of a 600-frame run. The station never saw
     * the collision, never judged it, and could never award a star, even though the
     * physics underneath was exactly right.
     */
    this.world.onImpact = () => {
      if (!this.running || this.collided) return;
      this.collided = true;
      this.app.sound?.('clack');
      this.settleAt = this.elapsed + 0.9;
    };

    this.running = false;
    this.collided = false;
    this.frozen = false;
    this.trailA = [];
    this.trailB = [];
    this.say(''); // the goal has its own permanent line
    this.refreshMaths?.();
  }

  /** Radius grows with the cube root of mass, so heavy reads as big but not absurd. */
  applyMasses() {
    this.a.radius = 0.5 + Math.cbrt(this.m1) * 0.24;
    this.b.radius = 0.5 + Math.cbrt(this.m2) * 0.24;
    this.a.computeMass();
    this.b.computeMass();
    this.a.setMass(this.m1);
    this.b.setMass(this.m2);
    this.a.restitution = this.e;
    this.b.restitution = this.e;
  }

  /** The forecast, from the analytic solution rather than from the simulation. */
  predict() {
    return collision1D(this.m1, this.u1, this.m2, 0, this.e);
  }

  go() {
    if (this.running) return;
    this.beginAttempt();
    this.reposition();
    this.applyMasses();
    this.a.vel = v2(this.u1, 0);
    this.b.vel = v2(0, 0);
    this.running = true;
    this.collided = false;
    this.app.sound?.('launch');
  }

  reposition() {
    this.frozen = false;
    this.collided = false;
    this.a.pos = v2(START_A, TRACK_Y);
    this.b.pos = v2(START_B, TRACK_Y);
    this.a.vel = v2(0, 0);
    this.b.vel = v2(0, 0);
    this.a.angle = 0;
    this.b.angle = 0;
    this.a.angVel = 0;
    this.b.angVel = 0;
    this.trailA = [];
    this.trailB = [];
  }

  update(dt) {
    // Held still after the verdict so the two velocity arrows stay on screen and
    // readable. There is no friction on this track, so left running the pink puck
    // simply coasts out of the frame and takes the answer with it.
    if (this.frozen) {
      this.elapsed += dt;
      return;
    }

    super.update(dt);
    if (!this.running) return;

    this.trailA.push(this.a.pos.clone());
    this.trailB.push(this.b.pos.clone());
    if (this.trailA.length > 240) this.trailA.shift();
    if (this.trailB.length > 240) this.trailB.shift();

    if (this.collided && this.elapsed > this.settleAt) {
      this.running = false;
      this.frozen = true;
      this.judge();
      return;
    }

    // Ran off the end without ever touching. Should not happen — they always
    // close on each other — but never leave an attempt hanging.
    if (!this.collided && (this.a.pos.x > 30 || this.b.pos.x > 30)) {
      this.running = false;
      this.reposition();
    }
  }

  judge() {
    const v1 = this.a.vel.x;
    if (isStopped(v1)) {
      const stars = this.succeed();
      toast(this.app.dom.stage,
        `Dead stop — <b>${stars} ★</b><br><span class="toast-sub">Equal masses, perfectly elastic: they swap velocities.</span>`,
        { tone: 'good', ms: 4600 });
      this.app.sound?.('hit');
    } else {
      this.say(
        `Blue is still moving at ${v1.toFixed(2)} m/s. Equal masses is the trick.`,
        'warn');
      this.app.sound?.('miss');
    }
    this.refreshMaths();
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();
    this.pLine = this.line('', { wide: true });
    this.eLine = this.line('', { wide: true });
    this.solveLine = this.line('', { big: true });
    this.lossLine = this.line('', { dim: true });

    card.append(
      this.section('Two equations, two unknowns', this.pLine, this.eLine),
      this.section('Solved', this.solveLine, this.lossLine),
      el('p', { class: 'math-note', text: 'The prediction is made before you press Go.' }),
    );

    const bar = this.controls();
    this.m1Slider = slider({
      label: 'Blue mass m₁', min: 0.5, max: 6, step: 0.1, value: this.m1,
      unit: 'kg', dp: 1, tone: 'velocity',
      onInput: (v) => {
        this.m1 = v;
        this.applyMasses();
        this.refreshMaths();
      },
    });
    this.m2Slider = slider({
      label: 'Pink mass m₂', min: 0.5, max: 6, step: 0.1, value: this.m2,
      unit: 'kg', dp: 1, tone: 'target',
      onInput: (v) => {
        this.m2 = v;
        this.applyMasses();
        this.refreshMaths();
      },
    });
    this.uSlider = slider({
      label: 'Blue speed u₁', min: 1, max: 9, step: 0.1, value: this.u1,
      unit: 'm/s', dp: 1,
      onInput: (v) => {
        this.u1 = v;
        this.refreshMaths();
      },
    });

    bar.append(
      this.m1Slider, this.m2Slider, this.uSlider,
      el('div', { class: 'control-buttons' },
        segmented([
          { label: 'Bouncy  e = 1', value: 1 },
          { label: 'Sticky  e = 0', value: 0 },
        ], this.e, (v) => {
          this.e = v;
          this.applyMasses();
          this.refreshMaths();
        }),
        button('Go', () => this.go(), { variant: 'primary', icon: '▶' })),
    );

    this.refreshMaths();
  }

  refreshMaths() {
    if (!this.pLine) return;
    const { v1, v2: v2out } = this.predict();
    const p = momentum(this.m1, this.u1, this.m2, 0);

    this.pLine.innerHTML = M.eq(
      M.sym('m'), M.sub('1'), M.sym('u'), M.sub('1'), M.op('+'),
      M.sym('m'), M.sub('2'), M.sym('u'), M.sub('2'), M.op('='),
      M.sym('m'), M.sub('1'), M.sym('v'), M.sub('1'), M.op('+'),
      M.sym('m'), M.sub('2'), M.sym('v'), M.sub('2'),
      `<span class="math-aside">momentum</span>`,
    );

    this.eLine.innerHTML = this.e === 1
      ? M.eq(
        M.sym('u'), M.sub('1'), M.op('−'), M.sym('u'), M.sub('2'), M.op('='),
        M.sym('v'), M.sub('2'), M.op('−'), M.sym('v'), M.sub('1'),
        `<span class="math-aside">bounce</span>`,
      )
      : M.eq(
        M.sym('v'), M.sub('1'), M.op('='), M.sym('v'), M.sub('2'),
        `<span class="math-aside">they stick</span>`,
      );

    const stopping = isStopped(v1, 0.2);
    this.solveLine.innerHTML = `${M.eq(
      M.sym('v'), M.sub('1'), M.op('='),
      M.num(v1, 2, stopping ? 'good' : 'velocity'), M.unit('m/s'),
    )}<br>${M.eq(
      M.sym('v'), M.sub('2'), M.op('='), M.num(v2out, 2, 'target'), M.unit('m/s'),
    )}`;

    const lost = energyLost(this.m1, this.u1, this.m2, 0, this.e);
    this.lossLine.innerHTML = M.eq(
      M.sym('p'), M.op('='), M.num(p, 1), M.unit('kg m/s'),
      M.op('·'), 'heat ', M.num(lost, 1), M.unit('J'),
    );
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    // A light puck struck by a heavy one can leave at 16 m/s. Widen the frame to
    // whatever the pucks actually need rather than letting one slide out of view.
    const lo = Math.min(-12, this.a.pos.x - 2.5, this.b.pos.x - 2.5);
    const hi = Math.max(12, this.a.pos.x + 2.5, this.b.pos.x + 2.5);
    r.fit(v2(lo, -4), v2(hi, 5), 40, this.app.insets());
    r.grid(1, 5);

    // The track.
    r.path([v2(-14, -0.75), v2(14, -0.75)], { stroke: C.groundEdge, width: 4 });
    r.path([v2(-14, TRACK_Y), v2(14, TRACK_Y)],
      { stroke: alpha(C.text, 0.12), width: 1.5, dash: [6, 8] });

    if (this.trailA.length > 1) r.trail(this.trailA, C.velocity, { width: 3 });
    if (this.trailB.length > 1) r.trail(this.trailB, C.target, { width: 3 });

    this.drawPuck(this.a, this.m1, 'A', C.velocity);
    this.drawPuck(this.b, this.m2, 'B', C.target);

    // The centre of mass, which sails through the collision untouched. Quietly one
    // of the best things on the whole stand once someone notices it.
    if (this.app.xray && this.running) {
      const total = this.m1 + this.m2;
      const com = this.a.pos.scale(this.m1 / total).add(this.b.pos.scale(this.m2 / total));
      r.path([v2(com.x, -2.4), v2(com.x, 2.4)],
        { stroke: alpha(C.warn, 0.75), width: 2, dash: [5, 5] });
      r.worldText('centre of mass', v2(com.x, 2.4), {
        dy: -10, size: 12, colour: C.warn, align: 'center', halo: true, weight: 700,
      });
    }

    if (this.app.xray) this.drawXray();
  }

  drawPuck(body, mass, label, colour) {
    const r = this.r;
    r.circle(body.pos, body.radius, {
      fill: alpha(colour, 0.22), stroke: colour, width: 3.5,
    });
    r.worldText(`${label}  ${mass.toFixed(1)} kg`, body.pos, {
      dy: 5, size: 14, weight: 800, colour, align: 'center', halo: true,
    });

    if (Math.abs(body.vel.x) > 0.05) {
      r.arrow(body.pos, body.pos.add(v2(body.vel.x * 0.5, 0)), {
        colour, width: 4,
        label: `${body.vel.x.toFixed(2)} m/s`, labelSize: 13,
      });
    }
  }

  drawXray() {
    const r = this.r;
    const ins = this.app.insets();
    const pNow = this.m1 * this.a.vel.x + this.m2 * this.b.vel.x;
    const kNow = kineticEnergy(this.m1, this.a.vel.x, this.m2, this.b.vel.x);
    const p0 = momentum(this.m1, this.u1, this.m2, 0);
    const k0 = kineticEnergy(this.m1, this.u1, this.m2, 0);

    drawReadout(r, r.width - ins.right - 260, ins.top + 20, [
      { label: 'momentum now', value: `${pNow.toFixed(2)}`, colour: C.momentum },
      { label: 'momentum before', value: `${p0.toFixed(2)}`, colour: alpha(C.momentum, 0.6) },
      { label: 'energy now', value: `${kNow.toFixed(2)} J`, colour: C.energyK },
      { label: 'energy before', value: `${k0.toFixed(2)} J`, colour: alpha(C.energyK, 0.6) },
      { label: 'v of centre of mass', value: `${centreOfMassVelocity(this.m1, this.u1, this.m2, 0).toFixed(2)}` },
    ], { title: 'X-ray · conserved?', width: 240 });
  }

  // --- attract ------------------------------------------------------------------

  attract(dt) {
    this.update(dt);
    if (this.running) return;
    this.attractWait = (this.attractWait ?? 0) - dt;
    if (this.attractWait > 0) return;
    this.attractWait = 4.2;

    // Cycle through the three cases worth seeing: heavy into light, light into
    // heavy, and the equal-mass swap that solves the puzzle.
    this.attractCase = ((this.attractCase ?? 0) + 1) % 3;
    [this.m1, this.m2] = [[4, 1], [1, 4], [2, 2]][this.attractCase];
    this.m1Slider?.set(this.m1);
    this.m2Slider?.set(this.m2);
    this.applyMasses();
    this.refreshMaths();
    this.go();
    this.attempts = 0;
    this.solved = false;
  }
}
