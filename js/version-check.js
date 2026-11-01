// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
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
  // Hooks for the page: shown after an update reload
  onUpdated() {},

  // One key per page, so each page reloads at most once per version
  reloadKey() {
    return `reloaded_for:${location.pathname}`;
  },

  isStamped() {
    // Unstamped when served locally or straight from the branch
    return !CONFIG.APP_VERSION.startsWith('__');
  },

  // Checks now and whenever the page comes back to the foreground; saves
  // anything pending when the page is hidden or closed (iOS may suspend the
  // page before a batched save runs)
  start() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') Store.flush();
      else this.run();
    });
    window.addEventListener('pagehide', () => Store.flush());
    if (this.isStamped() && new URLSearchParams(location.search).get('v') === CONFIG.APP_VERSION) this.onUpdated();
    this.run();
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
      if (sessionStorage.getItem(this.reloadKey()) === latest) return;
      sessionStorage.setItem(this.reloadKey(), latest);
    } catch (error) {
      return;
    }

    await Store.flush();

    // A new query string bypasses any cached copy of the page; the page's
    // versioned script and style URLs then pull fresh assets
    location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}`);
  }
};
