// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Wikipedia and Wikidata: posters and titles OMDb is missing, with no key
//
// Wikidata records each film's IMDb ID, year and Wikipedia page, and the page
// has the poster. So an IMDb ID or a name leads to a film and its picture, and
// this is what covers OMDb's gaps: titles it lacks, records it has out of date
// and posters it no longer has.
//
// Wikipedia's posters are non-free images it holds under fair use, which its
// image lookup leaves out unless asked (pilicense=any).
//
// Responses are untrusted: IDs are checked, text is capped, and an image is
// kept only if it's on Wikimedia's image host.
// ============================================================================

const Wikipedia = {
  TIMEOUT_MS: 8000,
  WIKIDATA: 'https://www.wikidata.org/w/api.php',
  ENGLISH: 'https://en.wikipedia.org/w/api.php',
  POSTER_WIDTH: 500,
  SEARCH_LIMIT: 10,
  // What a Wikidata description says of a film or show ("2026 film by Hans Petter Moland")
  SCREEN_WORK: /\b(film|movie|television|tv|series|miniseries|documentary)\b/i,
  SHOW: /\b(television|tv|series|miniseries)\b/i,

  async request(base, params) {
    const url = new URL(base);
    for (const [name, value] of Object.entries({ ...params, format: 'json', origin: '*' })) url.searchParams.set(name, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Wikipedia error ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  },

  // The film or show with this IMDb ID, or null: { wiki, imdbID, title, year,
  // type, director, poster, plot }
  async byImdb(imdbID) {
    const found = await this.request(this.WIKIDATA, { action: 'query', list: 'search', srsearch: `haswbstatement:P345=${imdbID}` });
    const hit = found && found.query && Array.isArray(found.query.search) ? found.query.search[0] : null;
    if (!hit) return null;
    const [title] = await this.records([hit.title]);
    return title && title.imdbID === imdbID ? title : null;
  },

  // Films and shows by name, best match first, as above
  async search(text) {
    const found = await this.request(this.WIKIDATA, {
      action: 'wbsearchentities', search: text, language: 'en', type: 'item', limit: String(this.SEARCH_LIMIT)
    });
    const hits = found && Array.isArray(found.search) ? found.search : [];
    const ids = hits.filter(hit => hit && typeof hit.description === 'string' && this.SCREEN_WORK.test(hit.description)).map(hit => hit.id);
    return ids.length ? this.records(ids) : [];
  },

  // Wikidata items to records, in the order given, leaving out any without an IMDb ID
  async records(ids) {
    const valid = ids.filter(id => /^Q\d+$/.test(id));
    if (!valid.length) return [];
    const data = await this.request(this.WIKIDATA, {
      action: 'wbgetentities', ids: valid.join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'en', sitefilter: 'enwiki'
    });
    const entities = data && data.entities ? data.entities : {};
    const parsed = valid.map(id => this.parseEntity(entities[id], id)).filter(Boolean);
    const pages = await this.pages(parsed.map(record => record.page).filter(Boolean));
    return parsed.map(({ page, ...record }) => ({ ...record, ...(pages.get(page) || {}) }));
  },

  parseEntity(entity, id) {
    if (!entity) return null;
    const value = property => {
      const claims = entity.claims && entity.claims[property];
      const snak = Array.isArray(claims) && claims[0] && claims[0].mainsnak;
      return snak && snak.datavalue ? snak.datavalue.value : null;
    };
    const english = field => {
      const text = entity[field] && entity[field].en && entity[field].en.value;
      return typeof text === 'string' ? text : '';
    };
    const imdbID = value('P345');
    const title = english('labels').substring(0, 500);
    if (typeof imdbID !== 'string' || !/^tt\d{7,10}$/.test(imdbID) || !title) return null;
    const date = value('P577');
    const year = date && typeof date.time === 'string' ? parseInt(date.time.slice(1, 5), 10) : NaN;
    const description = english('descriptions');
    const by = description.match(/\bby (.+)$/);
    const page = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
    return {
      wiki: id, imdbID, title,
      year: Number.isInteger(year) ? year : null,
      type: this.SHOW.test(description) ? 'series' : 'movie',
      director: by ? by[1].substring(0, 200) : '',
      poster: '', plot: '',
      page: typeof page === 'string' ? page : ''
    };
  },

  // Wikipedia page title -> { poster, plot }
  async pages(titles) {
    const result = new Map();
    if (!titles.length) return result;
    const data = await this.request(this.ENGLISH, {
      action: 'query', prop: 'pageimages|extracts', piprop: 'thumbnail', pilicense: 'any',
      pithumbsize: String(this.POSTER_WIDTH), pilimit: 'max', exintro: '1', explaintext: '1', exsentences: '2', exlimit: 'max',
      titles: titles.join('|')
    });
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    for (const page of pages) {
      if (!page || typeof page.title !== 'string') continue;
      result.set(page.title, {
        poster: this.imageUrl(page.thumbnail && page.thumbnail.source),
        plot: typeof page.extract === 'string' ? page.extract.substring(0, 1000) : ''
      });
    }
    return result;
  },

  // An image on Wikimedia's host, without the tracking on the end; otherwise ''
  imageUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\/upload\.wikimedia\.org\/[^\s"'<>]+$/.test(value)) return '';
    return value.split('?')[0];
  }
};
