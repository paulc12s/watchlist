// ============================================================================
// Ratings → watchlist
// Turns ratings entries into watchlist items. Shared by the ratings page's
// "Export for Watchlist" and the watchlist's Import of a ratings backup, so
// either file gives the same result.
//
// Seen and rated are the same thing on both pages: a title with a thumb,
// stars, notes or a rewatch flag goes over as watched, with its review.
// "Want to watch" titles go over as unwatched. Skips stay behind, since they
// mean you haven't seen it. Tag, platform and priority that came from the
// watchlist go back unchanged.
//
// Entries may come from a backup made by any version of the ratings page, so
// older field names (ratedAt) are read too. The watchlist sanitizes the result.
// ============================================================================

const Exchange = {
  watchlistItems(entries) {
    const thumb = e => (e.verdict === 'up' || e.verdict === 'down' ? e.verdict : '');
    const seen = e => thumb(e) || e.stars || e.review || e.rewatch;
    return (Array.isArray(entries) ? entries : [])
      .filter(e => e && typeof e === 'object' && (e.want || seen(e)))
      .map(e => ({
        title: e.title,
        type: e.type === 'series' ? 'series' : 'movie',
        priority: e.priority || 'medium',
        tag: e.tag || '',
        platform: e.platform || '',
        genre: Array.isArray(e.genres) ? e.genres.join(', ') : String(e.genres || ''),
        rating: e.imdbRating ? String(e.imdbRating) : '',
        plot: e.plot || '',
        poster: e.poster || '',
        imdbID: e.imdbID,
        watched: !e.want,
        thumb: seen(e) ? this.thumbFor(e) : '',
        stars: e.stars || 0,
        review: e.review || '',
        rewatch: Boolean(e.rewatch),
        reviewDate: e.reviewDate || e.ratedAt || ''
      }));
  },

  // The thumb a title counts as having. Watched and rated are the same thing,
  // so a title you've seen always has one: the thumb you gave, or else what
  // your stars say (4-5 up, 1-2 down), or else a thumbs up. The default isn't
  // stored, so a real thumb from the other page can still fill it in.
  // Works on watchlist items (thumb, watched) and ratings entries (verdict).
  thumbFor(item) {
    if (!item) return '';
    const given = item.thumb || item.verdict;
    if (given === 'up' || given === 'down') return given;
    const stars = Number.isInteger(item.stars) ? item.stars : 0;
    if (stars >= 4) return 'up';
    if (stars >= 1 && stars <= 2) return 'down';
    return item.watched || stars || item.review || item.rewatch ? 'up' : '';
  },

  // Local date and time for export file names, e.g. "2026-10-31-1432", so
  // two exports on the same day don't share a name
  fileStamp(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`;
  },

  isRatingsBackup(data) {
    return Boolean(data && data.app === 'ratings' && Array.isArray(data.ratings));
  }
};
