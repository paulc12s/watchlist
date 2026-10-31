// ============================================================================
// Ratings app start-up
// ============================================================================

const App = {
  async init() {
    RatingsUI.init();
    try {
      await RatingsDB.open();
      const { RATINGS_KEY, INFO_KEY, PREFS_KEY, TV_LISTS_KEY, TV_RECS_KEY } = RATINGS.STORAGE;
      const [ratings, info, prefs, tvLists, tvRecs] = await Promise.all([
        RatingsDB.load(RATINGS_KEY), RatingsDB.load(INFO_KEY), RatingsDB.load(PREFS_KEY),
        RatingsDB.load(TV_LISTS_KEY), RatingsDB.load(TV_RECS_KEY), Catalog.load()
      ]);
      Ratings.load(ratings);
      MovieInfo.load(info);
      Catalog.restoreTvLists(tvLists);
      TvRecs.load(tvRecs);
      Feed.order = prefs && RATINGS.ORDERS.includes(prefs.order) ? prefs.order : 'ranked';
      TMDB.key = prefs && typeof prefs.tmdbKey === 'string' ? prefs.tmdbKey : '';

      Ratings.onChange = () => RatingsDB.scheduleSave(RATINGS_KEY, () => Ratings.all());
      MovieInfo.onChange = () => RatingsDB.scheduleSave(INFO_KEY, () => MovieInfo.dump());
      Catalog.onTvListsChange = () => RatingsDB.scheduleSave(TV_LISTS_KEY, () => Catalog.tvLists);
      TvRecs.onChange = () => RatingsDB.scheduleSave(TV_RECS_KEY, () => TvRecs.cache);
      this.loadRecommender();

      RatingsUI.switchCategory((prefs && prefs.categoryId) || 'popular', { announce: false });
    } catch (error) {
      console.error('Start-up failed:', error);
      RatingsUI.toast(`Could not start: ${error.message}`);
    }

    // Save before the app is backgrounded or closed, then check for a new version
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') RatingsDB.flush();
      else this.checkVersion();
    });
    window.addEventListener('pagehide', () => RatingsDB.flush());
    this.checkVersion();
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
    RatingsDB.scheduleSave(RATINGS.STORAGE.PREFS_KEY, () => ({
      categoryId: Feed.categoryId, order: Feed.order, tmdbKey: TMDB.key
    }));
  },

  // Same idea as the watchlist's js/version-check.js: installed home-screen
  // copies reload when a newer deploy is out
  async checkVersion() {
    if (CONFIG.APP_VERSION.startsWith('__')) return;
    let latest;
    try {
      const response = await fetch('version.json', { cache: 'no-store' });
      if (!response.ok) return;
      latest = (await response.json()).version;
    } catch (error) {
      return;
    }
    if (!latest || latest === CONFIG.APP_VERSION) return;
    try {
      if (sessionStorage.getItem(RATINGS.RELOAD_KEY) === latest) return;
      sessionStorage.setItem(RATINGS.RELOAD_KEY, latest);
    } catch (error) {
      return;
    }
    await RatingsDB.flush();
    location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}`);
  }
};

App.init();
