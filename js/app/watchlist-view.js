// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Watchlist mode of the combined page (app.html)
// The view only: what you do here goes through ItemManager (adds, edits,
// thumbs, deletes, undo, which titles each list shows) and from there the
// shared Library. Named UI because ItemManager and UndoManager report to UI.
// Everything rendered goes through html`` so titles can't inject markup.
// ============================================================================

const UI = {
  elements: {},
  // Set while the panel is hidden; it re-renders when shown
  hidden: false,
  stale: false,
  add: { mode: 'search', type: '', chosen: null, results: [], seq: 0, timer: null },
  SORT_KEY: 'list_sort',
  editing: null,

  init() {
    const ids = ['listSearch', 'listTabs', 'listOptions', 'filterChips', 'titleList', 'addButton', 'undoBar', 'undoMessage', 'undoButton',
      'tagOptions', 'platformOptions', 'addSheet', 'addModes', 'addSearch', 'addType', 'addResults', 'manualTitle',
      'manualType', 'manualGenre', 'youtubeUrl', 'youtubeTitle', 'addOptions', 'addChosen', 'addPriority', 'addTag',
      'addPlatform', 'addSeenUp', 'addSeenDown', 'addToList', 'titleSheet', 'titleName', 'titleDetails', 'titleThumbs',
      'titleWant', 'titleRewatch', 'titleStars', 'titleNotes', 'titlePriority', 'titleTag', 'titlePlatform',
      'titleDelete', 'titleWeb', 'titleSave'];
    ids.forEach(id => { this.elements[id] = document.getElementById(id); });
    const els = this.elements;

    els.listSearch.addEventListener('input', () => {
      state.quickSearch = els.listSearch.value.trim();
      this.renderList();
    });
    els.listTabs.addEventListener('click', event => {
      const tab = event.target.closest('[data-list]');
      if (!tab) return;
      state.list = tab.dataset.list;
      this.render();
    });
    els.listOptions.addEventListener('click', event => {
      const button = event.target.closest('[data-verdict]');
      if (!button) return;
      state.verdict = button.dataset.verdict;
      this.render();
    });
    els.listOptions.addEventListener('change', event => {
      if (event.target.id !== 'listSort') return;
      state.sort = event.target.value;
      try {
        localStorage.setItem(this.SORT_KEY, state.sort);
      } catch (error) {
        // Not remembered; harmless
      }
      this.renderList();
    });
    try {
      const sort = localStorage.getItem(this.SORT_KEY);
      if (ItemManager.SORTS[sort]) state.sort = sort;
    } catch (error) {
      // Private browsing: default order
    }
    els.filterChips.addEventListener('click', event => {
      const chip = event.target.closest('[data-filter]');
      if (!chip) return;
      state.filter = state.filter === chip.dataset.filter ? 'all' : chip.dataset.filter;
      this.render();
    });
    els.titleList.addEventListener('click', event => this.listClick(event));
    els.undoButton.addEventListener('click', () => UndoManager.undo());
    els.addButton.addEventListener('click', () => this.openAdd());
    this.bindAdd();
    this.bindTitleSheet();
  },

  // ---- What ItemManager and UndoManager call -----------------------------------

  render() {
    if (this.hidden) {
      this.stale = true;
      return;
    }
    this.stale = false;
    this.renderTabs();
    this.renderListOptions();
    this.renderChips();
    this.renderList();
    this.renderOptions();
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

  show(visible) {
    this.hidden = !visible;
    if (visible && this.stale) this.render();
  },

  // ---- The list ---------------------------------------------------------------------

  renderTabs() {
    const shown = ItemManager.shown();
    const count = list => shown.filter(ItemManager.LISTS[list]).length;
    // ❤️ / 👍 / 👎 live inside Rated (renderListOptions)
    if (!['queue', 'watched', 'rated'].includes(state.list)) state.list = 'rated';
    const tabs = [['queue', 'To watch'], ['watched', 'Watched'], ['rated', 'Rated']];
    this.elements.listTabs.innerHTML = html`${tabs.map(([list, label]) => html`
      <button type="button" role="tab" data-list="${list}" aria-selected="${String(state.list === list)}">
        ${label}<span class="count">${count(list)}</span>
      </button>`)}`;
  },

  // Rated: which verdicts, and every list but the queue: the order
  renderListOptions() {
    const shown = ItemManager.shown();
    const verdicts = [['all', 'All', ''], ['loved', 'Loved', 'heart'], ['up', 'Liked', 'thumb-up'], ['down', 'Not for me', 'thumb-down']];
    const count = v => shown.filter(v === 'all' ? ItemManager.LISTS.rated : ItemManager.LISTS[v]).length;
    const sorts = Object.entries(ItemManager.SORTS);
    this.elements.listOptions.hidden = state.list === 'queue';
    this.elements.listOptions.innerHTML = state.list === 'queue' ? '' : html`
      ${state.list === 'rated' && html`
        <div class="segmented verdicts" role="radiogroup" aria-label="Your verdict">
          ${verdicts.map(([v, label, iconName]) => html`
            <button type="button" role="radio" data-verdict="${v}" aria-checked="${String(state.verdict === v)}" aria-label="${label}" title="${label}">
              ${iconName ? icon(iconName) : label}<span class="count">${count(v)}</span>
            </button>`)}
        </div>`}
      <label class="sort-field">
        <span class="visually-hidden">Sort by</span>
        <select id="listSort">
          ${sorts.map(([key, [label]]) => html`<option value="${key}" ${state.sort === key ? 'selected' : ''}>${label}</option>`)}
        </select>
      </label>`;
  },

  // Chips for what's in the current list: priorities only on the list to watch
  renderChips() {
    const shown = ItemManager.shown().filter(ItemManager.LISTS[state.list] || ItemManager.LISTS.queue);
    const has = test => shown.some(test);
    const chips = [
      ['all', 'All'],
      ...CONFIG.PRIORITIES.filter(p => state.list === 'queue' && has(t => t.want && Title.displayPriority(t) === p))
        .map(p => [p, p === 'watching' ? 'Watching now' : CONFIG.PRIORITY_LABELS[p]]),
      ...[['movie', 'Films'], ['series', 'TV'], ['youtube', 'YouTube']].filter(([type]) => has(t => t.type === type)),
      ...(has(t => t.rewatch) ? [['rewatch', 'Rewatch']] : []),
      ...[...new Set(shown.map(t => t.platform).filter(Boolean))].sort().map(p => [p, p]),
      ...[...new Set(shown.map(t => t.tag).filter(Boolean))].sort().map(t => [t, `#${t}`])
    ];
    // A filter whose titles have all gone falls back to All
    if (!chips.some(([key]) => key === state.filter)) state.filter = 'all';
    this.elements.filterChips.innerHTML = html`${chips.map(([key, label]) =>
      html`<button type="button" class="chip" data-filter="${key}" aria-pressed="${String(state.filter === key)}">${label}</button>`)}`;
  },

  renderList() {
    const titles = ItemManager.getFiltered();
    const list = this.elements.titleList;
    if (!titles.length) {
      const query = state.quickSearch;
      list.innerHTML = html`<div class="empty">
        <p>${query ? `Nothing here matches “${query}”.` : {
          queue: 'Nothing to watch yet.', watched: 'Nothing watched yet. Tap a thumb on a title once you’ve seen it.',
          rated: 'Nothing rated here yet. Rate titles with 👍, 👎 or ❤️ here or in Review.',
          up: 'No liked titles yet.', down: 'No titles marked “not for me”.'
        }[state.list]}</p>
        <button type="button" class="button primary" data-action="add">${icon('plus')}${query ? `Add “${query}”` : 'Add a title'}</button>
      </div>`;
      return;
    }

    if (state.list === 'queue') {
      // Grouped by priority, in the order CONFIG.PRIORITIES gives
      const groups = CONFIG.PRIORITIES.map(p => [p, titles.filter(t => Title.displayPriority(t) === p)]).filter(([, g]) => g.length);
      list.innerHTML = html`${groups.map(([p, group]) => html`
        <h2 class="group-label">${p === 'watching' ? 'Watching now' : `${CONFIG.PRIORITY_LABELS[p]} priority`}</h2>
        ${group.map(t => this.rowHTML(t))}`)}`;
    } else {
      const sorted = ItemManager.sorted(titles);
      const row = state.list === 'rated' ? t => this.ratedRowHTML(t) : t => this.rowHTML(t);
      list.innerHTML = html`${sorted.map(row)}`;
    }
  },

  rowHTML(t) {
    const thumb = Title.thumb(t);
    const watched = !t.want;
    const typeIcon = { movie: 'film', series: 'tv', youtube: 'play' }[t.type];
    const meta = [t.year, t.genres[0], t.imdbRating && `★ ${Title.formatRating(t.imdbRating)}`, t.type === 'youtube' && t.duration].filter(Boolean);
    return html`
      <article class="title-row" data-id="${t.id}">
        <button type="button" class="row-poster" data-action="web" aria-label="${t.type === 'youtube' ? 'Watch' : 'Search the web for'} ${t.title}">
          ${t.poster ? html`<img src="${t.poster}" alt="" loading="lazy">` : icon(typeIcon)}
        </button>
        <button type="button" class="row-main" data-action="open" aria-label="${t.title}: details and review">
          <span class="row-title">${t.title}</span>
          <span class="row-meta">${icon(typeIcon, 'tiny')}${meta.join(' · ')}</span>
          <span class="row-tags">
            ${t.platform && html`<span class="tag">${t.platform}</span>`}
            ${t.tag && html`<span class="tag">#${t.tag}</span>`}
            ${t.stars > 0 && !Title.isLoved(t) && html`<span class="tag tag-stars" aria-label="${t.stars} stars">${'★'.repeat(t.stars)}</span>`}
            ${t.rewatch && html`<span class="tag">${icon('rewatch', 'tiny')}Rewatch</span>`}
            ${!watched && thumb && html`<span class="tag">${icon(`thumb-${thumb}`, 'tiny')}Rated, still to watch</span>`}
          </span>
          ${t.review && html`<span class="row-review">${t.review}</span>`}
        </button>
        <div class="row-thumbs" role="group" aria-label="${watched ? 'Your verdict' : 'Watched it? Rate it'}">
          <button type="button" class="thumb love" data-action="love" aria-pressed="${String(Title.isLoved(t))}"
            title="${Title.isLoved(t) ? 'Loved: tap for just 👍' : 'Watched: loved it'}" aria-label="Loved it">${icon('heart')}</button>
          ${['up', 'down'].map(dir => html`<button type="button" class="thumb ${dir}" data-action="rate" data-thumb="${dir}"
            aria-pressed="${String(watched && thumb === dir)}"
            title="${watched && thumb === dir ? 'Put back on the list to watch' : dir === 'up' ? 'Watched: liked it' : 'Watched: not for me'}"
            aria-label="${dir === 'up' ? 'Thumbs up' : 'Thumbs down'}">${icon(`thumb-${dir}`)}</button>`)}
        </div>
      </article>`;
  },

  // Rated: a compact row with your verdict as one badge; tap to change it
  ratedRowHTML(t) {
    const thumb = Title.thumb(t);
    const loved = Title.isLoved(t);
    const typeIcon = { movie: 'film', series: 'tv', youtube: 'play' }[t.type];
    const meta = [t.year, t.genres[0], t.imdbRating && `IMDb ${Title.formatRating(t.imdbRating)}`].filter(Boolean);
    const verdict = loved ? 'Loved' : thumb === 'up' ? 'Liked' : 'Not for me';
    return html`
      <article class="title-row rated-row" data-id="${t.id}">
        <button type="button" class="row-poster" data-action="web" aria-label="${t.type === 'youtube' ? 'Watch' : 'Search the web for'} ${t.title}">
          ${t.poster ? html`<img src="${t.poster}" alt="" loading="lazy">` : icon(typeIcon, 'tiny')}
        </button>
        <button type="button" class="row-main" data-action="open" aria-label="${t.title}: ${verdict}. Details and review">
          <span class="row-title">${t.title}</span>
          <span class="row-meta">${icon(typeIcon, 'tiny')}${meta.join(' · ')}${t.rewatch && icon('rewatch', 'tiny')}${t.review && icon('note', 'tiny')}</span>
        </button>
        <button type="button" class="verdict-badge ${loved ? 'loved' : thumb}" data-action="open" aria-label="Your verdict: ${verdict}${t.stars && !loved ? `, ${t.stars} stars` : ''}" title="${verdict}">
          ${icon(loved ? 'heart' : `thumb-${thumb}`, loved ? 'filled' : '')}
          ${t.stars > 0 && !loved && html`<span class="badge-stars">${t.stars}★</span>`}
        </button>
      </article>`;
  },

  listClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'add') {
      this.openAdd(state.quickSearch);
      return;
    }
    const row = button.closest('.title-row');
    const t = row && Library.get(row.dataset.id);
    if (!t) return;
    if (button.dataset.action === 'rate') ItemManager.rate(t.id, button.dataset.thumb);
    else if (button.dataset.action === 'love') ItemManager.love(t.id);
    else if (button.dataset.action === 'open') this.openTitle(t);
    else if (button.dataset.action === 'web') this.openWeb(t);
  },

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
    const shown = ItemManager.shown();
    const tags = [...new Set(shown.map(t => t.tag).filter(Boolean))].sort();
    const platforms = [...new Set([...CONFIG.PLATFORMS, ...shown.map(t => t.platform).filter(Boolean)])];
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
    // Show the list the new title went to
    state.list = verdict.want === false ? 'watched' : 'queue';
    state.filter = 'all';
    this.render();
    RatingsUI.toast(`Added ${fields.title}`, verdict.verdict ? `thumb-${verdict.verdict}` : 'check');
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
    els.titleTag.value = t.tag;
    els.titlePlatform.value = t.platform;
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
      tag: els.titleTag.value.trim(),
      platform: els.titlePlatform.value.trim()
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
