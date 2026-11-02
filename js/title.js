// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Title: the one record shape the app stores, imports and exports
//
// A title is a film, show, video or anything else you track. Every mode, and
// every file, uses these fields:
//
//   id, title, type ('movie' | 'series' | 'youtube'), year,
//   imdbID, youtubeID, tmdbId, genres[], director, actors, plot, poster,
//   imdbRating (0-10), duration                     details
//   priority, tag, platform                          how you organise it
//   want      on your list to watch
//   verdict   'up' | 'down' (seen, with your thumb), 'skip' (not seen, don't
//             offer again), 'pass' (not seen, and not interested) or '' (not
//             seen). Seen and rated are the same thing
//   stars, review, rewatch                           the rest of your review
//   reviewDate   when the review last changed ('' if unknown, e.g. a title
//                marked watched in an old file: its 👍 counts all the same)
//   updatedDate  when anything last changed ('' if never, e.g. an old file)
//   guessPct  where the recommender ranked it when you first rated it
//
// sanitize() also reads every field name earlier versions used (thumb,
// watched, genre, rating, ratedAt, updatedAt), so every old file and stored
// list still loads.
// ============================================================================

const Title = {
  TYPES: ['movie', 'series', 'youtube'],
  VERDICTS: ['up', 'down', 'skip', 'pass'],
  REVIEW_FIELDS: ['verdict', 'stars', 'review', 'rewatch'],

  newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // randomUUID needs a secure context (https or localhost)
    return Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  },

  // Identity for matching copies of the same title across lists and files
  key(t) {
    if (t.imdbID) return `imdb:${t.imdbID}`;
    if (t.youtubeID) return `yt:${t.youtubeID}`;
    return `id:${t.id}`;
  },

  thumb(t) {
    return t && (t.verdict === 'up' || t.verdict === 'down') ? t.verdict : '';
  },

  isSeen(t) {
    return Boolean(this.thumb(t));
  },

  // Tags and platforms: no leading #, single spaces. Library.labelName then
  // gives each label one spelling on every save
  cleanLabel(value) {
    return String(value || '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
  },

  // How each type shows: its icon in the sprite, and its name
  TYPE_ICONS: { movie: 'film', series: 'tv', youtube: 'play' },
  TYPE_NAMES: { movie: 'Film', series: 'TV', youtube: 'YouTube' },

  // Where a title stands, in the words every mode uses: Loved, Liked, Not
  // for me, Not interested, Skipped, On your list, or '' for none of those
  statusLabel(t) {
    if (this.isLoved(t)) return 'Loved';
    return { up: 'Liked', down: 'Not for me', pass: 'Not interested', skip: 'Skipped' }[t.verdict] || (t.want ? 'On your list' : '');
  },

  // ❤️ is shorthand for five stars: seen, and loved
  LOVED_STARS: 5,
  isLoved(t) {
    return Boolean(t) && t.stars === this.LOVED_STARS;
  },

  // The thumb a review implies when none was given: what the stars say
  // (4-5 up, 1-2 down), otherwise a thumbs up
  impliedThumb(stars) {
    return stars >= 1 && stars <= 2 ? 'down' : 'up';
  },

  // Unknown priorities (written by a newer version) are kept in storage but
  // behave as medium on screen
  displayPriority(t) {
    return CONFIG.PRIORITIES.includes(t.priority) ? t.priority : 'medium';
  },

  formatRating(rating) {
    return typeof rating === 'number' ? rating.toFixed(1) : '';
  },

  sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = (value, max) => (typeof value === 'string' || typeof value === 'number'
      ? String(value).trim().substring(0, max) : '');
    const date = value => (typeof value === 'string' && value.length <= 40 && !isNaN(Date.parse(value)) ? value : '');
    const title = text(raw.title, CONFIG.LIMITS.MAX_TITLE_LENGTH);
    if (!title) return null;

    const year = parseInt(raw.year, 10);
    const rating = Number(raw.imdbRating !== undefined ? raw.imdbRating : raw.rating);
    const genres = raw.genres !== undefined ? raw.genres : raw.genre;
    const stars = Number.isInteger(raw.stars) && raw.stars >= 0 && raw.stars <= 5 ? raw.stars : 0;
    const review = text(raw.review, CONFIG.LIMITS.MAX_REVIEW_LENGTH);
    const rewatch = Boolean(raw.rewatch);
    const imdbID = text(raw.imdbID, 20);
    let plot = text(raw.plot, 2000);
    const youtubeID = text(raw.youtubeID, 20);
    // Older versions stored the YouTube URL in plot; the video ID already covers it
    if (youtubeID && plot.includes(youtubeID) && Security.isSafeUrl(plot)) plot = '';

    // The retired watchlist page said "watched" and "thumb"; the ratings page "want" and "verdict"
    const given = raw.verdict !== undefined ? raw.verdict : raw.thumb;
    let verdict = this.VERDICTS.includes(given) ? given : '';
    const legacyWatched = typeof raw.watched === 'boolean' ? raw.watched : null;
    const want = typeof raw.want === 'boolean' ? raw.want : legacyWatched === false;
    // Stars, a rewatch flag, or having watched it mean you've seen it, so it
    // has a thumb. Notes don't: they can be about a title still to watch
    if (!this.thumb({ verdict }) && (stars || rewatch || legacyWatched)) verdict = this.impliedThumb(stars);

    return {
      id: text(raw.id, 60) || this.newId(),
      title,
      type: this.TYPES.includes(raw.type) ? raw.type : 'movie',
      year: Number.isInteger(year) && year > 1800 && year < 2200 ? year : null,
      imdbID: /^tt\d{7,10}$/.test(imdbID) ? imdbID : '',
      youtubeID,
      tmdbId: Number.isInteger(raw.tmdbId) && raw.tmdbId > 0 ? raw.tmdbId : null,
      genres: (Array.isArray(genres) ? genres : String(genres || '').split(','))
        .map(g => text(g, 40)).filter(Boolean).slice(0, 10),
      director: text(raw.director, 200),
      actors: text(raw.actors, 300),
      plot,
      poster: Security.isSafeUrl(raw.poster) ? raw.poster.trim() : '',
      imdbRating: rating > 0 && rating <= 10 ? Math.round(rating * 10) / 10 : null,
      duration: text(raw.duration, 20),
      // Keep priorities this version doesn't know (written by a newer version)
      // so an out-of-date copy of the app can't silently downgrade them
      priority: typeof raw.priority === 'string' && /^[a-z-]{1,20}$/.test(raw.priority) ? raw.priority : '',
      tag: this.cleanLabel(text(raw.tag, CONFIG.LIMITS.MAX_TAG_LENGTH)),
      platform: this.cleanLabel(text(raw.platform, CONFIG.LIMITS.MAX_PLATFORM_LENGTH)),
      want,
      verdict,
      stars,
      review,
      rewatch,
      reviewDate: date(raw.reviewDate) || date(raw.ratedAt),
      updatedDate: date(raw.updatedDate) || date(raw.updatedAt),
      guessPct: typeof raw.guessPct === 'number' && raw.guessPct >= 0 && raw.guessPct <= 1 ? raw.guessPct : null
    };
  },

  // Whether your review (thumb, stars, notes, rewatch) differs between two
  // versions of a title. Skips and "want to watch" aren't reviews.
  reviewChanged(before, after) {
    return this.thumb(before) !== this.thumb(after) || (before.stars || 0) !== (after.stars || 0) ||
      (before.review || '') !== (after.review || '') || Boolean(before.rewatch) !== Boolean(after.rewatch);
  },

  // A changed copy of t: changes applied, sanitized, and dated. The review
  // date moves only when the review itself changed.
  changed(t, changes, now = new Date().toISOString()) {
    const next = this.sanitize({ ...t, ...changes, id: t.id });
    if (!next) return null;
    next.updatedDate = now;
    if (this.reviewChanged(t, next)) next.reviewDate = now;
    return next;
  },

  // Field names a raw record supplies, in today's names. Files from older
  // versions lack some fields; those are never taken from them.
  suppliedFields(raw) {
    const renamed = { thumb: 'verdict', watched: 'want', genre: 'genres', rating: 'imdbRating', ratedAt: 'reviewDate', updatedAt: 'updatedDate' };
    const fields = new Set(Object.keys(raw).map(name => renamed[name] || name));
    // Old watchlist files said "watched" without a thumb: that implies one
    if (fields.has('want') && 'watched' in raw) fields.add('verdict');
    return fields;
  },

  // Folds an imported copy (incoming, sanitized from raw) into local, the
  // copy already here. Returns the merged record, or null if nothing changed.
  //
  // - Your review (thumb, stars, notes, rewatch) comes from whichever copy was
  //   reviewed more recently; everything else from whichever changed more
  //   recently. A copy with no date (files from before dates were kept) never
  //   wins: it only fills in what's blank here.
  // - A file never removes a title, and fields a file doesn't carry are kept.
  // - Merging isn't an edit: the result keeps the newer of the two dates.
  merge(local, incoming, raw) {
    const supplied = this.suppliedFields(raw);
    const result = { ...local };
    const newer = (a, b) => Boolean(a && b && a > b);
    const reviewWins = newer(incoming.reviewDate, local.reviewDate);
    const restWins = newer(incoming.updatedDate, local.updatedDate);

    // A skip or pass isn't a review of something seen, so it goes by when the title last changed
    const verdictIsReview = this.isSeen(local) || this.isSeen(incoming);
    for (const field of Object.keys(incoming)) {
      if (field === 'id' || field === 'reviewDate' || field === 'updatedDate' || !supplied.has(field)) continue;
      const isReview = this.REVIEW_FIELDS.includes(field) && (field !== 'verdict' || verdictIsReview);
      if (isReview ? reviewWins : restWins) {
        result[field] = incoming[field];
      } else if (this.isBlank(field, local) && !this.isBlank(field, incoming)) {
        result[field] = incoming[field];
      }
    }
    // Filling in "want to watch" only applies to titles you haven't seen
    if (!restWins && !local.want && this.isSeen(local)) result.want = false;

    // A review date comes with the review it belongs to, or fills a blank
    if (reviewWins || (incoming.reviewDate && (!local.reviewDate || this.reviewChanged(local, result)))) {
      result.reviewDate = incoming.reviewDate || local.reviewDate;
    }
    result.updatedDate = [local.updatedDate, incoming.updatedDate].sort().pop() || '';

    return JSON.stringify(result) === JSON.stringify(local) ? null : result;
  },

  isBlank(field, t) {
    const value = t[field];
    if (field === 'verdict') return !this.isSeen(t);
    if (field === 'priority') return !value;
    if (Array.isArray(value)) return value.length === 0;
    return value === '' || value === null || value === 0 || value === false || value === undefined;
  }
};
