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
      editModal: document.getElementById('edit-modal'),
      editTitle: document.getElementById('edit-title'),
      editType: document.getElementById('edit-type'),
      editPriority: document.getElementById('edit-priority'),
      editTag: document.getElementById('edit-tag'),
      editPlatform: document.getElementById('edit-platform'),
      editGenre: document.getElementById('edit-genre'),
      editRating: document.getElementById('edit-rating'),
      editPlot: document.getElementById('edit-plot'),
      editSave: document.getElementById('edit-save'),
      editCancel: document.getElementById('edit-cancel')
    };

    this.attachEventListeners();
    this.populatePlatformList();
  },

  attachEventListeners() {
    this.elements.addBtn.addEventListener('click', () => this.toggleAddForm());
    this.elements.exportBtn.addEventListener('click', () => ItemManager.export());
    this.elements.importBtn.addEventListener('click', () => this.elements.importFile.click());
    this.elements.importFile.addEventListener('change', (e) => this.handleImport(e));

    // Search
    this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));

    // Manual toggle
    this.elements.manualToggle.addEventListener('click', () => this.toggleManualForm());
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
        if (state.filter === clickedFilter && clickedFilter !== 'all') {
          this.setFilter('all');
        } else {
          this.setFilter(clickedFilter);
        }
      }
    });

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
  },

  populatePlatformList() {
    this.elements.platformList.innerHTML = CONFIG.PLATFORMS
      .map(p => `<option value="${Security.escapeAttr(p)}">`)
      .join('');
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
    this.elements.youtubeForm.classList.add('hidden');
    this.elements.manualTitle.value = '';
    this.elements.manualGenre.value = '';
    this.elements.manualRating.value = '';
    this.elements.manualTag.value = '';
    this.elements.manualPlatform.value = '';
    this.elements.manualPriority.value = 'medium';
    this.elements.youtubeTitle.value = '';
    this.elements.youtubeUrl.value = '';
    this.elements.youtubePriority.value = 'medium';
    this.elements.youtubeTag.value = '';
    state.selectedSearchResult = null;
    state.searchResults = [];
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

    // Extract video ID for thumbnail and watch link
    const videoID = YouTubeAPI.extractVideoID(url);

    // Generate thumbnail URL if we have a video ID
    let poster = '';
    if (videoID) {
      poster = `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`;
    }

    // Add to watchlist
    const itemData = {
      id: Date.now() + '',
      title: title,
      type: 'youtube',
      genre: '',
      rating: '',
      plot: url, // Store URL in plot field
      poster: poster,
      imdbID: '',
      youtubeID: videoID || '',
      duration: '',
      priority: this.elements.youtubePriority.value,
      tag: this.elements.youtubeTag.value.trim(),
      platform: 'YouTube',
      watched: false
    };

    const success = ItemManager.add(itemData);

    if (success) {
      this.toggleAddForm();
      this.render();
      this.setStatus('YouTube video added', true);
      setTimeout(() => this.setStatus('saved', true), 2000);
    }
  },

  async handleSearch(query) {
    if (state.searchTimeout) {
      clearTimeout(state.searchTimeout);
    }

    if (!query || query.length < 2) {
      this.elements.searchResults.innerHTML = '';
      return;
    }

    state.searchTimeout = setTimeout(async () => {
      this.elements.searchResults.innerHTML = '<div class="search-loading">Searching...</div>';

      try {
        const results = await MovieAPI.search(query);
        state.searchResults = results;

        if (results.length === 0) {
          this.elements.searchResults.innerHTML = '<div class="search-empty">No results found. Try a different search or enter manually.</div>';
        } else {
          this.renderSearchResults(results);
        }
      } catch (error) {
        const errorMsg = error.message || 'Search failed. Please try again or enter manually.';
        this.elements.searchResults.innerHTML = `<div class="search-error">${Security.escapeHtml(errorMsg)}</div>`;
        console.error('Search failed:', error);
      }
    }, 500);
  },

  renderSearchResults(results) {
    const html = results.map((result, index) => {
      const posterImg = result.poster
        ? `<img src="${Security.escapeAttr(result.poster)}" class="result-poster" alt="${Security.escapeAttr(result.title)}" loading="lazy" onerror="this.style.display='none'">`
        : '<div class="result-poster"></div>';

      return `
        <div class="search-result" data-index="${index}">
          ${posterImg}
          <div class="result-info">
            <div class="result-title">${Security.escapeHtml(result.title)}</div>
            <div class="result-meta">${Security.escapeHtml(result.year)} • ${Security.escapeHtml(result.type === 'series' ? 'TV Series' : 'Movie')}</div>
          </div>
        </div>
      `;
    }).join('');

    this.elements.searchResults.innerHTML = html;
  },

  async handleSearchResultClick(e) {
    const resultEl = e.target.closest('.search-result');
    if (!resultEl) return;

    const index = parseInt(resultEl.dataset.index);
    const result = state.searchResults[index];

    if (!result) return;

    // Show loading
    this.elements.searchResults.innerHTML = '<div class="search-loading">Loading details...</div>';

    try {
      const details = await MovieAPI.getDetails(result.imdbID);

      if (details) {
        // Show confirmation with details
        this.showAddConfirmation(details);
      } else {
        this.elements.searchResults.innerHTML = '<div class="search-error">Could not load details. Please try again.</div>';
      }
    } catch (error) {
      this.elements.searchResults.innerHTML = '<div class="search-error">Failed to load details. Please try again.</div>';
    }
  },

  showAddConfirmation(details) {
    state.selectedSearchResult = details;

    const posterImg = details.poster
      ? `<img src="${Security.escapeAttr(details.poster)}" class="result-poster" alt="${Security.escapeAttr(details.title)}" loading="lazy" onerror="this.style.display='none'">`
      : '<div class="result-poster"></div>';

    const html = `
      <div class="search-result selected">
        ${posterImg}
        <div class="result-info">
          <div class="result-title">${Security.escapeHtml(details.title)} (${Security.escapeHtml(details.year)})</div>
          <div class="result-meta">${Security.escapeHtml(details.type === 'series' ? 'TV Series' : 'Movie')} ${details.genre ? '• ' + Security.escapeHtml(details.genre) : ''}</div>
          ${details.rating ? '<div class="result-meta">⭐ ' + Security.escapeHtml(details.rating) + '/10</div>' : ''}
          ${details.plot ? '<div class="result-plot">' + Security.escapeHtml(details.plot) + '</div>' : ''}
        </div>
      </div>
    `;

    this.elements.searchResults.innerHTML = html;

    // Show manual form for priority/tag selection
    this.elements.manualForm.classList.remove('hidden');
    this.elements.manualToggle.textContent = 'Choose different result';

    // Update save button
    this.elements.saveManualBtn.textContent = 'Add to Watchlist';
  },

  handleManualAdd() {
    let itemData;

    if (state.selectedSearchResult) {
      // Adding from search result
      itemData = {
        id: Date.now() + '',
        title: state.selectedSearchResult.title,
        type: state.selectedSearchResult.type,
        genre: state.selectedSearchResult.genre,
        rating: state.selectedSearchResult.rating,
        plot: state.selectedSearchResult.plot,
        poster: state.selectedSearchResult.poster,
        imdbID: state.selectedSearchResult.imdbID,
        priority: this.elements.manualPriority.value,
        tag: this.elements.manualTag.value.trim(),
        platform: this.elements.manualPlatform.value.trim(),
        watched: false
      };
    } else {
      // Manual entry
      const title = this.elements.manualTitle.value.trim();
      if (!title) return;

      itemData = {
        id: Date.now() + '',
        title: title,
        type: this.elements.manualType.value,
        genre: this.elements.manualGenre.value.trim(),
        rating: this.elements.manualRating.value.trim(),
        plot: '',
        poster: '',
        imdbID: '',
        priority: this.elements.manualPriority.value,
        tag: this.elements.manualTag.value.trim(),
        platform: this.elements.manualPlatform.value.trim(),
        watched: false
      };
    }

    const success = ItemManager.add(itemData);

    if (success) {
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

    const currentValue = item[field] || '';

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
      input.innerHTML = `
        <option value="high" ${currentValue === 'high' ? 'selected' : ''}>High</option>
        <option value="medium" ${currentValue === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="low" ${currentValue === 'low' ? 'selected' : ''}>Low</option>
      `;
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

      // Only do full re-render if priority changed (items need re-sorting)
      if (field === 'priority') {
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
      const priorityText = newValue === 'high' ? 'High' : newValue === 'medium' ? 'Medium' : 'Low';
      badge.textContent = priorityText;
      badge.className = `badge priority-${newValue} editable`;
      badge.setAttribute('data-field', 'priority');
      badge.setAttribute('data-item-id', itemId);
      badge.setAttribute('title', 'Click to edit priority');
    } else if (field === 'tag') {
      if (newValue) {
        badge.textContent = newValue;
        badge.style.opacity = '1';
      } else {
        badge.textContent = '+ tag';
        badge.style.opacity = '0.5';
      }
    } else if (field === 'platform') {
      if (newValue) {
        badge.textContent = '📺 ' + newValue;
        badge.style.opacity = '1';
      } else {
        badge.textContent = '📺 add platform';
        badge.style.opacity = '0.5';
      }
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
    this.elements.editPriority.value = item.priority;
    this.elements.editTag.value = item.tag || '';
    this.elements.editPlatform.value = item.platform || '';
    this.elements.editGenre.value = item.genre || '';
    this.elements.editRating.value = item.rating || '';
    this.elements.editPlot.value = item.plot || '';

    this.elements.editModal.classList.add('visible');
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
      plot: this.elements.editPlot.value.trim()
    });

    if (success) {
      this.closeEditModal();
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

    this.elements.stats.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">To Watch</div>
        <div class="stat-value">${unwatched.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">High Priority</div>
        <div class="stat-value">${high}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Movies</div>
        <div class="stat-value">${movies}</div>
      </div>
    `;
  },

  renderFilters() {
    const tags = [...new Set(state.items.map(i => i.tag).filter(Boolean))];
    const platforms = [...new Set(state.items.map(i => i.platform).filter(Boolean))];

    // Update tag datalist
    this.elements.tagList.innerHTML = tags
      .map(t => `<option value="${Security.escapeAttr(t)}">`)
      .join('');

    const filters = [
      { key: 'all', label: 'All' },
      { key: 'high', label: 'High Priority' },
      { key: 'medium', label: 'Medium Priority' },
      { key: 'low', label: 'Low Priority' },
      { key: 'movie', label: 'Movies' },
      { key: 'series', label: 'TV Series' },
      { key: 'youtube', label: 'YouTube' },
      ...platforms.map(p => ({ key: p, label: '📺 ' + p })),
      ...tags.map(t => ({ key: t, label: t })),
      { key: 'watched', label: 'Watched' }
    ];

    this.elements.filters.innerHTML = filters
      .map(f => {
        const activeClass = state.filter === f.key ? ' active' : '';
        return `<button class="filter-btn${activeClass}" data-filter="${Security.escapeAttr(f.key)}">${Security.escapeHtml(f.label)}</button>`;
      })
      .join('');
  },

  renderItems() {
    const filtered = ItemManager.getFiltered();

    if (filtered.length === 0) {
      this.elements.itemList.innerHTML = '<div class="empty-state">Nothing here. Add something to watch!</div>';
      return;
    }

    // Sort items by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...filtered].sort((a, b) => {
      return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
    });

    // Group by priority
    const byPriority = {};
    sorted.forEach(item => {
      const pri = item.priority || 'medium';
      if (!byPriority[pri]) byPriority[pri] = [];
      byPriority[pri].push(item);
    });

    const priorityLabels = { high: 'High Priority', medium: 'Medium Priority', low: 'Low Priority' };
    const priorityOrder2 = ['high', 'medium', 'low'];

    let html = '';

    for (const priority of priorityOrder2) {
      if (!byPriority[priority]) continue;

      html += `<div class="item-group-label">${priorityLabels[priority]}</div>`;

      byPriority[priority].forEach(item => {
        const safeId = Security.escapeAttr(item.id);
        const posterImg = item.poster && Security.isSafeUrl(item.poster)
          ? `<img src="${Security.escapeAttr(item.poster)}" class="item-poster" alt="${Security.escapeAttr(item.title)}" loading="lazy" onerror="this.style.display='none'">`
          : '<div class="item-poster"></div>';

        let itemClasses = 'item';
        if (item.watched) itemClasses += ' watched';

        html += `<div class="${itemClasses}" data-id="${safeId}">`;
        html += posterImg;
        html += '<div class="item-body">';
        html += '<div class="item-header">';
        html += `<div class="item-title">${Security.escapeHtml(item.title)}</div>`;
        html += `<input type="checkbox" class="item-checkbox" ${item.watched ? 'checked' : ''}>`;
        html += '</div>';
        html += '<div class="item-meta">';

        // Type badge
        if (item.type === 'youtube') {
          html += `<span class="badge youtube">📺 YouTube</span>`;
          if (item.youtubeID) {
            html += `<a href="https://www.youtube.com/watch?v=${Security.escapeAttr(item.youtubeID)}" target="_blank" rel="noopener" class="badge rating" style="text-decoration: none; cursor: pointer;">▶ Watch</a>`;
          }
        } else {
          html += `<span class="badge ${item.type}">${item.type === 'series' ? 'TV Series' : 'Movie'}</span>`;
        }

        // Priority badge (editable)
        html += `<span class="badge priority-${item.priority} editable" data-field="priority" data-item-id="${safeId}" title="Click to edit priority">`;
        html += item.priority === 'high' ? 'High' : item.priority === 'medium' ? 'Medium' : 'Low';
        html += '</span>';

        if (item.type !== 'youtube') {
          if (item.platform) {
            html += `<span class="badge platform editable" data-field="platform" data-item-id="${safeId}" title="Click to edit platform">📺 ${Security.escapeHtml(item.platform)}</span>`;
          } else {
            html += `<span class="badge platform editable" data-field="platform" data-item-id="${safeId}" title="Click to add platform" style="opacity: 0.5;">📺 add platform</span>`;
          }
        }

        // Duration for YouTube videos
        if (item.type === 'youtube' && item.duration) {
          html += `<span class="badge rating">⏱ ${Security.escapeHtml(item.duration)}</span>`;
        }

        if (item.rating) {
          html += `<span class="badge rating">⭐ ${Security.escapeHtml(item.rating)}</span>`;
        }

        // For YouTube, show channel instead of genre
        if (item.type === 'youtube' && item.genre) {
          html += `<span class="badge genre">${Security.escapeHtml(item.genre)}</span>`;
        } else if (item.genre && item.type !== 'youtube') {
          html += `<span class="badge genre">${Security.escapeHtml(item.genre.split(',')[0])}</span>`;
        }

        if (item.tag) {
          html += `<span class="badge tag editable" data-field="tag" data-item-id="${safeId}" title="Click to edit tag">${Security.escapeHtml(item.tag)}</span>`;
        } else {
          html += `<span class="badge tag editable" data-field="tag" data-item-id="${safeId}" title="Click to add tag" style="opacity: 0.5;">+ tag</span>`;
        }

        html += '</div>';
        if (item.plot) {
          html += `<div class="item-plot">${Security.escapeHtml(item.plot)}</div>`;
        }
        html += '<div class="item-actions">';
        html += '<button class="action-btn edit">Edit</button>';
        html += '<button class="action-btn delete">Delete</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      });
    }

    this.elements.itemList.innerHTML = html;
  }
};
