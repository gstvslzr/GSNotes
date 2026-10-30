#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 Gustavo Salazar
"""Assemble desktop/app/ (fully offline copy of GSNotes) from the web build."""
import os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NM = os.path.join(HERE, 'node_modules')
APP = os.path.join(HERE, 'app')

subprocess.run([sys.executable, os.path.join(ROOT, 'build.py')], check=True)
shutil.rmtree(APP, ignore_errors=True)
for d in ('vendor/tesseract/core', 'vendor/tesseract/lang', 'fonts'):
    os.makedirs(os.path.join(APP, d), exist_ok=True)

def cp(src, dst):
    shutil.copyfile(os.path.join(NM, src), os.path.join(APP, dst))

# libraries (same pinned versions as the web build)
cp('marked/marked.min.js', 'vendor/marked.min.js')
cp('dompurify/dist/purify.min.js', 'vendor/purify.min.js')
cp('pdfjs-dist/build/pdf.min.js', 'vendor/pdf.min.js')
cp('pdfjs-dist/build/pdf.worker.min.js', 'vendor/pdf.worker.min.js')
cp('mammoth/mammoth.browser.min.js', 'vendor/mammoth.browser.min.js')
cp('tesseract.js/dist/tesseract.min.js', 'vendor/tesseract/tesseract.min.js')
cp('tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js')
for f in ('tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core.wasm.js', 'tesseract-core-simd.wasm.js'):
    cp(f'tesseract.js-core/{f}', f'vendor/tesseract/core/{f}')
for lang in ('eng', 'spa'):  # OCR language data, so text recognition works offline
    cp(f'@tesseract.js-data/{lang}/4.0.0_best_int/{lang}.traineddata.gz', f'vendor/tesseract/lang/{lang}.traineddata.gz')

# fonts (latin subset covers English and Spanish)
faces = [('Atkinson Hyperlegible', 'atkinson-hyperlegible', w, s) for w in (400, 700) for s in ('normal', 'italic')] + \
        [('Bricolage Grotesque', 'bricolage-grotesque', w, 'normal') for w in (600, 700)] + \
        [('JetBrains Mono', 'jetbrains-mono', w, 'normal') for w in (400, 600)]
css = []
for fam, pkg, w, s in faces:
    fn = f'{pkg}-latin-{w}-{s}.woff2'
    cp(f'@fontsource/{pkg}/files/{fn}', f'fonts/{fn}')
    css.append(f"@font-face{{font-family:'{fam}';font-style:{s};font-weight:{w};font-display:swap;src:url(fonts/{fn}) format('woff2')}}")
open(os.path.join(APP, 'fonts.css'), 'w').write('\n'.join(css) + '\n')

# index.html: local libraries and fonts, no service worker or web manifest, strict CSP
html = open(os.path.join(ROOT, 'dist', 'index.html')).read()
html = re.sub(r'<link rel="(manifest|icon|apple-touch-icon|preconnect)"[^>]*>\n?', '', html)
html = re.sub(r'<meta name="(apple-mobile-web-app-capable|mobile-web-app-capable)"[^>]*>\n?', '', html)
html = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^"]*">', '<link rel="stylesheet" href="fonts.css">', html)
html = html.replace('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'vendor/marked.min.js')
html = html.replace('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js', 'vendor/purify.min.js')
csp = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: blob:; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")
boot = ('<script>\n'
        "window.GS_LIBS = { mammoth: 'vendor/mammoth.browser.min.js', tesseract: 'vendor/tesseract/tesseract.min.js', pdf: 'vendor/pdf.min.js', pdfWorker: new URL('vendor/pdf.worker.min.js', location.href).href };\n"
        "window.GS_TESS_OPTS = { workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href, corePath: new URL('vendor/tesseract/core', location.href).href, langPath: new URL('vendor/tesseract/lang', location.href).href, workerBlobURL: false };\n"
        '</script>\n')
html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="{csp}">', 1)
html = html.replace('<script src="vendor/marked.min.js">', boot + '<script src="vendor/marked.min.js">', 1)
assert 'googleapis' not in html and 'cdn.jsdelivr' not in html.split('const LIB')[0], 'remote URL left in desktop build'
open(os.path.join(APP, 'index.html'), 'w').write(html)
shutil.copyfile(os.path.join(ROOT, 'dist', 'icons', 'icon-512.png'), os.path.join(HERE, 'icon.png'))
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(APP) for f in fs)
print(f'desktop app assembled: {total / 1048576:.1f} MB')
