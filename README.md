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
4. Open `http://localhost:8000/` (landing page) or `http://localhost:8000/watchlist.html`

## Tests

```
node --test tests/watchlist.test.js tests/ratings.test.js
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

## Ratings (`ratings.html`)

A separate swipe feed for rating films and TV shows and building a taste profile. It has its own storage (`RatingsDB`) and never changes the watchlist's data; the two exchange JSON files.

- **Swipe right / left** — thumbs up / down. **Swipe up** — skip (not seen, or can't remember); skipped films don't come back unless you choose “Show skipped films again” in settings. **Swipe down** — back to the previous film. Arrow keys do the same on a computer
- **On the card** — stars (1–5 keys), 🔖 want to watch (W), 🔁 would rewatch (R), ✏️ notes (N). Stars, notes or rewatch mean you've seen it, so the film needs a thumb rather than a skip
- **TV** — add a free [TMDB](https://www.themoviedb.org/settings/api) key in settings (kept on that device only) to unlock live TV lists: most watched, top rated, trending, genres, networks and decades. Shows are rated like films and stored by IMDb ID, so they match the watchlist's TV items in both directions. TV ratings shape the taste profile but not recommendations, which use MovieLens films
- **Lists** — tap the list name to choose (most watched, love-it-or-hate-it, Oscar Best Picture nominees, decades, genres, hidden gems, a mix); ⏭ moves to the next list, and a finished list rolls on to the next automatically. Best-first or shuffled order is in settings
- **Tags & the crowd** — cards show MovieLens viewers' tags (“twist ending”, “atmospheric”). After you give a thumb, you see what share of MovieLens viewers liked the film; it's hidden until then so it can't sway you
- **📊 My taste** — genres, themes & style (tags), decades and directors you lean toward or away from; how often you agree with the crowd and where you don't; plus your liked / disliked / want / skipped films
- **⚙ Settings** — export/import a backup; import a watchlist export (watched titles fill in stars and notes, and 4–5★ count as 👍, 1–2★ as 👎 unless you've given a thumb here; unwatched become “want to watch”). Imports always merge: nothing is removed and nothing already set is overwritten; export want-to-watch as a file the watchlist's Import accepts; copy a taste profile to paste into an AI assistant for recommendations

The lists in `data/categories.json` are built from [MovieLens 32M](https://grouplens.org/datasets/movielens/) (ratings up to October 2023; non-commercial licence) plus hand-curated Oscar nominees in `tools/oscars.json`. Each film carries its top MovieLens tags (cleaned: opinions, awards and genre repeats dropped, synonyms folded) and the share of its raters who gave 4+ stars. To rebuild, unzip `ml-32m.zip` and run `node tools/build-categories.js path/to/ml-32m`. Posters and details come from OMDb when a card is shown and are cached, so each film costs one request.

### Recommendations

- **✨ For you** — picks in lanes, each with a reason (“because you liked…”); tap one to rate it or mark it want-to-watch
  - **Films:** *Great* (close to your best-rated films, and well regarded) and *Fun* (your comfort zones, whatever the critics said), from `data/similar.json`: for about 5,000 of the most-rated MovieLens films, each film's 30 most similar films by how the same people rated both
  - **TV** (needs the TMDB key): the same two lanes, built live from TMDB's recommended shows for each show you've rated, plus *From your film taste*, which matches well-known shows to the themes you like in films until you've rated 15 shows
- **Guesses, revealed after you swipe** — the first time you judge a title, where the recommender ranked it for you is saved and shown afterwards (“We guessed a good match”), never before, so it can't sway you. *My taste → How our guesses do* compares titles it ranked in your top 20% with the rest
- **Learn fastest** order (settings) — deals widely seen films the recommender knows least about, so each swipe teaches it the most

Ratings count by strength: 👎 −2 · 👍 +1 · 4★ +1.5 · 5★ +2.5 · rewatch +1, and skipping a widely seen title counts slightly against. Likes the crowd panned count extra in the *Fun* lanes. Scoring lives in `js/ratings/recommend.js` (shared by films and TV), TV data in `js/ratings/tvrecs.js`, and the sheet, guesses and learn order in `js/ratings/foryou.js`.

```
node tools/build-similar.js path/to/ml-32m                           # rebuild data/similar.json (~1 min)
node tools/build-similar.js path/to/ml-32m --holdout holdout.json    # same, minus the 20% test split
node tools/eval-similar.js movielens path/to/ml-32m holdout.json     # accuracy vs the averages baseline
node tools/eval-similar.js personal ratings-export.json             # how well it finds your own favourites
```

## Files

```
index.html           Landing page linking the two apps (+ index.css)
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
  ratings/           Ratings page: config, db, store, tmdb, catalog, taste, feed,
                     recommend, tvrecs, foryou, ui, app
ratings.html         Ratings swipe feed (+ ratings.css)
data/categories.json Film lists for the ratings page
data/similar.json    Similar-films data for recommendations
tools/               build-categories.js (MovieLens → lists), oscars.json,
                     build-similar.js + eval-similar.js (recommender data and tests)
```
