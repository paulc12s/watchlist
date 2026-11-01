// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Security: escaping, URL checks and safe HTML templating
// (Records are validated by Title.sanitize in js/title.js.)
// ============================================================================

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const Security = {
  // Safe for both element content and quoted attribute values
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, char => HTML_ENTITIES[char]);
  },

  isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
  }
};

// ============================================================================
// HTML templating
//
// html`<div>${value}</div>` escapes every interpolated value, so markup can't
// be injected by forgetting to call escapeHtml. Values that are themselves
// html`` results are inserted as-is, arrays are joined, and null / undefined /
// false render as nothing (handy for `${cond && html`...`}`).
// ============================================================================

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += renderHtmlValue(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

function renderHtmlValue(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderHtmlValue).join('');
  if (value === null || value === undefined || value === false) return '';
  return Security.escapeHtml(value);
}
