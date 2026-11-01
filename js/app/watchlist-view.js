// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// The combined page's shared UI (app.html): the two list views (Watchlist
// and Rated, js/app/list-view.js), the add sheet and the title sheet.
// What you do here goes through ItemManager (adds, edits, thumbs, deletes,
// undo, which titles each list shows) and from there the shared Library.
// Named UI because ItemManager and UndoManager report to UI.
// Everything rendered goes through html`` so titles can't inject markup.
// ============================================================================

const UI = {
  elements: {},
  views: {},
  add: { mode: 'search', type: '', chosen: null, results: [], seq: 0, timer: null },
  editing: null,

  init() {
    const ids = ['addButton', 'undoBar', 'undoMessage', 'undoButton',
      'tagOptions', 'platformOptions', 'addSheet', 'addModes', 'addSearch', 'addType', 'addResults', 'manualTitle',
      'manualType', 'manualGenre', 'youtubeUrl', 'youtubeTitle', 'addOptions', 'addChosen', 'addPriority', 'addTag',
      'addPlatform', 'addSeenUp', 'addSeenDown', 'addToList', 'titleSheet', 'titleName', 'titleDetails', 'titleThumbs',
      'titleWant', 'titleRewatch', 'titleStars', 'titleNotes', 'titlePriority', 'titleTag', 'titlePlatform',
      'titleDelete', 'titleWeb', 'titleSave'];
    ids.forEach(id => { this.elements[id] = document.getElementById(id); });
    const els = this.elements;

    this.views = {
      watchlist: ListView.create({
        name: 'watchlist', state, tabs: [['queue', 'To watch']], sortKey: 'list_sort',
        ids: { search: 'listSearch', tabs: 'listTabs', options: 'listOptions', chips: 'filterChips', list: 'titleList' }
      }),
      rated: ListView.create({
        name: 'rated', state: state.rated, tabs: [['rated', 'Rated'], ['unrated', 'Not rated']], verdicts: true, compact: true,
        sortKey: 'rated_sort',
        ids: { search: 'ratedSearch', tabs: 'ratedTabs', options: 'ratedOptions', chips: 'ratedChips', list: 'ratedList' }
      })
    };
    els.undoButton.addEventListener('click', () => UndoManager.undo());
    els.addButton.addEventListener('click', () => this.openAdd());
    this.bindAdd();
    this.bindTitleSheet();
  },

  // ---- What ItemManager and UndoManager call -----------------------------------

  // Every view, after any change; hidden ones catch up when shown
  render() {
    Object.values(this.views).forEach(view => view.render());
    this.renderOptions();
  },

  // Which list view is on screen (null: neither, e.g. review mode)
  showView(name) {
    for (const [key, view] of Object.entries(this.views)) view.show(key === name);
  },

  // Routine save messages stay quiet; anything else is worth a toast
  setStatus(text) {
    if (/^(saved|saving\.\.\.|exported)$/.test(text)) return;
    const friendly = { 'duplicate item': 'Already in your titles', 'save failed': 'Could not save. Export a backup to be safe.' };
    RatingsUI.toast(friendly[text] || text);
  },

  // Imports run from the settings sheet, which shows its own errors
  showImportError() {},
  hideImportError() {},

  // A video opens on YouTube; anything else, a web search for the title
  openWeb(t) {
    if (t.youtubeID) {
      window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(t.youtubeID)}`, '_blank', 'noopener');
      return;
    }
    const kind = { movie: 'movie', series: 'tv show', youtube: 'youtube video' }[t.type];
    const query = [t.title, t.year, kind, t.platform && t.platform !== 'YouTube' ? t.platform : ''].filter(Boolean).join(' ');
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
  },

  // Suggestions for the tag and platform fields
  renderOptions() {
    // One suggestion per label, in its usual spelling, so entries match
    const names = field => [...Library.labels(field).values()].map(({ label }) => label);
    const tags = names('tag').sort((a, b) => a.localeCompare(b));
    const used = new Set(names('platform').map(p => p.toLowerCase()));
    const platforms = [...names('platform'), ...CONFIG.PLATFORMS.filter(p => !used.has(p.toLowerCase()))];
    this.elements.tagOptions.innerHTML = html`${tags.map(t => html`<option value="${t}">`)}`;
    this.elements.platformOptions.innerHTML = html`${platforms.map(p => html`<option value="${p}">`)}`;
  },

  // ---- Adding ---------------------------------------------------------------------

  bindAdd() {
    const els = this.elements;
    els.addModes.addEventListener('click', event => {
      const tab = event.target.closest('[data-add-mode]');
      if (tab) this.setAddMode(tab.dataset.addMode);
    });
    els.addSearch.addEventListener('input', () => this.searchSoon());
    els.addType.addEventListener('click', event => {
      const button = event.target.closest('[data-type]');
      if (!button) return;
      this.add.type = button.dataset.type;
      setChecked(els.addType, 'type', this.add.type);
      this.searchSoon(0);
    });
    els.manualType.addEventListener('click', event => {
      const button = event.target.closest('[data-type]');
      if (button) setChecked(els.manualType, 'type', button.dataset.type);
    });
    els.addResults.addEventListener('click', event => {
      const result = event.target.closest('[data-result]');
      if (result) this.choose(this.add.results[Number(result.dataset.result)]);
    });
    els.addPriority.addEventListener('click', event => {
      const button = event.target.closest('[data-priority]');
      if (button) setChecked(els.addPriority, 'priority', button.dataset.priority);
    });
    els.addToList.addEventListener('click', () => this.addChosen({}));
    els.addSeenUp.addEventListener('click', () => this.addChosen({ verdict: 'up', want: false }));
    els.addSeenDown.addEventListener('click', () => this.addChosen({ verdict: 'down', want: false }));
  },

  openAdd(query = '') {
    const els = this.elements;
    this.add.chosen = null;
    els.addSearch.value = query;
    [els.manualTitle, els.manualGenre, els.youtubeUrl, els.youtubeTitle, els.addTag, els.addPlatform].forEach(input => { input.value = ''; });
    setChecked(els.addPriority, 'priority', 'medium');
    setChecked(els.manualType, 'type', 'movie');
    this.setAddMode('search');
    els.addSheet.showModal();
    els.addSearch.focus();
    if (query) this.searchSoon(0);
  },

  setAddMode(mode) {
    const els = this.elements;
    this.add.mode = mode;
    els.addModes.querySelectorAll('[data-add-mode]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.addMode === mode)));
    els.addSheet.querySelectorAll('.add-pane').forEach(pane => { pane.hidden = pane.dataset.pane !== mode; });
    // Search shows the options once you've picked a result; the others need them at once
    els.addOptions.hidden = mode === 'search' && !this.add.chosen;
    els.addChosen.hidden = mode !== 'search';
    if (mode === 'search') this.renderResults();
  },

  searchSoon(delay = 350) {
    clearTimeout(this.add.timer);
    this.add.chosen = null;
    this.elements.addOptions.hidden = true;
    this.add.timer = setTimeout(() => this.search(), delay);
  },

  async search() {
    const query = this.elements.addSearch.value.trim();
    const seq = ++this.add.seq;
    if (query.length < 2) {
      this.add.results = [];
      this.renderResults();
      return;
    }
    this.elements.addResults.innerHTML = html`<p class="hint">Searching…</p>`;
    try {
      const { results, tooMany } = await MovieAPI.search(query, this.add.type);
      if (seq !== this.add.seq) return;
      this.add.results = results;
      this.renderResults(tooMany ? 'Too many matches. Keep typing, or add a year (e.g. "dune 1984").' : 'No matches. Try another spelling, or add it by hand.');
      // Director and cast for the top results, to tell same-named titles apart
      results.slice(0, CONFIG.SEARCH.DETAIL_PREFETCH).forEach(result => {
        MovieAPI.getDetails(result.imdbID).then(() => { if (seq === this.add.seq && !this.add.chosen) this.renderResults(); }).catch(() => {});
      });
    } catch (error) {
      if (seq === this.add.seq) this.elements.addResults.innerHTML = html`<p class="hint error">${error.message}</p>`;
    }
  },

  renderResults(emptyMessage = '') {
    const { results, chosen } = this.add;
    const els = this.elements;
    if (chosen) {
      els.addResults.innerHTML = '';
      return;
    }
    if (!results.length) {
      els.addResults.innerHTML = emptyMessage ? html`<p class="hint">${emptyMessage}</p>` : '';
      return;
    }
    els.addResults.innerHTML = html`${results.map((result, index) => {
      const details = MovieAPI.detailsCache.get(result.imdbID) || result;
      const have = Library.byImdb(result.imdbID);
      return html`<button type="button" class="result" data-result="${index}">
        ${result.poster ? html`<img src="${result.poster}" alt="" loading="lazy">` : html`<span class="poster-blank">${icon(result.type === 'series' ? 'tv' : 'film')}</span>`}
        <span class="result-text">
          <span class="row-title">${result.title}</span>
          <span class="row-meta">${[result.year, result.type === 'series' ? 'TV' : 'Film', details.imdbRating && `★ ${Title.formatRating(details.imdbRating)}`].filter(Boolean).join(' · ')}</span>
          ${this.credits(details) && html`<span class="row-meta">${this.credits(details)}</span>`}
          ${have && html`<span class="tag">Already in your titles</span>`}
        </span>
      </button>`;
    })}`;
  },

  // "Dir. Denis Villeneuve · Ryan Gosling, Harrison Ford"
  credits(details) {
    const names = (list, count) => String(list || '').split(',').map(n => n.replace(/\(.*?\)/g, '').trim()).filter(Boolean).slice(0, count).join(', ');
    const lead = details.type === 'series' ? names(details.writer, 1) : names(details.director, 1);
    return [lead && `${details.type === 'series' ? 'By' : 'Dir.'} ${lead}`, names(details.actors, 2)].filter(Boolean).join(' · ');
  },

  async choose(result) {
    const els = this.elements;
    try {
      const details = (await MovieAPI.getDetails(result.imdbID)) || result;
      this.add.chosen = details;
      els.addChosen.innerHTML = this.chosenHTML(details);
      els.addResults.innerHTML = html`<button type="button" class="link-button" data-back>${icon('back', 'tiny')}Other results</button>`;
      els.addResults.querySelector('[data-back]').addEventListener('click', () => {
        this.add.chosen = null;
        els.addOptions.hidden = true;
        this.renderResults();
      });
      els.addOptions.hidden = false;
    } catch (error) {
      RatingsUI.toast(error.message);
    }
  },

  chosenHTML(t) {
    const genres = Array.isArray(t.genres) ? t.genres.join(', ') : '';
    return html`
      ${t.poster ? html`<img src="${t.poster}" alt="">` : html`<span class="poster-blank">${icon(t.type === 'series' ? 'tv' : t.type === 'youtube' ? 'play' : 'film')}</span>`}
      <div>
        <p class="row-title">${t.title}${t.year ? ` (${t.year})` : ''}</p>
        <p class="row-meta">${[t.type === 'series' ? 'TV' : t.type === 'youtube' ? 'YouTube' : 'Film', genres, t.imdbRating && `★ ${Title.formatRating(t.imdbRating)}`].filter(Boolean).join(' · ')}</p>
        ${this.credits(t) && html`<p class="row-meta">${this.credits(t)}</p>`}
        ${t.plot && html`<p class="plot">${t.plot}</p>`}
      </div>`;
  },

  // The fields to add from whichever pane is open, or null if something's missing
  addFields() {
    const els = this.elements;
    if (this.add.mode === 'search') {
      const d = this.add.chosen;
      if (!d) return null;
      return { title: d.title, year: d.year, type: d.type, genres: d.genres, director: d.director, actors: d.actors,
        imdbRating: d.imdbRating, plot: d.plot, poster: d.poster, imdbID: d.imdbID };
    }
    if (this.add.mode === 'manual') {
      const title = els.manualTitle.value.trim();
      if (!title) return els.manualTitle.focus(), null;
      return { title, type: checked(els.manualType, 'type'), genres: els.manualGenre.value.trim() };
    }
    const url = els.youtubeUrl.value.trim();
    const videoID = YouTubeAPI.extractVideoID(url);
    const title = els.youtubeTitle.value.trim() || (videoID ? `YouTube video (${videoID})` : '');
    if (!url || !title) return els.youtubeUrl.focus(), null;
    return {
      title, type: 'youtube', platform: 'YouTube', youtubeID: videoID || '',
      poster: videoID ? `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg` : '',
      // Without an ID the link is the only way back to the video, so keep it visible
      plot: videoID ? '' : url
    };
  },

  addChosen(verdict) {
    const els = this.elements;
    const fields = this.addFields();
    if (!fields) return;
    const added = ItemManager.add({
      ...fields,
      priority: checked(els.addPriority, 'priority'),
      tag: els.addTag.value.trim(),
      platform: els.addPlatform.value.trim() || fields.platform || '',
      ...verdict
    });
    if (!added) return;
    els.addSheet.close();
    state.filter = 'all';
    this.render();
    // Seen titles go to Rated, not the list to watch
    RatingsUI.toast(verdict.verdict ? `Added ${fields.title} to Rated` : `Added ${fields.title}`, verdict.verdict ? `thumb-${verdict.verdict}` : 'check');
  },

  // ---- A title's sheet: review and edit in one place -------------------------------

  bindTitleSheet() {
    const els = this.elements;
    els.titleThumbs.addEventListener('click', event => {
      const button = event.target.closest('[data-thumb]');
      if (!button) return;
      const draft = this.editing.draft;
      const choice = button.dataset.thumb;
      const loved = draft.verdict === 'up' && draft.stars === Title.LOVED_STARS;
      const current = loved ? 'love' : draft.verdict;
      // Loved is 👍 with five stars; leaving it drops the five stars
      if (loved && choice !== 'love') draft.stars = 0;
      if (choice === current) {
        draft.verdict = '';
      } else {
        draft.verdict = choice === 'love' ? 'up' : choice;
        if (choice === 'love') draft.stars = Title.LOVED_STARS;
      }
      // A thumb means you've seen it; clearing it puts it back on the list
      draft.want = draft.verdict ? false : true;
      this.renderDraft();
    });
    els.titleWant.addEventListener('click', () => {
      this.editing.draft.want = !this.editing.draft.want;
      this.renderDraft();
    });
    els.titleRewatch.addEventListener('click', () => {
      this.editing.draft.rewatch = !this.editing.draft.rewatch;
      this.renderDraft();
    });
    els.titleStars.addEventListener('click', event => {
      const button = event.target.closest('[data-stars]');
      if (!button) return;
      const stars = Number(button.dataset.stars);
      this.editing.draft.stars = this.editing.draft.stars === stars ? 0 : stars;
      this.renderDraft();
    });
    els.titlePriority.addEventListener('click', event => {
      const button = event.target.closest('[data-priority]');
      if (!button) return;
      this.editing.draft.priority = button.dataset.priority;
      this.renderDraft();
    });
    els.titleSave.addEventListener('click', () => this.saveTitle());
    els.titleDelete.addEventListener('click', () => {
      const { id } = this.editing;
      els.titleSheet.close();
      ItemManager.delete(id);
    });
    els.titleWeb.addEventListener('click', () => this.openWeb(Library.get(this.editing.id)));
  },

  openTitle(t) {
    const els = this.elements;
    this.editing = {
      id: t.id,
      draft: { verdict: Title.thumb(t), want: t.want, rewatch: t.rewatch, stars: t.stars, priority: Title.displayPriority(t) }
    };
    els.titleName.textContent = t.title;
    els.titleDetails.innerHTML = this.chosenHTML(t);
    els.titleNotes.value = t.review;
    // In their usual spelling, so saving tidies an odd one
    els.titleTag.value = Library.labelName('tag', t.tag);
    els.titlePlatform.value = Library.labelName('platform', t.platform);
    this.renderDraft();
    els.titleSheet.showModal();
  },

  renderDraft() {
    const els = this.elements;
    const draft = this.editing.draft;
    setChecked(els.titleThumbs, 'thumb',
      draft.verdict === 'up' && draft.stars === Title.LOVED_STARS ? 'love' : draft.verdict);
    els.titleWant.setAttribute('aria-pressed', String(draft.want));
    els.titleRewatch.setAttribute('aria-pressed', String(draft.rewatch));
    els.titleStars.querySelectorAll('[data-stars]').forEach(button => {
      const value = Number(button.dataset.stars);
      button.classList.toggle('filled', value <= draft.stars);
      button.setAttribute('aria-checked', String(value === draft.stars));
    });
    setChecked(els.titlePriority, 'priority', draft.priority);
  },

  saveTitle() {
    const els = this.elements;
    const { id, draft } = this.editing;
    // A title is either on the list or seen; with neither, it would vanish
    const want = draft.verdict ? draft.want : true;
    const current = Library.get(id);
    ItemManager.update(id, {
      // Keep a skip or not-interested from review mode unless a thumb replaces it
      verdict: draft.verdict || (current && !Title.isSeen(current) ? current.verdict : ''),
      want,
      rewatch: draft.rewatch,
      stars: draft.stars,
      review: els.titleNotes.value.trim(),
      priority: draft.priority,
      tag: els.titleTag.value,
      platform: els.titlePlatform.value
    });
    els.titleSheet.close();
    this.render();
  }
};

// Radio-style segmented controls: mark the button whose data-<key> is value
function setChecked(group, key, value) {
  group.querySelectorAll(`[data-${key}]`).forEach(button => {
    button.setAttribute('aria-checked', String(button.dataset[key] === value));
  });
}

function checked(group, key) {
  const button = group.querySelector('[aria-checked="true"]');
  return button ? button.dataset[key] : '';
}
