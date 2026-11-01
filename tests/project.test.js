// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Project-wide checks. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const NOTICE = 'Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.';

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['js', 'js/ratings'].includes(rel) ? sourceFiles(rel) : [];
    return /\.(js|css|html)$/.test(entry.name) ? [rel] : [];
  });
}

test('every source file carries the copyright notice, and the licence is MIT', () => {
  const files = ['.', 'js', 'tools', 'tests'].flatMap(sourceFiles);
  assert.ok(files.length > 30);
  const missing = files.filter(file => !fs.readFileSync(path.join(root, file), 'utf8').split('\n', 3).join('\n').includes(NOTICE));
  assert.deepEqual(missing, [], 'add the notice to the top of these files');
  const licence = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(licence, /^MIT License\n\nCopyright \(c\) 2026 Paul Constantinides\n/);
});

test('every page’s local scripts, stylesheets and icons exist, and the deploy stamps every page', () => {
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  assert.ok(pages.includes('app.html'));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const refs = [...source.matchAll(/(?:src|href)="([^"#:]+?\.(?:js|css|png))(?:\?[^"]*)?"/g)].map(m => m[1]);
    assert.ok(source.includes('href="icons/apple-touch-icon.png"'), `${page} lacks the home-screen icon`);
    if (page !== 'index.html') assert.ok(source.includes('js/icon-choice.js'), `${page} doesn't apply the icon choice`);
    for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `${page} loads ${ref}, which doesn't exist`);
    if (source.includes('__APP_VERSION__')) assert.ok(workflow.includes(` ${page}`), `pages.yml doesn't stamp ${page}`);
  }
});

test('the combined page allows every host its two modes load from', () => {
  const csp = page => fs.readFileSync(path.join(root, page), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const hosts = page => new Set(csp(page).match(/https:\/\/[^ ;]+/g));
  const combined = hosts('app.html');
  for (const page of ['watchlist.html', 'ratings.html']) {
    for (const host of hosts(page)) assert.ok(combined.has(host), `app.html's CSP lacks ${host}, which ${page} uses`);
  }
});

test('site icons are opaque PNGs at the sizes the pages declare', () => {
  // iOS fills a home-screen icon's transparency with black, hiding a dark glyph
  const files = [['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['icon-192.png', 192], ['icon-512.png', 512]];
  for (const [file, size] of ['', 'colour/'].flatMap(set => files.map(([name, px]) => [set + name, px]))) {
    const png = fs.readFileSync(path.join(root, 'icons', file));
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], `${file} size`);
    assert.ok([0, 2].includes(png[25]), `${file} has an alpha channel (colour type ${png[25]}); rebuild with tools/build-icons.py`);
  }
});

test('every palette is complete: CSS sets each input, with a swatch and a Settings button', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const css = read('ratings.css');
  const appCss = read('app.css');
  const page = read('app.html');
  const choices = read('js/palette.js').match(/CHOICES: \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  const inputs = ['accent', 'deep', 'love', 'on-accent', 'bg'].flatMap(name => [`--p-${name}-dark`, `--p-${name}-light`]);
  for (const choice of choices) {
    assert.match(page, new RegExp(`data-palette="${choice}"`), `${choice}: Settings button`);
    assert.match(appCss, new RegExp(`\\.swatch-${choice} \\{`), `${choice}: swatch`);
    const block = choice === 'classic'
      ? css.match(/:root \{([\s\S]*?)\n\}/)[1]
      : (css.match(new RegExp(`:root\\[data-palette="${choice}"\\] \\{([\\s\\S]*?)\\n\\}`)) || [])[1];
    assert.ok(block, `${choice}: CSS block`);
    for (const input of inputs) assert.ok(block.includes(`${input}:`), `${choice} sets ${input}`);
  }
  for (const file of ['app.html', 'ratings.html']) {
    const html = read(file);
    assert.ok(html.indexOf('js/palette.js') < html.indexOf('</head>'), `${file} applies the palette before drawing`);
  }
});
