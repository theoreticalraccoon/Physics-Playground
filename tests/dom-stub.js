// A DOM stub, just deep enough to run the stations in Node.
//
// This is not a browser and does not pretend to be one. Elements record their
// children and attributes, the canvas context swallows every call, and layout
// numbers are made up. What it does give us is the ability to run every station's
// build, update and render path in CI and find the crash before a child does.

const NOOP = () => {};

class StubClassList {
  constructor() {
    this.set = new Set();
  }

  add(...c) {
    for (const x of c) this.set.add(x);
  }

  remove(...c) {
    for (const x of c) this.set.delete(x);
  }

  toggle(c, force) {
    const on = force ?? !this.set.has(c);
    if (on) this.set.add(c);
    else this.set.delete(c);
    return on;
  }

  contains(c) {
    return this.set.has(c);
  }
}

class StubElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = new Proxy({}, {
      get: (t, k) => t[k] ?? '',
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
    this.style.setProperty = NOOP;
    this.dataset = {};
    this.classList = new StubClassList();
    this.className = '';
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.listeners = new Map();

    // Made-up geometry. Chosen to look like a landscape tablet so the insets and
    // camera fits exercise realistic numbers.
    this.offsetWidth = 340;
    this.offsetHeight = 190;
  }

  append(...nodes) {
    for (const n of nodes.flat(4)) {
      if (n === null || n === undefined || n === false) continue;
      this.children.push(n);
      if (n instanceof StubElement) n.parentNode = this;
    }
  }

  prepend(...nodes) {
    this.children.unshift(...nodes.flat(4).filter(Boolean));
  }

  replaceChildren(...nodes) {
    this.children = nodes.flat(4).filter(Boolean);
  }

  removeChild(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    return n;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  setAttribute(k, v) {
    this.attributes[k] = v;
  }

  getAttribute(k) {
    return this.attributes[k] ?? null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener() {}

  dispatch(type, ev = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault: NOOP, ...ev });
  }

  click() {
    this.dispatch('click');
  }

  focus() {}

  setPointerCapture() {}

  releasePointerCapture() {}

  getBoundingClientRect() {
    return {
      left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800, x: 0, y: 0,
    };
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

/** Every 2D context call is accepted and every getter returns something numeric. */
function makeContext() {
  const target = {
    measureText: (s) => ({ width: String(s).length * 7 }),
    setTransform: NOOP,
    createLinearGradient: () => ({ addColorStop: NOOP }),
    createRadialGradient: () => ({ addColorStop: NOOP }),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      // Unknown property: assume it is a drawing call, and if it is read as a
      // value instead, an empty string is harmless.
      return typeof k === 'string' && /^[a-z]/.test(k) ? NOOP : '';
    },
    set() {
      return true;
    },
  });
}

class StubCanvas extends StubElement {
  constructor() {
    super('canvas');
    this.width = 1280;
    this.height = 800;
    this._ctx = makeContext();
  }

  getContext() {
    return this._ctx;
  }
}

export function installDOM() {
  const byId = new Map();
  const canvas = new StubCanvas();
  byId.set('canvas', canvas);

  // Must stay in step with the ids in index.html — the shell looks every one of
  // these up at boot and a missing element is a TypeError before the first frame.
  for (const id of ['stage', 'hud', 'stationTitle', 'goal', 'hint', 'starRow',
    'backBtn', 'hudRight', 'mathPanel', 'controls', 'overlay', 'scoreChip']) {
    byId.set(id, new StubElement('div'));
  }

  const store = new Map();

  const doc = {
    readyState: 'complete',
    body: new StubElement('body'),
    documentElement: new StubElement('html'),
    createElement: (tag) => (tag === 'canvas' ? new StubCanvas() : new StubElement(tag)),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: NOOP,
    removeEventListener: NOOP,
  };

  const loc = {
    protocol: 'http:',
    origin: 'http://localhost',
    href: 'http://localhost/',
    search: '',
  };
  globalThis.location = loc;

  globalThis.window = {
    location: loc,
    devicePixelRatio: 2,
    addEventListener: NOOP,
    removeEventListener: NOOP,
    requestAnimationFrame: NOOP,
    AudioContext: null,
  };
  globalThis.document = doc;
  globalThis.Node = StubElement;
  globalThis.requestAnimationFrame = NOOP;
  globalThis.performance ??= { now: () => Date.now() };
  globalThis.navigator ??= {};

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  globalThis.Blob = class {};
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = NOOP;
  globalThis.setTimeout = globalThis.setTimeout ?? NOOP;

  return { byId, canvas };
}
