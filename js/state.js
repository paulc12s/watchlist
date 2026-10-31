// ============================================================================
// State Management
// ============================================================================

const state = {
  items: [],
  filter: 'all',
  // Which titles to list: 'queue' (to watch), 'watched', or by thumb, 'up' / 'down'
  list: 'queue',
  selectedSearchResult: null,
  searchResults: [],
  searchTimeout: null,
  searchSeq: 0,
  searchType: '',
  editingId: null,
  reviewingId: null,
  quickSearch: '',
  compactView: false,
  db: null,
  undoStack: []
};
