// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// For you, guesses and learn-fastest order
// The For you sheet lists picks in lanes: Top picks first (the few strong
// picks, see Recommender.strongPicks), then films (great, fun) from the
// MovieLens similarity data, and TV (great, fun, and a bridge from your film
// taste) from TMDB. Tapping a pick deals it as the next card; Top picks also
// take Want and Not interested straight from the list.
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

  // The recommender's guess for a title you haven't judged yet
  // ({ percentile, rank, top, strong }), or null when there's nothing to go on
  forCard(key, info) {
    const where = this.locate(key, info);
    if (!where) return null;
    return Recommender.guess(where.id, Ratings.all(), where.graph);
  },

  // Saved with a title's first verdict: the percentile (guessPct)
  saved(guess) {
    return guess ? { guessPct: guess.percentile } : {};
  },

  label(guess) {
    const { GUESS_LABELS } = REVIEW;
    return guess.strong ? GUESS_LABELS.strong : guess.top ? GUESS_LABELS.top : GUESS_LABELS.rest;
  },

  // How the guesses have done: of titles ranked in your top 1% versus the
  // rest, how many you'd seen (a thumb), how many of those you liked, and how
  // many you weren't interested in
  record(entries) {
    const guessed = entries.filter(e => typeof e.guessPct === 'number' && e.verdict);
    const share = (list, test) => (list.length ? list.filter(test).length / list.length : 0);
    const group = list => {
      const seen = list.filter(e => e.verdict === 'up' || e.verdict === 'down');
      return {
        count: list.length,
        seen: share(list, e => e.verdict === 'up' || e.verdict === 'down'),
        liked: share(seen, e => e.verdict === 'up'),
        passed: share(list, e => e.verdict === 'pass')
      };
    };
    const top = e => e.guessPct >= 1 - REC.STRONG_SHARE;
    return {
      total: guessed.length,
      top: group(guessed.filter(top)),
      rest: group(guessed.filter(e => !top(e)))
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
    ReviewUI.els.forYouSheet.showModal();
  },

  bind() {
    ReviewUI.els.forYouBody.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab;
        return this.render();
      }
      const decide = event.target.closest('[data-decide]');
      if (decide) return this.decide(decide.dataset.key, decide.dataset.decide);
      const pick = event.target.closest('[data-pick]');
      if (pick) {
        ReviewUI.els.forYouSheet.close();
        return ReviewUI.jumpTo(pick.dataset.pick);
      }
      if (event.target.closest('[data-action="settings"]')) {
        ReviewUI.els.forYouSheet.close();
        ReviewUI.openSettings();
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
    ReviewUI.els.forYouBody.innerHTML = html`${this.tabs()}${content}`;
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
    if (judged < REVIEW.MIN_FOR_YOU) {
      return this.show(html`<p class="hint">Give at least ${REVIEW.MIN_FOR_YOU} films a thumb up or down first. So far: ${judged}.</p>`);
    }
    const top = Recommender.strongPicks(entries);
    const { great, fun } = this.without(Recommender.lanes(entries, REVIEW.FOR_YOU_PICKS), top);
    this.show(html`
      ${this.topLane(top, 'films')}
      ${this.lane('Great films for you', 'Close to your best-rated films, and well regarded', great, 'films')}
      ${this.lane('Fun picks', 'Your comfort zones, whatever the critics said', fun, 'films')}`);
    this.fillPosters([...top, ...great.slice(0, REVIEW.FOR_YOU_POSTERS), ...fun.slice(0, REVIEW.FOR_YOU_POSTERS)]);
  },

  async renderTv(seq) {
    if (!TMDB.hasKey()) {
      return this.show(html`
        <p class="hint">TV picks come from TMDB, which needs a free key.</p>
        <button type="button" class="button primary" data-action="settings">Open settings</button>`);
    }
    this.show(html`<p class="hint">Finding shows…</p>`);
    const entries = Ratings.all();
    let lanes, top, bridge = [];
    try {
      await TvRecs.refresh(entries);
      const graph = TvRecs.graph(entries);
      top = Recommender.strongPicks(entries, graph);
      lanes = this.without(Recommender.lanes(entries, REVIEW.FOR_YOU_PICKS, graph), top);
      if (TvRecs.ratedShows(entries) < TV_REC.BRIDGE_UNTIL_RATED) {
        const filmTaste = Taste.compute(entries.filter(e => e.type === 'movie'), {
          tagsOf: entry => Catalog.basics(entry.imdbID).tags
        });
        const shown = new Set([...top, ...lanes.great, ...lanes.fun].map(item => item.id));
        bridge = (await TvRecs.bridge(entries, filmTaste.tags))
          .filter(item => !shown.has(item.id)).slice(0, REVIEW.FOR_YOU_PICKS);
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
      ${rated > 0 ? this.topLane(top, 'tv') : ''}
      ${this.lane('Great shows for you', 'Recommended from your best-rated shows', lanes.great, 'tv')}
      ${this.lane('Fun picks', 'Shows like the ones you enjoy, whatever their score', lanes.fun, 'tv')}
      ${this.lane('From your film taste', 'Well-known shows with the themes you like in films. Fades out once you’ve rated 15 shows', bridge, 'themes')}`);
  },

  // Lanes leave out what Top picks already shows
  without({ great, fun }, top) {
    const shown = new Set(top.map(item => item.id));
    return { great: great.filter(item => !shown.has(item.id)), fun: fun.filter(item => !shown.has(item.id)) };
  },

  // Only strong picks, however few: a short list beats a padded one
  topLane(items, kind) {
    return html`
      <section class="lane top-picks">
        <h3>Top picks</h3>
        <p class="lane-note">In your top 1%, and close to at least three titles you liked</p>
        ${items.length
          ? html`<ul class="film-list">${items.map(item => this.row(item, kind, true))}</ul>`
          : html`<p class="hint">No standouts right now. Keep rating, and ❤️ your favourites: they count most.</p>`}
      </section>`;
  },

  // Want or Not interested from Top picks, without dealing the card. The
  // guess isn't saved: you saw it was a top pick before deciding.
  async decide(key, decision) {
    try {
      const info = await MovieInfo.fetch(key);
      if (!MovieInfo.isUsable(info, key)) return ReviewUI.toast('Couldn’t find that title');
      if (decision === 'want') {
        const entry = Ratings.get(info.imdbID);
        const unseen = entry && (entry.verdict === 'skip' || entry.verdict === 'pass');
        Ratings.update(info, unseen ? { want: true, verdict: '' } : { want: true });
        ReviewUI.toast(`Added ${info.title} to want to watch`, 'want');
      } else {
        Ratings.update(info, { verdict: 'pass', want: false });
        ReviewUI.toast(`Not interested in ${info.title}`, 'pass');
      }
      this.render();
    } catch (error) {
      ReviewUI.toast(`Couldn’t save that: ${error.message}`);
    }
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

  row(item, kind, actions = false) {
    const cached = MovieInfo.get(item.id);
    const poster = item.poster || (cached && cached.poster) || '';
    const why = item.because && item.because.length
      ? `${kind === 'themes' ? 'Your themes' : 'Because you liked'}: ${item.because.join(', ')}` : '';
    const crowd = kind === 'films'
      ? `${Math.round(item.likeRate * 100)}% liked`
      : typeof item.tmdbRating === 'number' ? `TMDB ${item.tmdbRating.toFixed(1)}` : '';
    return html`
      <li class="${actions ? 'with-actions' : ''}"><button type="button" class="film-row" data-pick="${item.id}">
        ${poster ? html`<img src="${poster}" alt="" loading="lazy">` : html`<span class="thumb"></span>`}
        <span class="film-text">
          <span class="film-title">${item.title}${item.year && ` (${item.year})`}</span>
          ${why && html`<span class="film-why">${why}</span>`}
        </span>
        ${crowd && html`<span class="film-crowd">${crowd}</span>`}
      </button>${actions && html`
        <span class="pick-actions">
          <button type="button" class="pick-action" data-decide="want" data-key="${item.id}" title="Want to watch" aria-label="Want to watch ${item.title}">${icon('want')}</button>
          <button type="button" class="pick-action" data-decide="pass" data-key="${item.id}" title="Not interested" aria-label="Not interested in ${item.title}">${icon('pass')}</button>
        </span>`}</li>`;
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
          const row = ReviewUI.els.forYouBody.querySelector(`[data-pick="${item.id}"] .thumb`);
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
