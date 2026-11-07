// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// The combined page (app.html): three modes over one set of titles in this
// page's own database.
//   Watchlist  what to watch and what you've watched (js/app/list-view.js)
//   Review     the swipe feed (js/review/), started the first time you
//              open it so its lists only load when needed
//   Rated      everything you've rated, filtered and sorted (list-view.js)
// All change titles through the shared Library, so each mode sees the
// others' changes at once.
// ============================================================================

const Main = {
  MODE_KEY: 'app_mode',
  MODES: ['watchlist', 'rated', 'review'],
  PANELS: { watchlist: 'watchlistPanel', review: 'reviewPanel', rated: 'ratedPanel' },
  mode: 'watchlist',
  reviewStart: null,

  async init() {
    // The ratings UI owns the sheets every mode shares: settings (export,
    // import), notes, lists, taste. Its feed waits for review mode.
    Posters.init();
    ReviewUI.init();
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

    // Include settings in export and import (js/app/settings.js)
    const includeSettings = document.getElementById('includeSettings');
    includeSettings.checked = AppSettings.included();
    includeSettings.addEventListener('change', () => AppSettings.setIncluded(includeSettings.checked));

    // Appearance (js/palette.js)
    const schemeChoice = document.getElementById('schemeChoice');
    setChecked(schemeChoice, 'scheme', Appearance.get());
    schemeChoice.addEventListener('click', event => {
      const button = event.target.closest('[data-scheme]');
      if (!button) return;
      Appearance.set(button.dataset.scheme);
      setChecked(schemeChoice, 'scheme', button.dataset.scheme);
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

    document.getElementById('runCleanup').addEventListener('click', () => this.runCleanup());
    document.getElementById('bringIn').addEventListener('click', () => this.bringIn());

    // A change in either mode (or an import) shows in watchlist mode; it
    // re-renders once per frame however many titles changed, and not at all
    // if whatever made the change has already redrawn
    let pending = false;
    Library.onChange = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (UI.renderedRevision !== Library.revision) UI.render();
        ReviewUI.updateHeader();
      });
    };

    await ItemManager.load(CONFIG.STORAGE.APP);
    await ReviewApp.loadPrefs();
    TitleSearch.init();
    Posters.sweep();
    this.offerOldPages();

    let saved = '';
    try {
      saved = localStorage.getItem(this.MODE_KEY) || '';
    } catch (error) {
      // Private browsing: start in watchlist mode
    }
    this.setMode(this.MODES.includes(saved) ? saved : 'watchlist');
    VersionCheck.start();
  },

  // Settings → Run cleanup: tidy and repair (Library.cleanup), save, then
  // read back what's stored and check it against what's on screen
  async runCleanup() {
    const out = document.getElementById('cleanupReport');
    const button = document.getElementById('runCleanup');
    const show = (lines, ok) => {
      out.hidden = false;
      out.classList.toggle('problem', !ok);
      out.innerHTML = html`<ul>${lines.map(line => html`<li>${line}</li>`)}</ul>`;
    };
    if (Store.blocked) return show([`Nothing was changed: ${Store.blocked}`], false);

    button.disabled = true;
    try {
      const report = Library.cleanup();
      await Store.flush();
      const stored = await Store.load(CONFIG.STORAGE.TITLES_KEY);
      const matches = JSON.stringify(stored || []) === JSON.stringify(Library.all());
      const titles = Library.all();
      const hidden = titles.filter(t => !t.want && !t.verdict).length;
      const odd = titles.filter(t => t.verdict === 'down' && t.stars >= 4).length;
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

      const lines = [`Checked ${plural(report.titles, 'title')}.`];
      for (const { field, change, count } of report.renamed) lines.push(`${field === 'tag' ? 'Tag' : 'Platform'} ${change} (${plural(count, 'title')})`);
      if (report.repaired) lines.push(`Repaired ${plural(report.repaired, 'title')} with values an older version left behind.`);
      if (report.merged) lines.push(`Merged ${plural(report.merged, 'duplicate')}.`);
      if (report.renumbered) lines.push(`Gave ${plural(report.renumbered, 'title')} a new ID (two shared one).`);
      if (!report.changed) lines.push('Nothing needed tidying.');
      if (odd) lines.push(`${plural(odd, 'title')} rated 👎 with 4 or 5 stars; check them in Rated.`);
      if (hidden) lines.push(`${plural(hidden, 'title')} kept for review history only (not on a list, no verdict).`);
      lines.push(matches
        ? `Saved on this device: ${plural((stored || []).length, 'title')}, matching what you see.`
        : 'What’s saved on this device doesn’t match what you see. Export a backup, then reload.');
      if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        lines.push(`Storage: ${(usage / 1e6).toFixed(1)} MB used of ${(quota / 1e9).toFixed(1)} GB${persisted ? ', kept by the browser' : ''}.`);
      }
      show(lines, matches);
      ReviewUI.toast(report.changed ? 'Cleanup done' : 'Everything was already tidy', 'check');
    } catch (error) {
      console.error('Cleanup failed:', error);
      show([`Cleanup couldn’t finish: ${error.message}. Nothing was lost; export a backup to be safe.`], false);
    } finally {
      button.disabled = false;
    }
  },

  // Settings controls that show a stored choice, after an import changes it
  showSettings() {
    setChecked(document.getElementById('paletteChoice'), 'palette', Palette.get());
    setChecked(document.getElementById('schemeChoice'), 'scheme', Appearance.get());
    setChecked(document.getElementById('iconChoice'), 'icon', IconChoice.get());
    document.getElementById('tmdbKey').value = TMDB.key;
    document.getElementById('omdbKey').value = OMDb.personalKey;
  },

  // Settings → Titles from the old pages: shown only if they saved any here
  async offerOldPages() {
    const count = await OldPages.count();
    document.getElementById('oldPages').hidden = !count;
    document.getElementById('bringIn').textContent = `Bring in ${count} title${count === 1 ? '' : 's'} from the old pages`;
  },

  async bringIn() {
    const button = document.getElementById('bringIn');
    button.disabled = true;
    try {
      const { added, updated } = await OldPages.bringIn();
      ReviewUI.toast(added || updated ? `From the old pages: ${added} new, ${updated} updated` : 'Everything from the old pages was already here', 'check');
    } catch (error) {
      ReviewUI.toast(`Couldn’t bring them in: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  },

  setMode(mode) {
    this.mode = mode;
    const review = mode === 'review';
    document.querySelectorAll('.mode-switch [data-mode]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
    });
    for (const [name, id] of Object.entries(this.PANELS)) document.getElementById(id).hidden = name !== mode;
    document.body.dataset.mode = mode;
    ReviewUI.paused = !review;
    // Undo sits where review mode's rating buttons are, so it goes there
    if (review) UI.elements.undoBar.classList.remove('visible');
    UI.showView(review ? null : mode);
    try {
      localStorage.setItem(this.MODE_KEY, mode);
    } catch (error) {
      // Not remembered; harmless
    }

    if (review) {
      if (!this.reviewStart) {
        this.reviewStart = ReviewApp.start().catch(error => {
          console.error('Review mode failed to start:', error);
          ReviewUI.toast(`Could not load the lists: ${error.message}`);
          this.reviewStart = null;
        });
      } else {
        // Titles may have changed in the other modes
        ReviewUI.updateHeader();
      }
    }
  }
};

Main.init();
