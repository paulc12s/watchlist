// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Ratings app start-up
// ============================================================================

const App = {
  async init() {
    RatingsUI.init();
    Store.onError = error => {
      console.error('Save failed:', error);
      RatingsUI.toast('Could not save. Export a backup to be safe.');
    };
    try {
      // Titles are kept by the shared Library (js/library.js) in this page's database
      await Library.open(CONFIG.STORAGE.RATINGS);
      const { INFO_KEY, PREFS_KEY, TV_LISTS_KEY, TV_RECS_KEY } = RATINGS.STORAGE;
      const [info, prefs, tvLists, tvRecs] = await Promise.all([
        Store.load(INFO_KEY), Store.load(PREFS_KEY), Store.load(TV_LISTS_KEY), Store.load(TV_RECS_KEY), Catalog.load()
      ]);
      MovieInfo.load(info);
      Catalog.restoreTvLists(tvLists);
      TvRecs.load(tvRecs);
      Feed.order = prefs && RATINGS.ORDERS.includes(prefs.order) ? prefs.order : 'ranked';
      TMDB.key = prefs && typeof prefs.tmdbKey === 'string' ? prefs.tmdbKey : '';

      MovieInfo.onChange = () => Store.scheduleSave(INFO_KEY, () => MovieInfo.dump());
      Catalog.onTvListsChange = () => Store.scheduleSave(TV_LISTS_KEY, () => Catalog.tvLists);
      TvRecs.onChange = () => Store.scheduleSave(TV_RECS_KEY, () => TvRecs.cache);
      this.loadRecommender();

      RatingsUI.switchCategory((prefs && prefs.categoryId) || 'popular', { announce: false });
    } catch (error) {
      console.error('Start-up failed:', error);
      RatingsUI.toast(`Could not start: ${error.message}`);
    }

    VersionCheck.start();
  },

  // The film similarity data is large, so it loads alongside the first card
  // rather than before it; guesses and For you's film picks start once it's in
  async loadRecommender() {
    try {
      const response = await fetch(RATINGS.SIMILAR_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Recommender.use(await response.json());
      Catalog.learnScore = () => Guesses.learnScore();
      if (Feed.order === 'learn') Feed.start(Feed.categoryId);
      if (RatingsUI.els.forYouSheet.open) ForYou.render();
    } catch (error) {
      console.error('Could not load recommendations:', error);
    }
  },

  savePrefs() {
    Store.scheduleSave(RATINGS.STORAGE.PREFS_KEY, () => ({
      categoryId: Feed.categoryId, order: Feed.order, tmdbKey: TMDB.key
    }));
  }
};

App.init();
