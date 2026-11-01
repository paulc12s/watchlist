# Watchlist

A client-side movie, TV, and YouTube watchlist with a swipe feed for reviewing films and shows. `app.html` combines both; the classic `watchlist.html` and `ratings.html` remain. All data stays in your browser via IndexedDB — no server, no account required.

## Features

- **Search & add** movies/TV shows via the OMDb API with automatic metadata (poster, rating, genre, plot)
- **YouTube videos** — paste a URL to add with auto-generated thumbnail
- **Manual entry** for anything not in the database
- **Priority levels** (watching now/high/medium/low) with grouped display
- **Compact view** — collapse cards to title, poster and one line of tags (remembered per device)
- **Tags & platforms** — organize by custom tags (family, airplane, art) and streaming platform (Netflix, etc.)
- **Quick filter** — substring search across titles, combinable with filter buttons
- **👍 / 👎 instead of a watched checkbox** — watched and rated are the same thing: a thumb marks a title watched, and tapping the thumb it shows puts it back on the list to watch. Watched titles with no thumb count as 👍 (or 👎 if you gave them 1–2★); the default isn't stored, so a real thumb from the ratings page still fills it in. The **Watched**, **👍 Liked** and **👎 Not for me** buttons list those titles instead of the queue (Liked and Not for me include titles still on your list that carry that thumb), each optionally narrowed by another filter. Cards in every list are shown at full strength
- **Reviews** — rate titles out of 5 stars, jot a few thoughts, and flag them as worth a rewatch; give a thumb up or down in the review or Edit dialog. Each title keeps the date you last reviewed it (thumb, stars, notes or rewatch), or the date you first marked it watched if you didn't review it
- **Rewatch filter** — find flagged titles in either the active or watched list
- **Inline editing** — click any badge (priority, tag, platform) to edit in place
- **Import/Export** — JSON backup and restore, in the same file format as the ratings page, so either page's export imports into the other (see below)
- **Undo** — revert deletes, edits, and thumbs
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
node --test tests/*.test.js
```

`tests/library.test.js` covers the shared record, merging, imports and exports; `tests/watchlist.test.js` and `tests/ratings.test.js` each page; `tests/project.test.js` checks every source file carries the copyright notice. `tests/fixtures/` holds a sample of every file format the apps have exported, written by that version's own code; the tests import each one into both pages and fail if any field is dropped or changed. If you rename a field, keep reading the old name in `Title.sanitize` (and `Title.suppliedFields`) and add it to `FIELD_NOW` in `tests/library.test.js`. If you change the export format, add a new fixture.

## Deploying

`.github/workflows/pages.yml` runs the tests, stamps the commit hash into the app (replacing `__APP_VERSION__`), and publishes to GitHub Pages on every push to `main`. Set **Settings → Pages → Source** to **GitHub Actions** once.

Installed copies (such as an iPhone home-screen icon) check `version.json` on launch and whenever they come back to the foreground, and reload when a newer version is deployed. Locally, or when served straight from the branch, the version is unstamped and the check is skipped.

## Usage

- **Add** — click `+ Add`, search for a title, select a result, set priority/tag/platform, and save
- **Search tips** — add a year to narrow (`dune 1984`), use the All / Movies / TV toggle, or paste an IMDb link or `tt…` ID to jump straight to a title. Exact title matches and recent releases rank first; top results show director and cast to tell same-named titles apart
- **Filter** — use the filter buttons (type, priority, tag, platform) and/or type in the quick search bar
- **Watched** — tap 👍 or 👎 on a card to mark it watched; click Watched, 👍 Liked or 👎 Not for me to list those titles (click it again to go back to the queue); click another filter to narrow any of them
- **Review** — click the pencil icon next to the thumbs to set stars, notes and the rewatch flag; tap the current star again to clear the rating. Tap the lit thumb on a watched title (say, one flagged for rewatch) to put it back in the queue. A title on your list can carry a review from the ratings page and stay on the list; it shows its thumb as a badge
- **Edit** — click a badge to edit inline, or click Edit for the full modal
- **Poster click** — opens a Google search for the title
- **Export/Import** — see *Moving titles between pages, browsers and devices* below. A failed import shows an error that stays until you dismiss it

## Watchlist & Review (`app.html`)

One page with both apps, switched with **Watchlist | Review** at the top. Both modes work on the same titles, so a thumb given in either shows in the other straight away. The page keeps its own database (`TitlesDB`) and starts empty: export from the classic pages and import here to bring titles over. Its export is the same file format as theirs. Light and dark themes follow the device.

- **Watchlist mode** — *To watch*, *Watched*, 👍 and 👎 lists with counts; filter chips (priority, type, rewatch, platform, tag); a search box that filters your titles. Tap 👍 / 👎 on a title once you've seen it (tap the lit one to put it back on the list), or tap the title for its sheet: verdict, on-the-list and rewatch toggles, stars, notes, priority, tag, platform, delete, web search. Undo appears after each change
- **Adding** — **+** opens a sheet: search OMDb (with year, type, or an IMDb link), add by hand, or add a YouTube video; then add it to watch, or as already seen with 👍 or 👎
- **Review mode** — the ratings swipe feed (below), started the first time you open it, so its lists only load when you use them
- **⚙ Settings** — export, import and the taste profile for both modes, plus review order, TMDB key and skipped titles; links to batch upload and the classic pages

## Moving titles between pages, browsers and devices

Both pages store titles in the same shape (`js/title.js`) through the same code (`js/library.js`), each in its own database, so they never change each other's data. Files carry titles between them, and between browsers or devices:

- **Export** (either page) saves every title on that page as `{ "app": "titles", "version": 2, "titles": [...] }`, named with the local date and time (`watchlist-2026-10-31-1432.json`, `ratings-…`). Either page imports it
- **Import** (either page) also reads every file earlier versions wrote: watchlist exports, ratings backups, *Export for Watchlist* and want-to-watch files, and batch uploads
- **Merging:** a title is matched by IMDb ID, YouTube ID, or its own ID for manual entries. Your review (thumb, stars, notes, rewatch) comes from whichever copy was reviewed more recently; everything else from whichever changed more recently. A copy with no dates (files from before dates were kept) never wins: it only fills in what's blank. Merging isn't an edit, so it doesn't make a title newer
- **Seen and rated are the same thing:** a title you've watched, or given stars or notes, has a thumb (from its stars, otherwise 👍). A title on your list to watch can carry a review and stays on the list
- **Deletes are local:** removing a title on one page leaves the other page's copy, and importing from it brings the title back
- **Each browser and address keeps its own data.** `localhost` and the published site, Safari and Chrome, and different devices don't share; export and import to move between them

## Ratings (`ratings.html`)

A separate swipe feed for rating films and TV shows and building a taste profile. It keeps its own copy of your titles (`RatingsDB`) and never changes the watchlist's; the two pages exchange files (see below).

- **Swipe right / left** — thumbs up / down. **Swipe up** — skip (not seen, or can't remember); skipped films don't come back unless you choose “Show skipped films again” in settings. **Swipe down** — back to the previous film. Arrow keys do the same on a computer
- **On the card** — stars (1–5 keys), 🔖 want to watch (W), 🔁 would rewatch (R), ✏️ notes (N). Stars, notes or rewatch mean you've seen it, so the film needs a thumb rather than a skip
- **TV** — add a free [TMDB](https://www.themoviedb.org/settings/api) key in settings (kept on that device only) to unlock live TV lists: most watched, top rated, trending, genres, networks and decades. Shows are rated like films and stored by IMDb ID, so they match the watchlist's TV items in both directions. TV ratings shape the taste profile but not recommendations, which use MovieLens films
- **Lists** — tap the list name to choose (most watched, love-it-or-hate-it, Oscar Best Picture nominees, decades, genres, hidden gems, a mix); ⏭ moves to the next list, and a finished list rolls on to the next automatically. Best-first or shuffled order is in settings
- **Tags & the crowd** — cards show MovieLens viewers' tags (“twist ending”, “atmospheric”). After you give a thumb, you see what share of MovieLens viewers liked the film; it's hidden until then so it can't sway you
- **📊 My taste** — genres, themes & style (tags), decades and directors you lean toward or away from; how often you agree with the crowd and where you don't; plus your liked / disliked / want / skipped films
- **⚙ Settings** — export and import (see below); copy a taste profile to paste into an AI assistant for recommendations

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
index.html           Landing page (+ index.css)
app.html             Watchlist & Review in one page (+ app.css, over ratings.css)
watchlist.html       Classic watchlist
batch-upload.html    Bulk title importer (+ batch-upload.css)
version.json         Deployed version, stamped by the Pages workflow
movie.png, movie2.png  Icon artwork: black and colour clapperboards (transparent, 512px)
icons/, icons/colour/  Site icons built from them by tools/build-icons.py (needs Pillow):
                     opaque white tiles, since iOS shows transparency as black.
                     Settings → App icon picks the set (js/icon-choice.js)
watchlist.css        Styles (light/dark, responsive)
js/
  Shared by every page:
  config.js          API keys, limits, each page's database
  security.js        Escaping, URL checks, html`` templates
  title.js           The one record shape: sanitizing (incl. old field names), merging
  store.js           IndexedDB key-value storage with batched saves
  library.js         A page's titles: every change, import and export goes through here
  omdb.js            OMDb requests (key fallback, cache) and parsing
  version-check.js   Reload installed copies when a new version is deployed
  Watchlist and batch upload:
  state.js           Page state (filters, lists, dialogs)
  movie-api.js       Search: query parsing and ranking
  youtube-api.js     YouTube URL parsing
  item-manager.js    Watchlist actions: add, rate, delete, lists, import/export status
  undo-manager.js    Undo stack
  ui.js              Rendering & event handling
  app.js             Initialization
  batch-upload.js    Batch upload tool
  ratings/           Ratings feed: config, store (feed rules over the Library), tmdb,
                     catalog, taste, feed, recommend, tvrecs, foryou, ui, app, and
                     boot (starts ratings.html; app.html starts the feed itself)
  app/               Combined page: watchlist-view (watchlist mode), main (modes)
ratings.html         Classic ratings swipe feed (+ ratings.css)
data/categories.json Film lists for the ratings page
data/similar.json    Similar-films data for recommendations
tools/               build-categories.js (MovieLens → lists), oscars.json,
                     build-similar.js + eval-similar.js (recommender data and tests)
```

## Licence

The code is released under the [MIT License](LICENSE), copyright (c) 2026 Paul Constantinides. Anyone may use, copy, modify and distribute it, commercially or not, as long as the copyright and licence notice stay with it.

Third-party data and services keep their own terms, which the MIT License doesn't cover:
- **MovieLens** data in `data/` (built from MovieLens 32M by GroupLens Research) is under GroupLens's licence, which allows non-commercial use only.
- **TMDB:** this product uses the TMDB API but is not endorsed or certified by TMDB.
- **OMDb:** film details and posters come from the OMDb API under its terms of use.
