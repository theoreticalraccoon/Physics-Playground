// Offline cache.
//
// Venue wifi is the least reliable thing at any fair. Once the stand has loaded
// once, this keeps it running whether or not the network is still there.
//
// Bump CACHE when you change any file, or tablets will keep serving the old copy.

const CACHE = 'physics-playground-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/core/vec2.js',
  './src/core/body.js',
  './src/core/collide.js',
  './src/core/solver.js',
  './src/core/constraints.js',
  './src/core/integrators.js',
  './src/core/world.js',
  './src/render/palette.js',
  './src/render/renderer.js',
  './src/render/xray.js',
  './src/render/mathtype.js',
  './src/render/ui.js',
  './src/fair/scores.js',
  './src/fair/sound.js',
  './src/stations/station.js',
  './src/stations/launch.js',
  './src/stations/launch-math.js',
  './src/stations/resultant.js',
  './src/stations/resultant-math.js',
  './src/stations/slingshot.js',
  './src/stations/orbit-math.js',
  './src/stations/impact.js',
  './src/stations/impact-math.js',
  './src/stations/swing.js',
  './src/stations/swing-math.js',
  './src/stations/slope.js',
  './src/stations/slope-math.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Individually, so one bad path cannot fail the whole install.
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network first, falling back to cache.
 *
 * The other way round would be faster, but it also means a stand that has been
 * updated keeps showing yesterday's build until someone works out how to clear it.
 * Going to the network first costs a few milliseconds on a good connection and
 * removes an entire category of "why is it not updating" on the morning of the fair.
 */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
