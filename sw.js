// অফলাইনে চালানোর জন্য ক্যাশ — অ্যাপের ফাইল ও Firebase/ফন্ট ফাইল
const V = 'ah-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/data.js', 'js/ui.js', 'js/util.js', 'js/seed.js', 'js/config.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET') return;
  const ext = /gstatic\.com|googleapis\.com\/css|fonts\.gstatic/.test(u.host + u.pathname);
  if (u.origin !== location.origin && !ext) return; // Firestore/Auth এর নিজস্ব অনলাইন ট্রাফিক ছোঁয়া হয় না
  e.respondWith(caches.open(V).then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
});
