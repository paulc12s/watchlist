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

  // Folds an imported copy of an item into the one already in the list, so
  // nothing either side knows is lost: empty fields are filled in, and nothing
  // already set is overwritten. A review date only comes over with the review
  // it belongs to, or to fill a blank. Priority and watched status stay as they are,
  // since they're this list's own say about the queue. Returns whether
  // anything changed.
  mergeInto(existing, incoming) {
    let changed = false;
    const fill = (field, isEmpty) => {
      if (isEmpty(existing[field]) && !isEmpty(incoming[field])) {
        existing[field] = incoming[field];
        changed = true;
      }
    };
    const blank = value => !value;
    const before = { ...existing };
    ['tag', 'platform', 'genre', 'rating', 'plot', 'poster', 'duration', 'review', 'thumb', 'stars'].forEach(field => fill(field, blank));
    if (!existing.rewatch && incoming.rewatch) {
      existing.rewatch = true;
      changed = true;
    }
    if (incoming.reviewDate && (!existing.reviewDate || this.reviewChanged(before, existing))) {
      if (existing.reviewDate !== incoming.reviewDate) changed = true;
      existing.reviewDate = incoming.reviewDate;
    }
    return changed;
  },

  // The fields that make up your review; changing any of them dates the review
  REVIEW_FIELDS: ['thumb', 'stars', 'review', 'rewatch'],

  reviewChanged(before, after) {
    return this.REVIEW_FIELDS.some(field => before[field] !== after[field]);
  },

  // Priority to group, filter and edit by. Unknown values (from a newer
  // version of the app) are kept in storage but behave as medium here.
  displayPriority(item) {
    return CONFIG.PRIORITIES.includes(item.priority) ? item.priority : 'medium';
  }
};
