# Movies (watchlist)

A client-side app for films, TV and YouTube videos: a watchlist of what to watch next, a record of what you've rated, and a swipe feed for reviewing lists of films and shows, with recommendations from your own ratings. Everything stays in your browser (IndexedDB): no server, no account. Export a file any time as a backup, or to move your titles to another browser or device.

The app is `app.html`. The addresses of the retired Watchlist and Ratings pages (`watchlist.html`, `ratings.html`) and the site's front page (`index.html`) forward to it, so old bookmarks and home-screen icons keep working.

## Setup

1. The OMDb key is set in `js/config.js` (`CONFIG.API.OMDB_KEY`, falling back to OMDb's demo key). Get your own free key from [OMDb](http://www.omdbapi.com/apikey.aspx) if you fork this
2. Serve the directory over HTTP:
   ```
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000/app.html`

## Tests

```
node --test tests/*.test.js
```

`tests/library.test.js` covers the shared record, merging, imports and exports, and bringing titles in from the retired pages; `tests/lists.test.js` the Watchlist and Rated lists; `tests/review.test.js` review mode, the recommender, search and award lists; `tests/store.test.js` storage safety; `tests/project.test.js` checks every source file carries the copyright notice, every page's assets exist, the forwarding pages, icons and themes. `tests/fixtures/` holds a sample of every file format the apps have exported, written by that version's own code; the tests import each one and fail if any field is dropped or changed. If you rename a field, keep reading the old name in `Title.sanitize` (and `Title.suppliedFields`) and add it to `FIELD_NOW` in `tests/library.test.js`. If you change the export format, add a new fixture.

## Deploying

`.github/workflows/pages.yml` runs the tests, stamps the commit hash into the app (replacing `__APP_VERSION__`), and publishes to GitHub Pages on every push to `main`. Set **Settings → Pages → Source** to **GitHub Actions** once.

Installed copies (such as an iPhone home-screen icon) check `version.json` on launch and whenever they come back to the foreground, and reload when a newer version is deployed. Locally, or when served straight from the branch, the version is unstamped and the check is skipped.

## The app (`app.html`)

Three modes, switched with **Watchlist | Rated | Review** at the top, all on the same titles, so a thumb given in one shows in the others straight away. Titles are kept in the app's database (`TitlesDB`).

- **Watchlist mode** — just what you want to watch, grouped by priority, with a search box and filter chips (priority, type, rewatch, platform, tag), each showing how many titles it covers. The search box also narrows the chips to those whose names match what you type (all of them stay if none match); tapping a chip found that way clears the text and applies the filter. **Recently added** shows the last 20 titles added to your list, newest first. Tap ❤️, 👍 or 👎 once you've watched a title and it moves to Rated
- **Rated mode** — every title you've rated, including ones still on your list to watch, as compact rows with your verdict as an icon (❤️, 👍 or 👎, plus stars if you gave 1–4). Narrow it to ❤️, 👍 or 👎, and sort it by recently rated, your rating, title, year or IMDb rating (remembered on the device); tap a row to change the rating. A title marked watched in an older file counts as 👍

  Each mode keeps its own search and filters, so switching doesn't lose your place
- **Tags and platforms** — a title has any number of tags and one platform. Each is stored in one spelling, on every add, edit and import (`Library.labelName`): "art", "ART" and "#art" are saved as the spelling already in use; a new one is saved as typed, without # or extra spaces. A type, platform or tag with the same name (YouTube) is a single chip
- **The tag field** (`js/app/tag-input.js`) — each tag is a chip you can remove; a new tag has a dashed outline until it's saved. Suggestions appear as you type, most used first, and the rest of the top match shows in grey. Enter, Tab or a comma takes the highlighted suggestion, and the right arrow finishes the word. Pasting "a, b, c" adds all three, exactly as written. Backspace in an empty field picks the last chip, then removes it. On a phone, while the field has focus, the sheet fits the space above the keyboard and shows only the title, the field, its suggestions and the button to save; Done goes back to the whole sheet. In files, `tags` is a list; imports and CSVs can also give comma-separated text, and a file's old single `tag` still reads
- **Run cleanup** (Settings → Maintenance) — tidies data saved before that rule: every tag and platform rewritten in one spelling (one with capitals wins, so "Art" over "art"), titles re-checked and repaired, duplicates merged, IDs made unique. Then it reads back what's saved on the device and checks it matches what you see, and reports storage use. Dates stay as they are, and nothing is deleted
- **Adding** — **+** in the top bar, in every mode, opens a sheet: search OMDb (with year, type, or an IMDb link), add by hand, or add a YouTube video; then add it to watch, or as already seen with 👍 or 👎
- **Theme** (Settings) — Basic (the default look), or Pastel, Metal, Pride, Desert or Aurora, which colour the whole app: a tinted background with a two-colour glow, tinted glass, borders and sheets, and selected tabs and chips filled with the theme's colours. Each has a light and a dark version. Kept per browser (`js/palette.js`). A theme sets a handful of `--p-*` values in `base.css`; every tint is mixed from those, and text is checked at 4.5:1 contrast or better on the tinted surfaces
- **Appearance** (Settings) — Auto (follow the device, including when it switches at sunset), Light or Dark, kept per browser. The browser's bar colour follows the page
- **⚙ Settings** — export, import, the taste profile for an AI assistant, theme, appearance, app icon, review order, TMDB key, maintenance, and (if the retired pages saved any titles in this browser) **Bring in titles from the old pages**, which merges them in by the usual import rules

## Review mode

A swipe feed for rating films and TV shows and building a taste profile, started the first time you open it, so its lists only load when you use them.

- **Swipe right / left** — thumbs up / down. **❤️** (or L) — loved it: 👍 with five stars, the strongest signal the recommender gets. **Swipe up** — skip: not seen, or can't remember. A skip isn't a rating: the title stays in its list to rate, and comes round again after the titles you haven't seen. **Pass** on the card (or X) — not interested: not seen and don't want to, which counts against similar titles. **Swipe down** — back to the previous film. Arrow keys do the same on a computer
- **On the card** — stars (1–5 keys), 🔖 want to watch (W), 🔁 would rewatch (R), ✏️ notes (N). Stars or rewatch mean you've seen it, so the film needs a thumb rather than a skip; notes don't, so you can note why you want to watch something
- **TV** — add a free [TMDB](https://www.themoviedb.org/settings/api) key in settings (kept on that device only) to unlock live TV lists: most watched, top rated, trending, genres, networks and decades. Shows are rated like films and stored by IMDb ID, so they match the watchlist's TV items. TV ratings shape the taste profile but not recommendations, which use MovieLens films
- **Lists** — tap the list name to choose (most watched, love-it-or-hate-it, award lists, decades, genres, hidden gems, a mix); the header and the list sheet show how many titles are left to rate, skipped ones included. ⏭ moves to the next list. When a pass through a list leaves only titles you skipped, you can go through them again or move on; a list with everything rated, passed on or on your list is marked ✓ *All rated*. Best-first, shuffled or learn-fastest order is in settings
- **Find a title** — the search at the top of *Choose a list* finds any film or show and deals its card next, to rate it straight away (Enter takes the top one). Suggestions appear as you type, forgiving a letter or two (“bagonia” → Bugonia), from your own titles, about 5,000 well-known films, and TMDB's trending and popular titles when the device has a TMDB key; OMDb's results follow once you pause, matching half-typed words (“bugo” → Bugonia). A year (“dune 1984”) or an IMDb link narrows it. The add sheet in Watchlist mode searches the same way
- **Award lists** — *Best Picture nominees*, *Oscar acting nominees*, *Oscar directing, writing & cinematography*, *International feature nominees*, *Documentary feature nominees*, *Animated feature nominees* and *Golden Globe & Emmy TV nominees* (drama, comedy and limited series), each covering the last 10 ceremonies, newest first, winners first; plus *Festival top prizes* (Cannes, Venice and Berlin winners, last 25 years) and the *Sight and Sound critics' poll* (the 2022 top 100, in poll order). Built by `node tools/build-awards.js` from Wikidata (CC0), Wikipedia's nominee tables and the BFI's poll page into `data/awards.json` (38 KB, about 13 KB compressed), which is fetched only when one of them is opened. The build makes no OMDb requests. The TV list deals shows by IMDb ID, so it works without a TMDB key. Re-run the build after each awards season
- **Tags & the crowd** — cards show MovieLens viewers' tags (“twist ending”, “atmospheric”). After you give a thumb, you see what share of MovieLens viewers liked the film; it's hidden until then so it can't sway you
- **📊 My taste** — genres, themes & style (tags), decades and directors you lean toward or away from; how often you agree with the crowd and where you don't; plus your liked / disliked / want / skipped films

The lists in `data/categories.json` are built from [MovieLens 32M](https://grouplens.org/datasets/movielens/) (ratings up to October 2023; non-commercial licence) plus hand-curated Best Picture nominees in `tools/oscars.json` (which the award build folds into *Best Picture nominees*). Each film carries its top MovieLens tags (cleaned: opinions, awards and genre repeats dropped, synonyms folded) and the share of its raters who gave 4+ stars. To rebuild, unzip `ml-32m.zip` and run `node tools/build-categories.js path/to/ml-32m`. Posters and details come from OMDb when a card is shown and are cached, so each film costs one request.

### Recommendations

- **✨ For you** — picks in lanes, each with a reason (“because you liked…”); tap one to rate it or mark it want-to-watch
  - **Top picks** first: only titles in your top 1% that sit close to at least three titles you liked. Often a handful, sometimes none; never padded. Each row has **Want** and **Not interested** buttons
  - **Films:** *Great* (close to your best-rated films, and well regarded) and *Fun* (your comfort zones, whatever the critics said), from `data/similar.json`: for about 5,000 of the most-rated MovieLens films, each film's 30 most similar films by how the same people rated both
  - **TV** (needs the TMDB key): the same two lanes, built live from TMDB's recommended shows for each show you've rated, plus *From your film taste*, which matches well-known shows to the themes you like in films until you've rated 15 shows
- **Guesses, revealed after you swipe** — the first time you judge a title, where the recommender ranked it for you is saved and shown afterwards, never before, so it can't sway you: *a strong pick for you* (would be a Top pick), *a likely match* (top 1%) or *not one of our picks*. Below the top 1% the ranking barely separated films you'd seen from the rest, so nothing there is called a match. *My taste → How our guesses do* compares the top 1% with the rest
- **Learn fastest** order (settings) — deals widely seen films the recommender knows least about, so each swipe teaches it the most

Ratings count by strength: 👎 −2 · 👍 +1 · 4★ +1.5 · 5★ or ❤️ +2.5 · rewatch +1 · not interested −1 · on your list to watch +0.5. Skips count for nothing (they mean “not seen”; counting them against ranked your own likes lower). Likes the crowd panned count extra in the *Fun* lanes.

**Measuring it on your own ratings:** `node tools/eval-similar.js personal your-export.json` takes any export, hides each title you were dealt in turn, and reports where your likes and loved titles rank, how often strong picks turned out to be films you'd seen, how the saved guesses held up, and which rated films are missing from the film data. Your file stays on your computer (exports are git-ignored). Scoring lives in `js/review/recommend.js` (shared by films and TV), TV data in `js/review/tvrecs.js`, and the sheet, guesses and learn order in `js/review/foryou.js`.

```
node tools/build-similar.js path/to/ml-32m                           # rebuild data/similar.json (~1 min)
node tools/build-similar.js path/to/ml-32m --holdout holdout.json    # same, minus the 20% test split
node tools/eval-similar.js movielens path/to/ml-32m holdout.json     # accuracy vs the averages baseline
node tools/eval-similar.js personal ratings-export.json             # how well it finds your own favourites
```

## Backups and moving titles

All titles are stored in one shape (`js/title.js`) through one code path (`js/library.js`). Files carry them between browsers and devices:

- **Export** saves every title as `{ "app": "titles", "version": 2, "titles": [...] }`, named with the local date and time (`titles-2026-10-31-1432.json`)
- **Settings travel with it** while **Include settings** (beside Export and Import) is ticked, the default; untick it to export titles only and to import titles without a file's settings. Export adds `"settings"`: theme, appearance, app icon, the Watched and Rated sort orders, review order, the list review mode opens on, and the **TMDB key** (so the file holds a credential: keep it private). Import applies them, checking each on its own: a missing, malformed or unknown setting is skipped and the rest still apply, and a file without a TMDB key never removes this device's key. A file of settings and no titles imports too (`js/app/settings.js`)
- **Import** also reads every file earlier versions wrote: the retired pages' watchlist exports and ratings backups, *Export for Watchlist* and want-to-watch files, and batch uploads
- **Merging:** a title is matched by IMDb ID, YouTube ID, or its own ID for manual entries. Your review (thumb, stars, notes, rewatch) comes from whichever copy was reviewed more recently; everything else from whichever changed more recently. A copy with no dates (files from before dates were kept) never wins: it only fills in what's blank. Merging isn't an edit, so it doesn't make a title newer. A file never removes a title
- **Seen and rated are the same thing:** a title you've watched, or given stars or notes, has a thumb (from its stars, otherwise 👍). A title on your list to watch can carry a review and stays on the list
- **Each browser and address keeps its own data.** `localhost` and the published site, Safari and Chrome, and different devices don't share; export and import to move between them
- **Batch upload** (`batch-upload.html`) looks up a list of titles and writes a file to import
- **From the command line**, `tools/make-import.js` turns a plain list or a CSV into a file to import, either titles to watch or titles you've seen with ratings. IMDb's and Letterboxd's CSV exports work as they are. Each title is looked up on OMDb (cached in `tools/.cache/`, so running again costs no requests; set `OMDB_KEY` to use your own key) and goes through the app's own checks, so the file imports like an export. Ratings can be 👍/👎/❤️, words (up, down, love), *not interested* (or `0`, as Netflix writes it), 1–5 stars (`4`, `4/5`, `★★★★`) or out of ten (`8/10`); only a full top score is five stars (❤️). It ends with a summary: how many titles were converted and matched, and which were ambiguous, not found, left out or failed. A name without a year that several known titles share ("The Office", "Crash") keeps the best-known match, and one whose closest match has another name or is obscure is listed as unsure; with `-i` it shows the top three (year, director, cast, plot, IMDb votes) and asks, and does the same with the closest search results for a title not found. Shops' edition words come off titles first ("Gladiator: Extended Edition", ": Season 1"); a name written twice (Scarface and its remake) takes the next title of that name. Answers are remembered (`--ask-again` forgets them). With `--tmdb-key KEY` (or `TMDB_KEY`) titles are looked up on TMDB instead: its search results carry vote counts, so a title costs about 2 requests rather than OMDb's 2–5, with no daily limit; OMDb is asked only about titles TMDB has no clear match for (IMDb's search finds "Seven", which TMDB calls "Se7en"). Names match however they're written: "The" or not ("Hunger Games"), number words and numerals ("Two Guns" is "2 Guns", "Hangover 2" is "The Hangover Part II"), punctuation ("WALL-E"), capitals for words as an unsure match ("MI Ghost Protocol") — but the name exactly as written wins when a known title has it ("Nine" isn't "9", "Heat" isn't "The Heat"). An OMDb run stops after 100 requests (a free key allows about 1,000 a day, and the app on your phone shares the app's key), writes the titles done so far and says how to carry on: the same command again picks up from the cache; `--no-limit` goes on until OMDb's quota runs out, which also ends the run cleanly; `OMDB_KEY` uses only your own key. `tests/make-import-cli.test.js` runs the command end to end against a fake OMDb and TMDB (`tests/fixtures/fake-services.js`), so its limits, stops and file format are tested without any requests. The options and formats are at the top of the script

  ```
  node tools/make-import.js watchlist to-watch.txt               # Dune 2021 / Severance (TV) / tt0111161
  node tools/make-import.js reviewed ratings.csv -o seen.json    # Title,Year,Rating[,Date,Notes,...]
  node tools/make-import.js reviewed imdb-ratings.csv            # IMDb or Letterboxd export
  node tools/make-import.js reviewed ratings.csv -i              # choose between same-named titles
  node tools/make-import.js reviewed ratings.csv --tmdb-key KEY  # look up on TMDB: fewer requests, no daily limit
  node tools/make-import.js reviewed list.txt --no-lookup        # "Arrival, 👍" — no OMDb requests
  ```

### Keeping your data safe

- **If your saved titles can't be loaded**, the page carries on empty but saves nothing for the rest of the visit, so the stored titles can't be overwritten. A red banner says so; reload to try again
- **If a save fails**, it's kept and retried (after 2, 5, 15, 30 seconds, then every minute) on a fresh connection to the database, and a red banner stays until a save works. Export a backup if it doesn't go away
- **One tab saves at a time.** Each save writes the whole list, so two tabs of the same page would undo each other's changes. The tab opened last saves; older tabs stop saving and show a banner with a Reload button

## Files

```
app.html             The app (+ app.css, over base.css: the design system and review mode)
index.html, watchlist.html, ratings.html
                     Forward to app.html (the front page, and the retired pages' addresses)
batch-upload.html    Bulk title lookup, writing a file to import (+ batch-upload.css)
version.json         Deployed version, stamped by the Pages workflow
movie.png, movie2.png  Icon artwork: black and colour clapperboards (transparent, 512px)
icons/, icons/colour/  Site icons built from them by tools/build-icons.py (needs Pillow):
                     opaque white tiles, since iOS shows transparency as black.
                     Settings → App icon picks the set (js/icon-choice.js)
js/
  config.js          API keys, limits, the app's database (and the retired pages')
  security.js        Escaping, URL checks, html`` templates
  title.js           The one record shape: sanitizing (incl. old field names), merging
  store.js           IndexedDB key-value storage: batched saves, retries, one saving tab
  save-banner.js     The banner that stays while changes can't be saved
  palette.js         Theme and appearance, applied in <head> before the page draws
  icon-choice.js     App icon choice
  library.js         The titles: every change, import, export and tag spelling goes through here
  omdb.js            OMDb requests (key fallback, cache) and parsing
  movie-api.js       Search: query parsing, OMDb prefix matching, ranking
  youtube-api.js     YouTube URL parsing
  version-check.js   Reload installed copies when a new version is deployed
  state.js           What each list view shows; the undo stack
  item-manager.js    Watchlist and Rated: lists, sorting, chips, thumbs, undo
  undo-manager.js    Undo stack
  batch-upload.js    Batch upload tool
  dom.js             icon(), setChecked() and checked(), used by every mode
  app/               main (modes, settings), settings (settings in export and import), tag-input (the tag field),
                     list-view (Watchlist and Rated lists),
                     sheets (add and title sheets), old-pages (bring in
                     the retired pages' titles)
  review/            Review mode: config, store (rating rules over the Library), tmdb,
                     catalog, taste, feed, recommend, tvrecs, foryou, title-search
                     (both searches), ui, app
data/categories.json Film lists for review mode
data/similar.json    Similar-films data for recommendations
data/awards.json     Award lists, fetched the first time one is opened
tools/               build-categories.js (MovieLens → lists), oscars.json,
                     build-similar.js + eval-similar.js (recommender data and tests),
                     build-awards.js (award lists), build-icons.py,
                     make-import.js (a list or CSV → a file to import)
```

## Licence

The code is released under the [MIT License](LICENSE), copyright (c) 2026 Paul Constantinides. Anyone may use, copy, modify and distribute it, commercially or not, as long as the copyright and licence notice stay with it.

Third-party data and services keep their own terms, which the MIT License doesn't cover:
- **MovieLens** data in `data/` (built from MovieLens 32M by GroupLens Research) is under GroupLens's licence, which allows non-commercial use only.
- **TMDB:** this product uses the TMDB API but is not endorsed or certified by TMDB.
- **OMDb:** film details and posters come from the OMDb API under its terms of use.
- **App icons** (`movie.png`, `movie2.png` and the `icons/` built from them): [Movie icons created by monkik - Flaticon](https://www.flaticon.com/free-icons/movie), used under Flaticon's free licence, which requires this attribution. It's shown in the app's credits (Settings).
