// The leaderboard.
//
// It lives in localStorage on the tablet it was played on. GitHub Pages serves
// static files and runs nothing, so there is no server to hold a shared board —
// and for a single stand that turns out to be the right answer anyway. It survives
// the venue wifi dying, needs no accounts, and children's names never leave the
// device they were typed into.
//
// The consequence to know about: two tablets keep two boards, and they cannot be
// merged live. Export both to CSV at the end of the day if you need one list.

const KEY = 'physics-playground.scores.v1';
const MAX_ENTRIES = 500;

export const STATION_IDS = ['launch', 'resultant', 'slingshot', 'impact', 'swing', 'slope'];

/** Stars convert straight to points, so the score is legible: 3 stars = 300. */
export const POINTS_PER_STAR = 100;
export const MAX_SCORE = STATION_IDS.length * 3 * POINTS_PER_STAR;

/** @typedef {{id: string, name: string, klass: string, stars: Record<string, number>, score: number, at: number}} Entry */

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Private browsing, cleared storage, or a corrupt value. An empty board is a
    // fine thing to start the day with; never let this take the stand down.
    return [];
  }
}

function write(entries) {
  try {
    // Keep the file bounded. A busy stand can take hundreds of plays and there is
    // no reason to carry every one of them forever.
    const trimmed = entries
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

/** Names are typed by children on a tablet in a hurry. Be forgiving, then tidy. */
export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
}

/** Classes normalise to a compact uppercase form: "9 b" and "9B" are one class. */
export function cleanClass(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, 8);
}

export function newPlayer(name, klass) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName(name),
    klass: cleanClass(klass),
    stars: {},
    score: 0,
    at: Date.now(),
  };
}

export const scoreOf = (player) =>
  Object.values(player.stars ?? {}).reduce((s, n) => s + n * POINTS_PER_STAR, 0);

export const starTotal = (player) =>
  Object.values(player.stars ?? {}).reduce((s, n) => s + n, 0);

/**
 * Record a station result. Only an improvement counts, so a kid who replays a
 * station cannot lower their own score by messing about on the second go.
 */
export function recordStars(player, stationId, stars) {
  const best = Math.max(player.stars[stationId] ?? 0, stars);
  const improved = best > (player.stars[stationId] ?? 0);
  player.stars[stationId] = best;
  player.score = scoreOf(player);
  return improved;
}

export const stationsPlayed = (player) => Object.keys(player.stars ?? {}).length;

export const hasFinished = (player) => stationsPlayed(player) >= STATION_IDS.length;

/** Save or update a player's entry. Returns their rank on the whole board. */
export function save(player) {
  if (!player.name) return null;
  const entries = read().filter((e) => e.id !== player.id);
  entries.push({ ...player, score: scoreOf(player), at: Date.now() });
  write(entries);
  return rankOf(player.id);
}

export function all() {
  return read();
}

/** Top entries, highest score first, ties broken by who got there first. */
export function leaderboard(limit = 20, klass = null) {
  const entries = read().filter((e) => (klass ? e.klass === klass : true));
  return entries
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, limit);
}

export function rankOf(id, klass = null) {
  const board = leaderboard(Infinity, klass);
  const i = board.findIndex((e) => e.id === id);
  return i < 0 ? null : i + 1;
}

export const classList = () =>
  [...new Set(read().map((e) => e.klass).filter(Boolean))].sort();

/**
 * Class standings — the part that makes a stand busy.
 *
 * Ranked by best score rather than average, because average punishes a class for
 * being enthusiastic and sending thirty kids over. Best score means one strong run
 * puts a class on top and the rest come over to defend it.
 */
export function classStandings() {
  const byClass = new Map();
  for (const e of read()) {
    if (!e.klass) continue;
    const c = byClass.get(e.klass) ?? { klass: e.klass, best: 0, players: 0, total: 0, champion: '' };
    c.players++;
    c.total += e.score;
    if (e.score > c.best) {
      c.best = e.score;
      c.champion = e.name;
    }
    byClass.set(e.klass, c);
  }
  return [...byClass.values()]
    .map((c) => ({ ...c, average: Math.round(c.total / c.players) }))
    .sort((a, b) => b.best - a.best || b.average - a.average);
}

/** Classes most recently used, to offer as one-tap chips on the entry screen. */
export function recentClasses(limit = 8) {
  const seen = new Map();
  for (const e of read().sort((a, b) => b.at - a.at)) {
    if (e.klass && !seen.has(e.klass)) seen.set(e.klass, e.at);
    if (seen.size >= limit) break;
  }
  return [...seen.keys()];
}

// --- teacher controls ---------------------------------------------------------

/** CSV of the whole board, for the teacher to take away at the end of the day. */
export function toCSV() {
  const header = ['Rank', 'Name', 'Class', 'Score', 'Stars', 'Stations', ...STATION_IDS, 'Played at'];
  const rows = leaderboard(Infinity).map((e, i) => [
    i + 1,
    e.name,
    e.klass,
    e.score,
    starTotal(e),
    stationsPlayed(e),
    ...STATION_IDS.map((s) => e.stars?.[s] ?? ''),
    new Date(e.at).toISOString(),
  ]);
  return [header, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCSV(filename = null) {
  const name = filename
    ?? `physics-playground-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob([`﻿${toCSV()}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function clearAll() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** True when storage is usable at all — private mode on iOS can refuse writes. */
export function storageAvailable() {
  try {
    const probe = '__pp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
