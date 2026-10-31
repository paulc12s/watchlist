// ============================================================================
// For you, guesses and learn-fastest order
// The For you sheet lists picks in lanes: films (great, fun) from the
// MovieLens similarity data, and TV (great, fun, and a bridge from your film
// taste) from TMDB. Tapping a pick deals it as the next card.
//
// Guesses: when you give a title its first verdict, where the recommender
// ranked it for you is saved with the rating and revealed afterwards, never
// before, so it can't sway you. My taste shows how well the guesses hold up.
// ============================================================================

const Guesses = {
  // The graph and id a key would be scored in, or null
  locate(key, info) {
    if (TMDB.isShowKey(key)) return { graph: TvRecs.graph(Ratings.all()), id: key };
    if (!Recommender.ready() || !info || info.type !== 'movie') return null;
    return { graph: Recommender.filmGraph, id: info.imdbID };
  },

  // Percentile 0-1 for a title you haven't judged yet, or null when there's
  // nothing to go on
  forCard(key, info) {
    const where = this.locate(key, info);
    if (!where) return null;
    const guess = Recommender.guess(where.id, Ratings.all(), where.graph);
    return guess ? guess.percentile : null;
  },

  label(percentile) {
    return RATINGS.GUESS_LABELS.find(([cut]) => percentile >= cut)[1];
  },

  // How the guesses have done: of titles ranked in your top slice versus the
  // rest, how many you'd seen (a thumb, not a skip) and how many of those you liked
  record(entries) {
    const guessed = entries.filter(e => typeof e.guessPct === 'number' && e.verdict);
    const group = list => {
      const seen = list.filter(e => e.verdict === 'up' || e.verdict === 'down');
      return {
        count: list.length,
        seen: list.length ? seen.length / list.length : 0,
        liked: seen.length ? seen.filter(e => e.verdict === 'up').length / seen.length : 0
      };
    };
    return {
      total: guessed.length,
      top: group(guessed.filter(e => e.guessPct >= RATINGS.GUESS_TOP)),
      rest: group(guessed.filter(e => e.guessPct < RATINGS.GUESS_TOP))
    };
  },

  // For Catalog.learnScore: widely seen films with little evidence either way
  learnScore() {
    const graph = Recommender.filmGraph;
    const { results } = Recommender.score(Ratings.all(), 'great', graph);
    const evidence = new Map(results.map(r => [r.film.id, r.evidence]));
    return key => {
      const id = MovieInfo.imdbID(key) || key;
      const i = graph.index.get(id);
      if (i === undefined) return 0;
      return graph.items[i].popularity / (1 + 3 * (evidence.get(id) || 0));
    };
  }
};

const ForYou = {
  tab: 'films',
  renderSeq: 0,

  open() {
    this.render();
    RatingsUI.els.forYouSheet.showModal();
  },

  bind() {
    RatingsUI.els.forYouBody.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab;
        return this.render();
      }
      const pick = event.target.closest('[data-pick]');
      if (pick) {
        RatingsUI.els.forYouSheet.close();
        return RatingsUI.jumpTo(pick.dataset.pick);
      }
      if (event.target.closest('[data-action="settings"]')) {
        RatingsUI.els.forYouSheet.close();
        RatingsUI.openSettings();
      }
    });
  },

  tabs() {
    return html`
      <div class="segmented" role="tablist">
        ${[['films', 'Films'], ['tv', 'TV']].map(([id, label]) => html`
          <button type="button" role="tab" data-tab="${id}" aria-selected="${id === this.tab}">${label}</button>`)}
      </div>`;
  },

  show(content) {
    RatingsUI.els.forYouBody.innerHTML = html`${this.tabs()}${content}`;
  },

  render() {
    const seq = ++this.renderSeq;
    if (this.tab === 'tv') return this.renderTv(seq);
    this.renderFilms();
  },

  renderFilms() {
    if (!Recommender.ready()) return this.show(html`<p class="hint">Loading film data…</p>`);
    const entries = Ratings.all();
    const judged = entries.filter(e => e.type === 'movie' && (e.verdict === 'up' || e.verdict === 'down')).length;
    if (judged < RATINGS.MIN_FOR_YOU) {
      return this.show(html`<p class="hint">Give at least ${RATINGS.MIN_FOR_YOU} films a thumb up or down first. So far: ${judged}.</p>`);
    }
    const { great, fun } = Recommender.lanes(entries, RATINGS.FOR_YOU_PICKS);
    this.show(html`
      ${this.lane('Great films for you', 'Close to your best-rated films, and well regarded', great, 'films')}
      ${this.lane('Fun picks', 'Your comfort zones, whatever the critics said', fun, 'films')}`);
    this.fillPosters([...great.slice(0, RATINGS.FOR_YOU_POSTERS), ...fun.slice(0, RATINGS.FOR_YOU_POSTERS)]);
  },

  async renderTv(seq) {
    if (!TMDB.hasKey()) {
      return this.show(html`
        <p class="hint">TV picks come from TMDB, which needs a free key.</p>
        <button type="button" class="button primary" data-action="settings">Open settings</button>`);
    }
    this.show(html`<p class="hint">Finding shows…</p>`);
    const entries = Ratings.all();
    let lanes, bridge = [];
    try {
      await TvRecs.refresh(entries);
      const graph = TvRecs.graph(entries);
      lanes = Recommender.lanes(entries, RATINGS.FOR_YOU_PICKS, graph);
      if (TvRecs.ratedShows(entries) < TV_REC.BRIDGE_UNTIL_RATED) {
        const filmTaste = Taste.compute(entries.filter(e => e.type === 'movie'), {
          tagsOf: entry => Catalog.basics(entry.imdbID).tags
        });
        const shown = new Set([...lanes.great, ...lanes.fun].map(item => item.id));
        bridge = (await TvRecs.bridge(entries, filmTaste.tags))
          .filter(item => !shown.has(item.id)).slice(0, RATINGS.FOR_YOU_PICKS);
      }
    } catch (error) {
      if (seq === this.renderSeq) this.show(html`<p class="hint">${error.message}</p>`);
      return;
    }
    if (seq !== this.renderSeq) return;

    const rated = TvRecs.ratedShows(entries);
    this.show(html`
      ${rated === 0 && bridge.length === 0
        ? html`<p class="hint">Rate some shows from the TV lists, or more films, to get TV picks.</p>` : ''}
      ${this.lane('Great shows for you', 'Recommended from your best-rated shows', lanes.great, 'tv')}
      ${this.lane('Fun picks', 'Shows like the ones you enjoy, whatever their score', lanes.fun, 'tv')}
      ${this.lane('From your film taste', 'Well-known shows with the themes you like in films. Fades out once you’ve rated 15 shows', bridge, 'themes')}`);
  },

  lane(title, note, items, kind) {
    if (!items.length) return '';
    return html`
      <section class="lane">
        <h3>${title}</h3>
        <p class="lane-note">${note}</p>
        <ul class="film-list">${items.map(item => this.row(item, kind))}</ul>
      </section>`;
  },

  row(item, kind) {
    const cached = MovieInfo.get(item.id);
    const poster = item.poster || (cached && cached.poster) || '';
    const why = item.because && item.because.length
      ? `${kind === 'themes' ? 'Your themes' : 'Because you liked'}: ${item.because.join(', ')}` : '';
    const crowd = kind === 'films'
      ? `${Math.round(item.likeRate * 100)}% liked`
      : typeof item.tmdbRating === 'number' ? `TMDB ${item.tmdbRating.toFixed(1)}` : '';
    return html`
      <li><button type="button" class="film-row" data-pick="${item.id}">
        ${poster ? html`<img src="${poster}" alt="" loading="lazy">` : html`<span class="thumb"></span>`}
        <span class="film-text">
          <span class="film-title">${item.title}${item.year && ` (${item.year})`}</span>
          ${why && html`<span class="film-why">${why}</span>`}
        </span>
        ${crowd && html`<span class="film-crowd">${crowd}</span>`}
      </button></li>`;
  },

  // Film picks have no poster until OMDb is asked; fetch a few, two at a time
  async fillPosters(items) {
    const seq = this.renderSeq;
    const queue = items.filter(item => !MovieInfo.get(item.id));
    const worker = async () => {
      while (queue.length && seq === this.renderSeq) {
        const item = queue.shift();
        try {
          const info = await MovieInfo.fetch(item.id);
          const row = RatingsUI.els.forYouBody.querySelector(`[data-pick="${item.id}"] .thumb`);
          if (row && info.poster && seq === this.renderSeq) {
            const img = document.createElement('img');
            img.src = info.poster;
            img.alt = '';
            row.replaceWith(img);
          }
        } catch (error) {
          return; // OMDb trouble; leave the placeholders
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
};
