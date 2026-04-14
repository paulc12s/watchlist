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
  editingId: null,
  quickSearch: '',
  db: null,
  undoStack: []
};
