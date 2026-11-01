# Backlog

Enhancements we've agreed are worth doing, roughly in priority order. Move an
item to **Done** (with the commit) when it ships.

## Up next

### 1. Retire the classic pages
`app.html` does what `watchlist.html` and `ratings.html` do. Once you're happy with it:
- Point `watchlist.html` and `ratings.html` (and so existing home-screen icons) at `app.html`, after a last export from each.
- Remove their page-only code: `js/ui.js`, `js/app.js`, `watchlist.css`, `js/ratings/boot.js`, and the markup in both pages.
- Decide whether `app.html` should offer to copy the classic pages' data on first open (it starts empty today, by choice).

### 2. Choose where a title's link opens
Tapping a poster on the watchlist runs a Google search for the title. Make the destination a setting:
- **Google** search (today's behaviour).
- **Apple TV app** search, so iPhone and iPad open the title in the TV app with its streaming options.
- **Google TV app** search on Android (Android's equivalent of the Apple TV app).

Notes:
- Default to the one that fits the device, and keep the choice per device, like the compact view.
- Check each app's link format on a real device before building: the URL schemes and universal links weren't verified. Fall back to the Google search if the app link doesn't open.
- If the link loads anything into the page (not just a plain navigation), it needs adding to the CSP.

### 3. Recommend recent films and fix gaps in the film data
20 of 189 films rated in the 2026-11-01 test export aren't in `data/similar.json`, so they can neither be picked nor explain a pick: 10 from 2023 on (MovieLens 32M ends in 2023), 9 without a year, and *The Empire Strikes Back*, which looks like a build bug (needs the MovieLens files to diagnose).
- Link recent films into the graph at build time, from TMDB's similar-film lists or plot-text similarity, so the phone needs no extra key or file.
- Check TMDB's terms on publishing cached data first.
- Measure with `tools/eval-similar.js personal` before and after.

### 4. Consider an iOS app around `app.html`
A native app hosting this page in a web view, with native helpers. Decide after the recommendation prototypes show what's worth it. Compute isn't the bottleneck: scoring runs in milliseconds in Safari.
- **What it would add:**
  - iCloud sync and backup in place of manual export and import.
  - Storage Safari can't evict.
  - Background refresh of new releases and TV data.
  - On-device language model (Apple's Foundation Models framework, iOS 26; unverified) to read notes, explain picks and judge new releases from their plots.
  - On-device text embeddings to place films missing from MovieLens.
- **Costs:**
  - Apple Developer Program ($99/year); without it, a self-installed build expires after 7 days.
  - Swift code and App Store review to maintain.
  - Keep the scoring in the shared JavaScript so there's one code path, not a Swift copy.
- **Licences:** MovieLens data is non-commercial; check TMDB's terms before distributing.
- **Go if:** iCloud sync and background updates matter more than the recommendation gain. A web version gets most of the gain from text embeddings.

## Later
- CSS: a z-index scale as tokens.
- Taste over time, now that reviews are dated (`reviewDate`).
- In the watchlist import, flag conflicting verdicts (an existing 👎 alongside imported 4★) instead of keeping both.
- Undo for imports.
- Check TMDB genre and network IDs and endpoint behaviour against the live API. They were written from memory.

## Done
- Settings → Appearance: Auto, Light or Dark (data-scheme on <html>, set before the page draws); the browser bar colour follows the page. Themes checked readable in every combination.
- Search: suggestions as you type with typos forgiven (your titles, bundled films, TMDB's recent and popular titles), OMDb prefix matching ("bugo*"), "Did you mean", Enter picks; in review and the add sheet. Themes: Basic (was Classic) plus five that colour the whole app. App icon attribution (monkik, Flaticon).
- Review: search in Choose a list to rate any one film or show straight away (your titles first, then OMDb).
- Tags and platforms stored in one spelling on every add, edit and import; Settings → Run cleanup tidies older data and checks that what's saved matches what's shown. One chip per name (YouTube once), counts on every chip.
- Colour themes (Classic, Pastel, Metal, Pride, Desert, Aurora) in Settings. CSS: palette tokens with tints mixed from the accent, `color-scheme` set for native controls, small grey text raised to 4.5:1 contrast, verdict and star colours as tokens, reduced motion covering every animation.
- Watchlist streamlined to To watch only; Watched became Rated → Not rated (watched with only the default 👍, rated in one tap). Rated as a third top-level mode beside Watchlist and Review (compact rows, verdict icon, ❤️/👍/👎 filter, sorting, its own search and filters), replacing the separate ❤️/👍/👎 tabs. Review: finished lists marked with a ✓ and their skips revisitable per list; review layout built as a flex column so the buttons stay on screen.
- Storage safety: a failed load saves nothing for the visit; failed saves retry on a fresh connection with a banner until they work; only the newest tab of a page saves. Fixed: unreadable toasts in light mode, and picking a finished review list now says so instead of jumping to another list.
- Recommendation quality, measured on a real export with `tools/eval-similar.js personal`: skips no longer count against (loved films' median rank 15 → 9), watchlist titles count as a mild like, Top picks in For you (top 1% with three close liked titles: 61% seen against 34% overall), guess labels only call the top 1% a match, and a **Not interested** verdict (`pass`) in review mode and Top picks.
- ❤️ = 👍 with five stars, on watchlist rows, a Loved list, the title sheet and the review feed.
- GitHub settings: Dependabot alerts on; Actions must be pinned to full commit SHAs.
- Combined page `app.html`: watchlist mode (new design, light and dark) and review mode over one database, same export format as the classic pages.
- Shared data layer: one record shape (`js/title.js`), one library for every change, import and export (`js/library.js`), one storage module (`js/store.js`), one OMDb client and parser (`js/omdb.js`), one version check. Each page keeps its own database. Imports take the newer version of each title; deletes stay local. Manual entries no longer duplicate on re-import.
- MIT licence (`LICENSE`), copyright notice on every source file, with a test.
- Watchlist: 👍 Liked / 👎 Not for me lists alongside Watched, cards readable in every list, status shows “saved” after loading.
- Watched = rated: 👍 / 👎 replace the watchlist's watched checkbox; watched titles without a thumb count as 👍 (inferred, written on export, applied by the ratings import).
- Watchlist imports the ratings backup (shared conversion in `js/exchange.js`); failed imports stay on screen (watchlist banner, ratings settings sheet); export file names carry local date and time.
- Third-party review: Actions pinned to SHAs with Dependabot updates; CSPs checked against what each page loads (dropped `google.com` from the watchlist; hardened batch upload); OMDb and TMDB responses parsed as untrusted, with hostile-payload tests; the app's own OMDb key with fallback to the demo key (`js/omdb.js`); `SECURITY.md`.
- Review dates in both apps: `reviewDate`, carried both ways on import and export.
