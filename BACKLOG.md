# Backlog

Enhancements we've agreed are worth doing, roughly in priority order. Move an
item to **Done** (with the commit) when it ships.

## Up next

### 1. Review third-party tech and make vulnerabilities easy to patch
The app has no npm dependencies or CDN scripts. Everything outside the repo:

| What | Where | Notes |
|---|---|---|
| OMDb API | `js/movie-api.js`, `js/ratings/catalog.js` | Film details and posters; the key is in `js/config.js` |
| TMDB API | `js/ratings/tmdb.js` | TV on the ratings page; each user's own key, kept on their device |
| YouTube thumbnails | `i.ytimg.com` | Images only |
| Poster CDNs | `m.media-amazon.com`, `image.tmdb.org` | Images only |
| MovieLens 32M | `tools/build-*.js` → `data/*.json` | Build-time data, non-commercial licence |
| GitHub Actions | `.github/workflows/pages.yml` | `checkout`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`, pinned to major-version tags |
| Node (CI tests, build tools) | workflow + `tools/` | Built-in modules only |

To do:
- Pin the Actions to commit SHAs and add Dependabot for `github-actions`, so updates arrive as reviewable PRs.
- Check the CSP on each page against what the page really loads. Example: `watchlist.html` allows `connect-src https://www.google.com`, but the code seems to use Google only as a plain link. Not yet verified.
- Decide how the OMDb key in `js/config.js` is handled, given it ships to every visitor.
- Treat API responses as untrusted: keep sanitising every field before storing or rendering it, and add tests for hostile payloads.
- Write a short `SECURITY.md`: how to report an issue, and the patch steps for each item above.

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
- Review dates in both apps: `reviewDate`, carried both ways on import and export.
