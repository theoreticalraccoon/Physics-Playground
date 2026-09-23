// SLOPE — find the angle where it lets go, and you have measured the surface.
//
// A block on a ramp. Tilt the ramp and at one particular angle the block breaks
// away. That angle is not arbitrary:
//
//   mg sinθ  >  μ mg cosθ     the pull down the slope beats the grip
//        tanθ >  μ            every m and g cancels
//
// So μ = tan θ_critical. The mass genuinely does not matter and neither does g,
// which is why this works as an experiment rather than a demonstration: the surface
// is a mystery, and a kid measures an angle with their finger and comes away
// knowing a number nobody told them.
//
// The X-ray toggle is the hint here. With it off, μ shows as "?" and the grip bar
// is hidden, so the only way through is to find the edge. With it on, everything is
// revealed — for the kid who is stuck, or the one who wants to check.

import { Station } from './station.js';
import { Body } from '../core/body.js';
import { World } from '../core/world.js';
import { Vec2, v2, toDeg, toRad, clamp, rng } from '../core/vec2.js';
import { C, alpha, mix } from '../render/palette.js';
import { drawReadout } from '../render/xray.js';
import { el, slider, button, toast } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import {
  criticalAngle, frictionFromAngle, gravityAlongSlope, maxStaticFriction,
  slipRatio, slidingAcceleration, gradient,
} from './slope-math.js';

const G = 9.81;
const PIVOT = v2(-7, 0);
const RAMP_LEN = 15;
const RAMP_THICK = 0.5;
const BLOCK = 1.3;
const START_ALONG = 10.5;
const TOLERANCE_DEG = 1.5;

export class SlopeStation extends Station {
  static id = 'slope';
  static title = 'Slope';
  static tagline = 'Measure the mystery surface';
  static goal = 'Find the steepest angle where the block still holds, then press Lock in.';
  static maths = 'Gradient · tangent · inequalities';
  static icon = '◺';

  constructor(app) {
    super(app);
    this.targetAngle = toRad(12);
    this.angle = toRad(6);
    this.mass = 2.5;
  }

  build() {
    const rand = rng(Math.floor(Math.random() * 1e6));
    // Somewhere between a slippery and a grippy surface, avoiding the ends where
    // the answer is guessable.
    this.mu = 0.28 + rand() * 0.5;
    this.critical = criticalAngle(this.mu);

    this.angle = toRad(5);
    this.targetAngle = this.angle;
    this.slipped = false;
    this.slipAngle = null;

    this.world = new World({
      gravity: v2(0, -G), fixedDt: 1 / 240, velocityIterations: 24, positionIterations: 5,
    });

    this.ramp = Body.box(0, 0, RAMP_LEN, RAMP_THICK, {
      isStatic: true, friction: this.mu, restitution: 0,
    });
    this.block = Body.box(0, 0, BLOCK, BLOCK, {
      friction: this.mu, restitution: 0, density: 1,
    });
    this.block.setMass(this.mass);
    this.world.add(this.ramp, this.block);

    this.placeRamp(this.angle);
    this.placeBlock(START_ALONG);
    this.say(''); // the goal has its own permanent line
    this.refreshMaths?.();
  }

  placeRamp(theta) {
    this.ramp.angle = theta;
    this.ramp.pos = PIVOT.add(Vec2.fromAngle(theta, RAMP_LEN / 2));
  }

  placeBlock(along) {
    const dir = Vec2.fromAngle(this.angle);
    const up = dir.perp();
    this.block.pos = PIVOT
      .add(dir.scale(along))
      .add(up.scale(RAMP_THICK / 2 + BLOCK / 2));
    this.block.angle = this.angle;
    this.block.vel = v2(0, 0);
    this.block.angVel = 0;
  }

  /** How far up the ramp the block currently sits, measured from the pivot. */
  alongRamp() {
    return this.block.pos.sub(PIVOT).dot(Vec2.fromAngle(this.angle));
  }

  setAngle(theta) {
    this.targetAngle = clamp(theta, 0, toRad(55));
  }

  update(dt) {
    // Ease the ramp towards where the finger asked for it, rather than snapping.
    // Rotating a static body instantly would shove the block through it; a limited
    // rate keeps every contact honest and lets the solver do the physics.
    const maxRate = toRad(38) * dt;
    const diff = clamp(this.targetAngle - this.angle, -maxRate, maxRate);
    if (Math.abs(diff) > 1e-6) {
      const along = this.alongRamp();
      this.angle += diff;
      this.placeRamp(this.angle);
      // While it is still gripping, carry the block round with the ramp.
      if (!this.slipped) this.placeBlock(along);
    }

    super.update(dt);

    // The block has genuinely broken away when it has picked up real speed down
    // the slope, not merely jittered in its contact.
    if (!this.slipped && this.block.vel.len() > 0.35) {
      this.slipped = true;
      this.slipAngle = this.angle;
      this.app.sound?.('clack');
      this.say(
        `It let go at ${toDeg(this.angle).toFixed(1)}° — so the edge is just below that.`,
        'warn');
    }

    // Off the end of the ramp: put it back so the next attempt can start at once.
    if (this.alongRamp() < 0.5 || this.block.pos.y < -8) {
      this.slipped = false;
      this.setAngle(toRad(5));
      this.angle = toRad(5);
      this.placeRamp(this.angle);
      this.placeBlock(START_ALONG);
      this.slider?.set(5);
    }

    this.refreshMaths();
  }

  lockIn() {
    this.beginAttempt();
    const err = Math.abs(this.angle - this.critical);

    if (toDeg(err) < TOLERANCE_DEG) {
      const stars = this.succeed();
      toast(this.app.dom.stage,
        `μ = tan ${toDeg(this.critical).toFixed(1)}° = <b>${this.mu.toFixed(2)}</b> — ${stars} ★`
        + `<br><span class="toast-sub">You measured a property of the surface with nothing but an angle.</span>`,
        { tone: 'good', ms: 5200 });
      this.app.sound?.('hit');
    } else if (this.angle > this.critical) {
      this.say(
        `Past it — that angle was already too steep. Press Reset and stop sooner.`,
        'warn');
      this.app.sound?.('miss');
    } else {
      this.say(
        `Still gripping comfortably. Tilt it ${toDeg(err).toFixed(1)}° steeper and try again.`,
        'warn');
      this.app.sound?.('miss');
    }
  }

  // --- pointer: drag anywhere up or down to tilt ---------------------------------

  onPointerDown(world, screen) {
    this.dragFrom = screen.y;
    this.dragAngle = this.targetAngle;
  }

  onPointerMove(world, screen) {
    if (this.dragFrom === undefined) return;
    // Up is steeper. 260 px of travel covers the whole range, which is a
    // comfortable thumb sweep on a tablet.
    const delta = (this.dragFrom - screen.y) / 260 * toRad(55);
    this.setAngle(this.dragAngle + delta);
    this.slider?.set(toDeg(this.targetAngle));
  }

  onPointerUp() {
    this.dragFrom = undefined;
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();
    this.pullLine = this.line('');
    this.gripLine = this.line('');
    this.testLine = this.line('', { big: true });
    this.muLine = this.line('', { dim: true });

    card.append(
      this.section('Down the slope', this.pullLine),
      this.section('Holding it back', this.gripLine),
      this.section('It slips when', this.testLine, this.muLine),
    );

    const bar = this.controls();
    this.slider = slider({
      label: 'Tilt θ', min: 0, max: 55, step: 0.1, value: toDeg(this.angle),
      unit: '°', dp: 1, tone: 'accent',
      onInput: (v) => this.setAngle(toRad(v)),
    });
    this.mSlider = slider({
      label: 'Block mass m', min: 0.5, max: 8, step: 0.1, value: this.mass,
      unit: 'kg', dp: 1,
      onInput: (v) => {
        this.mass = v;
        this.block.setMass(v);
      },
    });

    bar.append(
      el('div', { class: 'hint-block' },
        el('p', { class: 'hint-title', text: 'Creep up on it' }),
        el('ol', { class: 'hint-steps' },
          el('li', { text: 'Drag the screen up, or use the Tilt slider.' }),
          el('li', { text: 'Go slowly. Stop at the steepest angle it still holds.' }),
          el('li', { text: 'Press Lock in. Too far and it slides — press Reset.' }))),
      this.slider, this.mSlider,
      el('div', { class: 'control-buttons' },
        button('Reset', () => {
          this.slipped = false;
          this.setAngle(toRad(5));
          this.angle = toRad(5);
          this.placeRamp(this.angle);
          this.placeBlock(START_ALONG);
          this.slider.set(5);
        }, { variant: 'ghost', icon: '↺' }),
        button('Lock in', () => this.lockIn(), { variant: 'primary', icon: '✓' })),
    );

    this.refreshMaths();
  }

  refreshMaths() {
    if (!this.pullLine) return;
    const reveal = this.app.xray || this.solved;
    const pull = gravityAlongSlope(this.mass, G, this.angle);
    const grip = maxStaticFriction(this.mass, G, this.angle, this.mu);

    this.pullLine.innerHTML = M.eq(
      M.sym('mg'), ' sin ', M.sym('θ'), M.op('='),
      M.num(pull, 1, 'force'), M.unit('N'),
    );

    this.gripLine.innerHTML = reveal
      ? M.eq(M.sym('μ'), M.sym('mg'), ' cos ', M.sym('θ'), M.op('='),
        M.num(grip, 1, 'force'), M.unit('N'))
      : M.eq(M.sym('μ'), M.sym('mg'), ' cos ', M.sym('θ'), M.op('='),
        `<span class="mnum t-dim">?</span>`,
        `<span class="math-aside">μ unknown</span>`);

    // Two lines, because "tan θ > μ · tan 5.0° = 0.087" reads as a single product
    // rather than a rule followed by the number that tests it.
    this.testLine.innerHTML = `${M.eq('tan ', M.sym('θ'), M.op('>'), M.sym('μ'))}`
      + `<br>${M.eq('tan ', M.num(toDeg(this.angle), 1, 'accent'), M.unit('°'),
        M.op('='), M.num(gradient(this.angle), 3, 'accent'))}`;

    this.muLine.innerHTML = reveal
      ? M.eq(M.sym('μ'), M.op('='), 'tan ', M.sym('θ'), M.sub('crit'), M.op('='),
        M.num(this.mu, 3, 'good'), M.op('·'), M.sym('θ'), M.sub('crit'), M.op('='),
        M.num(toDeg(this.critical), 1, 'good'), M.unit('°'))
      : (this.slipAngle
        ? M.eq('last slip at ', M.num(toDeg(this.slipAngle), 1, 'warn'), M.unit('°'))
        : M.eq('find the edge, then ', M.sym('μ'), M.op('='), 'tan ', M.sym('θ')));
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    r.fit(v2(-9, 0), v2(11, 11), 40, this.app.insets(),
      { anchor: { y: 0, frac: 0.86 } });
    r.grid(1, 5);

    // The horizontal, so the tilt has something to be a tilt from.
    r.path([PIVOT.sub(v2(1.5, 0)), PIVOT.add(v2(RAMP_LEN + 1, 0))],
      { stroke: alpha(C.text, 0.22), width: 2, dash: [8, 7] });

    r.body(this.ramp, { fill: C.ground, stroke: C.groundEdge, width: 2.5 });

    // Rise and run, drawn as the triangle the ramp makes with the horizontal.
    const end = PIVOT.add(Vec2.fromAngle(this.angle, RAMP_LEN));
    const foot = v2(end.x, PIVOT.y);
    r.path([PIVOT, foot, end], {
      stroke: alpha(C.accent, 0.3), width: 2, dash: [6, 6],
    });
    r.worldText(`run ${(end.x - PIVOT.x).toFixed(1)} m`, PIVOT.lerp(foot, 0.5), {
      dy: 20, size: 12, colour: alpha(C.accent, 0.75), align: 'center', halo: true,
    });
    r.worldText(`rise ${(end.y - PIVOT.y).toFixed(1)} m`, foot.lerp(end, 0.5), {
      dx: 12, size: 12, colour: alpha(C.accent, 0.75), halo: true,
    });
    r.angleArc(PIVOT, 0, this.angle, 62, C.accent, `${toDeg(this.angle).toFixed(1)}°`);

    this.drawBlock();
    this.drawBars();

    if (this.app.xray) {
      const ins = this.app.insets();
      drawReadout(r, r.width - ins.right - 250, ins.top + 20, [
        { label: 'μ (revealed)', value: this.mu.toFixed(3), colour: C.good },
        { label: 'critical angle', value: `${toDeg(this.critical).toFixed(2)}°`, colour: C.good },
        { label: 'tan θ', value: gradient(this.angle).toFixed(3), colour: C.accent },
        { label: 'a if sliding', value: `${slidingAcceleration(G, this.angle, this.mu).toFixed(2)} m/s²`, colour: C.force },
      ], { title: 'X-ray · the answer', width: 240 });
    }
  }

  drawBlock() {
    const r = this.r;
    const slipping = this.slipped;
    r.body(this.block, {
      fill: slipping ? alpha(C.bad, 0.3) : alpha(C.body, 0.9),
      stroke: slipping ? C.bad : C.bodyStroke,
      width: 3,
    });

    if (!this.app.xray) return;

    // Weight, and its two components along and into the slope. The same
    // right-angled triangle as every other station, tipped over.
    const p = this.block.pos;
    const w = this.mass * G;
    const s = 0.055;
    const down = v2(0, -w * s);
    const dir = Vec2.fromAngle(this.angle);
    const into = dir.perp().scale(-w * Math.cos(this.angle) * s);
    const along = dir.scale(-w * Math.sin(this.angle) * s);

    r.arrow(p, p.add(down), {
      colour: C.force, width: 3.5, label: `mg = ${w.toFixed(0)} N`, labelSize: 12,
    });
    r.arrow(p, p.add(along), {
      colour: alpha(C.force, 0.55), width: 2.5, dash: [6, 5],
      label: `mg sinθ = ${(w * Math.sin(this.angle)).toFixed(0)}`, labelSize: 11,
    });
    r.arrow(p, p.add(into), {
      colour: alpha(C.force, 0.55), width: 2.5, dash: [6, 5],
      label: `mg cosθ = ${(w * Math.cos(this.angle)).toFixed(0)}`, labelSize: 11,
    });
    // Friction, pushing back up the slope.
    const fric = dir.scale(Math.min(w * Math.sin(this.angle), this.mu * w * Math.cos(this.angle)) * s);
    r.arrow(p, p.add(fric), {
      colour: C.good, width: 3, label: 'friction', labelSize: 11,
    });
  }

  /**
   * Two racing bars: the pull down the slope against the most the friction can
   * offer. The moment the orange passes the green, the block goes. With the X-ray
   * off the green bar is hidden, because knowing it would give the game away.
   */
  drawBars() {
    const r = this.r;
    const ins = this.app.insets();
    // Tucked under the equation card in the left column, where nothing else is
    // drawn. Putting them beside the ramp meant they landed on top of it.
    const x = 24;
    const y = this.app.panelBottom();
    const w = 200;
    const maxN = this.mass * G;
    const reveal = this.app.xray || this.solved;

    r.text('FORCES ALONG THE SLOPE', x, y - 12,
      { size: 11, weight: 800, colour: C.textDim });

    const pull = gravityAlongSlope(this.mass, G, this.angle);
    r.text('pull', x, y + 13, { size: 12, weight: 700, colour: C.force });
    r.bar(x + 46, y, w, 15, pull / maxN, C.force);
    r.text(`${pull.toFixed(1)} N`, x + 46 + w + 8, y + 13,
      { size: 12, colour: C.textDim, mono: true });

    const grip = maxStaticFriction(this.mass, G, this.angle, this.mu);
    r.text('grip', x, y + 43, { size: 12, weight: 700, colour: reveal ? C.good : C.textFaint });
    if (reveal) {
      const ratio = slipRatio(this.angle, this.mu);
      r.bar(x + 46, y + 30, w, 15, grip / maxN,
        mix(C.good, C.bad, clamp(ratio, 0, 1)));
      r.text(`${grip.toFixed(1)} N`, x + 46 + w + 8, y + 43,
        { size: 12, colour: C.textDim, mono: true });
    } else {
      r.roundRect(x + 46, y + 30, w, 15, 7.5,
        { stroke: alpha(C.textFaint, 0.5), width: 1.5 });
      r.text('turn on X-ray to see it', x + 52, y + 43,
        { size: 11, colour: C.textFaint });
    }
  }

  // --- attract ------------------------------------------------------------------

  attract(dt) {
    // Creep up to the critical angle, let it go, drop back, repeat.
    if (this.slipped) {
      this.setAngle(toRad(4));
    } else {
      this.setAngle(this.angle + toRad(9) * dt);
    }
    this.update(dt);
    this.slider?.set(toDeg(this.targetAngle));
  }
}
