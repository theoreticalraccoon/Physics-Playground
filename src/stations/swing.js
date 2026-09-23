// SWING — match the pendulum to the wave.
//
// The bob traces its own curve onto a strip of paper scrolling away to the right,
// which is the classic sand-pendulum demonstration and still the clearest way to
// show that a swing *is* a cosine. A dashed target wave runs along the same strip;
// the job is to make them line up.
//
// This is simulated from its own differential equation, θ'' = −(g/L)sinθ, rather
// than as a body on a rod. The station is about that equation, so the equation
// should be the thing running — and integrating it directly with RK4 is both more
// accurate and cheaper than a constraint solver.
//
// The surprise is what is *missing* from T = 2π√(L/g). There is no mass in it and
// no amplitude. The mass slider is real, it moves a real number, and it changes
// nothing at all — which is a far better way to make the point than a caption.

import { Station } from './station.js';
import { World } from '../core/world.js';
import { Vec2, v2, toDeg, toRad, clamp } from '../core/vec2.js';
import { C, alpha } from '../render/palette.js';
import { drawReadout, drawEnergyBars } from '../render/xray.js';
import { el, slider, button, toast } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import {
  pendulumPeriod, stepPendulum, lengthForPeriod, bobPosition,
  pendulumEnergy, periodAtAmplitude, angularFrequency,
} from './swing-math.js';

const G = 9.81;
const PIVOT = v2(-8.5, 7);
const PAPER_X = -4;          // left edge of the paper: where the pen sits
const PAPER_MID = 0;         // fixed, so the paper does not jump when L changes
const PAPER_HALF = 2.5;      // world units from the centre line to full deflection
const PAPER_SPEED = 2.2;     // world units per second the paper moves
const PAPER_LEN = 10;
const TOLERANCE = 0.02;      // 2% on the period counts as a match

export class SwingStation extends Station {
  static id = 'swing';
  static title = 'Swing';
  static tagline = 'Match the wave';
  static goal = 'Change the length until the trace lines up with the dashed wave.';
  static maths = 'Trigonometry · square roots · period';
  static icon = '◡';

  constructor(app) {
    super(app);
    this.L = 1.6;
    this.theta0 = toRad(28);
    this.mass = 1.5;
  }

  build() {
    /*
     * A target period that needs a length in the middle of the slider's range, so
     * the answer is never at an end stop — and never one the pendulum already
     * happens to be matching.
     *
     * Without that second condition the station hands out a free three stars
     * roughly one time in eleven: the target lands inside the 2% tolerance of
     * whatever length the slider was left on, and "Lock in" wins without anyone
     * having touched anything.
     */
    const current = pendulumPeriod(this.L, G);
    do {
      this.targetT = 1.8 + Math.random() * 1.1;
    } while (Math.abs(current - this.targetT) / this.targetT < 0.08);
    this.state = { theta: this.theta0, omega: 0 };
    this.t = 0;
    this.history = [];
    // The engine still runs so the shell has a world to step, but the pendulum is
    // integrated by hand below.
    this.world = new World({ gravity: v2(0, 0) });
    this.say(''); // the goal has its own permanent line
    this.refreshMaths?.();
  }

  release() {
    this.state = { theta: this.theta0, omega: 0 };
    this.t = 0;
    this.history = [];
  }

  update(dt) {
    this.elapsed += dt;
    const h = Math.min(dt, 0.05);

    // Substep so the trace stays smooth even on a slow frame.
    const n = 4;
    for (let i = 0; i < n; i++) {
      this.state = stepPendulum(this.state, h / n, this.L, G);
      this.t += h / n;
    }

    this.history.push({ t: this.t, theta: this.state.theta });
    // Keep only what is still on the paper.
    const cutoff = this.t - PAPER_LEN / PAPER_SPEED;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }

  /** Commit to the current length and see whether the periods agree. */
  lockIn() {
    this.beginAttempt();
    const T = pendulumPeriod(this.L, G);
    const err = Math.abs(T - this.targetT) / this.targetT;

    if (err < TOLERANCE) {
      const stars = this.succeed();
      toast(this.app.dom.stage,
        `Matched — <b>${stars} ★</b><br><span class="toast-sub">L = gT²/4π² gave you the length directly.</span>`,
        { tone: 'good', ms: 4600 });
      this.app.sound?.('hit');
    } else {
      this.say(T > this.targetT
        ? `Too slow by ${((T - this.targetT) * 1000).toFixed(0)} ms — shorten it.`
        : `Too fast by ${((this.targetT - T) * 1000).toFixed(0)} ms — lengthen it.`, 'warn');
      this.app.sound?.('miss');
    }
    this.refreshMaths();
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();
    this.periodLine = this.line('', { big: true });
    this.targetLine = this.line('');
    this.solveLine = this.line('', { big: true });
    this.missingLine = this.line('', { dim: true });

    card.append(
      this.section('How long one swing takes', this.periodLine, this.targetLine),
      this.section('Set the length to this', this.solveLine,
        el('p', { class: 'math-note is-callout', text: 'Rearranging T for L gives the answer outright — no guessing needed.' })),
      this.section('What is not in the formula', this.missingLine),
    );

    const bar = this.controls();
    this.lSlider = slider({
      label: 'Length L', min: 0.4, max: 4, step: 0.01, value: this.L,
      unit: 'm', dp: 2, tone: 'velocity',
      onInput: (v) => {
        this.L = v;
        this.release();
        this.refreshMaths();
      },
    });
    this.aSlider = slider({
      label: 'Pull back θ₀', min: 5, max: 60, step: 1, value: toDeg(this.theta0),
      unit: '°', dp: 0, tone: 'accent',
      onInput: (v) => {
        this.theta0 = toRad(v);
        this.release();
        this.refreshMaths();
      },
    });
    this.mSlider = slider({
      label: 'Mass m', min: 0.5, max: 6, step: 0.1, value: this.mass,
      unit: 'kg', dp: 1,
      onInput: (v) => {
        this.mass = v;
        this.refreshMaths();
      },
    });

    bar.append(
      this.lSlider, this.aSlider, this.mSlider,
      el('div', { class: 'control-buttons' },
        button('Release', () => this.release(), { variant: 'ghost', icon: '↺' }),
        button('Lock in', () => this.lockIn(), { variant: 'primary', icon: '✓' })),
    );

    this.refreshMaths();
  }

  refreshMaths() {
    if (!this.periodLine) return;
    const T = pendulumPeriod(this.L, G);
    const err = Math.abs(T - this.targetT) / this.targetT;
    const close = err < TOLERANCE;

    this.periodLine.innerHTML = M.eq(
      M.sym('T'), M.op('='), '2', M.sym('π'),
      // Inline rather than stacked: a two-storey fraction is taller than the
      // radical glyph can cover, and the bar ends up floating above it.
      M.sqrt(`${M.sym('L')} / ${M.sym('g')}`),
      M.op('='), M.num(T, 3, close ? 'good' : 'velocity'), M.unit('s'),
    );

    this.targetLine.innerHTML = M.eq(
      'target ', M.sym('T'), M.op('='), M.num(this.targetT, 3, 'target'), M.unit('s'),
      M.op('·'), close ? 'matched' : `off by ${(err * 100).toFixed(1)}%`,
    );
    this.targetLine.className = `math-line${close ? ' is-good' : ''}`;

    this.solveLine.innerHTML = M.eq(
      M.sym('L'), M.op('='),
      M.frac(`${M.sym('g')}${M.sym('T')}${M.sup('2')}`, `4${M.sym('π')}${M.sup('2')}`),
      M.op('='), M.num(lengthForPeriod(this.targetT, G), 3, 'accent'), M.unit('m'),
    );

    // The mass is printed so it is visibly present as a number and visibly absent
    // from the formula.
    this.missingLine.innerHTML = `${M.eq(
      'mass ', M.num(this.mass, 1), M.unit('kg'), M.op('·'), 'not in T',
    )}<br>${M.eq(
      'amplitude ', M.num(toDeg(this.theta0), 0), M.unit('°'), M.op('·'),
      'adds ', M.num((periodAtAmplitude(this.L, G, this.theta0) / pendulumPeriod(this.L, G) - 1) * 100, 1),
      M.unit('%'),
    )}`;
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    r.fit(v2(-13.5, -3.2), v2(6.5, 8.4), 36, this.app.insets());
    r.grid(1, 5);

    this.drawPaper();
    this.drawPendulum();

    if (this.app.xray) {
      const ins = this.app.insets();
      const e = pendulumEnergy(this.state, this.L, G, this.mass);
      drawEnergyBars(r, ins.left + 24, r.height - ins.bottom - 120, 150, {
        kinetic: e.kinetic,
        potential: e.potential,
        reference: this.mass * G * this.L * (1 - Math.cos(this.theta0)),
      });
      drawReadout(r, r.width - ins.right - 250, ins.top + 20, [
        { label: 'θ now', value: `${toDeg(this.state.theta).toFixed(1)}°`, colour: C.accent },
        { label: 'ω = √(g/L)', value: `${angularFrequency(this.L, G).toFixed(3)} rad/s`, colour: C.velocity },
        { label: 'bob speed', value: `${Math.abs(this.state.omega * this.L).toFixed(2)} m/s`, colour: C.velocity },
        { label: 'swings seen', value: `${Math.floor(this.t / pendulumPeriod(this.L, G))}` },
      ], { title: 'X-ray', width: 230 });
    }
  }

  /**
   * The scrolling paper. Time runs right to left: the bob draws at the left edge
   * and the trace slides away, so the newest part of the curve is always the part
   * next to the thing making it.
   */
  drawPaper() {
    const r = this.r;
    const yScale = PAPER_HALF;
    const mid = PAPER_MID;
    const x = (t) => PAPER_X + (this.t - t) * PAPER_SPEED;

    // The paper itself.
    r.poly([
      v2(PAPER_X, mid - yScale * 1.15), v2(PAPER_X + PAPER_LEN, mid - yScale * 1.15),
      v2(PAPER_X + PAPER_LEN, mid + yScale * 1.15), v2(PAPER_X, mid + yScale * 1.15),
    ], { fill: 'rgba(255,255,255,0.03)', stroke: alpha(C.text, 0.1), width: 1.5 });
    r.path([v2(PAPER_X, mid), v2(PAPER_X + PAPER_LEN, mid)],
      { stroke: alpha(C.text, 0.18), width: 1.5 });

    // The target wave, a pure cosine with the wanted period.
    const targetPts = [];
    for (let i = 0; i <= 260; i++) {
      const t = this.t - (i / 260) * (PAPER_LEN / PAPER_SPEED);
      if (t < 0) break;
      const theta = this.theta0 * Math.cos((2 * Math.PI * t) / this.targetT);
      targetPts.push(v2(x(t), mid + (theta / Math.max(this.theta0, 0.01)) * yScale));
    }
    if (targetPts.length > 1) {
      r.path(targetPts, { stroke: alpha(C.target, 0.85), width: 2.5, dash: [10, 7] });
    }

    // What the pendulum actually drew.
    const pts = this.history
      .map((h) => v2(x(h.t), mid + (h.theta / Math.max(this.theta0, 0.01)) * yScale))
      .filter((p) => p.x >= PAPER_X - 0.2 && p.x <= PAPER_X + PAPER_LEN);
    if (pts.length > 1) r.path(pts, { stroke: C.velocity, width: 3 });

    // The pen: where the trace is being drawn right now.
    const penY = mid + (this.state.theta / Math.max(this.theta0, 0.01)) * yScale;
    const pen = v2(PAPER_X, penY);
    const bob = bobPosition(this.state.theta, this.L);
    r.path([PIVOT.add(v2(bob.x, bob.y)), pen],
      { stroke: alpha(C.velocity, 0.22), width: 1.5, dash: [4, 7] });
    r.dot(pen, 5, C.velocity);

    r.worldText('angle θ', v2(PAPER_X, mid + yScale * 1.15), {
      dx: 4, dy: -8, size: 12, weight: 700, colour: alpha(C.text, 0.5),
    });
    r.worldText('target', v2(PAPER_X + PAPER_LEN, mid + yScale * 1.15), {
      dx: -6, dy: -8, size: 12, weight: 700, colour: C.target, align: 'right',
    });
    r.worldText('yours', v2(PAPER_X + PAPER_LEN, mid + yScale * 1.15), {
      dx: -6, dy: 10, size: 12, weight: 700, colour: C.velocity, align: 'right',
    });
  }

  drawPendulum() {
    const r = this.r;
    const bob = bobPosition(this.state.theta, this.L);
    const bobPos = PIVOT.add(v2(bob.x, bob.y));

    // The arc the bob sweeps, so the amplitude is visible even at rest.
    const arc = [];
    for (let i = -20; i <= 20; i++) {
      const th = (i / 20) * this.theta0;
      const p = bobPosition(th, this.L);
      arc.push(PIVOT.add(v2(p.x, p.y)));
    }
    r.path(arc, { stroke: alpha(C.accent, 0.22), width: 2, dash: [5, 6] });

    r.path([PIVOT, bobPos], { stroke: C.bodyStroke, width: 3 });
    r.circle(PIVOT, 0.18, { fill: C.groundEdge, stroke: C.bodyStroke, width: 2 });

    // Vertical reference and the angle between it and the string.
    r.path([PIVOT, PIVOT.add(v2(0, -this.L - 0.9))],
      { stroke: alpha(C.text, 0.2), width: 1.5, dash: [5, 5] });
    r.angleArc(PIVOT, -Math.PI / 2, -Math.PI / 2 + this.state.theta,
      Math.max(r.px(this.L) * 0.42, 30), C.accent,
      `${toDeg(this.state.theta).toFixed(0)}°`);

    const rad = 0.16 + Math.cbrt(this.mass) * 0.12;
    r.circle(bobPos, rad, { fill: C.velocity, stroke: '#fff', width: 2.5 });

    // The bob's velocity, tangent to the arc.
    if (this.app.xray && Math.abs(this.state.omega) > 0.05) {
      const tangent = v2(Math.cos(this.state.theta), Math.sin(this.state.theta))
        .scale(this.state.omega * this.L * 0.4);
      r.arrow(bobPos, bobPos.add(tangent), {
        colour: C.velocity, width: 3,
        label: `${Math.abs(this.state.omega * this.L).toFixed(2)} m/s`, labelSize: 12,
      });
    }

    r.worldText(`L = ${this.L.toFixed(2)} m`, PIVOT.lerp(bobPos, 0.5), {
      dx: 14, size: 13, weight: 700, colour: C.textDim, halo: true,
    });
  }

  // --- attract ------------------------------------------------------------------

  attract(dt) {
    this.update(dt);
    // Slowly sweep the length through the answer and past it, so a passer-by sees
    // the two waves drift into and out of step.
    this.L = 2.1 + Math.sin(this.elapsed * 0.22) * 1.5;
    this.lSlider?.set(this.L);
    if (Math.floor(this.elapsed * 2) % 2 === 0) this.refreshMaths();
  }
}
