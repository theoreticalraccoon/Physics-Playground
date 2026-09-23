// Base class for the six stations.
//
// The shell owns the canvas, the frame loop and the HUD; a station owns a World, a
// panel of controls, and a rule for when the challenge has been met. Keeping that
// split strict is what lets the stations stay short enough to read in one sitting.
//
// Scoring is uniform everywhere, because a kid should never have to work out how
// this particular station is marked:
//
//   first attempt      3 stars
//   second or third    2 stars
//   after that         1 star
//
// Solving it at all is worth something. Nobody walks away with nothing.

import { clearNode, el } from '../render/ui.js';

export class Station {
  /** @type {string} */ static id = 'station';
  /** @type {string} */ static title = 'Station';
  /** @type {string} */ static tagline = '';
  /** @type {string} */ static goal = '';
  /** @type {string} */ static maths = '';
  /** @type {string} */ static icon = '●';

  constructor(app) {
    this.app = app;
    this.r = app.renderer;
    this.world = null;

    this.attempts = 0;
    this.solved = false;
    this.stars = 0;
    this.elapsed = 0;
    // Set true by a station when a run is in flight, so the shell knows not to
    // treat the idle timer as "abandoned".
    this.busy = false;
  }

  get id() {
    return this.constructor.id;
  }

  // --- lifecycle. Subclasses override build/step/render ------------------------

  /** Called once when the station becomes visible. */
  enter() {
    this.attempts = 0;
    this.solved = false;
    this.stars = 0;
    this.elapsed = 0;
    this.build();
    this.layoutPanels();
  }

  /** Called when leaving. Release anything the shell does not own. */
  exit() {
    this.world = null;
  }

  /** Build the world and the DOM controls. */
  build() {}

  /** Put the station's controls into the shell's panel slots. */
  layoutPanels() {}

  /** Advance the simulation. `dt` is real seconds since the last frame. */
  update(dt) {
    this.elapsed += dt;
    if (this.world) this.world.step(dt);
  }

  /** Draw the world. The shell has already cleared the canvas. */
  render() {}

  /** Start again from the initial state, keeping the attempt count. */
  reset() {
    this.build();
  }

  /** Discard everything, including attempts. Used when a new player arrives. */
  restart() {
    this.attempts = 0;
    this.solved = false;
    this.stars = 0;
    this.reset();
  }

  // --- pointer. World coordinates, already converted by the shell ---------------

  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}

  /**
   * Autonomous behaviour for the attract loop, so an unattended stand shows the
   * station playing itself rather than sitting still. Default is to just simulate.
   */
  attract(dt) {
    this.update(dt);
  }

  // --- scoring -----------------------------------------------------------------

  /** Call when the kid commits to an attempt. */
  beginAttempt() {
    this.attempts++;
    this.busy = true;
  }

  /**
   * Call when the challenge is met. Awards stars by attempt count, tells the shell,
   * and returns the stars so the station can show its own celebration.
   */
  succeed(detail = {}) {
    if (this.solved) return this.stars;
    this.solved = true;
    this.busy = false;
    this.stars = this.attempts <= 1 ? 3 : this.attempts <= 3 ? 2 : 1;
    this.app.onStationSolved(this, this.stars, detail);
    return this.stars;
  }

  /** Call when an attempt has clearly failed, so the station can offer a retry. */
  fail(detail = {}) {
    this.busy = false;
    this.app.onStationFailed(this, detail);
  }

  // --- panel helpers -----------------------------------------------------------

  /** The card that holds the live equations. Cleared and rebuilt by the station. */
  mathCard() {
    const card = this.app.dom.mathPanel;
    clearNode(card);
    card.classList.remove('is-empty');
    return card;
  }

  /** The strip along the bottom that holds sliders and buttons. */
  controls() {
    const bar = this.app.dom.controls;
    clearNode(bar);
    return bar;
  }

  /** A titled block inside the maths card. */
  section(title, ...children) {
    return el('div', { class: 'math-section' },
      title ? el('div', { class: 'math-section-title', text: title }) : null,
      ...children);
  }

  /**
   * A single live equation line. Returns the node so it can be updated in place.
   * `wide` is for expressions too long for the panel at the normal size — the
   * momentum equation, mostly.
   */
  line(html, opts = {}) {
    return el('div', {
      class: `math-line${opts.big ? ' is-big' : ''}${opts.dim ? ' is-dim' : ''}`
        + `${opts.wide ? ' is-wide' : ''}`,
      html,
    });
  }

  /** A label/value row for readouts that sit under the equations. */
  row(label, valueNode, tone = '') {
    return el('div', { class: 'math-row' },
      el('span', { class: 'math-row-label', text: label }),
      el('span', { class: `math-row-value${tone ? ` t-${tone}` : ''}` }, valueNode));
  }

  /** The one-line instruction shown under the title. Kept to a handful of words. */
  say(text, tone = '') {
    this.app.setHint(text, tone);
  }
}
