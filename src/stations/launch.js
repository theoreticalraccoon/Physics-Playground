// LAUNCH — a cannon, a target, and a quadratic.
//
// Aiming the cannon is editing the coefficients of y = ax + bx². The dotted curve
// on screen is the graph of the equation in the panel, drawn from the same two
// numbers, so a kid dragging their finger is dragging a parabola about.
//
// The cannon and the target sit at exactly the same height on purpose. R = v²sin2θ/g
// is the distance back to *launch height*, so a target level with the muzzle makes
// the printed formula exactly true rather than nearly true. An exhibit that teaches
// a formula and then quietly misses by half a metre is worse than no exhibit.
//
// The payoff is the complementary angle: having hit the target at 34°, the kid is
// shown that 56° hits it too, because sin(2θ) = sin(180° − 2θ). It is the moment
// the formula stops being a rule and starts being a reason.

import { Station } from './station.js';
import { Body } from '../core/body.js';
import { World } from '../core/world.js';
import { Vec2, v2, toDeg, toRad, clamp, rng } from '../core/vec2.js';
import { C, alpha } from '../render/palette.js';
import { drawVelocity, drawReadout } from '../render/xray.js';
import { el, slider, button, toast, toggle } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import {
  range, apex, flightTime, quadraticCoefficients, trajectoryPoints,
  solveLaunchAngle, complementAngle, heightAt,
} from './launch-math.js';
import { INTEGRATORS, trace, exactProjectile } from '../core/integrators.js';

const G = 9.81;
const MUZZLE = v2(0, 1.4);
const MIN_SPEED = 8;
const MAX_SPEED = 26;
const TARGET_RADIUS = 0.85;

export class LaunchStation extends Station {
  static id = 'launch';
  static title = 'Launch';
  static tagline = 'Hit the target';
  static goal = 'Aim the cannon so the ball lands in the ring.';
  static maths = 'Quadratics · trigonometry · roots';
  static icon = '◥';

  constructor(app) {
    super(app);
    this.angle = toRad(40);
    this.speed = 18;
    this.aiming = false;
    this.flight = null;
    this.showRace = false;
    this.provedComplement = false;
    this.lastResult = null;
    this.seed = Math.floor(Math.random() * 1e6);
  }

  build() {
    const rand = rng(this.seed);
    // Reachable at a comfortable speed but never trivially at 45 degrees.
    this.targetD = 14 + rand() * 16;

    this.world = new World({ gravity: v2(0, -G), fixedDt: 1 / 240 });
    this.world.add(Body.box(0, -1, 200, 2, { isStatic: true, friction: 0.7 }));

    this.ball = null;
    this.flight = null;
    this.provedComplement = false;
    this.lastResult = null;
    this.trail = [];

    this.target = MUZZLE.add(v2(this.targetD, 0));
    this.say(''); // the goal has its own permanent line
  }

  // --- aiming -------------------------------------------------------------------

  /** Point the barrel at the finger; the drag length sets the speed. */
  aimAt(world) {
    const d = world.sub(MUZZLE);
    if (d.len() < 0.4) return;
    this.angle = clamp(d.angle(), toRad(3), toRad(87));
    this.speed = clamp(MIN_SPEED + d.len() * 1.6, MIN_SPEED, MAX_SPEED);
    this.syncSliders();
  }

  onPointerDown(world) {
    if (this.flight) return;
    this.aiming = true;
    this.aimAt(world);
  }

  onPointerMove(world) {
    if (this.aiming && !this.flight) this.aimAt(world);
  }

  onPointerUp() {
    if (!this.aiming) return;
    this.aiming = false;
  }

  syncSliders() {
    this.angleSlider?.set(toDeg(this.angle));
    this.speedSlider?.set(this.speed);
    this.refreshMaths();
  }

  // --- firing -------------------------------------------------------------------

  fire(angle = this.angle, speed = this.speed, isProof = false) {
    if (this.flight) return;
    if (!isProof) this.beginAttempt();

    this.trail = [];
    this.ball = Body.circle(MUZZLE.x, MUZZLE.y, 0.28, {
      density: 2, restitution: 0.35, friction: 0.4,
    });
    this.ball.vel = Vec2.fromAngle(angle, speed);
    this.world.add(this.ball);

    this.flight = { t: 0, hit: false, angle, speed, isProof, resolved: false };
    this.app.sound?.('launch');
  }

  update(dt) {
    super.update(dt);
    if (!this.flight || !this.ball) return;

    this.flight.t += dt;
    this.trail.push(this.ball.pos.clone());
    if (this.trail.length > 400) this.trail.shift();

    // Hit test against the ring. At 1/240 s substeps the ball moves a few
    // centimetres per step, so a simple radius test cannot tunnel through.
    if (!this.flight.hit && this.ball.pos.dist(this.target) < TARGET_RADIUS) {
      this.flight.hit = true;
      this.onHit();
    }

    const landed = this.ball.pos.y < 0.3 && this.ball.vel.y <= 0;
    const gone = this.ball.pos.x > this.targetD + 40 || this.flight.t > 12;
    if (!this.flight.resolved && (landed || gone) && !this.flight.hit) {
      this.flight.resolved = true;
      this.onMiss();
    }
  }

  onHit() {
    this.app.sound?.('hit');
    if (this.flight.isProof) {
      toast(this.app.dom.stage,
        `Hit again, at <b>${toDeg(this.flight.angle).toFixed(0)}°</b>. Two angles, one target.`,
        { tone: 'good', ms: 4200 });
      return;
    }

    const stars = this.succeed({ angle: this.flight.angle });
    this.lastResult = { kind: 'hit', angle: this.flight.angle, speed: this.flight.speed };
    toast(this.app.dom.stage, `Direct hit — <b>${stars} ★</b>`, { tone: 'good' });
    this.refreshMaths();
  }

  onMiss() {
    const landedAt = this.ball.pos.x - MUZZLE.x;
    const err = landedAt - this.targetD;
    this.lastResult = { kind: 'miss', err };
    this.say(err < 0
      ? `Short by ${Math.abs(err).toFixed(1)} m — more angle or more speed.`
      : `Long by ${err.toFixed(1)} m — ease off.`, 'warn');
    this.app.sound?.('miss');
    this.refreshMaths();
    // Give the ball a moment to settle so the miss is visible, then clear it.
    setTimeout(() => this.clearShot(), 900);
  }

  clearShot() {
    if (this.ball) this.world.remove(this.ball);
    this.ball = null;
    this.flight = null;
  }

  /** Fire the other angle that hits the same target. The reveal. */
  proveComplement() {
    if (!this.solved || this.flight) return;
    this.provedComplement = true;
    this.clearShot();
    this.fire(complementAngle(this.lastResult.angle), this.lastResult.speed, true);
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();

    this.eqLine = this.line('', { big: true });
    this.rangeLine = this.line('');
    this.targetLine = this.line('');
    this.gapLine = this.line('', { dim: true });

    card.append(
      this.section('The path is a parabola', this.eqLine,
        el('p', { class: 'math-note', text: 'x measured from the muzzle, y above it.' })),
      this.section('Where it lands', this.rangeLine, this.targetLine, this.gapLine),
    );

    this.proofBtn = button('Show the other angle', () => this.proveComplement(),
      { variant: 'ghost', class: 'is-hidden' });
    card.append(this.proofBtn);

    const bar = this.controls();
    this.angleSlider = slider({
      label: 'Angle θ', min: 3, max: 87, step: 0.5, value: toDeg(this.angle),
      unit: '°', dp: 0, tone: 'accent',
      onInput: (v) => {
        this.angle = toRad(v);
        this.refreshMaths();
      },
    });
    this.speedSlider = slider({
      label: 'Speed v', min: MIN_SPEED, max: MAX_SPEED, step: 0.1, value: this.speed,
      unit: 'm/s', dp: 1, tone: 'velocity',
      onInput: (v) => {
        this.speed = v;
        this.refreshMaths();
      },
    });

    bar.append(
      this.angleSlider,
      this.speedSlider,
      el('div', { class: 'control-buttons' },
        toggle('Integrator race', this.showRace, (on) => {
          this.showRace = on;
          this.say(on
            ? 'Four ways to compute the same shot, all stepping at 0.25 s.'
            : this.constructor.goal);
        }),
        button('Fire', () => this.fire(), { variant: 'primary', icon: '▲' })),
    );

    this.refreshMaths();
  }

  refreshMaths() {
    if (!this.eqLine) return;
    const { a, b } = quadraticCoefficients(this.speed, this.angle, G);
    const R = range(this.speed, this.angle, G);
    const gap = R - this.targetD;

    this.eqLine.innerHTML = M.quadratic(a, b);

    this.rangeLine.innerHTML = M.eq(
      M.sym('R'), M.op('='),
      M.frac(`${M.sym('v')}${M.sup('2')} sin 2${M.sym('θ')}`, M.sym('g')),
      M.op('='), M.num(R, 1, 'accent'), M.unit('m'),
    );

    this.targetLine.innerHTML = M.eq(
      M.sym('d'), M.op('='), M.num(this.targetD, 1, 'target'), M.unit('m'),
      `<span class="math-aside">target</span>`,
    );

    const tone = Math.abs(gap) < 0.4 ? 'good' : 'dim';
    this.gapLine.className = `math-line is-dim${tone === 'good' ? ' is-good' : ''}`;
    this.gapLine.innerHTML = M.eq(
      M.sym('R'), M.op('−'), M.sym('d'), M.op('='),
      M.signed(gap, 1, tone === 'good' ? 'good' : ''), M.unit('m'),
    );

    this.proofBtn?.classList.toggle('is-hidden', !this.solved || this.provedComplement);
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    const far = Math.max(this.targetD, range(this.speed, this.angle, G)) + 6;
    r.fit(v2(-4, 0), v2(far, Math.max(apex(this.speed, this.angle, G) + 4, 12)),
      50, this.app.insets(), { anchor: { y: 0, frac: 0.92 } });

    r.grid(2, 5);
    this.drawGround();
    this.drawLaunchHeightLine();

    if (this.showRace) this.drawIntegratorRace();
    else this.drawPrediction();

    this.drawTarget();
    this.drawCannon();

    if (this.ball) {
      r.trail(this.trail, C.velocity, { width: 3 });
      r.body(this.ball, { fill: C.accent, stroke: '#fff', width: 2 });
      if (this.app.xray) drawVelocity(r, this.ball, { scale: 0.28 });
    }

    if (this.app.xray) this.drawXrayPanel();
  }

  drawGround() {
    const r = this.r;
    const tl = r.toWorld(0, 0);
    const br = r.toWorld(r.width, r.height);
    r.poly([v2(tl.x, 0), v2(br.x, 0), v2(br.x, br.y - 1), v2(tl.x, br.y - 1)],
      { fill: C.ground });
    r.path([v2(tl.x, 0), v2(br.x, 0)], { stroke: C.groundEdge, width: 3 });
  }

  /**
   * The dashed line at muzzle height, with the two roots marked on it. This is the
   * bridge between "where the ball goes" and "solving a quadratic": the roots of
   * y = ax + bx² are exactly the two places the ball is at launch height.
   */
  drawLaunchHeightLine() {
    const r = this.r;
    const R = range(this.speed, this.angle, G);
    const far = Math.max(this.targetD, R) + 4;
    r.path([v2(-4, MUZZLE.y), v2(far, MUZZLE.y)],
      { stroke: alpha(C.text, 0.16), width: 1.5, dash: [7, 7] });

    for (const [x, label] of [[0, 'x = 0'], [R, `x = ${R.toFixed(1)}`]]) {
      const p = v2(MUZZLE.x + x, MUZZLE.y);
      r.dot(p, 5, C.accent);
      r.worldText(label, p, {
        dy: -14, size: 12, weight: 700, colour: C.accent, align: 'center', halo: true,
      });
    }
    r.worldText('roots of the quadratic', v2(MUZZLE.x + R / 2, MUZZLE.y), {
      dy: 20, size: 12, colour: alpha(C.text, 0.45), align: 'center',
    });
  }

  drawPrediction() {
    const r = this.r;
    const pts = trajectoryPoints(MUZZLE, this.speed, this.angle, G, 110)
      .map((p) => v2(p.x, p.y));
    r.path(pts, { stroke: alpha(C.accent, 0.75), width: 2.5, dash: [9, 8] });

    // Apex, because the turning point of a quadratic is worth naming.
    const h = apex(this.speed, this.angle, G);
    const xApex = range(this.speed, this.angle, G) / 2;
    const top = v2(MUZZLE.x + xApex, MUZZLE.y + h);
    r.dot(top, 4, alpha(C.accent, 0.9));
    r.worldText(`apex ${h.toFixed(1)} m`, top, {
      dy: -12, size: 12, colour: alpha(C.accent, 0.9), align: 'center', halo: true,
    });
  }

  /**
   * Four integrators and the exact curve, all at a deliberately coarse 0.25 s step.
   *
   * The fan opens up as the shot flies because the error of each first-order method
   * grows like g·dt·t/2 — linearly in time. Euler is the high one and semi-implicit
   * the low one, and they are wrong by exactly the same amount in opposite
   * directions, which is a much more interesting fact than "Euler is bad".
   */
  drawIntegratorRace() {
    const r = this.r;
    const g = v2(0, -G);
    const accel = () => g;
    const start = { pos: MUZZLE, vel: Vec2.fromAngle(this.angle, this.speed) };
    const tMax = flightTime(this.speed, this.angle, G);
    const dt = 0.25;
    const steps = Math.ceil(tMax / dt);

    const exact = exactProjectile(MUZZLE, start.vel, G, tMax, 200);
    r.path(exact, { stroke: C.exact, width: 3 });

    const rows = [{ label: 'Exact', value: '0.00 m', colour: C.exact }];
    for (const key of ['rk4', 'verlet', 'semi', 'euler']) {
      const { path } = trace(key, start, accel, dt, steps);
      const colour = C[key];
      r.path(path, { stroke: alpha(colour, 0.9), width: 2.5, dash: [10, 6] });
      for (const p of path) r.dot(p, 3, colour);

      // Compare like with like: the error at the same *time*, not the nearest point.
      const last = path[path.length - 1];
      const t = (path.length - 1) * dt;
      const trueP = v2(MUZZLE.x + start.vel.x * t,
        MUZZLE.y + start.vel.y * t - 0.5 * G * t * t);
      rows.push({
        label: INTEGRATORS[key].name,
        value: `${last.dist(trueP).toFixed(2)} m`,
        colour,
      });
    }

    const ins = this.app.insets();
    drawReadout(r, ins.left + 20, ins.top + 20, rows, {
      title: `Error after ${(steps * dt).toFixed(1)} s at Δt = 0.25 s`,
      width: 260,
    });
  }

  drawTarget() {
    const r = this.r;
    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.06;
    const hit = this.flight?.hit;

    // The post, so the ring is visibly at the same height as the muzzle.
    r.path([v2(this.target.x, 0), v2(this.target.x, this.target.y - TARGET_RADIUS)],
      { stroke: C.groundEdge, width: 4 });

    r.circle(this.target, TARGET_RADIUS * pulse, {
      fill: alpha(hit ? C.good : C.target, 0.16),
      stroke: hit ? C.good : C.target,
      width: 3.5,
    });
    r.circle(this.target, TARGET_RADIUS * 0.4, { fill: hit ? C.good : C.target });
    r.worldText(`d = ${this.targetD.toFixed(1)} m`, this.target, {
      dy: -r.px(TARGET_RADIUS) - 16, size: 14, weight: 800,
      colour: hit ? C.good : C.target, align: 'center', halo: true,
    });
  }

  drawCannon() {
    const r = this.r;
    // A plinth, so the muzzle height reads as deliberate rather than accidental.
    r.poly([v2(-1.1, 0), v2(1.1, 0), v2(0.8, MUZZLE.y - 0.35), v2(-0.8, MUZZLE.y - 0.35)],
      { fill: C.ground, stroke: C.groundEdge, width: 2 });

    const dir = Vec2.fromAngle(this.angle);
    const barrelEnd = MUZZLE.add(dir.scale(2.1));
    const perp = dir.perp().scale(0.32);
    r.poly([
      MUZZLE.add(perp), barrelEnd.add(perp), barrelEnd.sub(perp), MUZZLE.sub(perp),
    ], { fill: '#3c4a70', stroke: C.groundEdge, width: 2 });
    r.circle(MUZZLE, 0.52, { fill: '#4a5b86', stroke: C.groundEdge, width: 2 });

    // The angle, drawn where it is being set.
    r.path([MUZZLE, MUZZLE.add(v2(2.6, 0))],
      { stroke: alpha(C.text, 0.25), width: 1.5, dash: [5, 5] });
    r.angleArc(MUZZLE, 0, this.angle, 52, C.accent, `${toDeg(this.angle).toFixed(0)}°`);

    // The launch velocity, decomposed — the same triangle as everywhere else.
    if (this.app.xray && !this.flight) {
      const v = Vec2.fromAngle(this.angle, this.speed);
      const s = 0.28;
      const tip = MUZZLE.add(v.scale(s));
      const corner = MUZZLE.add(v2(v.x * s, 0));
      r.arrow(MUZZLE, corner, {
        colour: C.velocityDim, width: 2, dash: [6, 5],
        label: `v cos θ = ${(v.x).toFixed(1)}`, labelSize: 12,
      });
      r.arrow(corner, tip, {
        colour: C.velocityDim, width: 2, dash: [6, 5],
        label: `v sin θ = ${(v.y).toFixed(1)}`, labelSize: 12,
      });
      r.arrow(MUZZLE, tip, {
        colour: C.velocity, width: 4,
        label: `v = ${this.speed.toFixed(1)} m/s`, labelSize: 13,
      });
    }
  }

  drawXrayPanel() {
    const R = range(this.speed, this.angle, G);
    const ins = this.app.insets();
    const rows = [
      { label: 'v cos θ', value: `${(this.speed * Math.cos(this.angle)).toFixed(2)} m/s`, colour: C.velocity },
      { label: 'v sin θ', value: `${(this.speed * Math.sin(this.angle)).toFixed(2)} m/s`, colour: C.velocity },
      { label: 'time of flight', value: `${flightTime(this.speed, this.angle, G).toFixed(2)} s` },
      { label: 'apex', value: `${apex(this.speed, this.angle, G).toFixed(2)} m` },
      { label: 'range', value: `${R.toFixed(2)} m`, colour: C.accent },
    ];
    if (this.showRace) return; // the race has its own readout in that corner
    drawReadout(this.r, this.r.width - ins.right - 250, ins.top + 20, rows,
      { title: 'X-ray', width: 230 });
  }

  // --- attract ------------------------------------------------------------------

  /** Plays itself: aims a little off, fires, adjusts, hits, repeats. */
  attract(dt) {
    this.update(dt);
    if (this.flight) return;

    this.attractWait = (this.attractWait ?? 1.2) - dt;
    if (this.attractWait > 0) {
      // Sweep the barrel while waiting so the screen is never still.
      this.angle = toRad(30 + Math.sin(this.elapsed * 0.8) * 18);
      this.refreshMaths();
      return;
    }

    this.attractWait = 2.6;
    const exact = solveLaunchAngle(this.targetD, this.speed, G);
    if (exact === null) {
      this.speed = clamp(this.speed + 2, MIN_SPEED, MAX_SPEED);
      return;
    }
    // Alternate between a near miss and a hit, so the loop shows both.
    this.attractHit = !this.attractHit;
    this.fire(exact + (this.attractHit ? 0 : toRad(4)), this.speed, true);
  }

  exit() {
    this.clearShot();
    super.exit();
  }
}
