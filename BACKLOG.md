# Backlog

Enhancements we've agreed are worth doing, roughly in priority order. Move an
item to **Done** (with the commit) when it ships.

## Up next

### 1. Third-party security: remaining decisions
The rest of this item shipped (see Done). Still open:
- GitHub settings: turn on Dependabot alerts, and optionally require SHA-pinned Actions.

### 2. Share the movie-database code between pages
`js/movie-api.js` (watchlist and batch upload) and `MovieInfo` in `js/ratings/catalog.js` each call OMDb and parse its results their own way. Merge them into one module covering:
- OMDb lookups
- TMDB lookups
- parsing
- caching
- sanitising

Both pages then load that module. Do the same for the date and ID helpers each page has its own copy of.

### 3. One page for both watchlist and ratings
A single page with a switch between the watchlist and the swipe-rating views. Both views read the same records, so nothing needs to be imported or exported between them. Needs:
- one data store
- a migration from today's two stores (watchlist IndexedDB key, `RatingsDB`)
- a combined record shape
- one CSP

Depends on item 2.

### 4. Top-picks list of strong matches you haven't rated
A list that shows only titles the recommender rates as a very strong match and you haven't rated yet. It should read like a run of standout suggestions, not a ranked dump.
- **Filter:** only titles above a high match bar (say the top 5% for you, with enough evidence behind the match), never just the top N. A short list beats a padded one.
- **Each row:** the title and why it was picked ("because you liked X, Y").
- **Actions:** from the list you can rate a title, add it to want to watch, or dismiss it.
- **Films and TV:** both.
- **Relation to today's For you sheet:** For you already shows the top 20 per lane. This is stricter, with a threshold instead of a count. It could replace For you or be a mode within it; decide when building.
- **Fits the single page (item 3):** it could feed the watchlist directly.

## Later
- Taste over time, now that reviews are dated (`reviewDate`).
- In the watchlist import, flag conflicting verdicts (an existing 👎 alongside imported 4★) instead of keeping both.
- Undo for imports.
- Stop manual entries without an IMDb or YouTube ID from duplicating on re-import.
- Check TMDB genre and network IDs and endpoint behaviour against the live API. They were written from memory.

## Done
- Watchlist: 👍 Liked / 👎 Not for me lists alongside Watched, cards readable in every list, status shows “saved” after loading.
- Watched = rated: 👍 / 👎 replace the watchlist's watched checkbox; watched titles without a thumb count as 👍 (inferred, written on export, applied by the ratings import).
- Watchlist imports the ratings backup (shared conversion in `js/exchange.js`); failed imports stay on screen (watchlist banner, ratings settings sheet); export file names carry local date and time.
- Third-party review: Actions pinned to SHAs with Dependabot updates; CSPs checked against what each page loads (dropped `google.com` from the watchlist; hardened batch upload); OMDb and TMDB responses parsed as untrusted, with hostile-payload tests; the app's own OMDb key with fallback to the demo key (`js/omdb.js`); `SECURITY.md`.
- Review dates in both apps: `reviewDate`, carried both ways on import and export.
