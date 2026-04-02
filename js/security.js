// ============================================================================
// Security & Validation
// ============================================================================

const Security = {
  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  escapeAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, char => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[char] || char;
    });
  },

  isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:'];

    for (const protocol of dangerousProtocols) {
      if (trimmed.startsWith(protocol)) return false;
    }

    return trimmed.startsWith('http://') ||
           trimmed.startsWith('https://');
  },

  sanitizeItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    try {
      // Validate required title field
      const title = String(item.title || '').trim();
      if (!title || title.length === 0) {
        console.warn('Item missing title:', item);
        return null;
      }

      return {
        id: String(item.id || Date.now()),
        title: title.substring(0, CONFIG.LIMITS.MAX_TITLE_LENGTH),
        type: CONFIG.TYPES.includes(item.type) ? item.type : 'movie',
        priority: CONFIG.PRIORITIES.includes(item.priority) ? item.priority : 'medium',
        tag: String(item.tag || '').trim().substring(0, CONFIG.LIMITS.MAX_TAG_LENGTH),
        genre: String(item.genre || '').substring(0, 200),
        rating: String(item.rating || '').substring(0, 10),
        plot: String(item.plot || '').substring(0, 2000),
        poster: this.isSafeUrl(item.poster) ? item.poster : '',
        platform: String(item.platform || '').trim().substring(0, CONFIG.LIMITS.MAX_PLATFORM_LENGTH),
        watched: Boolean(item.watched),
        imdbID: String(item.imdbID || '').substring(0, 20),
        youtubeID: String(item.youtubeID || '').substring(0, 20),
        duration: String(item.duration || '').substring(0, 20)
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
