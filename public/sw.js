/**
 * Lattice Notes offline shell.
 *
 * This file is a template. The build replaces the version marker with a
 * hash of this file and of every precached asset, and fills the precache
 * marker with the files of the finished build. Edit this file, never
 * `dist/sw.js`.
 */

const CACHE_PREFIX = 'lattice-notes-shell-';
const VERSION = '__CACHE_VERSION__';
const CACHE = 'lattice-notes-shell-__CACHE_VERSION__';
const PRECACHE = /* __PRECACHE_LIST__ */ [];
const SHELL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(PRECACHE);
      } catch (error) {
        // A half filled shell is worse than no shell: drop it and let the
        // install fail, so the previous worker stays in control.
        await caches.delete(CACHE);
        throw error;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.includes('/node_modules/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  return cached || fetch(request);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    return await fetch(request);
  } catch {
    return (await cache.match(SHELL)) || Response.error();
  }
}
