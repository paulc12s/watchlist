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
    if (entry.isDirectory()) return ['js', 'js/app', 'js/review'].includes(rel) ? sourceFiles(rel) : [];
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
    const forwards = /http-equiv="refresh" content="0; url=app\.html"/.test(source);
    if (!forwards) assert.ok(source.includes('js/icon-choice.js'), `${page} doesn't apply the icon choice`);
    for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `${page} loads ${ref}, which doesn't exist`);
    if (source.includes('__APP_VERSION__')) assert.ok(workflow.includes(` ${page}`), `pages.yml doesn't stamp ${page}`);
  }
});

test('the retired pages and the front door forward to the app, so old bookmarks and home-screen icons work', () => {
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  assert.deepEqual(pages.sort(), ['app.html', 'batch-upload.html', 'index.html', 'ratings.html', 'watchlist.html']);
  for (const page of ['index.html', 'watchlist.html', 'ratings.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(source, /<meta http-equiv="refresh" content="0; url=app\.html">/, page);
    assert.match(source, /<a href="app\.html">/, `${page} has a link too`);
    assert.doesNotMatch(source, /<script/, `${page} runs nothing`);
  }
});

// The scripts that draw the pages (js/review/ui.js, js/app/*.js, js/batch-upload.js)
// need a browser, so no other test runs them. These checks catch what would
// otherwise deploy with every test passing and leave a blank page.
function pageScripts(page) {
  const source = fs.readFileSync(path.join(root, page), 'utf8');
  return { source, scripts: [...source.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]) };
}

test('every script a page loads compiles, and none declares a name another already has', () => {
  const vm = require('node:vm');
  for (const page of ['app.html', 'batch-upload.html']) {
    const { scripts } = pageScripts(page);
    assert.ok(scripts.length >= 10, page);
    const declared = new Map();
    for (const file of scripts) {
      const code = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotThrow(() => new vm.Script(code, { filename: file }), `${file} doesn't compile`);
      // Scripts share one scope: a second top-level const or class of the
      // same name stops that whole file from running
      for (const [, name] of code.matchAll(/^(?:const|let|class) (\w+)/gm)) {
        assert.ok(!declared.has(name), `${page}: ${name} is declared in ${declared.get(name)} and again in ${file}`);
        declared.set(name, file);
      }
    }
  }
});

test('every element a page’s scripts look up by ID is in the page', () => {
  for (const page of ['app.html', 'batch-upload.html']) {
    const { source, scripts } = pageScripts(page);
    const ids = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    assert.ok(ids.size > 5, page);
    let checked = 0;
    for (const file of scripts) {
      const code = fs.readFileSync(path.join(root, file), 'utf8');
      const literal = [...code.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
      // Lists of IDs looked up in a loop: const ids = ['a', 'b', ...]
      const listed = [...code.matchAll(/const ids = \[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/'(\w+)'/g)].map(q => q[1]));
      for (const id of [...literal, ...listed]) {
        assert.ok(ids.has(id), `${file} looks up #${id}, which ${page} doesn't have`);
        checked++;
      }
    }
    assert.ok(checked > 5, `${page}: found the lookups to check`);
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
  const css = read('base.css');
  const appCss = read('app.css');
  const page = read('app.html');
  const choices = read('js/palette.js').match(/CHOICES: \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  const inputs = ['accent', 'deep', 'love', 'on-accent', 'bg'].flatMap(name => [`--p-${name}-dark`, `--p-${name}-light`]);
  for (const choice of choices) {
    assert.match(page, new RegExp(`data-palette="${choice}"`), `${choice}: Settings button`);
    assert.match(appCss, new RegExp(`\\.swatch-${choice} \\{`), `${choice}: swatch`);
    const block = choice === 'basic'
      ? css.match(/:root \{([\s\S]*?)\n\}/)[1]
      : (css.match(new RegExp(`:root\\[data-palette="${choice}"\\] \\{([\\s\\S]*?)\\n\\}`)) || [])[1];
    assert.ok(block, `${choice}: CSS block`);
    for (const input of inputs) assert.ok(block.includes(`${input}:`), `${choice} sets ${input}`);
  }
  const html = read('app.html');
  assert.ok(html.indexOf('js/palette.js') < html.indexOf('</head>'), 'app.html applies the palette before drawing');
});

test('palette.js runs on its own in <head>, setting the theme and appearance before the page draws', () => {
  const vm = require('node:vm');
  const attributes = {};
  const stored = { palette: 'pride', scheme: 'light' };
  const metas = [{ removeAttribute() {}, setAttribute(name, value) { this[name] = value; } }];
  const context = vm.createContext({
    localStorage: { getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '#f4ecff' }),
    document: {
      body: {},
      documentElement: {
        dataset: attributes,
        setAttribute(name, value) { attributes[name.replace('data-', '')] = value; },
        removeAttribute(name) { delete attributes[name.replace('data-', '')]; }
      },
      querySelectorAll: () => metas
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/palette.js'), 'utf8'), context);
  assert.deepEqual({ ...attributes }, { palette: 'pride', scheme: 'light' });
  assert.equal(metas[0].content, '#f4ecff', 'the browser bar takes the page background');
  stored.scheme = 'auto';
  vm.runInContext('Appearance.apply()', context);
  assert.equal(attributes.scheme, 'dark', 'auto follows the device (dark here)');
  stored.palette = 'classic';
  vm.runInContext('Palette.apply()', context);
  assert.equal(attributes.palette, undefined, 'Basic (once called Classic) sets nothing');
});

