// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Which icon set the pages show: the black clapperboard (icons/) or the
// colour one (icons/colour/). Chosen in the combined page's settings and
// remembered in this browser, so every page shows the same one. A home-screen
// icon is copied when you add the page, so re-add it after changing this.
// ============================================================================

const IconChoice = {
  KEY: 'site_icon',
  FOLDERS: { mono: 'icons/', colour: 'icons/colour/' },

  get() {
    try {
      return localStorage.getItem(this.KEY) === 'colour' ? 'colour' : 'mono';
    } catch (error) {
      return 'mono';
    }
  },

  set(choice) {
    try {
      localStorage.setItem(this.KEY, choice);
    } catch (error) {
      // Private browsing: applies to this visit only
    }
    this.apply(choice);
  },

  apply(choice = this.get()) {
    document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(link => {
      link.setAttribute('href', link.getAttribute('href').replace(/^icons\/(colour\/)?/, this.FOLDERS[choice] || this.FOLDERS.mono));
    });
  }
};

IconChoice.apply();
