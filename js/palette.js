// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Palette and appearance: the colour theme (Settings → Theme) and light or
// dark (Settings → Appearance), kept per browser like
// the app icon. Loaded in <head>, before the page draws, so it never flashes
// the default colours. The palettes themselves are CSS (base.css), keyed
// by data-palette on <html>; Basic is the default and sets nothing.
// "classic", Basic's earlier name, is still read.
// ============================================================================

const Palette = {
  KEY: 'palette',
  CHOICES: ['basic', 'pastel', 'metal', 'pride', 'desert', 'aurora'],

  get() {
    try {
      const saved = localStorage.getItem(this.KEY);
      return this.CHOICES.includes(saved) ? saved : 'basic';
    } catch (error) {
      return 'basic';
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
    if (choice === 'basic') document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', choice);
    Appearance.paintBar();
  }
};

// ============================================================================
// Appearance: Auto (follow the device), Light or Dark. Sets data-scheme on
// <html> to the scheme in effect, which the stylesheets key on (app.css has
// the light design), and keeps the browser's bar colour (theme-color) in step.
// ============================================================================

const Appearance = {
  KEY: 'scheme',
  CHOICES: ['auto', 'light', 'dark'],
  media: typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null,

  get() {
    try {
      const saved = localStorage.getItem(this.KEY);
      return this.CHOICES.includes(saved) ? saved : 'auto';
    } catch (error) {
      return 'auto';
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

  // The scheme in effect for a choice
  resolve(choice = this.get()) {
    if (choice !== 'auto') return choice;
    return this.media && this.media.matches ? 'light' : 'dark';
  },

  apply(choice = this.get()) {
    document.documentElement.dataset.scheme = this.resolve(choice);
    this.paintBar();
  },

  // The bar takes the page's own background, once the styles have loaded
  paintBar() {
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length || !document.body) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (!bg) return;
    metas.forEach(meta => {
      meta.removeAttribute('media');
      meta.setAttribute('content', bg);
    });
  }
};

// Both applied here, once both are defined, before the page draws
Palette.apply();
Appearance.apply();
// Auto follows the device as it changes (e.g. at sunset)
if (Appearance.media && Appearance.media.addEventListener) {
  Appearance.media.addEventListener('change', () => { if (Appearance.get() === 'auto') Appearance.apply(); });
}
addEventListener('DOMContentLoaded', () => Appearance.paintBar());
