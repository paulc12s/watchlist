// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// List views of the combined page (app.html): one implementation, used twice
//
//   Watchlist mode: To watch, grouped by priority, full rows with ❤️ / 👍 /
//                   👎 buttons for when you've watched one (it moves to Rated)
//   Rated mode:     compact rows with your verdict as one icon, narrowed
//                   by ❤️ / 👍 / 👎
//
// Each view has its own search, chips and order (view.state), so moving
// between modes keeps where you were in each. Which titles a view shows and
// how they sort is ItemManager's (getFiltered, sorted); rows open the title
// sheet and changes go through ItemManager like everywhere else.
// ============================================================================

const ListView = {
  // config: { name, state, tabs: [[list, label]] (may be empty), verdicts,
  //           sortKey, compact, ids: { search, tabs, options, chips, list } }
  create(config) {
    const view = Object.assign(Object.create(ListView), config, { hidden: true, stale: true, els: {} });
    for (const [part, id] of Object.entries(config.ids)) view.els[part] = document.getElementById(id);
    view.bind();
    return view;
  },

  bind() {
    const { els, state: s } = this;
    els.search.addEventListener('input', () => {
      s.quickSearch = els.search.value.trim();
      this.drawChips();
      this.renderList();
    });
    if (els.tabs) {
      els.tabs.addEventListener('click', event => {
        const tab = event.target.closest('[data-list]');
        if (!tab) return;
        s.list = tab.dataset.list;
        this.render();
      });
    }
    els.options.addEventListener('click', event => {
      const button = event.target.closest('[data-verdict]');
      if (!button) return;
      s.verdict = button.dataset.verdict;
      this.render();
    });
    els.options.addEventListener('change', event => {
      if (!event.target.matches('select[data-sort]')) return;
      s.sort = event.target.value;
      try {
        localStorage.setItem(this.sortKey, s.sort);
      } catch (error) {
        // Not remembered; harmless
      }
      this.renderList();
    });
    try {
      const sort = localStorage.getItem(this.sortKey);
      if (ItemManager.SORTS[sort]) s.sort = sort;
    } catch (error) {
      // Private browsing: default order
    }
    els.chips.addEventListener('click', event => {
      const chip = event.target.closest('[data-filter]');
      if (!chip) return;
      const key = chip.dataset.filter;
      // A chip found by typing its name: the text did its job, and left in the
      // search it would look for that name in titles too
      const found = (this.chipList || []).find(c => c.key === key);
      if (s.filter !== key && found && ItemManager.chipMatches(found, s.quickSearch)) {
        s.quickSearch = '';
        els.search.value = '';
      }
      s.filter = s.filter === key ? 'all' : key;
      this.render();
    });
    els.list.addEventListener('click', event => this.listClick(event));
  },

  // A new order, remembered on this device (Settings import uses it too)
  setSort(sort) {
    if (!ItemManager.SORTS[sort]) return;
    this.state.sort = sort;
    try {
      localStorage.setItem(this.sortKey, sort);
    } catch (error) {
      // Not remembered; harmless
    }
    this.render();
  },

  // Hidden views only note that they're out of date, and catch up when shown
  render() {
    if (this.hidden) {
      this.stale = true;
      return;
    }
    this.stale = false;
    this.renderTabs();
    this.renderOptions();
    this.renderChips();
    this.renderList();
  },

  show(visible) {
    this.hidden = !visible;
    if (visible && this.stale) this.render();
  },

  // A view with one list shows no tabs
  renderTabs() {
    if (!this.els.tabs) return;
    const s = this.state;
    if (!this.tabs.some(([list]) => list === s.list)) s.list = this.tabs[0][0];
    this.els.tabs.hidden = this.tabs.length < 2;
    if (this.tabs.length < 2) return;
    const shown = ItemManager.shown();
    const count = list => shown.filter(ItemManager.LISTS[list]).length;
    this.els.tabs.innerHTML = html`${this.tabs.map(([list, label]) => html`
      <button type="button" role="tab" data-list="${list}" aria-selected="${String(s.list === list)}">
        ${label}<span class="count">${count(list)}</span>
      </button>`)}`;
  },

  // The verdict filter (Rated) and the order (every list but the queue)
  renderOptions() {
    const s = this.state;
    const shown = ItemManager.shown();
    const verdicts = [['all', 'All', ''], ['loved', 'Loved', 'heart'], ['up', 'Liked', 'thumb-up'], ['down', 'Not for me', 'thumb-down']];
    const rated = shown.filter(ItemManager.LISTS.rated);
    const count = v => (v === 'all' ? rated : rated.filter(ItemManager.LISTS[v])).length;
    const sorted = s.list !== 'queue';
    const verdictsShown = this.verdicts && s.list === 'rated';
    this.els.options.hidden = !sorted && !verdictsShown;
    this.els.options.innerHTML = html`
      ${verdictsShown && html`
        <div class="segmented verdicts" role="radiogroup" aria-label="Your verdict">
          ${verdicts.map(([v, label, iconName]) => html`
            <button type="button" role="radio" data-verdict="${v}" aria-checked="${String(s.verdict === v)}" aria-label="${label}" title="${label}">
              ${iconName ? icon(iconName) : label}<span class="count">${count(v)}</span>
            </button>`)}
        </div>`}
      ${sorted && html`
        <label class="sort-field">
          <span class="visually-hidden">Sort by</span>
          <select data-sort>
            ${Object.entries(ItemManager.SORTS).map(([key, [label]]) =>
              html`<option value="${key}" ${s.sort === key ? 'selected' : ''}>${label}</option>`)}
          </select>
        </label>`}`;
  },

  // Chips for what's in the current list (and verdict), each with its count;
  // priorities only on the list to watch
  renderChips() {
    const s = this.state;
    const titles = ItemManager.getFiltered({ ...s, filter: 'all', quickSearch: '' });
    const chips = ItemManager.chips(titles, { priorities: s.list === 'queue' });
    // A filter whose titles have all gone falls back to All
    if (!chips.some(chip => chip.key === s.filter)) s.filter = 'all';
    this.chipList = chips;
    this.drawChips();
  },

  // The chips, narrowed by what's typed in the search. Typing only redraws
  // these from the list above, without counting the titles again
  drawChips() {
    const s = this.state;
    const all = this.chipList || [];
    const chips = ItemManager.narrowChips(all, s.quickSearch, s.filter);
    // Re-drawing keeps the row where it was scrolled, so a chip far along stays
    // in view; a narrowed row starts from its first chip
    const scrolled = chips.length < all.length ? 0 : this.els.chips.scrollLeft;
    this.els.chips.innerHTML = html`${chips.map(({ key, label, count }) =>
      html`<button type="button" class="chip" data-filter="${key}" aria-pressed="${String(s.filter === key)}">${label}<span class="count">${count}</span></button>`)}`;
    this.els.chips.scrollLeft = scrolled;
  },

  renderList() {
    const s = this.state;
    const titles = ItemManager.getFiltered(s);
    const list = this.els.list;
    // Tags and platforms as their chips show them
    const names = { tag: Library.labels('tag'), platform: Library.labels('platform') };
    // Searching finds your titles wherever they are: these are the ones this view doesn't show
    const others = s.quickSearch ? ItemManager.elsewhere(s.quickSearch, titles) : [];
    const othersHTML = others.length ? html`
      <h2 class="group-label">Elsewhere in your titles</h2>
      ${others.map(t => this.foundRowHTML(t))}` : '';
    if (!titles.length && others.length) {
      list.innerHTML = html`<p class="hint list-note">Nothing in this list matches “${s.quickSearch}”.</p>${othersHTML}`;
      return;
    }
    if (!titles.length) {
      const query = s.quickSearch;
      const empty = {
        queue: 'Nothing to watch yet.', watched: 'Nothing watched yet. Tap a thumb on a title once you’ve seen it.',
        rated: 'Nothing rated here yet. Rate titles with 👍, 👎 or ❤️ in Watchlist or Review.'
      }[s.list];
      list.innerHTML = html`<div class="empty">
        <p>${query ? `Nothing here matches “${query}”.` : empty}</p>
        ${!this.compact && html`<button type="button" class="button primary" data-action="add">${icon('plus')}${query ? `Add “${query}”` : 'Add a title'}</button>`}
      </div>`;
      return;
    }

    if (s.filter === 'recent') {
      // Newest first, the Library's own order, rather than by priority
      list.innerHTML = html`<h2 class="group-label">Recently added</h2>${titles.map(t => this.rowHTML(t, names))}${othersHTML}`;
    } else if (s.list === 'queue') {
      // Grouped by priority, in the order CONFIG.PRIORITIES gives
      const groups = CONFIG.PRIORITIES.map(p => [p, titles.filter(t => Title.displayPriority(t) === p)]).filter(([, g]) => g.length);
      list.innerHTML = html`${groups.map(([p, group]) => html`
        <h2 class="group-label">${p === 'watching' ? 'Watching now' : `${CONFIG.PRIORITY_LABELS[p]} priority`}</h2>
        ${group.map(t => this.rowHTML(t, names))}`)}${othersHTML}`;
    } else {
      const row = this.compact ? t => this.compactRowHTML(t) : t => this.rowHTML(t, names);
      list.innerHTML = html`${ItemManager.sorted(titles, s.sort).map(row)}${othersHTML}`;
    }
  },

  // A search match from outside this view: where it stands with you, and a
  // tap opens its sheet, the same one + opens for a title you have
  foundRowHTML(t) {
    const typeIcon = Title.TYPE_ICONS[t.type] || 'film';
    const status = Title.statusLabel(t) || 'In your titles';
    const meta = [t.year, t.genres[0]].filter(Boolean);
    return html`
      <article class="title-row rated-row found-row" data-id="${t.id}">
        <button type="button" class="row-poster" data-action="web" aria-label="${t.type === 'youtube' ? 'Watch' : 'Search the web for'} ${t.title}">
          ${posterHTML(t)}
        </button>
        <button type="button" class="row-main" data-action="open" aria-label="${t.title}: ${status}. Details and review">
          <span class="row-title">${t.title}</span>
          <span class="row-meta">${icon(typeIcon, 'tiny')}${meta.join(' · ')}</span>
        </button>
        <span class="tag found-status" data-action="open" aria-hidden="true">${status}</span>
      </article>`;
  },

  rowHTML(t, names) {
    const name = (field, value) => (names[field].get(Title.cleanLabel(value).toLowerCase()) || { label: value }).label;
    const thumb = Title.thumb(t);
    const watched = !t.want;
    const typeIcon = Title.TYPE_ICONS[t.type];
    const meta = [t.year, t.genres[0], t.imdbRating && `★ ${Title.formatRating(t.imdbRating)}`, t.type === 'youtube' && t.duration].filter(Boolean);
    return html`
      <article class="title-row" data-id="${t.id}">
        <button type="button" class="row-poster" data-action="web" aria-label="${t.type === 'youtube' ? 'Watch' : 'Search the web for'} ${t.title}">
          ${posterHTML(t)}
        </button>
        <button type="button" class="row-main" data-action="open" aria-label="${t.title}: details and review">
          <span class="row-title">${t.title}</span>
          <span class="row-meta">${icon(typeIcon, 'tiny')}${meta.join(' · ')}</span>
          <span class="row-tags">
            ${t.platform && t.type !== 'youtube' && html`<span class="tag">${name('platform', t.platform)}</span>`}
            ${t.tags.map(tag => html`<span class="tag">${name('tag', tag)}</span>`)}
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
  compactRowHTML(t) {
    const thumb = Title.thumb(t);
    const loved = Title.isLoved(t);
    const typeIcon = Title.TYPE_ICONS[t.type];
    const meta = [t.year, t.genres[0], t.imdbRating && `IMDb ${Title.formatRating(t.imdbRating)}`].filter(Boolean);
    const verdict = Title.statusLabel(t);
    return html`
      <article class="title-row rated-row" data-id="${t.id}">
        <button type="button" class="row-poster" data-action="web" aria-label="${t.type === 'youtube' ? 'Watch' : 'Search the web for'} ${t.title}">
          ${posterHTML(t)}
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
      UI.openAdd(this.state.quickSearch);
      return;
    }
    const row = button.closest('.title-row');
    const t = row && Library.get(row.dataset.id);
    if (!t) return;
    if (button.dataset.action === 'rate') ItemManager.rate(t.id, button.dataset.thumb);
    else if (button.dataset.action === 'love') ItemManager.love(t.id);
    else if (button.dataset.action === 'open') UI.openTitle(t);
    else if (button.dataset.action === 'web') UI.openWeb(t);
  }
};
