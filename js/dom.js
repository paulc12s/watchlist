// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Small DOM helpers every mode of the app uses
// ============================================================================

// An icon from the SVG sprite at the top of app.html
function icon(name, className = '') {
  return html`<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// A title's picture: its poster, or a card with its name. An image that won't
// load becomes the same card (js/posters.js)
function posterHTML(t) {
  return t.poster && !Posters.broken.has(t.poster)
    ? html`<img src="${t.poster}" alt="" loading="lazy" data-card="${t.title}">`
    : html`<span class="poster-blank poster-card"><span>${t.title}</span></span>`;
}

// Radio-style segmented controls: mark the button whose data-<key> is value
function setChecked(group, key, value) {
  group.querySelectorAll(`[data-${key}]`).forEach(button => {
    button.setAttribute('aria-checked', String(button.dataset[key] === value));
  });
}

// The value of a segmented control's checked button, or ''
function checked(group, key) {
  const button = group.querySelector('[aria-checked="true"]');
  return button ? button.dataset[key] : '';
}

// Shows rows in a list, keeping the elements of rows that haven't changed:
// their pictures don't reload, and the browser only lays out what moved. Most
// redraws change a row or two of hundreds. rows: [{ key, html }], where each
// html is one element. Elements are kept while out of view, so clearing a
// search puts its rows straight back; anything else may set the container's
// innerHTML in between (a message), as kept elements just go back in.
const ROW_CACHES = new WeakMap();
const ROWS_KEPT_OUT_OF_VIEW = 1000;

function updateRows(container, rows) {
  if (!ROW_CACHES.has(container)) ROW_CACHES.set(container, new Map());
  const cache = ROW_CACHES.get(container);

  // A repeated key (two stored titles sharing an ID) still gets its own element
  const seen = new Set();
  const keyed = rows.map(({ key, html: markup }, at) => {
    const unique = seen.has(key) ? `${key}#${at}` : key;
    seen.add(unique);
    return { key: unique, markup: String(markup) };
  });

  // New and changed rows are parsed together, which is quicker than one by one
  const changed = keyed.filter(({ key, markup }) => !cache.has(key) || cache.get(key).markup !== markup);
  if (changed.length) {
    const template = document.createElement('template');
    template.innerHTML = changed.map(({ markup }) => markup).join('');
    [...template.content.children].forEach((element, at) => {
      cache.set(changed[at].key, { markup: changed[at].markup, element });
    });
  }

  // Out first, so a row leaving the top doesn't count as all the rest moving
  const wanted = keyed.map(({ key }) => cache.get(key).element);
  const keep = new Set(wanted);
  for (const node of [...container.childNodes]) {
    if (!keep.has(node)) node.remove();
  }
  let cursor = container.firstChild;
  for (const element of wanted) {
    if (element === cursor) cursor = cursor.nextSibling;
    else container.insertBefore(element, cursor);
  }

  if (cache.size > keyed.length + ROWS_KEPT_OUT_OF_VIEW) {
    const current = new Set(keyed.map(({ key }) => key));
    for (const key of cache.keys()) {
      if (!current.has(key)) cache.delete(key);
    }
  }
}
