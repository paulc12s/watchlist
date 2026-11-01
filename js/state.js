// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// State Management
// ============================================================================

const state = {
  filter: 'all',
  // Which titles to list: 'queue' (to watch), 'watched', 'rated', or by thumb, 'up' / 'down'
  list: 'queue',
  // Within Rated: 'all', 'loved', 'up' or 'down'
  verdict: 'all',
  // How lists other than the queue are ordered (ItemManager.SORTS)
  sort: 'recent',
  // The combined page's Rated mode: its own search, filter, verdict and order
  rated: { list: 'rated', filter: 'all', quickSearch: '', verdict: 'all', sort: 'recent' },
  selectedSearchResult: null,
  searchResults: [],
  searchTimeout: null,
  searchSeq: 0,
  searchType: '',
  editingId: null,
  reviewingId: null,
  quickSearch: '',
  compactView: false,
  undoStack: []
};
