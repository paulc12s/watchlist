// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Ratings: what the swipe feed needs to know about your titles
// A thin layer over the shared Library (js/library.js), which stores, merges,
// imports and exports them; records have the shape in js/title.js. The feed
// works with films and shows, which are keyed by IMDb ID.
//
// verdict: 'up' | 'down' | 'skip' | 'pass' | ''  ('' = not judged yet; pass = not interested)
// want:    not seen, would like to; excluded from the feed like a verdict
// ============================================================================

const Ratings = {
  get(imdbID) {
    return Library.byImdb(imdbID);
  },

  // Films and shows; videos and manual entries from the watchlist don't belong in the feed
  all() {
    return Library.all().filter(t => t.imdbID);
  },

  // A film that's been dealt with doesn't come back in the feed
  isDone(imdbID) {
    const entry = this.get(imdbID);
    return Boolean(entry && (entry.verdict || entry.want));
  },

  // Stars, notes or a rewatch flag mean you've seen it, so skipping isn't an option
  hasOpinion(imdbID) {
    const entry = this.get(imdbID);
    return Boolean(entry && (entry.stars || entry.review || entry.rewatch));
  },

  // Creates the entry from the film's details on first touch, then applies changes
  update(info, changes) {
    const seenNow = changes.verdict === 'up' || changes.verdict === 'down';
    return Library.upsert(info, seenNow ? { ...changes, want: false } : changes);
  },

  setVerdict(info, verdict) {
    return this.update(info, { verdict });
  },

  // Tapping the current star again clears it, like the watchlist's reviews
  setStars(info, stars) {
    const current = this.get(info.imdbID);
    return this.update(info, { stars: current && current.stars === stars ? 0 : stars });
  },

  // Forget skips so those films come round again: all of them, or only the
  // IMDb IDs given (one list's); returns how many
  clearSkips(only = null) {
    const skipped = this.all().filter(e => e.verdict === 'skip' && (!only || only.has(e.imdbID)));
    for (const entry of skipped) {
      if (entry.want) Library.change(entry, { verdict: '' });
      else Library.remove(entry);
    }
    return skipped.length;
  },

  counts() {
    const counts = { up: 0, down: 0, skip: 0, pass: 0, want: 0 };
    for (const entry of this.all()) {
      if (entry.verdict) counts[entry.verdict]++;
      if (entry.want) counts.want++;
    }
    return counts;
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
    const passed = this.all().filter(e => e.verdict === 'pass');
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
      `## Want to watch (${wanted.length})`, ...wanted.map(line), '',
      `## Not interested, haven't seen (${passed.length})`, ...passed.map(line), ''
    ].join('\n');
  }
};
