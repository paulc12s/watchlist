// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// The combined page (app.html): watchlist mode and review mode over one set
// of titles in this page's own database. Watchlist mode is the view in
// js/app/watchlist-view.js; review mode is the ratings feed (js/ratings/),
// started the first time you open it so its lists only load when needed.
// Both change titles through the shared Library, so each mode sees the
// other's changes at once.
// ============================================================================

const Main = {
  MODE_KEY: 'app_mode',
  mode: 'watchlist',
  reviewStart: null,

  async init() {
    // The ratings UI owns the sheets every mode shares: settings (export,
    // import), notes, lists, taste. Its feed waits for review mode.
    RatingsUI.init();
    RatingsUI.exportPrefix = 'titles';
    UI.init();

    document.querySelectorAll('.mode-switch [data-mode]').forEach(tab => {
      tab.addEventListener('click', () => this.setMode(tab.dataset.mode));
    });

    // Colour theme (js/palette.js)
    const paletteChoice = document.getElementById('paletteChoice');
    setChecked(paletteChoice, 'palette', Palette.get());
    paletteChoice.addEventListener('click', event => {
      const button = event.target.closest('[data-palette]');
      if (!button) return;
      Palette.set(button.dataset.palette);
      setChecked(paletteChoice, 'palette', button.dataset.palette);
    });

    // App icon (js/icon-choice.js)
    const iconChoice = document.getElementById('iconChoice');
    setChecked(iconChoice, 'icon', IconChoice.get());
    iconChoice.addEventListener('click', event => {
      const button = event.target.closest('[data-icon]');
      if (!button) return;
      IconChoice.set(button.dataset.icon);
      setChecked(iconChoice, 'icon', button.dataset.icon);
    });

    // A change in either mode (or an import) shows in watchlist mode; it
    // re-renders once per frame however many titles changed
    let pending = false;
    Library.onChange = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        UI.render();
        RatingsUI.updateHeader();
      });
    };

    await ItemManager.load(CONFIG.STORAGE.APP);
    await RatingsApp.loadPrefs();

    let saved = '';
    try {
      saved = localStorage.getItem(this.MODE_KEY) || '';
    } catch (error) {
      // Private browsing: start in watchlist mode
    }
    this.setMode(saved === 'review' ? 'review' : 'watchlist');
    VersionCheck.start();
  },

  setMode(mode) {
    this.mode = mode;
    const review = mode === 'review';
    document.querySelectorAll('.mode-switch [data-mode]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
    });
    document.getElementById('watchlistPanel').hidden = review;
    document.getElementById('reviewPanel').hidden = !review;
    document.getElementById('addButton').hidden = review;
    document.body.dataset.mode = mode;
    RatingsUI.paused = !review;
    UI.show(!review);
    try {
      localStorage.setItem(this.MODE_KEY, mode);
    } catch (error) {
      // Not remembered; harmless
    }

    if (review) {
      if (!this.reviewStart) {
        this.reviewStart = RatingsApp.start().catch(error => {
          console.error('Review mode failed to start:', error);
          RatingsUI.toast(`Could not load the lists: ${error.message}`);
          this.reviewStart = null;
        });
      } else {
        // Titles may have changed in watchlist mode
        RatingsUI.updateHeader();
      }
    }
  }
};

Main.init();
