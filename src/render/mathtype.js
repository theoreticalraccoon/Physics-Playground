// Small maths typesetter, in HTML.
//
// Equations here are live: the same numbers that drive the simulation are printed
// inside the formula, updating every frame. That is the whole pedagogical trick, so
// the typesetting has to be good enough that the formula reads as maths rather than
// as a line of code.
//
// No KaTeX or MathJax. They are excellent and they are also 300 kB over a venue's
// wifi to draw about fifteen distinct expressions. Fractions, superscripts, roots
// and Greek letters cover everything the stand needs, and CSS does all four.

/** A stacked fraction. */
export const frac = (num, den) =>
  `<span class="frac"><span class="fnum">${num}</span><span class="fden">${den}</span></span>`;

export const sup = (x) => `<sup>${x}</sup>`;
export const sub = (x) => `<sub>${x}</sub>`;

/**
 * Square root, written with brackets rather than an overbar.
 *
 * An overbar has to be as tall as whatever it covers, and a single √ glyph cannot
 * stretch to match — put a fraction or a superscript under it and the bar detaches
 * and floats. Brackets are immune to that, they are what a student writes by hand,
 * and they stay unambiguous at any size. Not the prettiest option in a textbook;
 * the most reliable one on a stranger's tablet.
 */
export const sqrt = (x) =>
  `<span class="sqrt"><span class="rad-open">(</span>`
  + `<span class="radicand">${x}</span><span class="rad-close">)</span></span>`;

/**
 * A live number. `tone` picks the colour so the value matches the quantity it
 * belongs to — a velocity printed inside a formula is the same cyan as its arrow.
 */
export const num = (x, dp = 1, tone = '') =>
  `<span class="mnum${tone ? ` t-${tone}` : ''}">${
    typeof x === 'number' ? x.toFixed(dp) : x
  }</span>`;

/** A symbol standing for a quantity, italic as convention demands. */
export const sym = (s, tone = '') =>
  `<span class="msym${tone ? ` t-${tone}` : ''}">${s}</span>`;

export const op = (s) => `<span class="mop">${s}</span>`;

/**
 * A unit, spaced off the number it follows. Degrees and percent are the exception —
 * they belong tight against the digits, so they get the narrower spacing.
 */
export const unit = (u) =>
  `<span class="munit${/^[°%]$/.test(u) ? ' is-tight' : ''}">${u}</span>`;

/** Degrees, which come up often enough to be worth their own helper. */
export const deg = () => unit('°');

/** Wrap a whole expression so it lays out on the baseline correctly. */
export const eq = (...parts) => `<span class="eqn">${parts.join('')}</span>`;

/** The Greek and symbols the stand actually uses, so call sites stay readable. */
export const G = {
  theta: 'θ',
  mu: 'μ',
  omega: 'ω',
  pi: 'π',
  Delta: 'Δ',
  Sigma: 'Σ',
  alpha: 'α',
  degree: '°',
  approx: '≈',
  times: '×',
  minus: '−',
  plus: '+',
  cdot: '·',
  le: '≤',
  ge: '≥',
  ne: '≠',
  sqrtSign: '√',
  arrow: '→',
};

/**
 * Signed value with an explicit sign character, for component readouts where the
 * direction matters as much as the size.
 */
export const signed = (x, dp = 1, tone = '') =>
  `<span class="mnum${tone ? ` t-${tone}` : ''}">${x < 0 ? G.minus : '+'}${
    Math.abs(x).toFixed(dp)
  }</span>`;

/**
 * Render a quadratic as y = ax + bx², collapsing the sign of b into the operator
 * so it never prints "+ -0.03".
 */
export function quadratic(a, b, tone = 'accent') {
  const bSign = b < 0 ? G.minus : G.plus;
  return eq(
    sym('y'), op('='), num(a, 3, tone), sym('x'),
    op(bSign), num(Math.abs(b), 4, tone), sym('x'), sup('2'),
  );
}
