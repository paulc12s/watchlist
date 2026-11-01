// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Palette: the colour theme (Settings → Colour theme), kept per browser like
// the app icon. Loaded in <head>, before the page draws, so it never flashes
// the default colours. The palettes themselves are CSS (ratings.css), keyed
// by data-palette on <html>; Classic is the default and sets nothing.
// ============================================================================

const Palette = {
  KEY: 'palette',
  CHOICES: ['classic', 'pastel', 'metal', 'pride', 'desert', 'aurora'],

  get() {
    try {
      const saved = localStorage.getItem(this.KEY);
      return this.CHOICES.includes(saved) ? saved : 'classic';
    } catch (error) {
      return 'classic';
    }
  },

  set(choice) {
    try {
      localStorage.setItem(this.KEY, choice);
    } catch (error) {
      // Private browsing: applies for this visit only
    }
    this.apply(choice);
  },

  apply(choice = this.get()) {
    if (choice === 'classic') document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', choice);
  }
};

Palette.apply();
