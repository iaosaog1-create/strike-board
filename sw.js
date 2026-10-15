/* 앱 설치용 서비스워커: 항상 최신 파일을 먼저 받고, 연결이 안 될 때만 저장본을 씁니다 */
const CACHE = 'iaos-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; /* 서버(Supabase)·외부 파일은 건드리지 않음 */
  e.respondWith(fetch(r).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); }
    return res;
  }).catch(() => caches.match(r).then((m) => m || caches.match('index.html'))));
});
