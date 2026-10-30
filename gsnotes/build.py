#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 Gustavo Salazar
"""Build GSNotes: dist/ (installable PWA) and preview/gsnotes.html (single-file preview)."""
import json, os, re, glob, hashlib
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, DIST, PREV = (os.path.join(ROOT, d) for d in ('src', 'dist', 'preview'))
os.makedirs(DIST, exist_ok=True); os.makedirs(os.path.join(DIST, 'icons'), exist_ok=True); os.makedirs(PREV, exist_ok=True)

css = open(os.path.join(SRC, 'style.css')).read()
js = '\n'.join(open(f).read() for f in sorted(glob.glob(os.path.join(SRC, '[0-9][0-9]-*.js'))))
shell = open(os.path.join(SRC, 'shell.html')).read().replace('/*STYLE*/', css).replace('/*SCRIPT*/', js)
version = hashlib.sha1((css + js).encode()).hexdigest()[:10]

# ---- preview (artifact): no doctype/head/body, no PWA links
open(os.path.join(PREV, 'gsnotes.html'), 'w').write(shell.replace('<!--PWA_HEAD-->', ''))

# ---- PWA index.html: split shell into head and body
pwa_head = ('<link rel="manifest" href="manifest.webmanifest">\n'
            '<link rel="icon" href="icons/icon-192.png" type="image/png">\n'
            '<link rel="apple-touch-icon" href="icons/icon-192.png">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="mobile-web-app-capable" content="yes">')
s = shell.replace('<!--PWA_HEAD-->', pwa_head)
cut = s.index('<div class="app"')
head, body = s[:cut], s[cut:]
reset = '<style>[hidden]{display:none!important}img{max-width:100%}:root{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}</style>\n'
index = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
         '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
         + reset + head + '</head>\n<body>\n' + body + '</body>\n</html>\n')
open(os.path.join(DIST, 'index.html'), 'w').write(index)

manifest = {
  "name": "GSNotes", "short_name": "GSNotes", "description": "Private, offline-first Markdown notes.",
  "id": "./", "start_url": "./", "scope": "./", "display": "standalone", "display_override": ["window-controls-overlay", "standalone"],
  "background_color": "#eef1f5", "theme_color": "#2547c9", "categories": ["productivity"],
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
  "shortcuts": [
    {"name": "Quick capture", "url": "./?action=capture", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}]},
    {"name": "Today's note", "url": "./?action=today", "icons": [{"src": "icons/icon-192.png", "sizes": "192x192"}]}],
}
json.dump(manifest, open(os.path.join(DIST, 'manifest.webmanifest'), 'w'), indent=2)

sw = r"""/* GSNotes service worker — offline app shell + cached libraries */
const VERSION = 'gsnotes-%s';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|tessdata\.projectnaptha\.com)\//;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('gsnotes-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // app shell: network first so updates arrive, cache when offline
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  } else if (CDN.test(req.url)) {
    // pinned libraries, fonts, OCR language data: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })));
  }
});
""" % version
open(os.path.join(DIST, 'sw.js'), 'w').write(sw)

# ---- icons
def icon(size, maskable=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    blue, ink = (37, 71, 201, 255), (255, 255, 255, 255)
    if maskable: d.rectangle([0, 0, size, size], fill=blue); inset = size * 0.2
    else: d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=blue); inset = size * 0.12
    # page with folded corner
    x0, y0, x1, y1 = inset + size * .08, inset, size - inset - size * .08, size - inset
    fold = (x1 - x0) * .28
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=(238, 242, 255, 255))
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=(168, 186, 245, 255))
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int((x1 - x0) * .42))
    tb = d.textbbox((0, 0), 'GS', font=font)
    tx = x0 + ((x1 - x0) - (tb[2] - tb[0])) / 2 - tb[0]; ty = y0 + ((y1 - y0) - (tb[3] - tb[1])) / 2 - tb[1] + (y1 - y0) * .05
    d.text((tx, ty), 'GS', font=font, fill=blue)
    return img
icon(192).save(os.path.join(DIST, 'icons', 'icon-192.png'))
icon(512).save(os.path.join(DIST, 'icons', 'icon-512.png'))
icon(512, True).save(os.path.join(DIST, 'icons', 'maskable-512.png'))

# ---- extract the inline script for syntax checking
open(os.path.join(PREV, '_check.js'), 'w').write(js)
print('built', version, 'index.html', len(index) // 1024, 'KB')
