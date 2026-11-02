// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Settings in the export file
// Export adds the app's settings to the file (as "settings", beside
// "titles"); Import applies them. Both only while Settings → Include
// settings is ticked (the default). Older versions of the app ignore them,
// so the file format is unchanged otherwise.
//
//   theme, appearance, appIcon         how the app looks (js/palette.js, js/icon-choice.js)
//   watchlistSort, ratedSort           the order of Watchlist's Watched... and Rated lists
//   reviewOrder, reviewList            review mode's order and the list it opens on
//   tmdbKey                            the TMDB key for TV
//   omdbKey                            your own OMDb key, if you added one (with
//                                      either key the file holds a credential:
//                                      keep it private)
//
// A file is untrusted. Only these names are read, each checked on its own
// against what it may be (a known choice, or a key's exact shape); anything
// missing, mistyped, unknown or oversized is skipped and the rest still
// apply. Nothing in the file is ever copied wholesale, so names like
// "__proto__" do nothing. A file without a TMDB key never removes this
// device's key, and the same for OMDb.
// ============================================================================

const AppSettings = {
  // Settings → Include settings: whether export writes them and import
  // applies them. On unless turned off; remembered on this device
  INCLUDE_KEY: 'include_settings',

  included() {
    try {
      return localStorage.getItem(this.INCLUDE_KEY) !== 'no';
    } catch (error) {
      return true;
    }
  },

  setIncluded(on) {
    try {
      localStorage.setItem(this.INCLUDE_KEY, on ? 'yes' : 'no');
    } catch (error) {
      // Not remembered; this visit uses it
    }
  },

  // TMDB credentials: the 32-character v3 API key, or a v4 read access token (a JWT)
  TMDB_KEY: /^(?:[0-9a-f]{32}|eyJ[\w-]{10,600}\.[\w-]{10,2000}\.[\w-]{10,600})$/i,
  LIST_ID: /^[a-z0-9-]{1,60}$/,

  // What each setting may be: a check, given the raw value, returning the
  // clean value or undefined
  rules() {
    const oneOf = choices => value => (typeof value === 'string' && choices.includes(value) ? value : undefined);
    return {
      theme: oneOf(Palette.CHOICES),
      appearance: oneOf(Appearance.CHOICES),
      appIcon: oneOf(Object.keys(IconChoice.FOLDERS)),
      watchlistSort: oneOf(Object.keys(ItemManager.SORTS)),
      ratedSort: oneOf(Object.keys(ItemManager.SORTS)),
      reviewOrder: oneOf(REVIEW.ORDERS),
      reviewList: value => (typeof value === 'string' && this.LIST_ID.test(value) ? value : undefined),
      tmdbKey: value => (typeof value === 'string' && this.TMDB_KEY.test(value.trim()) ? value.trim() : undefined),
      omdbKey: value => (typeof value === 'string' && OMDb.KEY_SHAPE.test(value.trim()) ? value.trim() : undefined)
    };
  },

  // The usable settings in raw data from a file: { name: value } for the ones
  // that pass, and the names skipped
  clean(raw) {
    const settings = {};
    const skipped = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings, skipped };
    for (const [name, check] of Object.entries(this.rules())) {
      if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
      const value = check(raw[name]);
      if (value === undefined) skipped.push(name);
      else settings[name] = value;
    }
    return { settings, skipped };
  },

  // This device's settings, for the export file
  collect() {
    const settings = {
      theme: Palette.get(),
      appearance: Appearance.get(),
      appIcon: IconChoice.get(),
      watchlistSort: state.sort,
      ratedSort: state.rated.sort,
      reviewOrder: Feed.order,
      reviewList: Feed.categoryId || ReviewApp.savedCategoryId || undefined,
      tmdbKey: TMDB.key || undefined,
      omdbKey: OMDb.personalKey || undefined
    };
    // Only what would pass on the way back in
    return this.clean(settings).settings;
  },

  // Applies a file's settings; returns { applied: [names], skipped: [names] }
  apply(raw) {
    const { settings, skipped } = this.clean(raw);
    const has = name => Object.prototype.hasOwnProperty.call(settings, name);
    if (has('theme')) Palette.set(settings.theme);
    if (has('appearance')) Appearance.set(settings.appearance);
    if (has('appIcon')) IconChoice.set(settings.appIcon);
    if (has('watchlistSort')) UI.views.watchlist.setSort(settings.watchlistSort);
    if (has('ratedSort')) UI.views.rated.setSort(settings.ratedSort);
    let prefs = false;
    if (has('reviewOrder') && settings.reviewOrder !== Feed.order) {
      Feed.order = settings.reviewOrder;
      if (ReviewUI.feedStarted()) Feed.start(Feed.categoryId);
      prefs = true;
    }
    // The list review mode opens on next time; the one open now stays
    if (has('reviewList') && !ReviewUI.feedStarted()) {
      ReviewApp.savedCategoryId = settings.reviewList;
      prefs = true;
    }
    if (has('tmdbKey') && settings.tmdbKey !== TMDB.key) {
      TMDB.key = settings.tmdbKey;
      TitleSearch.refreshRecent();
      prefs = true;
    }
    // Unchecked here: a key that has stopped working falls back to the demo key
    if (has('omdbKey') && settings.omdbKey !== OMDb.personalKey) OMDb.setPersonalKey(settings.omdbKey);
    if (prefs) ReviewApp.savePrefs();
    if (typeof Main !== 'undefined') Main.showSettings();
    return { applied: Object.keys(settings), skipped };
  }
};
