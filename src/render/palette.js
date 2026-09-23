// One colour language for the whole stand.
//
// The rule that matters: a quantity keeps its colour everywhere. Velocity is cyan
// in the cannon, in the orbit and in the collision, so a kid who works out what
// cyan means at one station arrives at the next already knowing. Nothing else is
// allowed to borrow these hues.

export const C = {
  // Ground and furniture
  bg: '#080b14',
  bgPanel: 'rgba(19, 26, 44, 0.92)',
  bgPanelSolid: '#131a2c',
  bgRaised: '#1c2540',
  grid: 'rgba(120, 140, 190, 0.09)',
  gridMajor: 'rgba(120, 140, 190, 0.18)',
  rule: 'rgba(140, 160, 210, 0.22)',

  // Type
  text: '#eef2fb',
  textDim: '#93a0bd',
  textFaint: '#5d6a87',

  // The house accent — used for the brand, the primary action, and nothing else.
  accent: '#ffd23f',
  accentDim: 'rgba(255, 210, 63, 0.16)',

  // Physical quantities. These are the load-bearing ones.
  velocity: '#22d3ee',
  velocityDim: 'rgba(34, 211, 238, 0.30)',
  force: '#fb923c',
  forceDim: 'rgba(251, 146, 60, 0.30)',
  accel: '#fb923c',
  energyK: '#4ade80',
  energyP: '#a78bfa',
  momentum: '#38bdf8',
  target: '#f472b6',
  targetDim: 'rgba(244, 114, 182, 0.25)',

  // Objects
  body: '#dbe4f7',
  bodyStroke: '#8fa3cc',
  ground: '#2a3450',
  groundEdge: '#48587f',

  // Outcomes
  good: '#4ade80',
  bad: '#f87171',
  warn: '#fbbf24',

  // The integrator race: each method keeps its colour in the legend and on the curve.
  exact: '#ffffff',
  euler: '#f87171',
  semi: '#60a5fa',
  verlet: '#c084fc',
  rk4: '#4ade80',
};

/** Star colours for the score chips. */
export const STAR = { on: '#ffd23f', off: 'rgba(255, 210, 63, 0.20)' };

/**
 * Per-station accent, so each one has an identity you recognise from the menu
 * without ever reading its name. Deliberately distinct from the quantity colours
 * above at the points where they would sit side by side.
 */
export const STATION_HUES = {
  launch: '#ffd23f',
  resultant: '#fb923c',
  slingshot: '#a78bfa',
  impact: '#f472b6',
  swing: '#22d3ee',
  slope: '#4ade80',
};

/** Translucent version of any hex colour, for glows and fills. */
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Blend two hex colours. Used for the slip bars and the accuracy meters. */
export function mix(hexA, hexB, t) {
  const parse = (hex) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}
