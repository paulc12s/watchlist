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
