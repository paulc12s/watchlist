// ============================================================================
// Taste profile
// For each genre, theme (MovieLens tag), decade and director: how often you
// liked its films compared with how often you like films overall. Counts are
// smoothed toward your overall rate so two lucky thumbs don't make a
// "favorite genre". Five stars counts a little extra in favor, one star a
// little extra against.
//
// Also how often you agree with the crowd: whether most MovieLens raters
// liked (4+ stars) the films you liked.
// ============================================================================

const CROWD_LIST_LENGTH = 5;

const Taste = {
  weight(entry) {
    if (entry.verdict === 'up') return entry.stars === 5 ? 1.5 : 1;
    return entry.stars === 1 ? 1.5 : 1;
  },

  // tagsOf(entry) -> tags, crowdOf(entry) -> share of raters who liked it (0-1)
  // or null; both come from the film lists, which entries don't store
  compute(entries, { tagsOf = () => [], crowdOf = () => null } = {}) {
    const judged = entries.filter(e => e.verdict === 'up' || e.verdict === 'down');
    const up = judged.filter(e => e.verdict === 'up').length;
    const overall = judged.length ? up / judged.length : 0.5;

    const tally = keysOf => {
      const rows = new Map();
      for (const entry of judged) {
        for (const name of keysOf(entry)) {
          if (!rows.has(name)) rows.set(name, { name, up: 0, down: 0, wUp: 0, wDown: 0 });
          const row = rows.get(name);
          const w = this.weight(entry);
          if (entry.verdict === 'up') { row.up++; row.wUp += w; } else { row.down++; row.wDown += w; }
        }
      }
      // Two imaginary films at your overall rate pull small samples toward it
      return [...rows.values()]
        .filter(r => r.up + r.down >= RATINGS.MIN_PROFILE_FILMS)
        .map(r => {
          const rate = (r.wUp + 2 * overall) / (r.wUp + r.wDown + 2);
          return { name: r.name, up: r.up, down: r.down, rate, lift: rate - overall };
        })
        .sort((a, b) => b.lift - a.lift);
    };

    return {
      judged: judged.length,
      overall,
      genres: tally(e => e.genres),
      tags: tally(tagsOf),
      decades: tally(e => (e.year ? [`${Math.floor(e.year / 10) * 10}s`] : [])),
      directors: tally(e => e.director.split(',').map(d => d.trim()).filter(Boolean)),
      crowd: this.crowd(judged, crowdOf)
    };
  },

  crowd(judged, crowdOf) {
    const rated = judged
      .map(entry => ({ entry, rate: crowdOf(entry) }))
      .filter(r => typeof r.rate === 'number');
    const agree = rated.filter(r => (r.entry.verdict === 'up') === (r.rate >= 0.5)).length;
    return {
      compared: rated.length,
      agree,
      // Your strongest disagreements: liked what most didn't, and the reverse
      likedAgainst: rated.filter(r => r.entry.verdict === 'up' && r.rate < 0.5)
        .sort((a, b) => a.rate - b.rate).slice(0, CROWD_LIST_LENGTH),
      dislikedAgainst: rated.filter(r => r.entry.verdict === 'down' && r.rate >= 0.5)
        .sort((a, b) => b.rate - a.rate).slice(0, CROWD_LIST_LENGTH)
    };
  }
};
