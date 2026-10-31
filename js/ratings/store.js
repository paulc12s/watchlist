// ============================================================================
// Ratings store
// One entry per film, keyed by IMDb ID (the same key the watchlist uses for
// duplicates). Entries carry a snapshot of the film's details so exports and
// the taste profile work without going back to OMDb.
//
// verdict: 'up' | 'down' | 'skip' | ''  ('' = not judged yet, e.g. imported)
// want:    not seen, would like to; excluded from the feed like a verdict
// ============================================================================

const Ratings = {
  entries: new Map(),
  // Called after every change; app.js points it at the database
  onChange() {},

  get(imdbID) {
    return this.entries.get(imdbID);
  },

  all() {
    return [...this.entries.values()];
  },

  // A film that's been dealt with doesn't come back in the feed
  isDone(imdbID) {
    const entry = this.entries.get(imdbID);
    return Boolean(entry && (entry.verdict || entry.want));
  },

  // Stars, notes or a rewatch flag mean you've seen it, so skipping isn't an option
  hasOpinion(imdbID) {
    const entry = this.entries.get(imdbID);
    return Boolean(entry && (entry.stars || entry.review || entry.rewatch));
  },

  sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const imdbID = String(raw.imdbID || '');
    const title = String(raw.title || '').trim();
    if (!/^tt\d{7,10}$/.test(imdbID) || !title) return null;
    const year = Number(raw.year);
    const date = value => (typeof value === 'string' && !isNaN(Date.parse(value)) ? value : '');
    const text = (value, max) => String(value || '').trim().substring(0, max);
    return {
      imdbID,
      title: text(title, CONFIG.LIMITS.MAX_TITLE_LENGTH),
      year: Number.isInteger(year) && year > 1800 && year < 2200 ? year : null,
      genres: (Array.isArray(raw.genres) ? raw.genres : String(raw.genres || '').split(','))
        .map(g => text(g, 40)).filter(Boolean).slice(0, 10),
      director: text(raw.director, 200),
      actors: text(raw.actors, 300),
      plot: text(raw.plot, 1000),
      poster: Security.isSafeUrl(raw.poster) ? raw.poster : '',
      verdict: RATINGS.VERDICTS.includes(raw.verdict) ? raw.verdict : '',
      stars: Number.isInteger(raw.stars) && raw.stars >= 0 && raw.stars <= 5 ? raw.stars : 0,
      rewatch: Boolean(raw.rewatch),
      review: text(raw.review, CONFIG.LIMITS.MAX_REVIEW_LENGTH),
      want: Boolean(raw.want),
      ratedAt: date(raw.ratedAt),
      updatedAt: date(raw.updatedAt) || new Date().toISOString()
    };
  },

  // Creates the entry from the film's details on first touch, then applies changes
  update(info, changes) {
    const existing = this.entries.get(info.imdbID);
    // Fresh details win over the stored snapshot, but blanks don't erase it
    const details = Object.fromEntries(
      ['imdbID', 'title', 'year', 'genres', 'director', 'actors', 'plot', 'poster']
        .filter(field => info[field] && String(info[field]).length)
        .map(field => [field, info[field]])
    );
    const next = this.sanitize({
      ...existing, ...details, ...changes, updatedAt: new Date().toISOString()
    });
    if (!next) return null;
    if (changes.verdict === 'up' || changes.verdict === 'down') {
      next.want = false; // Seen it now
      if (!existing || existing.verdict !== changes.verdict) next.ratedAt = next.updatedAt;
    }
    this.entries.set(next.imdbID, next);
    this.onChange();
    return next;
  },

  setVerdict(info, verdict) {
    return this.update(info, { verdict });
  },

  // Tapping the current star again clears it, like the watchlist's reviews
  setStars(info, stars) {
    const current = this.get(info.imdbID);
    return this.update(info, { stars: current && current.stars === stars ? 0 : stars });
  },

  // Forget skips so those films come round again; returns how many
  clearSkips() {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.verdict !== 'skip') continue;
      count++;
      if (entry.want || entry.stars || entry.review || entry.rewatch) entry.verdict = '';
      else this.entries.delete(entry.imdbID);
    }
    if (count) this.onChange();
    return count;
  },

  counts() {
    const counts = { up: 0, down: 0, skip: 0, want: 0 };
    for (const entry of this.entries.values()) {
      if (entry.verdict) counts[entry.verdict]++;
      if (entry.want) counts.want++;
    }
    return counts;
  },

  // ---- Import / export ----------------------------------------------------

  backup() {
    return {
      app: 'ratings',
      version: 1,
      exportDate: new Date().toISOString(),
      ratings: this.all()
    };
  },

  // Films you want to see, as items the watchlist's Import accepts as-is
  watchlistItems() {
    return this.all().filter(e => e.want).map(e => ({
      title: e.title,
      type: 'movie',
      priority: 'medium',
      genre: e.genres.join(', '),
      plot: e.plot,
      poster: e.poster,
      imdbID: e.imdbID,
      watched: false
    }));
  },

  // Plain-text profile to paste into an AI assistant for recommendations
  aiProfile(taste) {
    const line = e => {
      const parts = [`${e.title}${e.year ? ` (${e.year})` : ''}`];
      if (e.stars) parts.push('★'.repeat(e.stars));
      if (e.rewatch) parts.push('would rewatch');
      if (e.review) parts.push(`"${e.review.replace(/\s+/g, ' ')}"`);
      return `- ${parts.join(' · ')}`;
    };
    const byRecent = (a, b) => (b.ratedAt || '').localeCompare(a.ratedAt || '');
    const liked = this.all().filter(e => e.verdict === 'up').sort(byRecent);
    const disliked = this.all().filter(e => e.verdict === 'down').sort(byRecent);
    const wanted = this.all().filter(e => e.want);
    const leanings = rows => rows.map(r => `${r.name} (liked ${r.up} of ${r.up + r.down})`).join(', ') || 'not enough ratings yet';

    return [
      '# My movie taste',
      '',
      'Recommend 10 films I have not rated or listed below. For each, give the title, year and one line on why it fits my taste. Prefer a mix of well-known and lesser-known films.',
      '',
      `## Leanings`,
      `- Genres I like: ${leanings(taste.genres.filter(r => r.lift > 0).slice(0, 6))}`,
      `- Genres I like less: ${leanings(taste.genres.filter(r => r.lift < 0).slice(-4).reverse())}`,
      `- Themes and styles I like: ${leanings(taste.tags.filter(r => r.lift > 0).slice(0, 8))}`,
      `- Themes and styles I like less: ${leanings(taste.tags.filter(r => r.lift < 0).slice(-5).reverse())}`,
      `- Decades I like: ${leanings(taste.decades.filter(r => r.lift > 0).slice(0, 4))}`,
      ...(taste.crowd.compared
        ? [`- I agree with most MovieLens viewers on ${Math.round(100 * taste.crowd.agree / taste.crowd.compared)}% of ${taste.crowd.compared} films`]
        : []),
      '',
      `## Liked (${liked.length})`, ...liked.map(line), '',
      `## Disliked (${disliked.length})`, ...disliked.map(line), '',
      `## Want to watch (${wanted.length})`, ...wanted.map(line), ''
    ].join('\n');
  },

  // Accepts a ratings backup or a watchlist export; returns { added, updated }
  import(data) {
    if (data && data.app === 'ratings' && Array.isArray(data.ratings)) {
      return this.importBackup(data.ratings);
    }
    if (data && (Array.isArray(data.watched) || Array.isArray(data.unwatched))) {
      return this.importWatchlist(data.unwatched || [], data.watched || []);
    }
    if (Array.isArray(data)) return this.importWatchlist(data.filter(i => i && !i.watched), data.filter(i => i && i.watched));
    throw new Error('Not a ratings backup or watchlist export');
  },

  importBackup(list) {
    if (list.length > RATINGS.MAX_IMPORT) throw new Error('Too many entries');
    let added = 0, updated = 0;
    for (const raw of list) {
      const entry = this.sanitize(raw);
      if (!entry) continue;
      const existing = this.entries.get(entry.imdbID);
      if (!existing) added++;
      else if (entry.updatedAt > existing.updatedAt) updated++;
      else continue; // Keep whichever copy was changed last
      this.entries.set(entry.imdbID, entry);
    }
    if (added || updated) this.onChange();
    return { added, updated };
  },

  // Watched titles bring their stars, notes and rewatch flag; 4-5 stars count
  // as thumbs up and 1-2 as thumbs down. Unwatched titles become "want to watch".
  // Anything already rated here is left alone.
  importWatchlist(unwatched, watched) {
    if (unwatched.length + watched.length > RATINGS.MAX_IMPORT) throw new Error('Too many items');
    let added = 0, updated = 0;
    const take = (item, fields) => {
      if (!item || item.type === 'youtube' || item.type === 'series') return;
      const existing = this.entries.get(item.imdbID);
      if (existing && (existing.verdict || existing.want)) return;
      const entry = this.sanitize({
        imdbID: item.imdbID, title: item.title, genres: item.genre,
        plot: item.plot, poster: item.poster, ...existing, ...fields
      });
      if (!entry) return;
      existing ? updated++ : added++;
      this.entries.set(entry.imdbID, entry);
    };
    for (const item of unwatched) take(item, { want: true });
    for (const item of watched) {
      const stars = Number.isInteger(item.stars) ? item.stars : 0;
      take(item, {
        stars, review: item.review, rewatch: item.rewatch,
        verdict: stars >= 4 ? 'up' : stars >= 1 && stars <= 2 ? 'down' : '',
        ratedAt: stars && stars !== 3 ? new Date().toISOString() : ''
      });
    }
    if (added || updated) this.onChange();
    return { added, updated };
  },

  load(list) {
    this.entries = new Map();
    for (const raw of list || []) {
      const entry = this.sanitize(raw);
      if (entry) this.entries.set(entry.imdbID, entry);
    }
  }
};
