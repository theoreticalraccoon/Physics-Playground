// Touch-first DOM controls.
//
// Everything here assumes a finger, not a mouse: nothing depends on hover, targets
// are at least 48 px, sliders have a grab area far larger than the track they draw,
// and drags use Pointer Events with capture so a finger sliding off the control
// keeps working instead of silently stopping.

/** Tiny DOM builder. Children may be nodes, strings, or nested arrays. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        // Object.assign onto a CSSStyleDeclaration silently drops custom
        // properties, because `--hue` is not a named property on it. They have to
        // go through setProperty or the station colours never arrive.
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * A big labelled slider with a live value readout.
 *
 * Returns the element with `.set(value)` attached, so a station can drive it from
 * the simulation (the Swing station moves the length slider during attract mode)
 * without re-reading the DOM.
 */
export function slider({
  label, min, max, step = 0.01, value, unit = '', dp = 1,
  onInput, tone = '', format = null,
}) {
  const readout = el('span', { class: `slider-value${tone ? ` t-${tone}` : ''}` });
  const input = el('input', {
    type: 'range', min, max, step, value,
    class: 'slider-input',
    'aria-label': label,
  });

  const paint = (v) => {
    readout.textContent = format ? format(v) : `${v.toFixed(dp)}${unit ? ` ${unit}` : ''}`;
    // Fill the track up to the thumb, which reads much better at a glance than a
    // bare groove when someone is looking from two metres away.
    const pct = ((v - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    paint(v);
    onInput?.(v);
  });
  paint(value);

  const wrap = el('label', { class: `slider${tone ? ` tone-${tone}` : ''}` },
    el('span', { class: 'slider-head' },
      el('span', { class: 'slider-label', text: label }),
      readout),
    input);

  wrap.set = (v) => {
    input.value = v;
    paint(v);
  };
  wrap.get = () => parseFloat(input.value);
  return wrap;
}

export function button(label, onTap, opts = {}) {
  const b = el('button', {
    class: `btn${opts.variant ? ` btn-${opts.variant}` : ''}${opts.class ? ` ${opts.class}` : ''}`,
    type: 'button',
  }, opts.icon ? el('span', { class: 'btn-icon', text: opts.icon }) : null,
     el('span', { text: label }));
  b.addEventListener('click', (e) => {
    e.preventDefault();
    onTap?.(e);
  });
  return b;
}

/** A row of mutually exclusive chips. Returns the element with `.select(value)`. */
export function segmented(options, value, onChange) {
  const buttons = new Map();
  const wrap = el('div', { class: 'segmented' });

  for (const o of options) {
    const b = el('button', {
      class: `seg${o.value === value ? ' is-on' : ''}`,
      type: 'button',
      text: o.label,
    });
    b.addEventListener('click', () => {
      wrap.select(o.value);
      onChange?.(o.value);
    });
    buttons.set(o.value, b);
    wrap.append(b);
  }

  wrap.select = (v) => {
    for (const [key, b] of buttons) b.classList.toggle('is-on', key === v);
  };
  return wrap;
}

/** An on/off pill, for the X-ray toggle. */
export function toggle(label, on, onChange) {
  const b = el('button', {
    class: `toggle${on ? ' is-on' : ''}`,
    type: 'button',
  }, el('span', { class: 'toggle-dot' }), el('span', { text: label }));

  let state = on;
  b.addEventListener('click', () => {
    state = !state;
    b.classList.toggle('is-on', state);
    onChange?.(state);
  });
  b.set = (v) => {
    state = v;
    b.classList.toggle('is-on', state);
  };
  return b;
}

/**
 * Pointer drag on any element, in element-local pixels.
 *
 * Capture is the important part: without it, a finger that slides beyond the canvas
 * edge mid-aim stops sending events and the shot is lost. With it, the drag follows
 * the finger anywhere on screen until it lifts.
 */
export function onDrag(target, { onStart, onMove, onEnd, onTap } = {}) {
  let active = null;
  let startPos = null;
  let moved = 0;

  const local = (e) => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  target.addEventListener('pointerdown', (e) => {
    if (active !== null) return; // ignore a second finger mid-drag
    active = e.pointerId;
    moved = 0;
    startPos = local(e);
    target.setPointerCapture(e.pointerId);
    onStart?.(startPos, e);
  });

  target.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    const p = local(e);
    moved = Math.max(moved, Math.hypot(p.x - startPos.x, p.y - startPos.y));
    onMove?.(p, e, startPos);
  });

  const finish = (e) => {
    if (e.pointerId !== active) return;
    const p = local(e);
    active = null;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      // Capture can already be gone if the pointer was cancelled by the browser.
    }
    onEnd?.(p, e, startPos);
    // A short drag is a tap. 10 px of slop, because fingers are not precise.
    if (moved < 10) onTap?.(p, e);
  };

  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);

  return () => {
    active = null;
  };
}

/** Star row for a score. Filled stars up to `n` out of `of`. */
export function stars(n, of = 3, size = 'md') {
  return el('span', { class: `stars stars-${size}` },
    Array.from({ length: of }, (_, i) => el('span', {
      class: `star${i < n ? ' is-on' : ''}`,
      text: '★',
    })));
}

/**
 * A short-lived message over the canvas: "HIT!", "Try again", the complementary
 * angle reveal. Auto-removes, so callers never have to track it.
 */
export function toast(parent, html, { ms = 2200, tone = '' } = {}) {
  const t = el('div', { class: `toast${tone ? ` toast-${tone}` : ''}`, html });
  parent.append(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => {
    t.classList.remove('is-in');
    setTimeout(() => t.remove(), 400);
  }, ms);
  return t;
}

/** Format a number for display without exponent notation creeping in. */
export function fmt(x, dp = 1) {
  if (!Number.isFinite(x)) return '∞';
  if (Math.abs(x) >= 100000) return x.toExponential(1);
  return x.toFixed(dp);
}
