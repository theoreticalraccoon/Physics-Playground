// The shell: one canvas, one frame loop, and a small state machine over the top.
//
// Screens run attract → name → menu → station → menu → board → attract. The idle
// timer sends everything back to attract after 30 seconds untouched, which is the
// single most important feature for a stand nobody has time to babysit: whatever
// the last kid left behind, the next one walks up to a clean start.

import { Renderer } from './render/renderer.js';
import { C } from './render/palette.js';
import { el, clearNode, button, toggle, stars, onDrag, toast } from './render/ui.js';
import { v2 } from './core/vec2.js';

import { LaunchStation } from './stations/launch.js';
import { ResultantStation } from './stations/resultant.js';
import { SlingshotStation } from './stations/slingshot.js';
import { ImpactStation } from './stations/impact.js';
import { SwingStation } from './stations/swing.js';
import { SlopeStation } from './stations/slope.js';

import * as Scores from './fair/scores.js';
import { Sound } from './fair/sound.js';

const STATION_CLASSES = [
  LaunchStation, ResultantStation, SlingshotStation,
  ImpactStation, SwingStation, SlopeStation,
];

const IDLE_MS = 30000;

export class App {
  constructor() {
    this.dom = {
      stage: document.getElementById('stage'),
      canvas: document.getElementById('canvas'),
      hud: document.getElementById('hud'),
      title: document.getElementById('stationTitle'),
      hint: document.getElementById('hint'),
      starRow: document.getElementById('starRow'),
      goal: document.getElementById('goal'),
      backBtn: document.getElementById('backBtn'),
      hudRight: document.getElementById('hudRight'),
      mathPanel: document.getElementById('mathPanel'),
      controls: document.getElementById('controls'),
      overlay: document.getElementById('overlay'),
      scoreChip: document.getElementById('scoreChip'),
    };

    this.renderer = new Renderer(this.dom.canvas);
    // Held as `audio`; the callable `sound(name)` below is the surface stations
    // use, so a station never has to know which object owns the oscillators.
    this.audio = new Sound();
    this.xray = false;
    this.attractMode = true;
    this.player = null;
    this.screen = 'attract';
    this.station = null;
    this.lastPointerAt = performance.now();

    this.stations = new Map(
      STATION_CLASSES.map((Klass) => [Klass.id, new Klass(this)]),
    );

    this.buildChrome();
    this.bindEvents();
    this.route();
    this.loop(performance.now());
  }

  /**
   * Deep links, so the stand can be opened straight onto one station:
   * `?station=slope`. Handy when a teacher wants the tablet parked on the exhibit
   * that goes with today's lesson, and it is how the screenshots get taken.
   */
  route() {
    const q = new URLSearchParams(location.search);
    const id = q.get('station');
    if (id && this.stations.has(id)) {
      this.player = Scores.newPlayer(q.get('name') || 'Guest', q.get('class') || '');
      if (q.get('xray') === '1') {
        this.xray = true;
        this.xrayToggle.set(true);
      }
      this.play(id);
      const warm = parseFloat(q.get('warm'));
      if (Number.isFinite(warm) && warm > 0) this.warm(this.station, warm);
      return;
    }
    if (q.get('screen') === 'menu') {
      this.player = Scores.newPlayer(q.get('name') || 'Guest', q.get('class') || '');
      this.showMenu();
      return;
    }
    if (q.get('screen') === 'board') {
      this.showBoard();
      return;
    }
    this.showAttract();
  }

  // --- chrome -------------------------------------------------------------------

  buildChrome() {
    this.xrayToggle = toggle('X-ray', false, (on) => {
      this.xray = on;
      this.station?.refreshMaths?.();
      this.audio.play('tick');
    });
    this.dom.hudRight.prepend(this.xrayToggle);

    this.dom.backBtn.addEventListener('click', () => {
      this.audio.play('tick');
      if (this.screen === 'play') this.showMenu();
      else if (this.screen === 'board') this.showMenu();
      else this.showAttract();
    });

    // Teacher controls, hidden behind a long press on the title so a child never
    // finds them by accident but a supervising adult can always get at them.
    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(() => this.showTeacher(), 1400);
    };
    const cancelPress = () => clearTimeout(pressTimer);
    for (const ev of ['pointerdown']) this.dom.title.addEventListener(ev, startPress);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      this.dom.title.addEventListener(ev, cancelPress);
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.renderer.resize());
    // A tablet rotating reports the new size a beat after the event fires.
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.renderer.resize(), 200);
    });

    onDrag(this.dom.canvas, {
      onStart: (p) => {
        this.touched();
        this.station?.onPointerDown(this.toWorld(p), p);
      },
      onMove: (p) => {
        this.touched();
        this.station?.onPointerMove(this.toWorld(p), p);
      },
      onEnd: (p) => {
        this.touched();
        this.station?.onPointerUp(this.toWorld(p), p);
      },
    });

    // Any touch anywhere counts as activity, including on the panels.
    for (const ev of ['pointerdown', 'keydown']) {
      document.addEventListener(ev, () => this.touched(), { passive: true });
    }

    // Keyboard shortcuts, for whoever is running the stand.
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'x') this.xrayToggle.click();
      if (e.key === 'Escape') this.screen === 'play' ? this.showMenu() : this.showAttract();
    });
  }

  /**
   * Play a cue. Stations call `this.app.sound('hit')`, so this has to be a method
   * on the app rather than the Sound instance itself — calling the instance is a
   * TypeError, and one thrown out of the attract warm-up takes the whole screen
   * down before anything has been drawn.
   */
  sound(name) {
    this.audio.play(name);
  }

  toWorld(p) {
    return this.renderer.toWorld(p.x, p.y);
  }

  touched() {
    this.lastPointerAt = performance.now();
    this.audio.unlock();
    if (this.attractMode && this.screen === 'attract') return; // the tap is handled by the screen
  }

  /**
   * Space taken by the panels, so a station can frame its action in the part of the
   * canvas that is actually visible.
   */
  insets() {
    const panel = this.dom.mathPanel;
    const controls = this.dom.controls;
    const showPanels = this.screen === 'play';
    return {
      top: this.dom.hud.offsetHeight || 0,
      left: showPanels && panel.offsetWidth ? panel.offsetWidth + 24 : 0,
      right: 0,
      bottom: showPanels && controls.offsetHeight ? controls.offsetHeight + 16 : 0,
    };
  }

  /**
   * Screen y just below the equation card, in CSS pixels. Canvas readouts drawn in
   * the left column use it so they tuck under the panel instead of landing on top
   * of whatever the station is doing.
   */
  panelBottom() {
    const p = this.dom.mathPanel;
    if (!p || p.classList.contains('is-hidden')) return this.dom.hud.offsetHeight + 20;
    return p.offsetTop + p.offsetHeight + 30;
  }

  /**
   * Transient feedback only — "short by 3 m", "too slow by 40 ms".
   *
   * The goal used to live here too, which meant the first miss erased it and a kid
   * arriving mid-run had nothing on screen telling them what they were trying to
   * do. The goal now has its own line and this one never touches it.
   */
  setHint(text, tone = '') {
    this.dom.hint.textContent = text ?? '';
    this.dom.hint.className = tone ? `t-${tone}` : '';
    this.dom.hint.classList.toggle('is-empty', !text);
  }

  /** The station's objective. Set once when the station opens, then left alone. */
  setGoal(text) {
    this.dom.goal.textContent = text ?? '';
    this.dom.goal.classList.toggle('is-empty', !text);
  }

  // --- the loop -----------------------------------------------------------------

  loop(now) {
    const dt = Math.min((now - (this.lastFrame ?? now)) / 1000, 0.05);
    this.lastFrame = now;

    if (this.screen === 'play' || this.attractMode) {
      if (this.attractMode) this.station?.attract(dt);
      else this.station?.update(dt);
    }

    this.renderer.clear(C.bg);
    if (this.station) this.station.render();

    // Idle: hand the stand back to the attract loop, saving whatever was earned.
    if (!this.attractMode && now - this.lastPointerAt > IDLE_MS) {
      this.finishRun(true);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  // --- screens ------------------------------------------------------------------

  clearOverlay() {
    clearNode(this.dom.overlay);
    this.dom.overlay.classList.add('is-empty');
    this.dom.overlay.classList.remove('is-attract', 'no-boards');
  }

  overlayScreen(...children) {
    const o = this.dom.overlay;
    clearNode(o);
    o.classList.remove('is-empty');
    if (this.screen !== 'attract') o.classList.remove('is-attract', 'no-boards');
    o.append(...children);
    return o;
  }

  setChrome({
    title = '', goal = '', hint = '', panels = false, back = false, score = false,
  }) {
    this.dom.title.textContent = title;
    this.setGoal(goal);
    this.setHint(hint);
    this.dom.mathPanel.classList.toggle('is-hidden', !panels);
    this.dom.controls.classList.toggle('is-hidden', !panels);
    this.dom.backBtn.classList.toggle('is-hidden', !back);
    this.dom.hud.classList.toggle('is-hidden', !title && !back);
    this.xrayToggle.classList.toggle('is-hidden', !panels);
    this.dom.scoreChip.classList.toggle('is-hidden', !score || !this.player);
    if (this.player) {
      this.dom.scoreChip.innerHTML =
        `<span class="chip-name">${escapeHTML(this.player.name)}</span>`
        + `<span class="chip-class">${escapeHTML(this.player.klass)}</span>`
        + `<span class="chip-score">${this.player.score}</span>`;
    }
  }

  /** The idle loop: a station playing itself, with the board scrolling past. */
  showAttract() {
    this.screen = 'attract';
    this.attractMode = true;
    this.player = null;
    this.xray = false;
    this.xrayToggle.set(false);

    this.pickAttractStation();
    this.setChrome({});
    clearNode(this.dom.mathPanel);
    clearNode(this.dom.controls);

    const board = Scores.leaderboard(5);
    const classes = Scores.classStandings().slice(0, 3);
    const hasBoards = board.length > 0 || classes.length > 0;

    // The scrim goes light for attract so the station playing behind it is the
    // thing that catches an eye across a hall, not the wall of text over it.
    this.dom.overlay.classList.add('is-attract');
    this.dom.overlay.classList.toggle('no-boards', !hasBoards);

    this.overlayScreen(
      el('div', { class: `attract${hasBoards ? '' : ' is-solo'}` },
        el('div', { class: 'attract-main' },
          el('p', { class: 'eyebrow', text: 'PHYSICS PLAYGROUND' }),
          el('h1', { class: 'attract-title' },
            'Six ways to see ', el('em', {}, 'the maths'), ' move.'),
          el('p', { class: 'attract-sub', text: 'Quadratics, vectors, trigonometry and conics — all of it running in front of you.' }),
          el('button', { class: 'attract-cta', type: 'button' },
            el('span', { text: 'Tap to play' })),
          // Only worth offering once there is something to look at. Tapping the
          // attract screen anywhere starts a run, so this has to swallow its own
          // pointer event or it would open the board and a run at the same time.
          hasBoards
            ? el('button', {
              class: 'attract-link',
              type: 'button',
              text: 'Leaderboard',
              onPointerdown: (e) => {
                e.stopPropagation();
                this.audio.unlock();
                this.showBoard();
              },
            })
            : null),
        el('div', { class: 'attract-boards' },
          board.length
            ? el('div', { class: 'attract-board' },
              el('h3', { text: 'Top scores' }),
              ...board.map((e, i) => el('div', { class: 'board-row' },
                el('span', { class: 'board-rank', text: `${i + 1}` }),
                el('span', { class: 'board-name', text: e.name }),
                el('span', { class: 'board-class', text: e.klass }),
                el('span', { class: 'board-score', text: String(e.score) }))))
            : null,
          classes.length
            ? el('div', { class: 'attract-board' },
              el('h3', { text: 'Classes' }),
              ...classes.map((c, i) => el('div', { class: 'board-row' },
                el('span', { class: 'board-rank', text: `${i + 1}` }),
                el('span', { class: 'board-name', text: c.klass }),
                el('span', { class: 'board-class', text: `${c.players} played` }),
                el('span', { class: 'board-score', text: String(c.best) }))))
            : null)),
    );

    this.dom.overlay.addEventListener('pointerdown', () => {
      if (this.screen === 'attract') this.showProfile();
    }, { once: true });
  }

  /** Rotate which station demonstrates itself, so the stand never looks static. */
  pickAttractStation() {
    const ids = [...this.stations.keys()];
    this.attractIndex = ((this.attractIndex ?? -1) + 1) % ids.length;
    // Three seconds in, so the station is mid-motion the instant it appears.
    this.switchStation(ids[this.attractIndex], 3);
    clearTimeout(this.attractTimer);
    this.attractTimer = setTimeout(() => {
      if (this.screen === 'attract') this.showAttract();
    }, 14000);
  }

  showProfile() {
    this.screen = 'profile';
    this.attractMode = false;
    this.audio.unlock();
    this.touched();
    this.setChrome({ back: true });

    const nameInput = el('input', {
      type: 'text', class: 'field', placeholder: 'Your name',
      maxlength: 18, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false',
    });
    const classInput = el('input', {
      type: 'text', class: 'field', placeholder: 'Class (e.g. 9B)',
      maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    });

    const start = () => {
      const name = Scores.cleanName(nameInput.value) || 'Player';
      const klass = Scores.cleanClass(classInput.value);
      this.player = Scores.newPlayer(name, klass);
      this.showMenu();
    };

    const chips = Scores.recentClasses(6);

    this.overlayScreen(
      el('div', { class: 'sheet' },
        el('h2', { text: 'Who is playing?' }),
        el('p', { class: 'sheet-sub', text: 'Your name goes on the board next to your class. It stays on this tablet.' }),
        el('div', { class: 'field-row' }, nameInput),
        el('div', { class: 'field-row' }, classInput),
        chips.length
          ? el('div', { class: 'chip-row' },
            ...chips.map((c) => {
              const b = el('button', { class: 'class-chip', type: 'button', text: c });
              b.addEventListener('click', () => {
                classInput.value = c;
                this.audio.play('tick');
              });
              return b;
            }))
          : null,
        el('div', { class: 'sheet-actions' },
          button('Start', start, { variant: 'primary' })),
        !Scores.storageAvailable()
          ? el('p', { class: 'warn-note', text: 'This browser will not let the stand save scores, so the board will not survive a reload.' })
          : null),
    );

    nameInput.focus();
    for (const input of [nameInput, classInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') start();
      });
    }
  }

  showMenu() {
    this.screen = 'menu';
    this.attractMode = false;
    this.touched();
    this.setChrome({ back: true, score: true });
    clearNode(this.dom.mathPanel);
    clearNode(this.dom.controls);

    const done = Scores.stationsPlayed(this.player);
    const cards = STATION_CLASSES.map((Klass) => {
      const earned = this.player.stars[Klass.id] ?? 0;
      const card = el('button', {
        class: `station-card${earned ? ' is-done' : ''}`,
        type: 'button',
        style: { '--hue': hueFor(Klass.id) },
      },
      el('span', { class: 'card-icon', text: Klass.icon }),
      el('span', { class: 'card-title', text: Klass.title }),
      el('span', { class: 'card-tag', text: Klass.tagline }),
      el('span', { class: 'card-maths', text: Klass.maths }),
      stars(earned, 3, 'sm'));
      card.addEventListener('click', () => this.play(Klass.id));
      return card;
    });

    this.overlayScreen(
      el('div', { class: 'menu' },
        el('div', { class: 'menu-head' },
          el('h2', {}, 'Pick a station, ', el('em', {}, this.player.name)),
          el('p', { class: 'menu-sub', text: `${done} of 6 done · ${this.player.score} points` })),
        el('div', { class: 'card-grid' }, ...cards),
        el('div', { class: 'menu-actions' },
          button('Leaderboard', () => this.showBoard(), { variant: 'ghost' }),
          button(done ? 'Finish and save' : 'Finish early', () => this.finishRun(false),
            { variant: done >= 6 ? 'primary' : 'ghost' }))),
    );
  }

  play(id) {
    this.touched();
    this.switchStation(id);
    this.screen = 'play';
    this.attractMode = false;
    this.clearOverlay();

    const Klass = this.station.constructor;
    this.setChrome({
      title: Klass.title, goal: Klass.goal, panels: true, back: true, score: true,
    });
    this.renderStars();
    this.audio.play('tick');
  }

  /**
   * @param warmSeconds run the station forward before anyone looks at it. The
   * attract loop uses it so a passer-by meets a pendulum already swinging and a
   * probe already in flight, rather than a screen that has to be waited on.
   */
  switchStation(id, warmSeconds = 0) {
    if (this.station) this.station.exit();
    this.station = this.stations.get(id);
    this.station.enter();
    if (warmSeconds > 0) this.warm(this.station, warmSeconds);
  }

  /** Step a station forward at a fixed 60 Hz without drawing anything. */
  warm(station, seconds) {
    const steps = Math.min(Math.round(seconds * 60), 3600);
    const wasAttract = this.attractMode;
    for (let i = 0; i < steps; i++) {
      if (wasAttract) station.attract(1 / 60);
      else station.update(1 / 60);
    }
  }

  renderStars() {
    clearNode(this.dom.starRow);
    if (this.station) this.dom.starRow.append(stars(this.station.stars, 3, 'md'));
  }

  showBoard() {
    this.screen = 'board';
    this.setChrome({ title: 'Leaderboard', back: true, score: true });
    clearNode(this.dom.mathPanel);
    clearNode(this.dom.controls);

    const board = Scores.leaderboard(12);
    const classes = Scores.classStandings().slice(0, 6);

    this.overlayScreen(
      el('div', { class: 'board-screen' },
        el('div', { class: 'board-col' },
          el('h3', { text: 'Players' }),
          board.length
            ? el('div', {}, ...board.map((e, i) => el('div', {
              class: `board-row${e.id === this.player?.id ? ' is-you' : ''}`,
            },
            el('span', { class: 'board-rank', text: `${i + 1}` }),
            el('span', { class: 'board-name', text: e.name }),
            el('span', { class: 'board-class', text: e.klass }),
            stars(Scores.starTotal(e), 18, 'xs'),
            el('span', { class: 'board-score', text: String(e.score) }))))
            : el('p', { class: 'empty', text: 'Nobody has finished a run yet. Be first.' })),
        el('div', { class: 'board-col' },
          el('h3', { text: 'Classes' }),
          classes.length
            ? el('div', {}, ...classes.map((c, i) => el('div', { class: 'board-row' },
              el('span', { class: 'board-rank', text: `${i + 1}` }),
              el('span', { class: 'board-name', text: c.klass }),
              el('span', { class: 'board-class', text: `best: ${c.champion}` }),
              el('span', { class: 'board-score', text: String(c.best) }))))
            : el('p', { class: 'empty', text: 'No classes yet.' })),
        el('div', { class: 'board-actions' },
          button('Export CSV', () => this.exportScores(), { variant: 'ghost', icon: '↓' }),
          button('Clear the board', () => this.confirmClearBoard('board'),
            { variant: 'danger', icon: '⌫' }),
          button('Back', () => this.showMenu(), { variant: 'ghost' }))),
    );
  }

  exportScores() {
    if (!Scores.all().length) {
      toast(this.dom.stage, 'Nothing to export yet.', { tone: 'warn' });
      return;
    }
    Scores.downloadCSV();
    toast(this.dom.stage, 'Saved to your downloads.', { tone: 'good' });
  }

  /**
   * Wiping the board is irreversible and there is no server copy, so it asks on its
   * own screen with the count spelled out.
   *
   * This used to be a tap-the-same-button-twice confirm, which armed a flag that was
   * only ever cleared by a successful wipe. One tap then walking away left the next
   * single tap — different person, different day — deleting the day's scores with no
   * warning at all. A separate screen cannot get stuck half-armed.
   */
  confirmClearBoard(returnTo) {
    const count = Scores.all().length;
    const back = () => (returnTo === 'board' ? this.showBoard() : this.showTeacher());

    if (!count) {
      toast(this.dom.stage, 'The board is already empty.', { tone: 'warn' });
      return;
    }

    this.setChrome({ title: 'Clear the board?', back: true });
    this.overlayScreen(
      el('div', { class: 'sheet' },
        el('h2', { text: 'Clear the board?' }),
        el('p', { class: 'sheet-sub', text: `This deletes all ${count} run${count === 1 ? '' : 's'} saved on this tablet and starts the leaderboard fresh.` }),
        el('p', { class: 'warn-note', text: 'It cannot be undone, and there is no copy anywhere else. Export the CSV first if today’s scores still matter.' }),
        el('div', { class: 'sheet-actions' },
          button('Cancel', back, { variant: 'primary' }),
          button('Export CSV first', () => this.exportScores(), { variant: 'ghost', icon: '↓' }),
          button(`Delete all ${count}`, () => {
            Scores.clearAll();
            // Drop the run in progress too. Leaving it in memory means the next save
            // writes that player straight back onto the board we just emptied.
            this.player = null;
            this.audio.play('tick');
            toast(this.dom.stage, 'Board cleared. Fresh start.', { tone: 'good' });
            this.showAttract();
          }, { variant: 'danger', icon: '⌫' }))),
    );
  }

  /** Teacher panel: export the day's scores, or wipe the board. */
  showTeacher() {
    this.setChrome({ title: 'Stand controls', back: true });
    const count = Scores.all().length;

    this.overlayScreen(
      el('div', { class: 'sheet' },
        el('h2', { text: 'Stand controls' }),
        el('p', { class: 'sheet-sub', text: `${count} runs saved on this tablet. Scores never leave the device, so export before the tablet is wiped.` }),
        el('div', { class: 'sheet-actions' },
          button('Export CSV', () => this.exportScores(), { variant: 'primary', icon: '↓' }),
          button('Clear the board', () => this.confirmClearBoard('teacher'),
            { variant: 'danger', icon: '⌫' }),
          button('Back', () => this.showAttract(), { variant: 'ghost' }))),
    );
  }

  // --- station callbacks --------------------------------------------------------

  onStationSolved(station, starCount) {
    this.renderStars();
    if (!this.player) return;

    Scores.recordStars(this.player, station.id, starCount);
    this.dom.scoreChip.innerHTML =
      `<span class="chip-name">${escapeHTML(this.player.name)}</span>`
      + `<span class="chip-class">${escapeHTML(this.player.klass)}</span>`
      + `<span class="chip-score">${this.player.score}</span>`;
    Scores.save(this.player);

    // Nudge them onward rather than leaving them staring at a solved puzzle.
    setTimeout(() => {
      if (this.screen === 'play' && this.station === station) {
        this.setHint(Scores.hasFinished(this.player)
          ? 'All six done. Head back for the board.'
          : 'Solved. Back for the next one whenever you like.', 'good');
      }
    }, 2400);
  }

  onStationFailed() {
    this.renderStars();
  }

  /** End a run: save, show where they landed, then hand back to attract. */
  finishRun(fromIdle) {
    if (!this.player) {
      this.showAttract();
      return;
    }
    const played = Scores.stationsPlayed(this.player);
    if (played === 0) {
      this.showAttract();
      return;
    }

    Scores.save(this.player);
    const rank = Scores.rankOf(this.player.id);
    const classRank = this.player.klass
      ? Scores.rankOf(this.player.id, this.player.klass) : null;

    this.screen = 'result';
    this.attractMode = false;
    this.setChrome({ back: true });
    clearNode(this.dom.mathPanel);
    clearNode(this.dom.controls);

    this.overlayScreen(
      el('div', { class: 'sheet result' },
        el('p', { class: 'eyebrow', text: fromIdle ? 'RUN SAVED' : 'NICE WORK' }),
        el('h2', {}, this.player.name),
        el('div', { class: 'result-score', text: String(this.player.score) }),
        stars(Scores.starTotal(this.player), 18, 'md'),
        el('p', { class: 'sheet-sub' },
          `${played} of 6 stations · `,
          rank ? `#${rank} overall` : '',
          classRank && this.player.klass ? ` · #${classRank} in ${this.player.klass}` : ''),
        el('div', { class: 'sheet-actions' },
          button('See the board', () => this.showBoard(), { variant: 'primary' }),
          button('Done', () => this.showAttract(), { variant: 'ghost' }))),
    );

    // If this came from the idle timer, nobody is standing there — go back on our
    // own after a few seconds rather than leaving a name on screen.
    if (fromIdle) setTimeout(() => this.showAttract(), 6000);
  }
}

const hueFor = (id) => ({
  launch: '#ffd23f', resultant: '#fb923c', slingshot: '#a78bfa',
  impact: '#f472b6', swing: '#22d3ee', slope: '#4ade80',
}[id] ?? '#ffd23f');

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Kick off once the DOM exists.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}

// Offline support, so the stand survives the venue wifi dying mid-morning.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // No offline cache. Everything still works while the network holds up.
    });
  });
}
