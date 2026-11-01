# Security

## Reporting an issue

Open a [private security advisory](https://github.com/paulc12s/watchlist/security/advisories/new) on this repository. Please don't use a public issue for anything exploitable.

## What the app trusts

The app is static pages on GitHub Pages. There is no server and no account, and all data stays in the browser (IndexedDB).

- **Code:** only this repository. No npm packages or CDN scripts. Each page's Content-Security-Policy allows scripts from `'self'` only.
- **Untrusted input:** OMDb and TMDB responses, and imported JSON files.
  - The parsers (`OMDb.parseDetails` / `OMDb.search` in `js/omdb.js`, and `TMDB.parse`) keep only strings and cap their length.
  - They require IMDb IDs to look like `tt1234567`, and keep a poster only if it's an http(s) URL.
  - Every stored, imported or added title goes through `Title.sanitize` (`js/title.js`).
  - Everything rendered goes through the `html` template tag, which escapes it.
  - Tests with hostile payloads are in `tests/`.

## Third parties, and how to patch each

| What | Where | Patch steps |
|---|---|---|
| GitHub Actions | `.github/workflows/pages.yml` | Pinned to commit SHAs, and the repository requires it (Settings → Actions → Require actions to be pinned to a full-length commit SHA), so an unpinned action fails the run. Dependabot alerts are on. Dependabot (`.github/dependabot.yml`) opens a weekly PR when one has a new version. Check the release notes, then merge. To patch by hand, resolve the new tag with `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`, then update the SHA and the `# vX.Y.Z` comment. |
| OMDb API | `js/omdb.js` (all requests and parsing, for every page); keys in `js/config.js` | Data only, treated as untrusted. If OMDb rejects the app's key or its quota runs out, `js/omdb.js` switches to the shared demo key (`trilogy`) for the rest of the visit. If the key is abused or revoked, replace `CONFIG.API.OMDB_KEY` and push. |
| TMDB API | `js/ratings/tmdb.js` | Each user's own key, stored on their device only. If TMDB changes its API, update `TMDB_CONFIG` in `js/ratings/config.js`. |
| Image hosts | `m.media-amazon.com`, `image.tmdb.org`, `i.ytimg.com` | Allowed only in each page's CSP `img-src`. Remove a host there if it becomes untrustworthy. |
| MovieLens data | `tools/build-*.js` → `data/*.json` | Build-time data. Rebuild with the tools and check the diff. |
| Node | CI tests and `tools/` | Built-in modules only, so nothing to patch beyond the runner image. |

## When you add an external request

1. Add its host to the CSP of every page that uses it: `connect-src` for fetches, `img-src` for images. Don't add hosts that only appear in plain links.
2. Parse its response defensively (see above) and add a test with a hostile payload.
3. Add it to the table above.

## Known limits

- **Framing:** a CSP in a `<meta>` tag can't set `frame-ancestors`, and GitHub Pages can't send headers. So the `frame-ancestors 'none'` in the pages has no effect, and they could be framed by another site. Every action needs your own clicks on your own data, so the risk is low.
- **OMDb key:** it ships to every visitor, so anyone can read it and use up its daily quota. If that happens, the app keeps working on the shared demo key, which is slower to respond and has its own limits.
