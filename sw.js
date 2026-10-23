// GymMo2 Service Worker
// - アプリ本体: ネットワーク優先（常に最新）、オフラインや低速時はキャッシュから即起動
// - フォント: stale-while-revalidate
// - API（Apps Script）: キャッシュしない（常に素通し）
const VERSION = 'v1.1.1';
const SHELL_CACHE = `gymmo2-shell-${VERSION}`;
const FONT_CACHE = 'gymmo2-fonts-v1';
const NETWORK_TIMEOUT = 3500;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/screens.css',
  './css/log.css',
  './js/main.js',
  './js/config.js',
  './js/api.js',
  './js/store.js',
  './js/native.js',
  './js/router.js',
  './js/timer.js',
  './js/demo-data.js',
  './js/lib/dates.js',
  './js/lib/dom.js',
  './js/lib/format.js',
  './js/lib/haptics.js',
  './js/lib/html.js',
  './js/lib/metrics.js',
  './js/lib/parse.js',
  './js/lib/sound.js',
  './js/lib/storage.js',
  './js/ui/calendar.js',
  './js/ui/charts.js',
  './js/ui/datepicker.js',
  './js/ui/dock.js',
  './js/ui/icons.js',
  './js/ui/overlay.js',
  './js/ui/ptr.js',
  './js/ui/tabbar.js',
  './js/views/analyze.js',
  './js/views/common.js',
  './js/views/day.js',
  './js/views/exercise.js',
  './js/views/history.js',
  './js/views/log.js',
  './js/views/settings.js',
  './js/views/welcome.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gymmo2-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API は常に素通し
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Google Fonts: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetching = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetching;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // アプリ本体: ネットワーク優先（HTTP キャッシュを再検証）、ダメならキャッシュ
  event.respondWith(
    withTimeout(fetch(req, { cache: 'no-cache' }), NETWORK_TIMEOUT)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./'));
        return Response.error();
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./')))
  );
});
