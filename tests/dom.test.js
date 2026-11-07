// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// updateRows keeps unchanged rows' elements. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers');

// Just enough DOM: a container of nodes, and a template that parses one
// element per <i>...</i>
class Element {
  constructor(markup) {
    this.markup = markup;
    this.parent = null;
  }

  remove() {
    if (this.parent) this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1);
    this.parent = null;
  }

  get nextSibling() {
    const siblings = this.parent.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
}

function container() {
  return {
    childNodes: [],
    moves: 0,
    get firstChild() { return this.childNodes[0] || null; },
    insertBefore(node, before) {
      node.remove();
      this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node);
      node.parent = this;
      this.moves++;
    }
  };
}

function load() {
  const parsed = [];
  const document = {
    createElement: () => ({
      set innerHTML(text) {
        parsed.push(text);
        this.content = { children: text.match(/<i>.*?<\/i>/g).map(markup => new Element(markup)) };
      }
    })
  };
  const context = vm.createContext({ document });
  vm.runInContext(read('js/dom.js'), context);
  return { updateRows: context.updateRows, parsed };
}

const row = (key, text = key) => ({ key, html: `<i>${text}</i>` });
const shown = list => list.childNodes.map(node => node.markup).join('');

test('updateRows parses only new and changed rows, and reuses the rest', () => {
  const { updateRows, parsed } = load();
  const list = container();
  updateRows(list, [row('a'), row('b'), row('c')]);
  assert.equal(shown(list), '<i>a</i><i>b</i><i>c</i>');
  const [a, b, c] = list.childNodes;

  parsed.length = 0;
  updateRows(list, [row('a'), row('b', 'changed'), row('c')]);
  assert.deepEqual(parsed, ['<i>changed</i>']);
  assert.equal(list.childNodes[0], a);
  assert.notEqual(list.childNodes[1], b);
  assert.equal(list.childNodes[2], c);

  parsed.length = 0;
  updateRows(list, [row('a'), row('b', 'changed'), row('c')]);
  assert.deepEqual(parsed, [], 'nothing changed, nothing parsed');
});

test('updateRows follows any new order, and a row leaving moves nothing else', () => {
  const { updateRows } = load();
  const list = container();
  updateRows(list, ['a', 'b', 'c', 'd'].map(key => row(key)));
  const [, b, c, d] = list.childNodes;

  list.moves = 0;
  updateRows(list, ['b', 'c', 'd'].map(key => row(key)));
  assert.deepEqual(list.childNodes, [b, c, d]);
  assert.equal(list.moves, 0);

  updateRows(list, ['d', 'b', 'c'].map(key => row(key)));
  assert.equal(shown(list), '<i>d</i><i>b</i><i>c</i>');
});

test('rows out of view keep their elements, and go back after a message took the list', () => {
  const { updateRows, parsed } = load();
  const list = container();
  updateRows(list, [row('a'), row('b')]);
  const [a, b] = list.childNodes;
  updateRows(list, [row('b')]);
  [...list.childNodes].forEach(node => node.remove()); // innerHTML = a message
  list.childNodes.push(Object.assign(new Element('<p>'), { parent: list }));

  parsed.length = 0;
  updateRows(list, [row('a'), row('b')]);
  assert.deepEqual(parsed, []);
  assert.deepEqual(list.childNodes, [a, b]);
});

test('a repeated key still shows every row', () => {
  const { updateRows } = load();
  const list = container();
  updateRows(list, [row('a', 'one'), row('a', 'two')]);
  assert.equal(shown(list), '<i>one</i><i>two</i>');
});

test('rows long out of view are let go once there are many', () => {
  const { updateRows, parsed } = load();
  const list = container();
  const many = Array.from({ length: 1100 }, (_, n) => row(`k${n}`));
  updateRows(list, many);
  updateRows(list, [row('other')]);
  parsed.length = 0;
  updateRows(list, [many[0]]);
  assert.deepEqual(parsed, ['<i>k0</i>'], 'parsed again: it had been let go');
});
