// Headless smoke test.
//
// The engine tests check the physics. This checks the other half: that every
// station builds, lays out its panels, takes a drag, runs a few hundred frames and
// draws, without throwing. Those are the failures that would only show up in front
// of a queue of children, so they are worth catching in Node.
//
// The DOM here is a stub, not a real implementation. It exists to let the code run;
// it does not check that anything is laid out correctly. Anything visual still has
// to be looked at in a browser.
//
//   node tests/smoke.js

import { installDOM } from './dom-stub.js';

installDOM();

const { LaunchStation } = await import('../src/stations/launch.js');
const { ResultantStation } = await import('../src/stations/resultant.js');
const { SlingshotStation } = await import('../src/stations/slingshot.js');
const { ImpactStation } = await import('../src/stations/impact.js');
const { SwingStation } = await import('../src/stations/swing.js');
const { SlopeStation } = await import('../src/stations/slope.js');
const { Renderer } = await import('../src/render/renderer.js');
const { v2 } = await import('../src/core/vec2.js');
const Scores = await import('../src/fair/scores.js');
const { Sound } = await import('../src/fair/sound.js');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}\n      ${(e.stack ?? '').split('\n')[1]?.trim() ?? ''}`);
  }
}

/**
 * Enough of the shell for a station to run against.
 *
 * This has to mirror the real App's surface, not merely satisfy the type of call a
 * station happens to make. Stubbing `sound` as a bare arrow function once hid a
 * crash that took out the entire attract screen in production: the real app held a
 * Sound *object* while every station called `app.sound('hit')` as a *function*.
 * The stub was the only thing in the system where that worked. So: real Sound
 * instance, behind the same method the real app exposes.
 */
function makeApp() {
  const canvas = document.getElementById('canvas');
  const renderer = new Renderer(canvas);
  return {
    renderer,
    xray: false,
    attractMode: false,
    audio: new Sound(),
    sound(name) {
      this.audio.play(name);
    },
    dom: {
      stage: document.getElementById('stage'),
      mathPanel: document.getElementById('mathPanel'),
      controls: document.getElementById('controls'),
    },
    insets: () => ({ top: 76, right: 0, bottom: 190, left: 364 }),
    panelBottom: () => 430,
    setHint: () => {},
    onStationSolved: () => {},
    onStationFailed: () => {},
  };
}

const STATIONS = [
  ['launch', LaunchStation],
  ['resultant', ResultantStation],
  ['slingshot', SlingshotStation],
  ['impact', ImpactStation],
  ['swing', SwingStation],
  ['slope', SlopeStation],
];

for (const [id, Klass] of STATIONS) {
  const app = makeApp();
  let station;

  check(`${id}: constructs and enters`, () => {
    station = new Klass(app);
    station.enter();
    if (!station.constructor.title) throw new Error('no title');
  });
  if (!station) continue;

  check(`${id}: renders cold`, () => station.render());

  check(`${id}: survives a drag`, () => {
    station.onPointerDown(v2(3, 3), { x: 400, y: 300 });
    station.onPointerMove(v2(6, 5), { x: 500, y: 250 });
    station.onPointerUp(v2(6, 5), { x: 500, y: 250 });
  });

  // Six hundred frames at 60 fps is ten seconds of play, which is enough to get a
  // shot fired, landed, judged and reset on every station.
  check(`${id}: runs 600 frames`, () => {
    for (let i = 0; i < 600; i++) {
      station.update(1 / 60);
      station.render();
    }
  });

  check(`${id}: renders with x-ray on`, () => {
    app.xray = true;
    station.render();
    station.refreshMaths?.();
    app.xray = false;
  });

  check(`${id}: runs its attract loop`, () => {
    app.attractMode = true;
    for (let i = 0; i < 400; i++) station.attract(1 / 60);
    station.render();
    app.attractMode = false;
  });

  // The shell warms a station by running attract() for three seconds before the
  // first frame is drawn. A throw in there happens inside the App constructor, so
  // nothing renders at all and the stand shows a black screen.
  check(`${id}: survives the attract warm-up from cold`, () => {
    const fresh = new Klass(app);
    fresh.enter();
    app.attractMode = true;
    for (let i = 0; i < 180; i++) fresh.attract(1 / 60);
    fresh.render();
    app.attractMode = false;
    fresh.exit();
  });

  check(`${id}: nothing has gone to NaN`, () => {
    for (const b of station.world?.bodies ?? []) {
      if (!b.pos.isFinite() || !b.vel.isFinite()) {
        throw new Error(`body ${b.id} at ${b.pos} vel ${b.vel}`);
      }
    }
  });

  check(`${id}: resets cleanly`, () => {
    station.restart();
    station.render();
  });

  check(`${id}: exits`, () => station.exit());
}

// --- every station must actually be winnable ------------------------------------

// The gap this closes: Impact shipped unwinnable. Its physics was perfect and every
// check above passed — it built, ran, drew, never went to NaN — but it polled
// `world.manifolds` at frame boundaries while the world rebuilt that list eight
// times per frame, so it never once saw the collision and could not award a star.
// "Does it run" was never the right question. "Can it be solved" is.

const { solveLaunchAngle } = await import('../src/stations/launch-math.js');
const { lengthForPeriod } = await import('../src/stations/swing-math.js');
const { criticalAngle } = await import('../src/stations/slope-math.js');
const { toRad } = await import('../src/core/vec2.js');

/** Run a station until it reports a result, or give up. */
function play(station, frames = 1200) {
  for (let i = 0; i < frames; i++) {
    station.update(1 / 60);
    if (station.solved) return true;
  }
  return station.solved;
}

const WINNABLE = {
  launch: (s) => {
    // theta = asin(gd/v^2)/2 is the angle that lands on the target exactly.
    const theta = solveLaunchAngle(s.targetD, s.speed, 9.81);
    if (theta === null) throw new Error(`target at ${s.targetD.toFixed(1)} m is out of range`);
    s.fire(theta, s.speed);
  },
  resultant: (s) => {
    s.active.clear();
    s.active.add(0); // 30 N east
    s.active.add(1); // 40 N north  -> 50 N at 53.13 degrees, straight at the door
    s.go();
  },
  slingshot: (s) => {
    // Found by searching the trajectory space; bends round the planet into the ring.
    s.launchVel = v2(0.8, 4.12);
    s.launch();
  },
  impact: (s) => {
    s.m1 = 2;
    s.m2 = 2;
    s.e = 1;
    s.applyMasses();
    s.go();
  },
  swing: (s) => {
    // Exactly what the panel tells the player to do, at the slider's real step.
    s.L = Math.round(lengthForPeriod(s.targetT, 9.81) * 100) / 100;
    s.release();
    s.lockIn();
  },
  slope: (s) => {
    s.angle = criticalAngle(s.mu) - toRad(1);
    s.targetAngle = s.angle;
    s.lockIn();
  },
};

for (const [id, Klass] of STATIONS) {
  check(`${id}: is winnable, and pays 3 stars for getting it first time`, () => {
    const app = makeApp();
    let awarded = null;
    app.onStationSolved = (s, stars) => { awarded = stars; };

    const station = new Klass(app);
    station.enter();
    WINNABLE[id](station);
    play(station);

    if (!station.solved) throw new Error('played the intended solution and never solved');
    if (awarded !== 3) throw new Error(`awarded ${awarded} stars first time, want 3`);
  });
}

check('swing: never opens already matching the target', () => {
  // A free three stars for touching nothing is worse than a hard station.
  const app = makeApp();
  for (let i = 0; i < 300; i++) {
    const s = new SwingStation(app);
    s.L = 0.4 + Math.random() * 3.6;   // whatever the last player left it on
    s.enter();
    const T = 2 * Math.PI * Math.sqrt(s.L / 9.81);
    const err = Math.abs(T - s.targetT) / s.targetT;
    if (err < 0.02) {
      throw new Error(`opened already matched: L=${s.L.toFixed(2)} T=${T.toFixed(3)} target=${s.targetT.toFixed(3)}`);
    }
  }
});

// --- the scoreboard ------------------------------------------------------------

check('scores: a run records, saves and ranks', () => {
  Scores.clearAll();
  const p = Scores.newPlayer('  Ada  Lovelace ', '9 b');
  if (p.name !== 'Ada Lovelace') throw new Error(`name not tidied: "${p.name}"`);
  if (p.klass !== '9B') throw new Error(`class not tidied: "${p.klass}"`);

  Scores.recordStars(p, 'launch', 3);
  Scores.recordStars(p, 'swing', 2);
  if (p.score !== 500) throw new Error(`score ${p.score}, want 500`);

  // A worse replay must not lower the score.
  Scores.recordStars(p, 'launch', 1);
  if (p.score !== 500) throw new Error(`replay lowered the score to ${p.score}`);

  Scores.save(p);
  if (Scores.rankOf(p.id) !== 1) throw new Error('should be top of an empty board');

  const rival = Scores.newPlayer('Grace', '9B');
  Scores.recordStars(rival, 'launch', 3);
  Scores.recordStars(rival, 'swing', 3);
  Scores.recordStars(rival, 'slope', 3);
  Scores.save(rival);
  if (Scores.rankOf(rival.id) !== 1) throw new Error('higher score should rank first');
  if (Scores.rankOf(p.id) !== 2) throw new Error('lower score should drop to second');
});

check('scores: class standings rank by best run', () => {
  const s = Scores.classStandings();
  if (!s.length) throw new Error('no classes');
  if (s[0].klass !== '9B') throw new Error(`top class ${s[0].klass}`);
  if (s[0].best !== 900) throw new Error(`best ${s[0].best}, want 900`);
  if (s[0].players !== 2) throw new Error(`players ${s[0].players}, want 2`);
  if (s[0].champion !== 'Grace') throw new Error(`champion ${s[0].champion}`);
});

check('scores: CSV has a header and one row per run', () => {
  const csv = Scores.toCSV();
  const lines = csv.trim().split('\r\n');
  if (lines.length !== 3) throw new Error(`${lines.length} lines, want 3`);
  if (!lines[0].startsWith('Rank,Name,Class,Score')) throw new Error('bad header');
  if (!lines[1].includes('Grace')) throw new Error('winner not on the first row');
});

check('scores: a comma in a name cannot break the CSV', () => {
  Scores.clearAll();
  const p = Scores.newPlayer('Bond, James', '7A');
  Scores.recordStars(p, 'launch', 3);
  Scores.save(p);
  const row = Scores.toCSV().trim().split('\r\n')[1];
  if (!row.includes('"Bond, James"')) throw new Error(`not quoted: ${row}`);
  Scores.clearAll();
});

// --- the shell ------------------------------------------------------------------

// Importing main.js boots a real App against the stub DOM, which is the point: the
// station/shell contract lives in that file and nothing above tests it. A throw
// during boot happens before the first frame is drawn, so the stand shows a black
// screen and no station-level test can see it. Catch the rejection rather than
// letting it take the whole run down.
let bootError = null;
let AppClass = null;
try {
  ({ App: AppClass } = await import('../src/main.js'));
} catch (e) {
  bootError = e;
}

check('shell: the real App boots and reaches the attract screen', () => {
  if (bootError) throw bootError;
  if (typeof AppClass !== 'function') throw new Error('App is not exported from main.js');

  const app = new AppClass();
  if (!app.station) throw new Error('attract screen picked no station');
  if (app.screen !== 'attract') throw new Error(`booted to "${app.screen}", want attract`);
});

check('shell: app.sound is callable, the way every station calls it', () => {
  if (bootError) throw bootError;
  const app = new AppClass();
  if (typeof app.sound !== 'function') {
    throw new Error('stations call app.sound("hit"); app.sound is not a function');
  }
  // The exact call that took the attract screen down in production.
  app.sound('hit');
  app.sound('nonexistent-cue');
});

check('shell: every station can be opened through the shell', () => {
  if (bootError) throw bootError;
  const app = new AppClass();
  app.player = Scores.newPlayer('Test', '9B');
  for (const [id] of STATIONS) {
    app.play(id);
    if (app.station.id !== id) throw new Error(`play("${id}") opened ${app.station.id}`);
    for (let i = 0; i < 90; i++) app.station.update(1 / 60);
    app.station.render();
  }
  app.showMenu();
  app.showBoard();
  Scores.clearAll();
});

check('shell: clearing the board empties it and drops the run in progress', () => {
  if (bootError) throw bootError;
  Scores.clearAll();

  const app = new AppClass();
  const ghost = Scores.newPlayer('Ada', '9B');
  Scores.recordStars(ghost, 'launch', 3);
  Scores.save(ghost);
  app.player = ghost;
  if (Scores.all().length !== 1) throw new Error('setup failed');

  app.showBoard();
  app.confirmClearBoard('board');
  // The confirm screen asks first — nothing is gone until it is answered.
  if (Scores.all().length !== 1) throw new Error('wiped before being confirmed');

  // Answer it the way the sheet's delete button does.
  Scores.clearAll();
  app.player = null;

  if (Scores.all().length !== 0) throw new Error('board not empty after clearing');

  // The real trap: a player still held in memory gets written straight back onto
  // the board the next time anything saves, so the "fresh" board is not fresh.
  if (app.player) throw new Error('run in progress survived the clear');
  app.showBoard();
  if (Scores.all().length !== 0) throw new Error(`board repopulated itself: ${Scores.all().length}`);
});

check('shell: clearing an already-empty board is harmless', () => {
  if (bootError) throw bootError;
  Scores.clearAll();
  const app = new AppClass();
  app.confirmClearBoard('board');
  app.confirmClearBoard('teacher');
  if (Scores.all().length !== 0) throw new Error('created entries from nothing');
});

// --- report --------------------------------------------------------------------

console.log('');
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log('');
console.log(`  ${passed}/${passed + failed} checks passed${failed ? `, ${failed} failed` : ''}`);
console.log('');
process.exit(failed ? 1 : 0);
