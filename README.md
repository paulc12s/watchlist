# Watchlist

A client-side movie, TV, and YouTube watchlist app. All data stays in your browser via IndexedDB — no server, no account required.

## Features

- **Search & add** movies/TV shows via the OMDb API with automatic metadata (poster, rating, genre, plot)
- **YouTube videos** — paste a URL to add with auto-generated thumbnail
- **Manual entry** for anything not in the database
- **Priority levels** (watching now/high/medium/low) with grouped display
- **Compact view** — collapse cards to title, poster and one line of tags (remembered per device)
- **Tags & platforms** — organize by custom tags (family, airplane, art) and streaming platform (Netflix, etc.)
- **Quick filter** — substring search across titles, combinable with filter buttons
- **Watched toggle** — mark items as watched; filter to view watched items, optionally narrowed by another filter
- **Reviews** — rate titles out of 5 stars, jot a few thoughts, and flag them as worth a rewatch
- **Rewatch filter** — find flagged titles in either the active or watched list
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

## Tests

```
node --test tests/watchlist.test.js
```

## Deploying

`.github/workflows/pages.yml` runs the tests, stamps the commit hash into the app (replacing `__APP_VERSION__`), and publishes to GitHub Pages on every push to `main`. Set **Settings → Pages → Source** to **GitHub Actions** once.

Installed copies (such as an iPhone home-screen icon) check `version.json` on launch and whenever they come back to the foreground, and reload when a newer version is deployed. Locally, or when served straight from the branch, the version is unstamped and the check is skipped.

## Usage

- **Add** — click `+ Add`, search for a title, select a result, set priority/tag/platform, and save
- **Search tips** — add a year to narrow (`dune 1984`), use the All / Movies / TV toggle, or paste an IMDb link or `tt…` ID to jump straight to a title. Exact title matches and recent releases rank first; top results show director and cast to tell same-named titles apart
- **Filter** — use the filter buttons (type, priority, tag, platform) and/or type in the quick search bar
- **Watched** — check the checkbox to mark watched; click the Watched filter to view them; click another filter while in watched mode to narrow further
- **Review** — click the pencil icon next to the checkbox to set stars, notes and the rewatch flag; tap the current star again to clear the rating. Uncheck a watched title flagged for rewatch to put it back in the queue
- **Edit** — click a badge to edit inline, or click Edit for the full modal
- **Poster click** — opens a Google search for the title
- **Export/Import** — back up your list as JSON and restore on any browser

## Files

```
watchlist.html       Main app
batch-upload.html    Bulk title importer (+ batch-upload.css)
version.json         Deployed version, stamped by the Pages workflow
watchlist.css        Styles (light/dark, responsive)
js/
  config.js          API keys, limits, constants
  state.js           App state
  security.js        Input sanitization, escaping, html`` templates
  item-model.js      Item creation, duplicate keys, display priority
  database.js        IndexedDB wrapper
  movie-api.js       OMDb search & detail fetch
  youtube-api.js     YouTube URL parsing
  item-manager.js    CRUD, filtering, import/export
  undo-manager.js    Undo stack
  version-check.js   Reload installed copies when a new version is deployed
  batch-upload.js    Batch upload tool (uses the shared modules above)
  ui.js              Rendering & event handling
  app.js             Initialization
```
