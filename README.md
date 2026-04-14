# Watchlist

A client-side movie, TV, and YouTube watchlist app. All data stays in your browser via IndexedDB — no server, no account required.

## Features

- **Search & add** movies/TV shows via the OMDb API with automatic metadata (poster, rating, genre, plot)
- **YouTube videos** — paste a URL to add with auto-generated thumbnail
- **Manual entry** for anything not in the database
- **Priority levels** (high/medium/low) with grouped display
- **Tags & platforms** — organize by custom tags (family, airplane, art) and streaming platform (Netflix, etc.)
- **Quick filter** — substring search across titles, combinable with filter buttons
- **Watched toggle** — mark items as watched; filter to view watched items, optionally narrowed by another filter
- **Inline editing** — click any badge (priority, tag, platform) to edit in place
- **Import/Export** — JSON-based backup and restore
- **Undo** — revert deletes, edits, and watched toggles
- **Batch upload** — add many titles at once via `batch-upload.html`
- **Dark mode** — follows system preference
- **Mobile-ready** — responsive layout with iOS PWA support

## Setup

1. Get a free API key from [OMDb](http://www.omdbapi.com/apikey.aspx)
2. Set it in `js/config.js` → `CONFIG.API.OMDB_KEY`
3. Serve the directory over HTTP:
   ```
   python3 -m http.server 8000
   ```
4. Open `http://localhost:8000/watchlist.html`

## Usage

- **Add** — click `+ Add`, search for a title, select a result, set priority/tag/platform, and save
- **Filter** — use the filter buttons (type, priority, tag, platform) and/or type in the quick search bar
- **Watched** — check the checkbox to mark watched; click the Watched filter to view them; click another filter while in watched mode to narrow further
- **Edit** — click a badge to edit inline, or click Edit for the full modal
- **Poster click** — opens a Google search for the title
- **Export/Import** — back up your list as JSON and restore on any browser

## Files

```
watchlist.html       Main app
batch-upload.html    Bulk title importer
watchlist.css        Styles (light/dark, responsive)
js/
  config.js          API keys, limits, constants
  state.js           App state
  security.js        Input sanitization & XSS protection
  database.js        IndexedDB wrapper
  movie-api.js       OMDb search & detail fetch
  youtube-api.js     YouTube URL parsing
  item-manager.js    CRUD, filtering, import/export
  undo-manager.js    Undo stack
  ui.js              Rendering & event handling
  app.js             Initialization
```
