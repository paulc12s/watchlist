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
      // 'movie' or 'series', the same values the watchlist uses
      type: raw.type === 'series' ? 'series' : 'movie',
      // TMDB's ID for shows, to fetch their recommendations
      tmdbId: Number.isInteger(raw.tmdbId) && raw.tmdbId > 0 ? raw.tmdbId : null,
      // The watchlist's own organising fields, kept so a round trip loses nothing
      tag: text(raw.tag, CONFIG.LIMITS.MAX_TAG_LENGTH),
      platform: text(raw.platform, CONFIG.LIMITS.MAX_PLATFORM_LENGTH),
      priority: typeof raw.priority === 'string' && /^[a-z-]{1,20}$/.test(raw.priority) ? raw.priority : '',
      // Where the recommender ranked this title for you when it was dealt
      // (1 = top pick), saved with your first verdict to measure its guesses
      guessPct: typeof raw.guessPct === 'number' && raw.guessPct >= 0 && raw.guessPct <= 1 ? raw.guessPct : null,
      verdict: RATINGS.VERDICTS.includes(raw.verdict) ? raw.verdict : '',
      stars: Number.isInteger(raw.stars) && raw.stars >= 0 && raw.stars <= 5 ? raw.stars : 0,
      rewatch: Boolean(raw.rewatch),
      review: text(raw.review, CONFIG.LIMITS.MAX_REVIEW_LENGTH),
      want: Boolean(raw.want),
      // When you last gave a thumb, stars, notes or the rewatch flag; '' if
      // never. Shared with the watchlist. (Older versions called it ratedAt.)
      reviewDate: date(raw.reviewDate) || date(raw.ratedAt),
      // Any change at all, so the newer copy wins when backups are merged
      updatedDate: date(raw.updatedDate) || date(raw.updatedAt) || new Date().toISOString()
    };
  },

  // Creates the entry from the film's details on first touch, then applies changes
  update(info, changes) {
    const existing = this.entries.get(info.imdbID);
    // Fresh details win over the stored snapshot, but blanks don't erase it
    const details = Object.fromEntries(
      ['imdbID', 'title', 'year', 'genres', 'director', 'actors', 'plot', 'poster', 'imdbRating', 'type', 'tmdbId']
        .filter(field => info[field] && String(info[field]).length)
        .map(field => [field, info[field]])
    );
    const next = this.sanitize({
      ...existing, ...details, ...changes, updatedDate: new Date().toISOString()
    });
    if (!next) return null;
    if (changes.verdict === 'up' || changes.verdict === 'down') next.want = false; // Seen it now
    if (reviewChanged(existing || {}, next)) next.reviewDate = next.updatedDate;
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

  // Everything the watchlist can use, as items its Import accepts as-is:
  // titles you want to see (unwatched) and titles you've seen and given a
  // thumb, stars, notes or a rewatch flag (watched). Skips stay here, since
  // they mean you haven't seen it. Tag, platform and priority that came from
  // the watchlist go back unchanged.
  watchlistItems() {
    const seen = e => e.verdict === 'up' || e.verdict === 'down' || e.stars || e.review || e.rewatch;
    return this.all().filter(e => e.want || seen(e)).map(e => ({
      title: e.title,
      type: e.type,
      priority: e.priority || 'medium',
      tag: e.tag,
      platform: e.platform,
      genre: e.genres.join(', '),
      rating: e.imdbRating ? String(e.imdbRating) : '',
      plot: e.plot,
      poster: e.poster,
      imdbID: e.imdbID,
      watched: !e.want,
      thumb: e.verdict === 'up' || e.verdict === 'down' ? e.verdict : '',
      stars: e.stars,
      review: e.review,
      rewatch: e.rewatch,
      reviewDate: e.reviewDate
    }));
  },

  // Plain-text profile to paste into an AI assistant for recommendations
  aiProfile(taste) {
    const line = e => {
      const parts = [`${e.title}${e.year ? ` (${e.year})` : ''}`];
      if (e.stars) parts.push('★'.repeat(e.stars));
      if (e.type === 'series') parts.push('TV series');
      if (e.imdbRating) parts.push(`IMDb ${e.imdbRating}`);
      if (e.rewatch) parts.push('would rewatch');
      if (e.review) parts.push(`"${e.review.replace(/\s+/g, ' ')}"`);
      return `- ${parts.join(' · ')}`;
    };
    const byRecent = (a, b) => (b.reviewDate || '').localeCompare(a.reviewDate || '');
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
      else if (entry.updatedDate > existing.updatedDate) updated++;
      else continue; // Keep whichever copy was changed last
      this.entries.set(entry.imdbID, entry);
    }
    if (added || updated) this.onChange();
    return { added, updated };
  },

  // Merges a watchlist export without losing anything already here:
  // - Titles the watchlist says you've seen (watched, or with a thumb, stars,
  //   notes or rewatch) fill in what this app lacks. Its thumb, or else 4-5
  //   stars / 1-2 stars, becomes a thumb here unless you've given one here. A
  //   title you skipped or wanted is upgraded, since you've now seen it.
  // - Other unwatched titles become "want to watch" unless you've rated them.
  // - Tag, platform and priority are kept for the trip back.
  // - The review date comes with whatever review is taken from the watchlist;
  //   the import itself never counts as a review.
  // - Nothing is removed, and a filled-in field is never overwritten.
  importWatchlist(unwatched, watched) {
    if (unwatched.length + watched.length > RATINGS.MAX_IMPORT) throw new Error('Too many items');
    let added = 0, updated = 0;
    const now = new Date().toISOString();
    const thumbed = entry => Boolean(entry && (entry.verdict === 'up' || entry.verdict === 'down'));
    const hasOpinion = entry => thumbed(entry) || entry.stars || entry.review || entry.rewatch;

    const merge = (item, changes) => {
      if (!item || item.type === 'youtube') return;
      const existing = this.entries.get(item.imdbID);
      const base = existing || {
        imdbID: item.imdbID, title: item.title, genres: item.genre, plot: item.plot, poster: item.poster,
        type: item.type, imdbRating: item.rating
      };
      const entry = this.sanitize({ ...base, ...changes(existing || {}) });
      if (!entry) return;
      if (existing && JSON.stringify({ ...entry, updatedDate: '' }) === JSON.stringify({ ...existing, updatedDate: '' })) return;
      if (existing) {
        updated++;
        entry.updatedDate = now;
      } else {
        added++;
      }
      this.entries.set(entry.imdbID, entry);
    };

    const items = [
      ...unwatched.map(item => item && { ...item, watched: false }),
      ...watched.map(item => item && { ...item, watched: true })
    ];
    for (const item of items) {
      if (!item) continue;
      const stars = Number.isInteger(item.stars) && item.stars >= 1 && item.stars <= 5 ? item.stars : 0;
      const thumb = item.thumb === 'up' || item.thumb === 'down' ? item.thumb : '';
      const verdict = thumb || (stars >= 4 ? 'up' : stars >= 1 && stars <= 2 ? 'down' : '');
      const seenThere = item.watched || thumb || stars || item.review || item.rewatch;

      merge(item, entry => {
        const changes = {};
        if (!entry.tag && item.tag) changes.tag = item.tag;
        if (!entry.platform && item.platform) changes.platform = item.platform;
        if (!entry.priority && item.priority) changes.priority = item.priority;
        if (!seenThere) {
          if (!hasOpinion(entry)) Object.assign(changes, { want: true, verdict: '' });
          return changes;
        }
        changes.want = false;
        // Seen now: a skip no longer applies, and the watchlist's verdict carries over
        if (!thumbed(entry)) changes.verdict = verdict;
        // Stars that contradict a thumb you've given here are left out
        const conflicts = thumbed(entry) && verdict && verdict !== entry.verdict;
        if (!entry.stars && stars && !conflicts) changes.stars = stars;
        if (!entry.review && item.review) changes.review = item.review;
        if (!entry.rewatch && item.rewatch) changes.rewatch = true;
        if (item.reviewDate && (!entry.reviewDate || reviewChanged(entry, { ...entry, ...changes }))) {
          changes.reviewDate = item.reviewDate;
        }
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

// Whether your review (thumb, stars, notes, rewatch) differs between two
// versions of an entry. Skips and "want to watch" aren't reviews.
function reviewChanged(before, after) {
  const thumb = entry => (entry.verdict === 'up' || entry.verdict === 'down' ? entry.verdict : '');
  return thumb(before) !== thumb(after) || (before.stars || 0) !== (after.stars || 0) ||
    (before.review || '') !== (after.review || '') || Boolean(before.rewatch) !== Boolean(after.rewatch);
}
