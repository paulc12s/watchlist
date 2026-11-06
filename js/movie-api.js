// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Movie search for the watchlist and batch upload
// Turns what you type into OMDb queries and ranks the results; the requests
// and parsing are in js/omdb.js.
// ============================================================================

const MovieAPI = {
  // Full details for titles already looked up, so results can show them at once
  detailsCache: new Map(),

  // Splits a query into the parts OMDb can filter on:
  //   "tt31450459" or an IMDb URL -> direct lookup
  //   "dune 1984" / "dune (1984)" -> title "dune", year 1984
  parseQuery(rawQuery) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');

    const imdbMatch = query.match(/\btt\d{7,10}\b/);
    if (imdbMatch) {
      return { imdbID: imdbMatch[0] };
    }

    // Cap the year so titles like "Blade Runner 2049" aren't treated as a year filter
    const maxYear = new Date().getFullYear() + 3;
    const yearMatch = query.match(/^(.+?)[\s(]+((?:19|20)\d{2})\)?$/);
    if (yearMatch && parseInt(yearMatch[2], 10) <= maxYear) {
      return { title: yearMatch[1], year: yearMatch[2], fullQuery: query };
    }

    return { title: query };
  },

  async search(rawQuery, type = '') {
    const parsed = this.parseQuery(rawQuery);

    if (parsed.imdbID) {
      const details = await this.getDetails(parsed.imdbID);
      return { results: details ? [details] : [], tooMany: false };
    }

    const { title, year, fullQuery } = parsed;
    if (title.length < 2) {
      return { results: [], tooMany: false };
    }

    // OMDb's exact-title lookup finds titles its fuzzy search buries many pages deep
    const exactLookups = [this.lookupTitle(title, year, type)];
    const pageLookups = [this.searchPage(title, year, type, 1)];
    // OMDb matches whole words only; a trailing * matches the start of the
    // last one, so a half-typed title finds something ("bugo*" -> Bugonia)
    const lastWord = title.trim().split(' ').pop();
    if (lastWord.length >= CONFIG.SEARCH.WILDCARD_MIN) pageLookups.push(this.searchPage(`${title.trim()}*`, year, type, 1));

    if (fullQuery) {
      // The trailing number may belong to the title ("Death Race 2000"), so also search it literally
      exactLookups.push(this.lookupTitle(fullQuery, '', type));
      pageLookups.push(this.searchPage(fullQuery, '', type, 1));
    } else {
      // New releases sort behind decades of older matches; ask for this year's directly
      pageLookups.push(this.searchPage(title, String(new Date().getFullYear()), type, 1));
    }

    const [exact, pages] = await Promise.all([
      Promise.all(exactLookups),
      Promise.all(pageLookups)
    ]);

    // Broad queries: pull a few more pages so ranking has more to choose from
    const pageCount = Math.min(CONFIG.SEARCH.MAX_PAGES, Math.ceil(pages[0].total / 10));
    const extraPages = [];
    for (let page = 2; page <= pageCount; page++) {
      extraPages.push(this.searchPage(title, year, type, page));
    }
    pages.push(...await Promise.all(extraPages));

    const candidates = [...exact.filter(Boolean), ...pages.flatMap(p => p.items)];

    return {
      results: this.rank(candidates, parsed).slice(0, CONFIG.SEARCH.MAX_RESULTS),
      tooMany: pages[0].tooMany
    };
  },

  searchPage(query, year, type, page) {
    return OMDb.search({ s: query, y: year, type, page: String(page) });
  },

  async lookupTitle(title, year, type) {
    const details = await OMDb.details({ t: title, y: year, type });
    if (details) this.detailsCache.set(details.imdbID, details);
    return details;
  },

  // Order: how closely the title matches, then the requested year, then recent
  // releases, then OMDb's own order (which roughly tracks popularity)
  rank(candidates, { title, year }) {
    const query = this.normalizeTitle(title);
    const recentYear = new Date().getFullYear() - 1;

    const unique = new Map();
    candidates.forEach((item, order) => {
      if (!unique.has(item.imdbID)) {
        unique.set(item.imdbID, { item, order });
      }
    });

    return [...unique.values()]
      .map(({ item, order }) => {
        const startYear = parseInt(item.year, 10) || 0;
        return {
          item,
          order,
          score: this.matchScore(this.normalizeTitle(item.title), query),
          yearMatch: year && startYear === parseInt(year, 10) ? 1 : 0,
          recent: startYear >= recentYear ? 1 : 0
        };
      })
      .sort((a, b) =>
        b.score - a.score ||
        b.yearMatch - a.yearMatch ||
        b.recent - a.recent ||
        a.order - b.order)
      .map(entry => entry.item);
  },

  matchScore(title, query) {
    const stripArticle = s => s.replace(/^(the|a|an) /, '');

    if (title === query || stripArticle(title) === stripArticle(query)) return 3;
    if (title.startsWith(query) || stripArticle(title).startsWith(stripArticle(query))) return 2;

    const titleWords = title.split(' ');
    if (query.split(' ').every(word => titleWords.includes(word))) return 1;

    return 0;
  },

  // Whether two records are the same film: the same name, or (a translated
  // name, say) the same year. OMDb's record for an IMDb ID can be out of date
  // and describe another film entirely, which fails both
  sameTitle(a, b) {
    const year = t => parseInt(t.year, 10) || null;
    return this.normalizeTitle(a.title || '') === this.normalizeTitle(b.title || '') ||
      (year(a) !== null && year(a) === year(b));
  },

  normalizeTitle(title) {
    return title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  },

  async getDetails(imdbID) {
    if (!imdbID) {
      throw new Error('Invalid IMDB ID');
    }
    if (!this.detailsCache.has(imdbID)) {
      const details = await OMDb.details({ i: imdbID });
      if (!details) return null;
      this.detailsCache.set(imdbID, details);
    }
    return this.detailsCache.get(imdbID);
  }
};
