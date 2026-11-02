// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// State: what each list view shows (js/app/list-view.js), and the undo stack
// ============================================================================

const state = {
  // Watchlist mode: the list to watch, its search and filter chip
  list: 'queue',
  filter: 'all',
  quickSearch: '',
  verdict: 'all',
  sort: 'recent',
  // Rated mode keeps its own; verdict narrows it to ❤️, 👍 or 👎
  rated: { list: 'rated', filter: 'all', quickSearch: '', verdict: 'all', sort: 'recent' },
  undoStack: []
};
