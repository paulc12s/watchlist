// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Posters: every title shows a picture, or failing that its name
//
// OMDb has no poster for some titles and still hands out addresses of images
// that have been taken down, so a saved poster can stop working at any time.
//   - An image that fails to load is replaced on the spot with a card showing
//     the title (posterHTML draws the same card for a title with no poster).
//   - A title you have then gets a replacement: from OMDb, then Wikipedia,
//     then TMDB if this device has a key. It's only kept once it has loaded.
//
// Lookups spend OMDb's daily quota, so they run a few at a time, and a title
// nothing could be found for isn't asked about again for a week. Filling in a
// poster isn't an edit: dates stay as they are, so it can't win a merge.
// ============================================================================

const Posters = {
  CHECKS_KEY: 'poster_checks',
  RECHECK_MS: 7 * 24 * 60 * 60 * 1000,
  MAX_PER_SWEEP: 20,
  WORKERS: 2,
  LOAD_TIMEOUT_MS: 8000,
  queue: [],
  running: 0,
  asked: new Set(),
  // Images that failed this visit: redrawing a list goes straight to the card,
  // without asking for them again. Saved addresses stay, as the failure may pass
  broken: new Set(),

  // Image errors don't bubble, but they can be caught on the way down
  init() {
    document.addEventListener('error', event => this.failed(event.target), true);
  },

  failed(img) {
    if (img.tagName !== 'IMG' || !/^https?:/.test(img.src)) return;
    this.broken.add(img.getAttribute('src'));
    const row = img.closest('[data-id]');
    img.replaceWith(this.standIn(img));
    if (row) this.repair(Library.get(row.dataset.id));
  },

  // What takes a failed image's place, in the style of where it was
  standIn(img) {
    const name = document.createElement('span');
    name.textContent = img.dataset.card || '';
    if (img.classList.contains('poster')) {
      const card = document.createElement('div');
      card.className = 'poster placeholder';
      card.append(name);
      return card;
    }
    const holder = document.createElement('span');
    holder.className = img.dataset.card ? 'poster-blank poster-card' : 'thumb';
    if (img.dataset.card) holder.append(name);
    return holder;
  },

  // Titles with no poster, as the app starts and when a TMDB key is added
  sweep() {
    Library.all()
      .filter(t => !t.poster && t.imdbID && !this.checkedLately(t.id))
      .slice(0, this.MAX_PER_SWEEP)
      .forEach(t => this.repair(t));
  },

  // A new TMDB key can find what OMDb couldn't
  recheck() {
    this.asked.clear();
    this.saveChecks({});
    this.sweep();
    UI.render();
  },

  repair(t) {
    if (!t || !t.imdbID || this.asked.has(t.id) || this.checkedLately(t.id)) return;
    this.asked.add(t.id);
    this.queue.push(t);
    this.next();
  },

  next() {
    while (this.running < this.WORKERS && this.queue.length) {
      this.running++;
      this.fix(this.queue.shift()).finally(() => {
        this.running--;
        this.next();
      });
    }
  },

  // Where a replacement can come from. OMDb's record for an IMDb ID can be
  // out of date and describe a different film, so its poster has to agree
  sources: [
    async t => {
      const details = await OMDb.details({ i: t.imdbID });
      return details && MovieAPI.sameTitle(details, t) ? details.poster : '';
    },
    async t => {
      const found = await Wikipedia.byImdb(t.imdbID);
      return found ? found.poster : '';
    },
    async t => {
      if (typeof TMDB === 'undefined' || !TMDB.hasKey()) return '';
      const found = await TMDB.find(t.imdbID);
      return found ? found.poster : '';
    }
  ],

  async fix(t) {
    let answered = true;
    for (const source of this.sources) {
      let url = '';
      try {
        url = await source(t);
      } catch (error) {
        // Offline or out of quota says nothing about the title: ask again another time
        answered = false;
      }
      if (url && url !== t.poster && await this.loads(url)) {
        if (Library.get(t.id) === t) {
          t.poster = url;
          Library.changed();
        }
        return;
      }
    }
    if (answered) this.markChecked(t.id);
  },

  loads(url) {
    return new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve(false), this.LOAD_TIMEOUT_MS);
      image.onload = () => { clearTimeout(timer); resolve(true); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = url;
    });
  },

  // ---- Which titles came up empty: kept on this device only ------------------

  readChecks() {
    try {
      return JSON.parse(localStorage.getItem(this.CHECKS_KEY)) || {};
    } catch (error) {
      return {};
    }
  },

  saveChecks(checks) {
    try {
      localStorage.setItem(this.CHECKS_KEY, JSON.stringify(checks));
    } catch (error) {
      // Not remembered: asked again next visit
    }
  },

  checkedLately(id) {
    const when = this.readChecks()[id];
    return Boolean(when) && Date.now() - when < this.RECHECK_MS;
  },

  markChecked(id) {
    this.saveChecks({ ...this.readChecks(), [id]: Date.now() });
  }
};
