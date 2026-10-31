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
      // IMDb's audience rating out of 10, from OMDb when the card was shown
      imdbRating: Number(raw.imdbRating) > 0 && Number(raw.imdbRating) <= 10 ? Number(raw.imdbRating) : null,
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
      ['imdbID', 'title', 'year', 'genres', 'director', 'actors', 'plot', 'poster', 'imdbRating']
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
      if (e.imdbRating) parts.push(`IMDb ${e.imdbRating}`);
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

  // Merges a watchlist export without losing anything already here:
  // - Watched titles fill in stars, notes and rewatch where this app has none,
  //   and 4-5 stars become a thumb up, 1-2 a thumb down, unless you've already
  //   given a thumb here. A film you skipped or wanted is upgraded, since the
  //   watchlist says you've now seen it.
  // - Unwatched titles become "want to watch" unless you've rated them.
  // - Nothing is removed, and a filled-in field is never overwritten.
  importWatchlist(unwatched, watched) {
    if (unwatched.length + watched.length > RATINGS.MAX_IMPORT) throw new Error('Too many items');
    let added = 0, updated = 0;
    const now = new Date().toISOString();
    const thumbed = entry => Boolean(entry && (entry.verdict === 'up' || entry.verdict === 'down'));

    const merge = (item, changes) => {
      if (!item || item.type === 'youtube' || item.type === 'series') return;
      const existing = this.entries.get(item.imdbID);
      const base = existing || {
        imdbID: item.imdbID, title: item.title, genres: item.genre, plot: item.plot, poster: item.poster
      };
      const entry = this.sanitize({ ...base, ...changes(existing || {}) });
      if (!entry) return;
      if (existing && JSON.stringify({ ...entry, updatedAt: '' }) === JSON.stringify({ ...existing, updatedAt: '' })) return;
      if (existing) {
        updated++;
        entry.updatedAt = now;
      } else {
        added++;
      }
      this.entries.set(entry.imdbID, entry);
    };

    for (const item of unwatched) {
      const seen = entry => thumbed(entry) || entry.stars || entry.review || entry.rewatch;
      merge(item, entry => (seen(entry) ? {} : { want: true, verdict: '' }));
    }
    for (const item of watched) {
      const stars = Number.isInteger(item.stars) && item.stars >= 1 && item.stars <= 5 ? item.stars : 0;
      const verdict = stars >= 4 ? 'up' : stars >= 1 && stars <= 2 ? 'down' : '';
      merge(item, entry => {
        const changes = { want: false };
        if (!thumbed(entry)) {
          // Seen now: a skip no longer applies, and stars may give a thumb
          changes.verdict = verdict;
          if (verdict) changes.ratedAt = now;
        }
        // Stars that contradict a thumb you've given here are left out
        const conflicts = thumbed(entry) && verdict && verdict !== entry.verdict;
        if (!entry.stars && stars && !conflicts) changes.stars = stars;
        if (!entry.review && item.review) changes.review = item.review;
        if (!entry.rewatch && item.rewatch) changes.rewatch = true;
        return changes;
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
