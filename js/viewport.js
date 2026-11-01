// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Viewport: keeps sheets usable while the on-screen keyboard is up
//
// On iPhone the keyboard doesn't shrink the page; it covers it, and Safari
// slides the page up to keep the focused field in view, which can push a
// bottom sheet's search box off the top. So this tracks the part of the
// screen you can actually see (visualViewport) as --vv-top and --vv-height
// on <html>, and sets data-keyboard while the keyboard is up. The styles
// then pin an open sheet to that visible area, with its search box at the
// top and its results scrolling in the space left (ratings.css).
// ============================================================================

const Viewport = {
  // The keyboard is up when the visible area is this much shorter than the window
  KEYBOARD_MIN_PX: 120,

  // State for the given measurements: { top, height, keyboard }
  measure(innerHeight, viewport) {
    const height = Math.round(viewport ? viewport.height : innerHeight);
    const top = Math.round(viewport ? viewport.offsetTop : 0);
    return { top, height, keyboard: innerHeight - height > this.KEYBOARD_MIN_PX };
  },

  update() {
    const { top, height, keyboard } = this.measure(window.innerHeight, window.visualViewport);
    const root = document.documentElement;
    root.style.setProperty('--vv-top', `${top}px`);
    root.style.setProperty('--vv-height', `${height}px`);
    if (keyboard) root.dataset.keyboard = '';
    else delete root.dataset.keyboard;
  },

  start() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => this.update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    this.update();
  }
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') Viewport.start();
