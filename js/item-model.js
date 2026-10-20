// ============================================================================
// Item Model
// Creating items, identifying duplicates, and reading fields for display.
// Shared by the main app and the batch upload tool.
// ============================================================================

const ItemModel = {
  newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // randomUUID needs a secure context (https or localhost)
    return Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  },

  // Builds a complete, sanitized item from whichever fields are known
  create(fields) {
    return Security.sanitizeItem({ watched: false, ...fields, id: this.newId() });
  },

  // Identity for duplicate detection; manual entries have none and are never duplicates
  key(item) {
    if (item.imdbID) return `imdb:${item.imdbID}`;
    if (item.youtubeID) return `yt:${item.youtubeID}`;
    return null;
  },

  keySet(items) {
    return new Set(items.map(item => this.key(item)).filter(Boolean));
  },

  isDuplicate(item, keys) {
    const key = this.key(item);
    return key !== null && keys.has(key);
  },

  // Priority to group, filter and edit by. Unknown values (from a newer
  // version of the app) are kept in storage but behave as medium here.
  displayPriority(item) {
    return CONFIG.PRIORITIES.includes(item.priority) ? item.priority : 'medium';
  }
};
