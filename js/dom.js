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
