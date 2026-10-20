// ============================================================================
// Version Check
//
// iOS home-screen apps often resume a page from memory instead of reloading
// it, so a deploy can go unnoticed for days. On launch and whenever the app
// returns to the foreground, compare the running version with the deployed
// version.json and reload if they differ.
//
// The deploy workflow (.github/workflows/pages.yml) replaces the version placeholder
// with the commit hash in CONFIG, version.json and the asset URLs.
// ============================================================================

const VersionCheck = {
  RELOAD_KEY: 'watchlist_reloaded_for',

  isStamped() {
    // Unstamped when served locally or straight from the branch
    return !CONFIG.APP_VERSION.startsWith('__');
  },

  async run() {
    if (!this.isStamped()) return;

    let latest;
    try {
      const response = await fetch('version.json', { cache: 'no-store' });
      if (!response.ok) return;
      latest = (await response.json()).version;
    } catch (error) {
      return; // Offline; try again next time
    }

    if (!latest || latest === CONFIG.APP_VERSION) return;

    // Reload at most once per version so a stubborn cache can't cause a loop
    try {
      if (sessionStorage.getItem(this.RELOAD_KEY) === latest) return;
      sessionStorage.setItem(this.RELOAD_KEY, latest);
    } catch (error) {
      return;
    }

    await ItemManager.flush();

    // A new query string bypasses any cached copy of the page; the page's
    // versioned script and style URLs then pull fresh assets
    location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}`);
  },

  // After an update reload, say so briefly
  announceUpdate() {
    if (this.isStamped() && new URLSearchParams(location.search).get('v') === CONFIG.APP_VERSION) {
      UI.setStatus('updated to latest version', true);
      setTimeout(() => UI.setStatus('saved', true), 3000);
    }
  }
};
