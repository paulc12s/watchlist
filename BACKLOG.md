# Backlog

Enhancements we've agreed are worth doing, roughly in priority order. Move an
item to **Done** (with the commit) when it ships.

## Up next

### 1. Third-party security: remaining decisions
The rest of this item shipped (see Done). Still open:
- GitHub settings: turn on Dependabot alerts, and optionally require SHA-pinned Actions.

### 2. Retire the classic pages
`app.html` does what `watchlist.html` and `ratings.html` do. Once you're happy with it:
- Point `watchlist.html` and `ratings.html` (and so existing home-screen icons) at `app.html`, after a last export from each.
- Remove their page-only code: `js/ui.js`, `js/app.js`, `watchlist.css`, `js/ratings/boot.js`, and the markup in both pages.
- Decide whether `app.html` should offer to copy the classic pages' data on first open (it starts empty today, by choice).

### 3. Top-picks list of strong matches you haven't rated
A list that shows only titles the recommender rates as a very strong match and you haven't rated yet. It should read like a run of standout suggestions, not a ranked dump.
- **Filter:** only titles above a high match bar (say the top 5% for you, with enough evidence behind the match), never just the top N. A short list beats a padded one.
- **Each row:** the title and why it was picked ("because you liked X, Y").
- **Actions:** from the list you can rate a title, add it to want to watch, or dismiss it.
- **Films and TV:** both.
- **Relation to today's For you sheet:** For you already shows the top 20 per lane. This is stricter, with a threshold instead of a count. It could replace For you or be a mode within it; decide when building.
- **Fits the combined page:** it could feed the watchlist directly.

### 4. Choose where a title's link opens
Tapping a poster on the watchlist runs a Google search for the title. Make the destination a setting:
- **Google** search (today's behaviour).
- **Apple TV app** search, so iPhone and iPad open the title in the TV app with its streaming options.
- **Google TV app** search on Android (Android's equivalent of the Apple TV app).

Notes:
- Default to the one that fits the device, and keep the choice per device, like the compact view.
- Check each app's link format on a real device before building: the URL schemes and universal links weren't verified. Fall back to the Google search if the app link doesn't open.
- If the link loads anything into the page (not just a plain navigation), it needs adding to the CSP.

## Later
- Taste over time, now that reviews are dated (`reviewDate`).
- In the watchlist import, flag conflicting verdicts (an existing 👎 alongside imported 4★) instead of keeping both.
- Undo for imports.
- Check TMDB genre and network IDs and endpoint behaviour against the live API. They were written from memory.

## Done
- Combined page `app.html`: watchlist mode (new design, light and dark) and review mode over one database, same export format as the classic pages.
- Shared data layer: one record shape (`js/title.js`), one library for every change, import and export (`js/library.js`), one storage module (`js/store.js`), one OMDb client and parser (`js/omdb.js`), one version check. Each page keeps its own database. Imports take the newer version of each title; deletes stay local. Manual entries no longer duplicate on re-import.
- MIT licence (`LICENSE`), copyright notice on every source file, with a test.
- Watchlist: 👍 Liked / 👎 Not for me lists alongside Watched, cards readable in every list, status shows “saved” after loading.
- Watched = rated: 👍 / 👎 replace the watchlist's watched checkbox; watched titles without a thumb count as 👍 (inferred, written on export, applied by the ratings import).
- Watchlist imports the ratings backup (shared conversion in `js/exchange.js`); failed imports stay on screen (watchlist banner, ratings settings sheet); export file names carry local date and time.
- Third-party review: Actions pinned to SHAs with Dependabot updates; CSPs checked against what each page loads (dropped `google.com` from the watchlist; hardened batch upload); OMDb and TMDB responses parsed as untrusted, with hostile-payload tests; the app's own OMDb key with fallback to the demo key (`js/omdb.js`); `SECURITY.md`.
- Review dates in both apps: `reviewDate`, carried both ways on import and export.
