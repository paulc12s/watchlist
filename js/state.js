// ============================================================================
// State Management
// ============================================================================

const state = {
  items: [],
  filter: 'all',
  selectedSearchResult: null,
  searchResults: [],
  searchTimeout: null,
  editingId: null,
  db: null,
  undoStack: []
};
