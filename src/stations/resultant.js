// RESULTANT — add force arrows until the crate goes where you want.
//
// The crate sits on ice. Tapping an arrow in the dock attaches it; the components
// are summed live and the single arrow that replaces them is drawn on top of its
// own construction lines. Then you press Go and find out whether your arithmetic
// pointed the crate at the door.
//
// The door is deliberately placed at 53.13°, so the crate is reached by a 30 N pull
// east and a 40 N pull north — a 3-4-5 triangle, with a resultant of exactly 50 N.
// When a kid stumbles into it the station says so, which is the first time
// Pythagoras has ever done anything for them.

import { Station } from './station.js';
import { Body } from '../core/body.js';
import { World } from '../core/world.js';
import { Vec2, v2, toDeg, toRad, clamp } from '../core/vec2.js';
import { C, alpha } from '../render/palette.js';
import { drawComponents, drawReadout } from '../render/xray.js';
import { el, button, toast } from '../render/ui.js';
import * as M from '../render/mathtype.js';
import { resultant, angleError, isPythagorean } from './resultant-math.js';

const DOOR_DIST = 11;
// The catalogue of arrows on offer. Chosen so several combinations work but only a
// couple are tidy, which is what makes finding the tidy one feel like a discovery.
const DOCK = [
  { magnitude: 30, theta: 0 },
  { magnitude: 40, theta: Math.PI / 2 },
  { magnitude: 20, theta: Math.PI },
  { magnitude: 25, theta: -Math.PI / 2 },
  { magnitude: 35, theta: toRad(45) },
  { magnitude: 15, theta: toRad(120) },
];

export class ResultantStation extends Station {
  static id = 'resultant';
  static title = 'Resultant';
  static tagline = 'Push it through the door';
  static goal = 'Switch on forces until the arrow points at the door.';
  static maths = 'Vectors · components · Pythagoras';
  static icon = '⤢';

  constructor(app) {
    super(app);
    this.active = new Set();
    this.running = false;
  }

  build() {
    // 3-4-5: the door sits exactly where 30 east and 40 north send the crate.
    this.doorTheta = Math.atan2(4, 3);
    this.door = Vec2.fromAngle(this.doorTheta, DOOR_DIST);

    this.world = new World({ gravity: v2(0, 0), fixedDt: 1 / 240 });
    this.crate = Body.box(0, 0, 1.5, 1.5, {
      density: 3, friction: 0, restitution: 0.1, linearDamping: 0,
    });
    this.world.add(this.crate);

    this.running = false;
    this.active.clear();
    this.trail = [];
    this.say(''); // the goal has its own permanent line
    this.refreshMaths?.();
    this.refreshDock?.();
  }

  get forces() {
    return [...this.active].map((i) => DOCK[i]);
  }

  toggle(i) {
    if (this.running) return;
    if (this.active.has(i)) this.active.delete(i);
    else this.active.add(i);
    this.app.sound?.('tick');
    this.refreshDock();
    this.refreshMaths();
  }

  go() {
    if (this.running || this.active.size === 0) return;
    this.beginAttempt();
    this.running = true;
    this.trail = [];

    // One clean shove, then it coasts. Ice, so nothing slows it down and the
    // direction it leaves in is the direction it keeps.
    const R = resultant(this.forces);
    this.crate.vel = v2(R.x, R.y).scale(0.06);
    this.app.sound?.('launch');
  }

  update(dt) {
    super.update(dt);
    if (!this.running) return;

    this.trail.push(this.crate.pos.clone());
    if (this.trail.length > 300) this.trail.shift();

    const d = this.crate.pos.dist(this.door);
    if (d < 1.3) {
      this.running = false;
      const stars = this.succeed();
      const tidy = isPythagorean(this.forces);
      toast(this.app.dom.stage,
        tidy
          ? `Through the door — <b>${stars} ★</b><br><span class="toast-sub">30, 40 and 50. That is a 3-4-5 triangle.</span>`
          : `Through the door — <b>${stars} ★</b>`,
        { tone: 'good', ms: tidy ? 5000 : 2600 });
      this.app.sound?.('hit');
      return;
    }

    // Once it is clearly past the door, call it.
    if (this.crate.pos.len() > DOOR_DIST + 6) {
      this.running = false;
      const err = toDeg(angleError(this.crate.pos.angle(), this.doorTheta));
      this.say(`Missed by ${err.toFixed(0)}° — check ΣFx and ΣFy.`, 'warn');
      this.app.sound?.('miss');
      setTimeout(() => this.resetCrate(), 700);
    }
  }

  resetCrate() {
    this.crate.pos = v2(0, 0);
    this.crate.vel = v2(0, 0);
    this.crate.angle = 0;
    this.crate.angVel = 0;
    this.trail = [];
    this.running = false;
  }

  // --- panels -------------------------------------------------------------------

  layoutPanels() {
    const card = this.mathCard();
    this.sumLine = this.line('');
    this.magLine = this.line('', { big: true });
    this.angLine = this.line('');
    this.doorLine = this.line('', { dim: true });

    card.append(
      this.section('Add the components', this.sumLine),
      this.section('Put it back together', this.magLine, this.angLine),
      this.section('The door', this.doorLine),
    );

    const bar = this.controls();
    this.dockEl = el('div', { class: 'dock' });
    bar.append(
      el('div', { class: 'dock-wrap' },
        el('div', { class: 'dock-label', text: 'FORCES' }),
        this.dockEl),
      el('div', { class: 'control-buttons' },
        button('Clear', () => {
          this.active.clear();
          this.refreshDock();
          this.refreshMaths();
        }, { variant: 'ghost' }),
        button('Go', () => this.go(), { variant: 'primary', icon: '▶' })),
    );

    this.refreshDock();
    this.refreshMaths();
  }

  refreshDock() {
    if (!this.dockEl) return;
    this.dockEl.replaceChildren(...DOCK.map((f, i) => {
      const on = this.active.has(i);
      const b = el('button', {
        class: `force-chip${on ? ' is-on' : ''}`,
        type: 'button',
        style: { '--dir': `${-toDeg(f.theta)}deg` },
      },
      el('span', { class: 'force-arrow', text: '→' }),
      el('span', { class: 'force-mag', text: `${f.magnitude} N` }),
      el('span', { class: 'force-ang', text: `${toDeg(f.theta).toFixed(0)}°` }));
      b.addEventListener('click', () => this.toggle(i));
      return b;
    }));
  }

  refreshMaths() {
    if (!this.sumLine) return;
    const R = resultant(this.forces);

    this.sumLine.innerHTML = `${M.eq(
      M.sym('ΣF'), M.sub('x'), M.op('='), M.num(R.x, 1, 'force'), M.unit('N'),
    )}<br>${M.eq(
      M.sym('ΣF'), M.sub('y'), M.op('='), M.num(R.y, 1, 'force'), M.unit('N'),
    )}`;

    this.magLine.innerHTML = M.eq(
      M.sym('|F|'), M.op('='),
      M.sqrt(`${M.sym('ΣF')}${M.sub('x')}${M.sup('2')} + ${M.sym('ΣF')}${M.sub('y')}${M.sup('2')}`),
      M.op('='), M.num(R.magnitude, 1, 'force'), M.unit('N'),
    );

    this.angLine.innerHTML = M.eq(
      M.sym('θ'), M.op('='),
      'tan', M.sup('−1'),
      `(${M.frac(`${M.sym('ΣF')}${M.sub('y')}`, `${M.sym('ΣF')}${M.sub('x')}`)})`,
      M.op('='),
      M.num(R.magnitude < 0.01 ? 0 : toDeg(R.theta), 1, 'force'), M.unit('°'),
    );

    const err = R.magnitude < 0.01 ? 90 : toDeg(angleError(R.theta, this.doorTheta));
    const aligned = err < 4;
    this.doorLine.className = `math-line is-dim${aligned ? ' is-good' : ''}`;
    this.doorLine.innerHTML = M.eq(
      'door at ', M.num(toDeg(this.doorTheta), 1, 'target'), M.unit('°'),
      M.op('·'), aligned ? 'lined up' : `off by ${err.toFixed(0)}°`,
    );
  }

  // --- drawing ------------------------------------------------------------------

  render() {
    const r = this.r;
    r.fit(v2(-5, -3.5), v2(11, 10.5), 40, this.app.insets());
    r.grid(1, 5);

    // Axes through the crate's start, so components have something to be measured
    // against rather than floating in space.
    r.path([v2(-5, 0), v2(11, 0)], { stroke: alpha(C.text, 0.18), width: 1.5 });
    r.path([v2(0, -3.5), v2(0, 10.5)], { stroke: alpha(C.text, 0.18), width: 1.5 });

    this.drawDoor();

    if (this.trail.length > 1) r.trail(this.trail, C.velocity, { width: 3 });
    r.body(this.crate, { fill: '#c3d0ea', stroke: '#8fa3cc', width: 2.5 });

    this.drawForces();

    if (this.app.xray) {
      const R = resultant(this.forces);
      drawReadout(r, this.r.width - this.app.insets().right - 250, this.app.insets().top + 20, [
        { label: 'arrows on', value: String(this.active.size) },
        { label: 'ΣFx', value: `${R.x.toFixed(1)} N`, colour: C.force },
        { label: 'ΣFy', value: `${R.y.toFixed(1)} N`, colour: C.force },
        { label: '|F|', value: `${R.magnitude.toFixed(1)} N`, colour: C.force },
        { label: 'θ', value: `${(R.magnitude < 0.01 ? 0 : toDeg(R.theta)).toFixed(1)}°` },
      ], { title: 'X-ray', width: 230 });
    }
  }

  drawDoor() {
    const r = this.r;
    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.05;

    // The line of sight to the door: the direction the resultant has to match.
    r.path([v2(0, 0), this.door], {
      stroke: alpha(C.target, 0.28), width: 2, dash: [8, 8],
    });

    const n = Vec2.fromAngle(this.doorTheta);
    const t = n.perp().scale(1.5 * pulse);
    r.path([this.door.add(t), this.door.sub(t)], { stroke: C.target, width: 6 });
    r.ring(this.door, 1.3 * pulse, alpha(C.target, 0.55), { width: 2, dash: [6, 6] });
    r.worldText('DOOR', this.door, {
      dy: -28, size: 13, weight: 800, colour: C.target, align: 'center', halo: true,
    });
    r.worldText(`${toDeg(this.doorTheta).toFixed(1)}°`, this.door, {
      dy: 30, size: 13, weight: 700, colour: alpha(C.target, 0.8), align: 'center', halo: true,
    });
  }

  drawForces() {
    const r = this.r;
    const origin = this.crate.pos;
    const scale = 0.1; // metres of arrow per newton

    // Each contributing force, faint, from the crate.
    for (const f of this.forces) {
      const v = Vec2.fromAngle(f.theta, f.magnitude * scale);
      r.arrow(origin, origin.add(v), {
        colour: alpha(C.force, 0.45), width: 2.5,
        label: `${f.magnitude} N`, labelSize: 12,
      });
    }

    // The resultant, with the component triangle drawn underneath it.
    const R = resultant(this.forces);
    if (R.magnitude > 0.01) {
      drawComponents(r, origin, v2(R.x, R.y), C.force, {
        scale, symbol: 'ΣF', unit: 'N', width: 4.5,
      });
    }
  }

  // --- attract ------------------------------------------------------------------

  attract(dt) {
    this.update(dt);
    if (this.running) return;
    this.attractWait = (this.attractWait ?? 0) - dt;
    if (this.attractWait > 0) return;
    this.attractWait = 3.4;

    this.resetCrate();
    this.active.clear();
    // Show the tidy answer half the time and a wrong guess the rest, so the loop
    // demonstrates both the mistake and the fix.
    this.attractGood = !this.attractGood;
    if (this.attractGood) {
      this.active.add(0);
      this.active.add(1);
    } else {
      this.active.add(0);
      this.active.add(4);
    }
    this.refreshDock();
    this.refreshMaths();
    setTimeout(() => {
      if (this.app.attractMode) this.go();
    }, 900);
  }
}
