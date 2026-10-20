// ============================================================================
// State Management
// ============================================================================

const state = {
  items: [],
  filter: 'all',
  watchedMode: false,
  selectedSearchResult: null,
  searchResults: [],
  searchTimeout: null,
  searchSeq: 0,
  searchType: '',
  editingId: null,
  quickSearch: '',
  compactView: false,
  db: null,
  undoStack: []
};
