// ============================================================================
// Security & Validation
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
  },

  sanitizeItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    try {
      // Validate required title field
      const title = String(item.title || '').trim();
      if (!title) {
        console.warn('Item missing title:', item);
        return null;
      }

      const youtubeID = String(item.youtubeID || '').substring(0, 20);
      let plot = String(item.plot || '').substring(0, 2000);

      // Older versions stored the YouTube URL in plot; the video ID already covers it
      if (youtubeID && plot.includes(youtubeID) && this.isSafeUrl(plot.trim())) {
        plot = '';
      }

      return {
        id: String(item.id || ItemModel.newId()),
        title: title.substring(0, CONFIG.LIMITS.MAX_TITLE_LENGTH),
        type: CONFIG.TYPES.includes(item.type) ? item.type : 'movie',
        // Keep priorities this version doesn't know (written by a newer version)
        // so an out-of-date copy of the app can't silently downgrade them
        priority: typeof item.priority === 'string' && /^[a-z-]{1,20}$/.test(item.priority)
          ? item.priority
          : 'medium',
        tag: String(item.tag || '').trim().substring(0, CONFIG.LIMITS.MAX_TAG_LENGTH),
        genre: String(item.genre || '').substring(0, 200),
        rating: String(item.rating || '').substring(0, 10),
        plot,
        poster: this.isSafeUrl(item.poster) ? item.poster : '',
        platform: String(item.platform || '').trim().substring(0, CONFIG.LIMITS.MAX_PLATFORM_LENGTH),
        watched: Boolean(item.watched),
        imdbID: String(item.imdbID || '').substring(0, 20),
        youtubeID,
        duration: String(item.duration || '').substring(0, 20),
        // Personal review: 0 stars means unrated
        stars: Number.isInteger(item.stars) && item.stars >= 0 && item.stars <= 5 ? item.stars : 0,
        review: String(item.review || '').trim().substring(0, CONFIG.LIMITS.MAX_REVIEW_LENGTH),
        rewatch: Boolean(item.rewatch)
      };
    } catch (error) {
      console.error('Sanitize error:', error, item);
      return null;
    }
  },

  sanitizeItems(itemsArray) {
    if (!Array.isArray(itemsArray)) return [];
    return itemsArray.map(i => this.sanitizeItem(i)).filter(i => i !== null);
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
