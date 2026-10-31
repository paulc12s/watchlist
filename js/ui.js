// ============================================================================
// UI Rendering & Interaction
// ============================================================================

const UI = {
  elements: {},

  init() {
    this.elements = {
      addBtn: document.getElementById('add-btn'),
      exportBtn: document.getElementById('export-btn'),
      importBtn: document.getElementById('import-btn'),
      importFile: document.getElementById('import-file'),
      status: document.getElementById('status'),
      addForm: document.getElementById('add-form'),
      searchInput: document.getElementById('search-input'),
      searchResults: document.getElementById('search-results'),
      manualToggle: document.getElementById('manual-toggle'),
      youtubeToggle: document.getElementById('youtube-toggle'),
      manualForm: document.getElementById('manual-form'),
      youtubeForm: document.getElementById('youtube-form'),
      manualTitle: document.getElementById('manual-title'),
      manualType: document.getElementById('manual-type'),
      manualGenre: document.getElementById('manual-genre'),
      manualRating: document.getElementById('manual-rating'),
      manualPriority: document.getElementById('manual-priority'),
      manualTag: document.getElementById('manual-tag'),
      manualPlatform: document.getElementById('manual-platform'),
      saveManualBtn: document.getElementById('save-manual-btn'),
      cancelBtn: document.getElementById('cancel-btn'),
      youtubeTitle: document.getElementById('youtube-title'),
      youtubeUrl: document.getElementById('youtube-url'),
      youtubePriority: document.getElementById('youtube-priority'),
      youtubeTag: document.getElementById('youtube-tag'),
      addYoutubeBtn: document.getElementById('add-youtube-btn'),
      cancelYoutubeBtn: document.getElementById('cancel-youtube-btn'),
      tagList: document.getElementById('tag-list'),
      platformList: document.getElementById('platform-list'),
      filters: document.getElementById('filters'),
      itemList: document.getElementById('item-list'),
      stats: document.getElementById('stats'),
      undoBar: document.getElementById('undo-bar'),
      undoBtn: document.getElementById('undo-btn'),
      undoMessage: document.getElementById('undo-message'),
      searchType: document.getElementById('search-type'),
      quickSearch: document.getElementById('quick-search'),
      quickSearchClear: document.getElementById('quick-search-clear'),
      viewToggle: document.getElementById('view-toggle'),
      editModal: document.getElementById('edit-modal'),
      editTitle: document.getElementById('edit-title'),
      editType: document.getElementById('edit-type'),
      editPriority: document.getElementById('edit-priority'),
      editTag: document.getElementById('edit-tag'),
      editPlatform: document.getElementById('edit-platform'),
      editGenre: document.getElementById('edit-genre'),
      editRating: document.getElementById('edit-rating'),
      editPlot: document.getElementById('edit-plot'),
      editThumb: document.getElementById('edit-thumb'),
      editSave: document.getElementById('edit-save'),
      editCancel: document.getElementById('edit-cancel'),
      reviewModal: document.getElementById('review-modal'),
      reviewTitle: document.getElementById('review-title'),
      reviewDate: document.getElementById('review-date'),
      reviewStars: document.getElementById('review-stars'),
      reviewText: document.getElementById('review-text'),
      reviewRewatch: document.getElementById('review-rewatch'),
      reviewThumb: document.getElementById('review-thumb'),
      reviewSave: document.getElementById('review-save'),
      reviewCancel: document.getElementById('review-cancel')
    };

    this.attachEventListeners();
    this.populatePlatformList();
    this.initViewToggle();
  },

  attachEventListeners() {
    this.elements.addBtn.addEventListener('click', () => this.toggleAddForm());
    this.elements.exportBtn.addEventListener('click', () => ItemManager.export());
    this.elements.importBtn.addEventListener('click', () => this.elements.importFile.click());
    this.elements.importFile.addEventListener('change', (e) => this.handleImport(e));

    // Search
    this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    this.elements.searchType.addEventListener('click', (e) => {
      const btn = e.target.closest('.search-type-btn');
      if (!btn) return;
      state.searchType = btn.dataset.type;
      this.elements.searchType.querySelectorAll('.search-type-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      this.handleSearch(this.elements.searchInput.value);
    });

    // Quick search
    this.elements.quickSearch.addEventListener('input', (e) => {
      state.quickSearch = e.target.value.trim();
      this.elements.quickSearchClear.classList.toggle('hidden', !state.quickSearch);
      // Re-rendering rebuilds every card, so wait for a pause in typing
      clearTimeout(this.quickSearchTimer);
      this.quickSearchTimer = setTimeout(() => this.renderItems(), 150);
    });
    this.elements.quickSearchClear.addEventListener('click', () => {
      clearTimeout(this.quickSearchTimer);
      state.quickSearch = '';
      this.elements.quickSearch.value = '';
      this.elements.quickSearchClear.classList.add('hidden');
      this.elements.quickSearch.focus();
      this.renderItems();
    });

    // Manual toggle
    this.elements.manualToggle.addEventListener('click', () => {
      if (state.selectedSearchResult) {
        this.backToSearchResults();
      } else {
        this.toggleManualForm();
      }
    });
    this.elements.youtubeToggle.addEventListener('click', () => this.toggleYoutubeForm());

    // Manual form
    this.elements.saveManualBtn.addEventListener('click', () => this.handleManualAdd());
    this.elements.cancelBtn.addEventListener('click', () => this.toggleAddForm());
    this.elements.manualTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleManualAdd();
    });

    // YouTube form
    this.elements.addYoutubeBtn.addEventListener('click', () => this.handleYoutubeAdd());
    this.elements.cancelYoutubeBtn.addEventListener('click', () => this.toggleAddForm());
    this.elements.youtubeUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleYoutubeAdd();
    });

    // Undo
    this.elements.undoBtn.addEventListener('click', () => UndoManager.undo());

    // Filters
    this.elements.filters.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-btn')) {
        const clickedFilter = e.target.dataset.filter;
        if (clickedFilter === 'watched') {
          state.watchedMode = !state.watchedMode;
          this.render();
        } else if (state.filter === clickedFilter && clickedFilter !== 'all') {
          this.setFilter('all');
        } else {
          this.setFilter(clickedFilter);
        }
      }
    });

    // Swap broken posters for the empty placeholder (the CSP blocks inline onerror handlers)
    const replaceBrokenImage = (e) => {
      if (e.target.tagName !== 'IMG') return;
      const placeholder = document.createElement('div');
      placeholder.className = e.target.className;
      e.target.replaceWith(placeholder);
    };
    this.elements.itemList.addEventListener('error', replaceBrokenImage, true);
    this.elements.searchResults.addEventListener('error', replaceBrokenImage, true);

    // Item list
    this.elements.itemList.addEventListener('click', (e) => this.handleItemClick(e));
    this.elements.itemList.addEventListener('change', (e) => this.handleItemChange(e));

    // Search results
    this.elements.searchResults.addEventListener('click', (e) => this.handleSearchResultClick(e));

    // Edit modal
    this.elements.editSave.addEventListener('click', () => this.saveEdit());
    this.elements.editCancel.addEventListener('click', () => this.closeEditModal());
    this.elements.editModal.addEventListener('click', (e) => {
      if (e.target === this.elements.editModal) this.closeEditModal();
    });
    // Thumbs, in both the edit and review dialogs: tapping the pressed one again clears it
    [this.elements.editThumb, this.elements.reviewThumb].forEach(group => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.thumb-toggle');
        if (!btn) return;
        this.setThumb(group, btn.dataset.thumb === this.thumbs.get(group) ? '' : btn.dataset.thumb);
      });
    });

    // Review modal; tapping the current star rating again clears it
    this.elements.reviewStars.addEventListener('click', (e) => {
      const btn = e.target.closest('.star-btn');
      if (!btn) return;
      const stars = Number(btn.dataset.stars);
      this.setReviewStars(stars === this.reviewStars ? 0 : stars);
    });
    this.elements.reviewRewatch.addEventListener('click', () => {
      const pressed = this.elements.reviewRewatch.getAttribute('aria-pressed') === 'true';
      this.elements.reviewRewatch.setAttribute('aria-pressed', String(!pressed));
    });
    this.elements.reviewSave.addEventListener('click', () => this.saveReview());
    this.elements.reviewCancel.addEventListener('click', () => this.closeReviewModal());
    this.elements.reviewModal.addEventListener('click', (e) => {
      if (e.target === this.elements.reviewModal) this.closeReviewModal();
    });
  },

  // Compact view is a per-device preference, so it lives in localStorage rather than the watchlist data
  initViewToggle() {
    try {
      state.compactView = localStorage.getItem(CONFIG.VIEW_STORAGE_KEY) === '1';
    } catch (error) {
      state.compactView = false;
    }
    this.applyViewMode();

    this.elements.viewToggle.addEventListener('click', () => {
      state.compactView = !state.compactView;
      try {
        localStorage.setItem(CONFIG.VIEW_STORAGE_KEY, state.compactView ? '1' : '0');
      } catch (error) {
        // Preference just won't persist
      }
      this.applyViewMode();
    });
  },

  applyViewMode() {
    this.elements.itemList.classList.toggle('compact', state.compactView);
    this.elements.viewToggle.textContent = state.compactView ? 'Expand' : 'Collapse';
    this.elements.viewToggle.setAttribute('aria-pressed', String(state.compactView));
  },

  populatePlatformList() {
    this.elements.platformList.innerHTML = html`${CONFIG.PLATFORMS.map(p => html`<option value="${p}">`)}`;
  },

  toggleAddForm() {
    const isVisible = this.elements.addForm.classList.contains('visible');

    if (isVisible) {
      this.elements.addForm.classList.remove('visible');
      this.resetAddForm();
    } else {
      this.elements.addForm.classList.add('visible');
      this.elements.searchInput.focus();
    }
  },

  resetAddForm() {
    this.elements.searchInput.value = '';
    this.elements.searchResults.innerHTML = '';
    this.elements.manualForm.classList.add('hidden');
    this.elements.manualForm.classList.remove('from-search');
    this.elements.youtubeForm.classList.add('hidden');
    this.elements.manualTitle.value = '';
    this.elements.manualType.value = 'movie';
    this.elements.manualGenre.value = '';
    this.elements.manualRating.value = '';
    this.elements.manualTag.value = '';
    this.elements.manualPlatform.value = '';
    this.elements.manualPriority.value = 'medium';
    this.elements.manualToggle.textContent = 'Or enter manually';
    this.elements.saveManualBtn.textContent = 'Add to Watchlist';
    this.elements.youtubeTitle.value = '';
    this.elements.youtubeUrl.value = '';
    this.elements.youtubePriority.value = 'medium';
    this.elements.youtubeTag.value = '';
    this.elements.youtubeToggle.textContent = 'Or add YouTube video';
    state.selectedSearchResult = null;
    state.searchResults = [];
    clearTimeout(state.searchTimeout);
    state.searchSeq++;
  },

  toggleManualForm() {
    const isHidden = this.elements.manualForm.classList.contains('hidden');
    if (isHidden) {
      this.elements.youtubeForm.classList.add('hidden');
      this.elements.manualForm.classList.remove('hidden');
      this.elements.manualToggle.textContent = 'Or search automatically';
      this.elements.manualTitle.focus();
    } else {
      this.elements.manualForm.classList.add('hidden');
      this.elements.manualToggle.textContent = 'Or enter manually';
      this.elements.searchInput.focus();
    }
  },

  toggleYoutubeForm() {
    const isHidden = this.elements.youtubeForm.classList.contains('hidden');
    if (isHidden) {
      this.elements.manualForm.classList.add('hidden');
      this.elements.youtubeForm.classList.remove('hidden');
      this.elements.youtubeToggle.textContent = 'Or search automatically';
      this.elements.youtubeUrl.focus();
    } else {
      this.elements.youtubeForm.classList.add('hidden');
      this.elements.youtubeToggle.textContent = 'Or add YouTube video';
      this.elements.searchInput.focus();
    }
  },

  handleYoutubeAdd() {
    const title = this.elements.youtubeTitle.value.trim();
    const url = this.elements.youtubeUrl.value.trim();

    if (!title) {
      alert('Please enter a video title');
      return;
    }

    if (!url) {
      alert('Please enter a YouTube URL');
      return;
    }

    // Video ID gives the thumbnail and the watch link
    const videoID = YouTubeAPI.extractVideoID(url);

    const success = ItemManager.add({
      title,
      type: 'youtube',
      poster: videoID ? `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg` : '',
      youtubeID: videoID || '',
      // Without an ID the URL is the only link to the video, so keep it visible
      plot: videoID ? '' : url,
      priority: this.elements.youtubePriority.value,
      tag: this.elements.youtubeTag.value.trim(),
      platform: 'YouTube'
    });

    if (success) {
      this.toggleAddForm();
      this.render();
    }
  },

  handleSearch(query) {
    clearTimeout(state.searchTimeout);

    // Any response for an earlier query is stale from here on
    const seq = ++state.searchSeq;

    if (state.selectedSearchResult) {
      this.clearSelection();
    }

    if (!query || query.trim().length < 2) {
      this.elements.searchResults.innerHTML = '';
      state.searchResults = [];
      return;
    }

    state.searchTimeout = setTimeout(async () => {
      this.elements.searchResults.innerHTML = '<div class="search-loading">Searching...</div>';

      try {
        const { results, tooMany } = await MovieAPI.search(query, state.searchType);
        if (seq !== state.searchSeq) return;

        state.searchResults = results;

        if (results.length === 0) {
          const message = tooMany
            ? 'Too many matches. Keep typing, or add a year (e.g. "dune 1984").'
            : 'No results found. Try a different search or enter manually.';
          this.elements.searchResults.innerHTML = html`<div class="search-empty">${message}</div>`;
        } else {
          this.renderSearchResults(results);
        }
      } catch (error) {
        if (seq !== state.searchSeq) return;
        const errorMsg = error.message || 'Search failed. Please try again or enter manually.';
        this.elements.searchResults.innerHTML = html`<div class="search-error">${errorMsg}</div>`;
        console.error('Search failed:', error);
      }
    }, 500);
  },

  renderSearchResults(results) {
    this.elements.searchResults.innerHTML = html`${results.map((result, index) => this.searchResultHTML(result, index))}`;
    this.prefetchResultDetails(results, state.searchSeq);
  },

  posterHTML(item, className) {
    return item.poster && Security.isSafeUrl(item.poster)
      ? html`<img src="${item.poster}" class="${className}" alt="${item.title}" loading="lazy">`
      : html`<div class="${className}"></div>`;
  },

  searchResultHTML(result, index) {
    return html`
      <div class="search-result" data-index="${index}">
        ${this.posterHTML(result, 'result-poster')}
        <div class="result-info">
          <div class="result-title">${result.title}</div>
          <div class="result-details">${this.resultDetailsHTML(result)}</div>
        </div>
      </div>
    `;
  },

  resultDetailsHTML(result) {
    const details = MovieAPI.detailsCache.get(result.imdbID) || result;
    const meta = [details.year, details.type === 'series' ? 'TV Series' : 'Movie'];
    if (details.rating) meta.push(`⭐ ${details.rating}`);
    const credits = this.creditsText(details);

    return html`
      <div class="result-meta">${meta.filter(Boolean).join(' • ')}</div>
      ${credits && html`<div class="result-credits">${credits}</div>`}
    `;
  },

  // "Dir. Denis Villeneuve · Ryan Gosling, Harrison Ford" — enough to tell same-named titles apart
  creditsText(details) {
    const firstNames = (list, count) => (list || '')
      .split(',')
      .map(name => name.replace(/\(.*?\)/g, '').trim())
      .filter(Boolean)
      .slice(0, count)
      .join(', ');

    // Series rarely list a director; OMDb's writer field holds the creators
    const isSeries = details.type === 'series';
    const makers = firstNames(isSeries ? details.writer : details.director, 2);
    const cast = firstNames(details.actors, 2);

    return [makers && (isSeries ? 'Created by ' : 'Dir. ') + makers, cast]
      .filter(Boolean)
      .join(' · ');
  },

  // Fill in director/cast for the top results so same-named titles can be told apart
  prefetchResultDetails(results, seq) {
    results.slice(0, CONFIG.SEARCH.DETAIL_PREFETCH).forEach(async (result, index) => {
      if (MovieAPI.detailsCache.has(result.imdbID)) return;

      try {
        await MovieAPI.getDetails(result.imdbID);
      } catch (error) {
        return; // Credits are optional; the result is still selectable
      }

      if (seq !== state.searchSeq || state.selectedSearchResult) return;
      const el = this.elements.searchResults.querySelector(`.search-result[data-index="${index}"] .result-details`);
      if (el) el.innerHTML = this.resultDetailsHTML(result);
    });
  },

  async handleSearchResultClick(e) {
    if (state.selectedSearchResult) return;

    const resultEl = e.target.closest('.search-result');
    if (!resultEl) return;

    const index = parseInt(resultEl.dataset.index);
    const result = state.searchResults[index];

    if (!result) return;

    const seq = state.searchSeq;

    // Show loading
    this.elements.searchResults.innerHTML = '<div class="search-loading">Loading details...</div>';

    try {
      const details = await MovieAPI.getDetails(result.imdbID);
      if (seq !== state.searchSeq) return;

      if (details) {
        // Show confirmation with details
        this.showAddConfirmation(details);
      } else {
        this.elements.searchResults.innerHTML = '<div class="search-error">Could not load details. Please try again.</div>';
      }
    } catch (error) {
      if (seq !== state.searchSeq) return;
      this.elements.searchResults.innerHTML = html`<div class="search-error">${error.message || 'Failed to load details. Please try again.'}</div>`;
    }
  },

  showAddConfirmation(details) {
    state.selectedSearchResult = details;

    const credits = this.creditsText(details);

    this.elements.searchResults.innerHTML = html`
      <div class="search-result selected">
        ${this.posterHTML(details, 'result-poster')}
        <div class="result-info">
          <div class="result-title">${details.title} (${details.year})</div>
          <div class="result-meta">${details.type === 'series' ? 'TV Series' : 'Movie'} ${details.genre && `• ${details.genre}`}</div>
          ${details.rating && html`<div class="result-meta">⭐ ${details.rating}/10</div>`}
          ${credits && html`<div class="result-credits">${credits}</div>`}
          ${details.plot && html`<div class="result-plot">${details.plot}</div>`}
        </div>
      </div>
    `;

    // Show manual form for priority/tag selection, minus the fields the search already filled
    this.elements.manualForm.classList.remove('hidden');
    this.elements.manualForm.classList.add('from-search');
    this.elements.manualToggle.textContent = 'Choose different result';

    // Seed type dropdown from search result
    if (details.type === 'movie' || details.type === 'series') {
      this.elements.manualType.value = details.type;
    }

    // Update save button
    this.elements.saveManualBtn.textContent = 'Add to Watchlist';
  },

  clearSelection() {
    state.selectedSearchResult = null;
    this.elements.manualForm.classList.add('hidden');
    this.elements.manualForm.classList.remove('from-search');
    this.elements.manualToggle.textContent = 'Or enter manually';
  },

  backToSearchResults() {
    this.clearSelection();
    this.renderSearchResults(state.searchResults);
  },

  handleManualAdd() {
    const choices = {
      type: this.elements.manualType.value,
      priority: this.elements.manualPriority.value,
      tag: this.elements.manualTag.value.trim(),
      platform: this.elements.manualPlatform.value.trim()
    };
    let fields;

    if (state.selectedSearchResult) {
      // Adding from search result — type dropdown is seeded from API but user can override
      const { title, genre, rating, plot, poster, imdbID } = state.selectedSearchResult;
      fields = { title, genre, rating, plot, poster, imdbID, ...choices };
    } else {
      // Manual entry
      const title = this.elements.manualTitle.value.trim();
      if (!title) return;

      fields = {
        title,
        genre: this.elements.manualGenre.value.trim(),
        rating: this.elements.manualRating.value.trim(),
        ...choices
      };
    }

    if (ItemManager.add(fields)) {
      this.toggleAddForm();
      this.render();
    }
  },

  handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > CONFIG.LIMITS.MAX_FILE_SIZE) {
      this.setStatus('file too large', false);
      setTimeout(() => this.setStatus('saved', true), 2000);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      ItemManager.import(e.target.result);
    };
    reader.readAsText(file);
    event.target.value = '';
  },

  handleItemClick(e) {
    const target = e.target;

    // Poster click - Google search for the title
    if (target.classList.contains('item-poster')) {
      const itemEl = target.closest('.item');
      if (!itemEl) return;

      const itemId = itemEl.dataset.id;
      const item = state.items.find(i => i.id === itemId);
      if (!item) return;

      // Build search query: title + type + platform
      let query = item.title;

      if (item.type === 'movie') {
        query += ' movie';
      } else if (item.type === 'series') {
        query += ' tv show';
      } else if (item.type === 'youtube') {
        query += ' youtube video';
      }

      if (item.platform && item.platform !== 'YouTube') {
        query += ' ' + item.platform;
      }

      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      window.open(searchUrl, '_blank');
      return;
    }

    // Review icon (the click may land on the svg inside it)
    const reviewBtn = target.closest('.review-btn');
    if (reviewBtn) {
      const itemEl = reviewBtn.closest('.item');
      if (itemEl) this.openReviewModal(itemEl.dataset.id);
      return;
    }

    // Inline editable badge click
    if (target.classList.contains('editable')) {
      e.stopPropagation();
      this.startInlineEdit(target);
      return;
    }

    // Action buttons
    if (target.classList.contains('action-btn')) {
      const itemEl = target.closest('.item');
      if (!itemEl) return;

      const itemId = itemEl.dataset.id;

      if (target.classList.contains('edit')) {
        this.openEditModal(itemId);
      } else if (target.classList.contains('delete')) {
        ItemManager.delete(itemId);
      }
    }
  },

  startInlineEdit(badge) {
    // Clean up any existing inline edits first
    const existingEdit = document.querySelector('.badge-edit-input, .badge-edit-select');
    if (existingEdit) {
      const existingBadge = existingEdit.previousElementSibling;
      if (existingBadge) {
        existingBadge.style.display = '';
      }
      existingEdit.remove();
    }

    const field = badge.dataset.field;
    const itemId = badge.dataset.itemId;
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    const currentValue = field === 'priority' ? ItemModel.displayPriority(item) : item[field] || '';

    let input;
    const blurHandler = () => {
      this.saveInlineEdit(input, itemId, field, badge, blurHandler, keydownHandler);
    };

    const keydownHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Remove listeners before cleanup
        input.removeEventListener('blur', blurHandler);
        input.removeEventListener('keydown', keydownHandler);
        badge.style.display = '';
        input.remove();
      }
    };

    if (field === 'priority') {
      // Dropdown for priority
      input = document.createElement('select');
      input.className = 'badge-edit-select';
      input.innerHTML = html`${CONFIG.PRIORITIES.map(p =>
        html`<option value="${p}" ${currentValue === p && 'selected'}>${CONFIG.PRIORITY_LABELS[p]}</option>`)}`;
    } else {
      // Text input for tag and platform
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'badge-edit-input';
      input.value = currentValue;
      input.placeholder = field === 'tag' ? 'Add tag...' : 'Add platform...';

      if (field === 'platform') {
        input.setAttribute('list', 'platform-list');
      } else if (field === 'tag') {
        input.setAttribute('list', 'tag-list');
      }
    }

    // Add event listeners
    input.addEventListener('blur', blurHandler);
    input.addEventListener('keydown', keydownHandler);

    // Replace badge with input
    badge.style.display = 'none';
    badge.parentNode.insertBefore(input, badge.nextSibling);
    input.focus();
    if (input.type === 'text') {
      input.select();
    }
  },

  saveInlineEdit(input, itemId, field, badge, blurHandler, keydownHandler) {
    const newValue = input.value.trim();

    // Remove event listeners before removing element
    input.removeEventListener('blur', blurHandler);
    input.removeEventListener('keydown', keydownHandler);

    // Remove input and show badge again
    input.remove();
    badge.style.display = '';

    // Update item
    const updates = {};
    updates[field] = newValue;

    const success = ItemManager.update(itemId, updates);

    if (success) {
      // Only update the specific badge text instead of full re-render
      this.updateBadgeDisplay(badge, field, newValue, itemId);

      // Full re-render if priority changed (items need re-sorting) or a
      // platform was cleared (empty platform badges aren't shown)
      if (field === 'priority' || (field === 'platform' && !newValue)) {
        this.render();
      } else {
        // Just update filters in case new tag was added
        this.renderFilters();
      }
    }
  },

  updateBadgeDisplay(badge, field, newValue, itemId) {
    // Update the badge text without re-rendering everything
    if (field === 'priority') {
      badge.textContent = CONFIG.PRIORITY_LABELS[newValue];
      badge.className = `badge priority-${newValue} editable`;
      badge.setAttribute('data-field', 'priority');
      badge.setAttribute('data-item-id', itemId);
      badge.setAttribute('title', 'Click to edit priority');
    } else if (field === 'tag') {
      if (newValue) {
        badge.textContent = newValue;
      } else {
        badge.textContent = '+ tag';
      }
      badge.classList.toggle('empty', !newValue);
    } else if (field === 'platform' && newValue) {
      // A cleared platform triggers a full render, which drops the badge
      badge.textContent = '📺 ' + newValue;
    }
  },

  handleItemChange(e) {
    if (e.target.classList.contains('item-checkbox')) {
      const itemEl = e.target.closest('.item');
      if (itemEl) {
        ItemManager.toggle(itemEl.dataset.id);
      }
    }
  },

  openEditModal(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    state.editingId = itemId;

    this.elements.editTitle.value = item.title;
    this.elements.editType.value = item.type;
    this.elements.editPriority.value = ItemModel.displayPriority(item);
    this.elements.editTag.value = item.tag || '';
    this.elements.editPlatform.value = item.platform || '';
    this.elements.editGenre.value = item.genre || '';
    this.elements.editRating.value = item.rating || '';
    this.elements.editPlot.value = item.plot || '';
    this.setThumb(this.elements.editThumb, item.thumb);

    this.elements.editModal.classList.add('visible');
  },

  // Current thumb per dialog's toggle group
  thumbs: new Map(),

  setThumb(group, thumb) {
    this.thumbs.set(group, thumb || '');
    group.querySelectorAll('.thumb-toggle').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.thumb === thumb));
    });
  },

  closeEditModal() {
    this.elements.editModal.classList.remove('visible');
    state.editingId = null;
  },

  saveEdit() {
    if (!state.editingId) return;

    const success = ItemManager.update(state.editingId, {
      title: this.elements.editTitle.value.trim(),
      type: this.elements.editType.value,
      priority: this.elements.editPriority.value,
      tag: this.elements.editTag.value.trim(),
      platform: this.elements.editPlatform.value.trim(),
      genre: this.elements.editGenre.value.trim(),
      rating: this.elements.editRating.value.trim(),
      plot: this.elements.editPlot.value.trim(),
      thumb: this.thumbs.get(this.elements.editThumb)
    });

    if (success) {
      this.closeEditModal();
      this.render();
    }
  },

  openReviewModal(itemId) {
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;

    state.reviewingId = itemId;

    this.elements.reviewTitle.textContent = item.title;
    this.elements.reviewDate.textContent = item.reviewDate
      ? `Reviewed ${new Date(item.reviewDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : '';
    this.setThumb(this.elements.reviewThumb, item.thumb);
    this.setReviewStars(item.stars);
    this.elements.reviewText.value = item.review;
    this.elements.reviewRewatch.setAttribute('aria-pressed', String(item.rewatch));

    this.elements.reviewModal.classList.add('visible');
  },

  setReviewStars(stars) {
    this.reviewStars = stars;
    this.elements.reviewStars.querySelectorAll('.star-btn').forEach(btn => {
      const value = Number(btn.dataset.stars);
      btn.classList.toggle('filled', value <= stars);
      btn.setAttribute('aria-checked', String(value === stars));
    });
  },

  closeReviewModal() {
    this.elements.reviewModal.classList.remove('visible');
    state.reviewingId = null;
  },

  saveReview() {
    if (!state.reviewingId) return;

    const success = ItemManager.update(state.reviewingId, {
      stars: this.reviewStars,
      review: this.elements.reviewText.value.trim(),
      rewatch: this.elements.reviewRewatch.getAttribute('aria-pressed') === 'true',
      thumb: this.thumbs.get(this.elements.reviewThumb)
    });

    if (success) {
      this.closeReviewModal();
      this.render();
    }
  },

  setFilter(filterValue) {
    state.filter = filterValue;
    this.render();
  },

  setStatus(text, isSuccess) {
    this.elements.status.textContent = text;
    this.elements.status.classList.toggle('success', isSuccess);
  },

  render() {
    this.renderStats();
    this.renderFilters();
    this.renderItems();
  },

  renderStats() {
    const unwatched = state.items.filter(i => !i.watched);
    const high = unwatched.filter(i => i.priority === 'high').length;
    const movies = unwatched.filter(i => i.type === 'movie').length;

    const stats = [['To Watch', unwatched.length], ['High Priority', high], ['Movies', movies]];
    this.elements.stats.innerHTML = html`${stats.map(([label, value]) => html`
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      </div>
    `)}`;
  },

  renderFilters() {
    const tags = [...new Set(state.items.map(i => i.tag).filter(Boolean))];
    const platforms = [...new Set(state.items.map(i => i.platform).filter(Boolean))];
    const hasRewatch = state.filter === 'rewatch' || state.items.some(i => i.rewatch);

    // Update tag datalist
    this.elements.tagList.innerHTML = html`${tags.map(t => html`<option value="${t}">`)}`;

    const filters = [
      { key: 'all', label: 'All' },
      ...CONFIG.PRIORITIES.map(p => ({ key: p, label: this.priorityGroupLabel(p) })),
      { key: 'movie', label: 'Movies' },
      { key: 'series', label: 'TV Series' },
      { key: 'youtube', label: 'YouTube' },
      ...platforms.map(p => ({ key: p, label: '📺 ' + p })),
      ...tags.map(t => ({ key: t, label: t })),
      ...(hasRewatch ? [{ key: 'rewatch', label: '🔁 Rewatch' }] : []),
      { key: 'watched', label: 'Watched' }
    ];

    this.elements.filters.innerHTML = html`${filters.map(f => {
      const isActive = f.key === 'watched' ? state.watchedMode : state.filter === f.key;
      return html`<button class="filter-btn ${isActive && 'active'}" data-filter="${f.key}">${f.label}</button>`;
    })}`;
  },

  priorityGroupLabel(priority) {
    const label = CONFIG.PRIORITY_LABELS[priority];
    return priority === 'watching' ? label : `${label} Priority`;
  },

  renderItems() {
    const filtered = ItemManager.getFiltered();

    if (filtered.length === 0) {
      this.elements.itemList.innerHTML = '<div class="empty-state">Nothing here. Add something to watch!</div>';
      return;
    }

    // Group by priority; CONFIG.PRIORITIES fixes the group order
    const byPriority = {};
    filtered.forEach(item => {
      const priority = ItemModel.displayPriority(item);
      (byPriority[priority] = byPriority[priority] || []).push(item);
    });

    this.elements.itemList.innerHTML = html`${CONFIG.PRIORITIES
      .filter(priority => byPriority[priority])
      .map(priority => html`
        <div class="item-group-label">${this.priorityGroupLabel(priority)}</div>
        ${byPriority[priority].map(item => this.itemHTML(item))}
      `)}`;
  },

  itemHTML(item) {
    const priority = ItemModel.displayPriority(item);
    const isYoutube = item.type === 'youtube';
    const hasReview = item.stars > 0 || item.review || item.rewatch || item.thumb;
    const editable = (field, label) =>
      html`data-field="${field}" data-item-id="${item.id}" title="Click to ${label}"`;

    return html`
      <div class="item ${item.watched && 'watched'}" data-id="${item.id}">
        ${this.posterHTML(item, 'item-poster')}
        <div class="item-body">
          <div class="item-header">
            <div class="item-title">${item.title}</div>
            <button type="button" class="review-btn ${hasReview && 'has-review'}" title="${hasReview ? 'Edit review' : 'Write a review'}" aria-label="${hasReview ? 'Edit review' : 'Write a review'}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <input type="checkbox" class="item-checkbox" ${item.watched && 'checked'}>
          </div>
          <div class="item-meta">
            ${isYoutube
              ? html`<span class="badge youtube">📺 YouTube</span>
                ${item.youtubeID && html`<a href="https://www.youtube.com/watch?v=${item.youtubeID}" target="_blank" rel="noopener" class="badge rating badge-link">▶ Watch</a>`}`
              : html`<span class="badge ${item.type}">${item.type === 'series' ? 'TV Series' : 'Movie'}</span>`}
            <span class="badge priority-${priority} editable" ${editable('priority', 'edit priority')}>${CONFIG.PRIORITY_LABELS[priority]}</span>
            ${!isYoutube && item.platform && html`<span class="badge platform editable" ${editable('platform', 'edit platform')}>📺 ${item.platform}</span>`}
            ${isYoutube && item.duration && html`<span class="badge rating">⏱ ${item.duration}</span>`}
            ${item.rating && html`<span class="badge rating">⭐ ${item.rating}</span>`}
            ${item.genre && html`<span class="badge genre">${isYoutube ? item.genre : item.genre.split(',')[0]}</span>`}
            ${item.tag
              ? html`<span class="badge tag editable" ${editable('tag', 'edit tag')}>${item.tag}</span>`
              : html`<span class="badge tag editable empty" ${editable('tag', 'add tag')}>+ tag</span>`}
            ${item.thumb && html`<span class="badge thumb" title="${item.thumb === 'up' ? 'You liked it' : 'Not for you'}">${item.thumb === 'up' ? '👍' : '👎'}</span>`}
            ${item.stars > 0 && html`<span class="badge stars" title="Your rating: ${item.stars}/5">${'★'.repeat(item.stars)}${'☆'.repeat(5 - item.stars)}</span>`}
            ${item.rewatch && html`<span class="badge rewatch">🔁 Rewatch</span>`}
          </div>
          ${item.plot && html`<div class="item-plot">${item.plot}</div>`}
          ${item.review && html`<div class="item-review">${item.review}</div>`}
          <div class="item-actions">
            <button class="action-btn edit">Edit</button>
            <button class="action-btn delete">Delete</button>
          </div>
        </div>
      </div>
    `;
  }
};
