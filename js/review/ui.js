// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Ratings UI
// The card, its gestures and buttons, and the sheets (lists, notes, taste,
// settings). Everything rendered goes through html`` so film data from OMDb or
// an imported file can't inject markup.
// ============================================================================

// The icon beside each verdict on the card (the words are Title.statusLabel's)
const VERDICT_ICONS = { up: 'thumb-up', down: 'thumb-down', skip: 'skip', pass: 'pass' };


const ReviewUI = {
  els: {},
  // The combined page pauses the feed's keyboard shortcuts outside review mode
  paused: false,
  renderSeq: 0,
  busy: false,
  toastTimer: null,

  init() {
    const ids = ['card', 'stage', 'categoryButton', 'categoryName', 'categoryProgress', 'nextCategory',
      'tasteButton', 'settingsButton', 'toast', 'categorySheet', 'categoryList', 'noteSheet', 'noteFilm',
      'noteText', 'noteSave', 'tasteSheet', 'tasteBody', 'settingsSheet', 'exportBackup', 'importButton',
      'importFile', 'importError', 'exportAI', 'tmdbKey', 'tmdbSave', 'omdbKey', 'omdbSave', 'omdbError',
      'forYouButton', 'forYouSheet', 'forYouBody'];
    ids.forEach(id => { this.els[id] = document.getElementById(id); });

    document.querySelectorAll('.actions [data-action]').forEach(button => {
      button.addEventListener('click', () => this.act(button.dataset.action));
    });
    this.els.card.addEventListener('click', event => {
      const target = event.target.closest('[data-action]');
      if (target) this.act(target.dataset.action, Number(target.dataset.value) || 0);
    });

    this.els.categoryButton.addEventListener('click', () => this.openCategories());
    this.els.nextCategory.addEventListener('click', () => this.switchCategory(Catalog.nextId(Feed.categoryId)));
    this.els.tasteButton.addEventListener('click', () => this.openTaste());
    this.els.forYouButton.addEventListener('click', () => ForYou.open());
    ForYou.bind();
    this.els.settingsButton.addEventListener('click', () => this.openSettings());
    this.bindTitleSearch();
    this.els.categoryList.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      this.els.categorySheet.close();
      this.switchCategory(button.dataset.category);
    });
    this.els.tasteBody.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) this.renderTaste(tab.dataset.tab);
      const film = event.target.closest('[data-film]');
      if (film) {
        this.els.tasteSheet.close();
        this.jumpTo(film.dataset.film);
      }
    });

    document.querySelectorAll('dialog [data-close]').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });
    document.querySelectorAll('dialog').forEach(dialog => {
      // Tapping the backdrop closes the sheet
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    });

    this.els.noteSave.addEventListener('click', () => this.saveNote());
    this.bindSettings();
    this.bindGestures();
    this.bindKeys();
  },

  toast(message, iconName = '') {
    clearTimeout(this.toastTimer);
    this.els.toast.innerHTML = html`${iconName && icon(iconName)}<span>${message}</span>`;
    this.els.toast.classList.add('show');
    this.toastTimer = setTimeout(() => this.els.toast.classList.remove('show'), 2600);
  },

  // ---- Lists ----------------------------------------------------------------

  async switchCategory(id, { announce = true } = {}) {
    if (!id) {
      this.toast('Every list is rated');
      return;
    }
    const category = Catalog.get(id);
    if (category.media === 'tv') {
      if (!TMDB.hasKey()) {
        Feed.start(id);
        ReviewApp.savePrefs();
        return this.renderMessage('Add a TMDB key to rate TV',
          'TV lists come from TMDB, which needs a free key. Get one at themoviedb.org, then add it in Settings.', true);
      }
      const seq = ++this.renderSeq;
      this.renderMessage(category.name, 'Loading shows…');
      try {
        await Catalog.prepare(id);
      } catch (error) {
        Feed.start(id);
        return this.renderMessage('Couldn’t load this list', error.message, /key/i.test(error.message));
      }
      if (seq !== this.renderSeq) return; // Another list was chosen meanwhile
    } else if (category.awards && !category.loaded) {
      const seq = ++this.renderSeq;
      this.renderMessage(category.name, 'Loading the list…');
      try {
        await Catalog.prepare(id);
      } catch (error) {
        return this.renderMessage('Couldn’t load this list', error.message);
      }
      if (seq !== this.renderSeq) return;
    }
    Feed.start(id);
    ReviewApp.savePrefs();
    // A list you pick yourself and have rated all of says so, rather than
    // quietly moving on to another list
    if (announce && Catalog.remaining(id) === 0) return this.renderFinished(category);
    if (announce) this.toast(category.name);
    this.advance();
  },

  renderFinished(category) {
    const nextId = Catalog.nextId(category.id);
    this.updateHeader();
    this.els.card.className = 'card empty';
    this.els.card.innerHTML = html`
      <div class="info">
        <h1 class="title">You’ve finished “${category.name}”</h1>
        <p class="meta">Every title in it is rated, passed on or on your list to watch.</p>
        ${nextId && html`<button type="button" class="button primary" data-action="next-list">Next list: ${Catalog.get(nextId).name}</button>`}
      </div>`;
  },

  // This pass is through, but titles you skipped are still to rate
  renderSkippedLeft(category, count) {
    const nextId = Catalog.nextId(category.id);
    this.updateHeader();
    this.els.card.className = 'card empty';
    this.els.card.innerHTML = html`
      <div class="info">
        <h1 class="title">Only skipped titles left</h1>
        <p class="meta">${count} title${count === 1 ? '' : 's'} in “${category.name}” ${count === 1 ? 'is' : 'are'} still to rate: ones you skipped.</p>
        <button type="button" class="button" data-action="go-again">Go through ${count === 1 ? 'it' : 'them'} again</button>
        ${nextId && nextId !== category.id && html`<button type="button" class="button primary" data-action="next-list">Next list: ${Catalog.get(nextId).name}</button>`}
      </div>`;
  },

  // On the combined page the feed starts the first time you open review mode
  feedStarted() {
    return Boolean(Feed.categoryId && Catalog.get(Feed.categoryId));
  },

  updateHeader() {
    if (!this.feedStarted()) return;
    const category = Catalog.get(Feed.categoryId);
    const total = category.keys.length;
    this.els.categoryName.textContent = category.name;
    const left = Catalog.remaining(category.id);
    this.els.categoryProgress.textContent = left ? `${left} of ${total} to rate` : `All ${total} rated`;
  },

  openCategories() {
    const groups = [...Catalog.groups()].map(([group, categories]) => html`
      <section class="category-group">
        <h3>${group}</h3>
        ${categories.map(category => {
          const total = category.keys.length;
          // Skipped titles count as still to rate
          const left = Catalog.remaining(category.id);
          const finished = category.loaded && total > 0 && left === 0;
          const note = category.media === 'tv' && !TMDB.hasKey() ? 'Needs a TMDB key (Settings)'
            : finished ? 'All rated' : category.note;
          return html`
            <button type="button" class="category-option ${category.id === Feed.categoryId ? 'current' : ''} ${finished ? 'finished' : ''}" data-category="${category.id}">
              <span class="option-name">${finished && icon('check', 'tiny')}${category.name}</span>
              <span class="option-progress">${category.loaded && !finished ? `${left} to rate` : ''}</span>
              ${note && html`<span class="option-note">${note}</span>`}
            </button>`;
        })}
      </section>`);
    this.els.categoryList.innerHTML = html`${groups}`;
    this.clearTitleSearch();
    this.els.categorySheet.showModal();
  },

  // ---- Finding one title (Choose a list → search) ---------------------------
  // Type a title (with a year, or an IMDb link) to rate one film or show
  // straight away. Suggestions (js/review/title-search.js: your titles,
  // recent and well-known ones, typos forgiven) show as you type; OMDb's
  // results follow once you pause. Enter or a tap deals the card next, and
  // the feed carries on from there.

  titleSearch: { searcher: null, rows: [] },

  bindTitleSearch() {
    const input = document.getElementById('titleSearch');
    const list = document.getElementById('titleSearchResults');
    if (!input || !list) return;
    this.titleSearch.searcher = TitleSearch.searcher(({ query, suggestions, results, state }) => {
      this.showTitleResults(query.length > 0);
      // Review rates films and shows; OMDb's other kinds stay out
      const kept = results.filter(r => r.type === 'movie' || r.type === 'series').slice(0, 12);
      if (query) this.renderTitleResults(query, suggestions, kept, state);
    });
    input.addEventListener('input', () => this.titleSearch.searcher.search(input.value));
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (this.titleSearch.rows.length) this.pickTitle(this.titleSearch.rows[0]);
    });
    list.addEventListener('click', event => {
      const row = event.target.closest('[data-found]');
      if (row) this.pickTitle(this.titleSearch.rows[Number(row.dataset.found)]);
    });
  },

  clearTitleSearch() {
    const input = document.getElementById('titleSearch');
    if (!input) return;
    input.value = '';
    this.titleSearch.searcher.cancel();
    this.showTitleResults(false);
  },

  // While searching, the results take the lists' place
  showTitleResults(searching) {
    document.getElementById('titleSearchResults').hidden = !searching;
    this.els.categoryList.hidden = searching;
  },

  // state: 'short' (keep typing), 'searching', 'done', or an error message
  renderTitleResults(query, suggestions, results, state) {
    this.titleSearch.rows = [...suggestions, ...results];
    const status = found => {
      const entry = TitleSearch.owned(found);
      return entry ? Title.statusLabel(entry) || 'In your titles' : '';
    };
    const row = (r, i) => {
      const mark = status(r);
      return html`
        <li><button type="button" class="film-row" data-found="${i}">
          ${r.poster ? html`<img src="${r.poster}" alt="" loading="lazy">` : html`<span class="thumb"></span>`}
          <span class="film-text">
            <span class="film-title">${r.title}${r.year && ` (${r.year})`}</span>
            <span class="film-why">${Title.TYPE_NAMES[r.type] || 'Film'}${mark && ` · ${mark}`}</span>
          </span>
        </button></li>`;
    };
    // With no results from OMDb, the suggestions are the best guess at what you meant
    const didYouMean = state === 'done' && !results.length && suggestions.length;
    const label = text => html`<li class="results-label">${text}</li>`;
    const note = text => html`<li class="hint">${text}</li>`;
    document.getElementById('titleSearchResults').innerHTML = html`
      ${suggestions.length > 0 && label(didYouMean ? 'Did you mean' : 'Suggestions')}
      ${suggestions.map(row)}
      ${results.length > 0 && label('More results')}
      ${results.map((r, i) => row(r, suggestions.length + i))}
      ${state === 'short' ? note('Keep typing to search everything…')
        : state === 'searching' ? note('Searching OMDb…')
          : state === 'done' ? (!suggestions.length && !results.length ? note(`Nothing found for “${query}”. Check the spelling, add the year, or paste an IMDb link.`) : '')
            : note(state)}`;
  },

  // A title you already have opens its sheet, as from +; anything else is
  // dealt as the next card
  async pickTitle(found) {
    if (!found) return;
    const openOwned = t => {
      this.els.categorySheet.close();
      this.clearTitleSearch();
      UI.openTitle(t);
    };
    const have = TitleSearch.owned(found);
    if (have) return openOwned(have);
    let imdbID = found.imdbID;
    if (!imdbID) {
      this.toast(`Finding ${found.title}…`);
      try {
        imdbID = await TitleSearch.resolve(found);
      } catch (error) {
        return this.toast(error.message);
      }
      if (!imdbID) return this.toast(`Couldn’t find ${found.title} on IMDb`);
      if (Library.byImdb(imdbID)) return openOwned(Library.byImdb(imdbID));
    }
    MovieInfo.expected.set(imdbID, found.type === 'series' ? 'series' : 'movie');
    this.els.categorySheet.close();
    this.clearTitleSearch();
    this.jumpTo(imdbID);
  },

  // ---- Cards ----------------------------------------------------------------

  // Deal the next film, moving to the next list when this one runs out
  advance() {
    const key = Feed.next();
    if (!key) {
      // Through this pass, with skipped titles still to rate: offer them again
      const left = Catalog.remaining(Feed.categoryId);
      if (left > 0) return this.renderSkippedLeft(Catalog.get(Feed.categoryId), left);
      const finished = Catalog.get(Feed.categoryId).name;
      const nextId = Catalog.nextId(Feed.categoryId);
      if (!nextId) {
        this.renderEmpty();
        return;
      }
      this.toast(`Finished “${finished}”. Now: ${Catalog.get(nextId).name}`);
      return this.switchCategory(nextId, { announce: false });
    }
    this.show(key);
  },

  async show(key) {
    const seq = ++this.renderSeq;
    this.updateHeader();
    if (!key) {
      this.renderEmpty();
      return;
    }

    const cached = MovieInfo.get(key);
    this.renderCard(key, MovieInfo.isUsable(cached, key) ? cached : null);
    this.prefetch();
    if (cached) {
      if (!MovieInfo.isUsable(cached, key)) this.passOver(key);
      return;
    }

    try {
      const info = await MovieInfo.fetch(key);
      if (seq !== this.renderSeq) return;
      if (!MovieInfo.isUsable(info, key)) {
        this.passOver(key);
        return;
      }
      this.renderCard(key, info);
    } catch (error) {
      if (seq !== this.renderSeq) return;
      this.renderError(key, error.message);
    }
  },

  // Series and films OMDb doesn't know quietly drop out
  passOver(key) {
    Feed.drop(key);
    this.advance();
  },

  prefetch() {
    for (const key of Feed.upcoming(REVIEW.PREFETCH)) {
      MovieInfo.fetch(key)
        .then(info => { if (info.poster) new Image().src = info.poster; })
        .catch(() => {});
    }
  },

  // info is null while OMDb details are loading
  renderCard(key, info) {
    const basics = Catalog.basics(key);
    const film = info || basics;
    const entry = info ? Ratings.get(info.imdbID) : null;
    const stars = entry ? entry.stars : 0;
    const meta = [film.year, info && info.runtime, film.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    const credit = info && info.type === 'series' ? 'Created by' : 'Dir.';
    const people = info ? [info.director && `${credit} ${info.director}`, info.actors].filter(Boolean).join(' · ') : '';
    const judged = entry && (entry.verdict === 'up' || entry.verdict === 'down');
    // The crowd's view stays hidden until you've given yours
    const crowd = !judged ? ''
      : basics.likeRate !== null ? `${Math.round(basics.likeRate * 100)}% of viewers liked it`
        : info && info.tmdbRating ? `TMDB ${info.tmdbRating}/10` : '';
    const statusText = entry ? Title.statusLabel(entry) : '';
    const statusIcon = entry && (Title.isLoved(entry) ? 'heart' : VERDICT_ICONS[entry.verdict] || 'want');

    this.els.card.className = `card${info ? '' : ' loading'}`;
    this.els.card.innerHTML = html`
      ${info && info.poster
        ? html`<img class="poster" src="${info.poster}" alt="" draggable="false">`
        : html`<div class="poster placeholder"><span>${film.title}</span></div>`}
      <div class="stamp stamp-up">${icon('thumb-up')}<span>Like</span></div>
      <div class="stamp stamp-down">${icon('thumb-down')}<span>Nope</span></div>
      <div class="stamp stamp-skip">${icon('skip')}<span>Skip</span></div>
      ${info && html`
        <div class="rail">
          <button type="button" class="rail-button ${entry && entry.want ? 'on' : ''}" data-action="want" aria-pressed="${Boolean(entry && entry.want)}" title="Want to watch (W)">
            ${icon('want')}<span class="rail-label">Want</span>
          </button>
          <button type="button" class="rail-button ${entry && entry.verdict === 'pass' ? 'on' : ''}" data-action="pass" aria-pressed="${Boolean(entry && entry.verdict === 'pass')}" title="Not interested (X)">
            ${icon('pass')}<span class="rail-label">Pass</span>
          </button>
          <button type="button" class="rail-button ${entry && entry.rewatch ? 'on' : ''}" data-action="rewatch" aria-pressed="${Boolean(entry && entry.rewatch)}" title="Would rewatch (R)">
            ${icon('rewatch')}<span class="rail-label">Rewatch</span>
          </button>
          <button type="button" class="rail-button ${entry && entry.review ? 'on' : ''}" data-action="note" title="Notes (N)">
            ${icon('note')}<span class="rail-label">Notes</span>
          </button>
        </div>`}
      <div class="info">
        ${statusText && html`
          <p class="status status-${entry.verdict || 'want'}">
            ${icon(statusIcon)}<span>${statusText}</span>${crowd && html`<span class="status-crowd">${crowd}</span>`}
          </p>`}
        <h1 class="title">${film.title}</h1>
        ${meta && html`<p class="meta">${meta}</p>`}
        ${basics.tags.length > 0 && html`<ul class="tags">${basics.tags.slice(0, 4).map(tag => html`<li>${tag}</li>`)}</ul>`}
        ${people && html`<p class="people">${people}</p>`}
        ${info && info.plot && html`<p class="plot">${info.plot}</p>`}
        ${entry && entry.review && html`<p class="review">“${entry.review}”</p>`}
        ${info && html`
          <div class="stars" role="group" aria-label="Stars">
            ${[1, 2, 3, 4, 5].map(n => html`
              <button type="button" class="star ${n <= stars ? 'on' : ''}" data-action="stars" data-value="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star')}</button>`)}
          </div>`}
      </div>`;
    this.els.card.style.transform = '';
  },

  renderError(key, message) {
    const { title } = Catalog.basics(key);
    this.els.card.className = 'card error';
    this.els.card.innerHTML = html`
      <div class="poster placeholder"><span>${title}</span></div>
      <div class="info">
        <h1 class="title">${title}</h1>
        <p class="meta">${message}</p>
        <button type="button" class="button primary" data-action="retry">Try again</button>
      </div>`;
  },

  // A card with a message instead of a film; optionally a button to Settings
  renderMessage(title, text, withSettings = false) {
    this.updateHeader();
    this.els.card.className = 'card empty';
    this.els.card.innerHTML = html`
      <div class="info">
        <h1 class="title">${title}</h1>
        <p class="meta">${text}</p>
        ${withSettings && html`<button type="button" class="button primary" data-action="settings">Open settings</button>`}
      </div>`;
  },

  renderEmpty() {
    this.updateHeader();
    this.els.card.className = 'card empty';
    this.els.card.innerHTML = html`
      <div class="info">
        <h1 class="title">That’s everything</h1>
        <p class="meta">Every title in every list is rated, passed on or on your list to watch.</p>
      </div>`;
  },

  // A title opened from the taste sheet, For you or the search goes next in the trail
  // You picked it, often after seeing it was a pick, so its guess isn't kept
  // (only titles the lists deal score the recommender honestly)
  chosen: new Set(),

  jumpTo(imdbID) {
    this.chosen.add(imdbID);
    Feed.trail.splice(Feed.index + 1, 0, imdbID);
    Feed.index++;
    this.show(imdbID);
  },

  // ---- Actions --------------------------------------------------------------

  currentInfo() {
    const key = Feed.current();
    const info = key && MovieInfo.get(key);
    return MovieInfo.isUsable(info, key) ? info : null;
  },

  async act(action, value) {
    if (this.busy) return;
    const key = Feed.current();
    if (action === 'settings') return this.openSettings();
    if (action === 'retry') return this.show(key);
    if (action === 'next-list') return this.switchCategory(Catalog.nextId(Feed.categoryId));
    if (action === 'go-again') {
      Feed.start(Feed.categoryId);
      return this.advance();
    }
    // A message card (finished list, missing key) has no title to rate: the
    // film behind it is the last one shown, which back returns to
    if (this.els.card.classList.contains('empty')) {
      if (action === 'back' && key) this.show(key);
      return;
    }
    if (action === 'back') {
      if (!Feed.back()) return this.toast('This is the first one');
      await this.fly('back');
      return this.show(Feed.current());
    }

    const info = this.currentInfo();
    if (!info) return; // Still loading

    const entry = Ratings.get(info.imdbID);
    switch (action) {
      case 'up':
      case 'down':
      case 'love': {
        const verdict = action === 'down' ? 'down' : 'up';
        const guess = this.judge(key, info, action === 'love' ? { verdict, stars: Title.LOVED_STARS } : { verdict });
        this.reveal(key, verdict, guess);
        await this.fly(verdict);
        return this.advance();
      }
      case 'skip':
        if (Ratings.hasOpinion(info.imdbID) && !(entry && Title.isSeen(entry))) return this.refuseSeen();
        // Moving past a film already dealt with leaves its rating alone
        if (!Ratings.isDone(info.imdbID)) this.judge(key, info, { verdict: 'skip' });
        await this.fly('skip');
        return this.advance();
      case 'pass': {
        // Not interested: you haven't seen it and don't want to
        if (Ratings.hasOpinion(info.imdbID) || Title.isSeen(entry)) return this.refuseSeen();
        const guess = this.judge(key, info, { verdict: 'pass', want: false });
        this.toast(guess ? `Not interested. We guessed ${Guesses.label(guess)}` : 'Not interested', 'pass');
        await this.fly('skip');
        return this.advance();
      }
      case 'want': {
        const want = !(entry && entry.want);
        // Wanting a film you skipped or passed on earlier takes that back
        const unseenVerdict = entry && (entry.verdict === 'skip' || entry.verdict === 'pass');
        Ratings.update(info, want && unseenVerdict ? { want, verdict: '' } : { want });
        if (!want) return this.renderCard(key, info);
        this.toast('Added to want to watch', 'want');
        await this.fly('skip');
        return this.advance();
      }
      case 'rewatch':
        Ratings.update(info, { rewatch: !(entry && entry.rewatch) });
        return this.renderCard(key, info);
      case 'stars':
        Ratings.setStars(info, value);
        return this.renderCard(key, info);
      case 'note':
        return this.openNote(info);
    }
  },

  // Saves a verdict from the card; a title's first verdict keeps the guess
  // made before it, to score the recommender honestly. Returns the guess.
  judge(key, info, changes) {
    const guess = this.firstVerdict(info) ? Guesses.forCard(key, info) : null;
    const scored = !this.chosen.has(key) && !this.chosen.has(info.imdbID);
    Ratings.update(info, { ...changes, ...(scored ? Guesses.saved(guess) : {}) });
    return guess;
  },

  // Not interested means unseen, so a title you've rated (or given stars or
  // rewatch, which mean seen) can't take it
  refuseSeen() {
    this.nudge();
    this.toast('You’ve rated this one. Swipe right or left to save it.');
  },

  // Only a title's first verdict is scored against the guess
  firstVerdict(info) {
    const entry = Ratings.get(info.imdbID);
    return !(entry && entry.verdict);
  },

  // After a thumb, reveal the recommender's guess and how the crowd saw it
  // (MovieLens viewers for films, TMDB's for TV)
  reveal(key, verdict, guess) {
    const { likeRate } = Catalog.basics(key);
    const info = MovieInfo.get(key);
    const parts = [];
    if (guess !== null) parts.push(`We guessed ${Guesses.label(guess)}`);
    if (likeRate !== null) {
      const minority = verdict === 'up' ? likeRate < 0.4 : likeRate > 0.6;
      parts.push(`${Math.round(likeRate * 100)}% of MovieLens viewers liked it${minority ? ', so you’re in the minority' : ''}`);
    } else if (info && info.tmdbRating) {
      parts.push(`TMDB viewers rate it ${info.tmdbRating}/10`);
    }
    if (parts.length) this.toast(parts.join('. '), verdict === 'up' ? 'thumb-up' : 'thumb-down');
  },

  // Animate the card off screen in the direction of the action
  fly(direction) {
    const card = this.els.card;
    this.busy = true;
    card.classList.remove('dragging');
    card.style.transform = '';
    card.classList.add(`fly-${direction}`);
    return new Promise(resolve => setTimeout(() => {
      card.classList.remove(`fly-${direction}`);
      card.classList.add('enter');
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('enter')));
      this.busy = false;
      resolve();
    }, 220));
  },

  nudge() {
    const card = this.els.card;
    card.classList.remove('nudge');
    void card.offsetWidth; // Restart the animation
    card.classList.add('nudge');
  },

  // ---- Gestures -------------------------------------------------------------

  bindGestures() {
    const card = this.els.card;
    let drag = null;

    card.addEventListener('pointerdown', event => {
      if (this.busy || event.button > 0 || event.target.closest('button, a, textarea')) return;
      drag = { x: event.clientX, y: event.clientY, t: performance.now(), axis: null, id: event.pointerId };
    });

    card.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        card.setPointerCapture(event.pointerId);
        card.classList.add('dragging');
      }
      const amount = drag.axis === 'x' ? dx : dy;
      const strength = Math.min(1, Math.abs(amount) / REVIEW.SWIPE_DISTANCE);
      card.style.transform = drag.axis === 'x'
        ? `translateX(${dx}px) rotate(${dx / 25}deg)`
        : `translateY(${dy}px)`;
      card.dataset.hint = drag.axis === 'x' ? (dx > 0 ? 'up' : 'down') : (dy < 0 ? 'skip' : 'back');
      card.style.setProperty('--hint', strength.toFixed(2));
    });

    const end = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const { axis } = drag;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const elapsed = Math.max(1, performance.now() - drag.t);
      drag = null;
      card.classList.remove('dragging');
      delete card.dataset.hint;
      card.style.removeProperty('--hint');
      if (!axis || event.type === 'pointercancel') {
        card.style.transform = '';
        return;
      }
      const amount = axis === 'x' ? dx : dy;
      const swiped = Math.abs(amount) > REVIEW.SWIPE_DISTANCE || Math.abs(amount) / elapsed > REVIEW.SWIPE_VELOCITY;
      if (!swiped) {
        card.style.transform = '';
        return;
      }
      if (axis === 'x') this.act(dx > 0 ? 'up' : 'down');
      else this.act(dy < 0 ? 'skip' : 'back');
      // Snap back if the action didn't go ahead (still loading, or refused)
      if (!this.busy) card.style.transform = '';
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  },

  bindKeys() {
    document.addEventListener('keydown', event => {
      if (this.paused || document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const keys = {
        ArrowRight: 'up', ArrowLeft: 'down', ArrowUp: 'skip', ArrowDown: 'back',
        w: 'want', r: 'rewatch', n: 'note', l: 'love', x: 'pass'
      };
      if (keys[event.key]) {
        event.preventDefault();
        this.act(keys[event.key]);
      } else if (/^[1-5]$/.test(event.key)) {
        this.act('stars', Number(event.key));
      }
    });
  },

  // ---- Notes ----------------------------------------------------------------

  openNote(info) {
    const entry = Ratings.get(info.imdbID);
    this.noteFor = info;
    this.els.noteFilm.textContent = `${info.title}${info.year ? ` (${info.year})` : ''}`;
    this.els.noteText.value = entry ? entry.review : '';
    this.els.noteSheet.showModal();
    this.els.noteText.focus();
  },

  saveNote() {
    const info = this.noteFor;
    if (!info) return;
    Ratings.update(info, { review: this.els.noteText.value });
    this.els.noteSheet.close();
    if (Feed.current() && MovieInfo.get(Feed.current()) === info) this.renderCard(Feed.current(), info);
    const entry = Ratings.get(info.imdbID);
    if (entry && !entry.verdict) this.toast('Saved. Swipe right or left to rate it.', 'check');
  },

  // ---- Taste ----------------------------------------------------------------

  computeTaste() {
    return Taste.compute(Ratings.all(), {
      tagsOf: entry => Catalog.basics(entry.imdbID).tags,
      crowdOf: entry => Catalog.basics(entry.imdbID).likeRate
    });
  },

  // How the recommender's guesses have held up against your verdicts
  guessSection() {
    const record = Guesses.record(Ratings.all());
    if (record.total < REVIEW.MIN_GUESSES) return '';
    const pct = x => `${Math.round(x * 100)}%`;
    const top = Math.round(REC.STRONG_SHARE * 100);
    const detail = group => `Seen ${pct(group.seen)} · liked ${pct(group.liked)} of those seen · not interested ${pct(group.passed)}`;
    return html`
      <section class="lean guesses">
        <h3>How our guesses do</h3>
        <p class="hint">From ${record.total} cards where we made a guess before you swiped.</p>
        <ul>
          <li class="lean-row"><span class="lean-name">Ranked in your top ${top}%</span><span class="lean-count">${record.top.count}</span></li>
          <li class="guess-detail">${detail(record.top)}</li>
          <li class="lean-row"><span class="lean-name">Everything else</span><span class="lean-count">${record.rest.count}</span></li>
          <li class="guess-detail">${detail(record.rest)}</li>
        </ul>
        <p class="hint">Good guesses show up as a higher seen and liked share in the top group.</p>
      </section>`;
  },

  crowdSection(crowd) {
    if (crowd.compared < REVIEW.MIN_PROFILE_FILMS) return '';
    const film = ({ entry, rate }) => html`
      <li class="lean-row">
        <span class="lean-name">${entry.title}${entry.year && ` (${entry.year})`}</span>
        <span class="lean-count">${Math.round(rate * 100)}%</span>
      </li>`;
    return html`
      <section class="lean crowd">
        <h3>You vs. the crowd</h3>
        <p class="hint">You agree with most MovieLens viewers on ${Math.round(100 * crowd.agree / crowd.compared)}% of ${crowd.compared} films. Percentages are the share of viewers who liked each film.</p>
        ${crowd.likedAgainst.length > 0 && html`<p class="lean-label">You liked, most didn’t</p><ul>${crowd.likedAgainst.map(film)}</ul>`}
        ${crowd.dislikedAgainst.length > 0 && html`<p class="lean-label">Most liked, you didn’t</p><ul>${crowd.dislikedAgainst.map(film)}</ul>`}
      </section>`;
  },

  openTaste() {
    this.renderTaste('up');
    this.els.tasteSheet.showModal();
  },

  renderTaste(tab) {
    const counts = Ratings.counts();
    const taste = this.computeTaste();
    const leaning = (title, rows) => {
      const likes = rows.filter(r => r.lift > 0.04).slice(0, 6);
      const dislikes = rows.filter(r => r.lift < -0.04).slice(-4).reverse();
      if (!likes.length && !dislikes.length) return '';
      const row = r => html`
        <li class="lean-row">
          <span class="lean-name">${r.name}</span>
          <span class="lean-bar"><span class="lean-fill ${r.lift > 0 ? 'pos' : 'neg'}" data-rate="${Math.round(r.rate * 100)}"></span></span>
          <span class="lean-count">${r.up}/${r.up + r.down}</span>
        </li>`;
      return html`
        <section class="lean">
          <h3>${title}</h3>
          ${likes.length > 0 && html`<p class="lean-label">You lean toward</p><ul>${likes.map(row)}</ul>`}
          ${dislikes.length > 0 && html`<p class="lean-label">You lean away from</p><ul>${dislikes.map(row)}</ul>`}
        </section>`;
    };

    const filters = {
      up: e => e.verdict === 'up',
      down: e => e.verdict === 'down',
      want: e => e.want,
      skip: e => e.verdict === 'skip',
      pass: e => e.verdict === 'pass'
    };
    const films = Ratings.all()
      .filter(filters[tab])
      .sort((a, b) => (b.updatedDate || '').localeCompare(a.updatedDate || ''))
      .slice(0, 300);
    const tabs = [['up', 'thumb-up', counts.up, 'Liked'], ['down', 'thumb-down', counts.down, 'Not for me'],
      ['want', 'want', counts.want, 'Want to watch'], ['pass', 'pass', counts.pass, 'Not interested'], ['skip', 'skip', counts.skip, 'Skipped']];

    this.els.tasteBody.innerHTML = html`
      ${taste.judged < 20
        ? html`<p class="hint">Rate at least 20 films with a thumb up or down for the profile to mean much. So far: ${taste.judged}. “Most watched” and “Love it or hate it” are the quickest lists for this.</p>`
        : html`<p class="hint">You like ${Math.round(taste.overall * 100)}% of the ${taste.judged} films you’ve rated. Bars show how often you liked each group; counts are likes out of films rated.</p>`}
      ${leaning('Genres', taste.genres)}
      ${leaning('Themes & style', taste.tags)}
      ${leaning('Decades', taste.decades)}
      ${leaning('Directors', taste.directors)}
      ${this.crowdSection(taste.crowd)}
      ${this.guessSection()}
      <section class="films">
        <div class="segmented" role="tablist">
          ${tabs.map(([id, iconName, count, label]) => html`
            <button type="button" role="tab" data-tab="${id}" aria-selected="${id === tab}" aria-label="${label}">${icon(iconName)}<span>${count}</span></button>`)}
        </div>
        ${films.length
          ? html`<ul class="film-list">${films.map(e => html`
              <li><button type="button" class="film-row" data-film="${e.imdbID}">
                ${e.poster ? html`<img src="${e.poster}" alt="" loading="lazy">` : html`<span class="thumb"></span>`}
                <span class="film-text">
                  <span class="film-title">${e.title}${e.year && ` (${e.year})`}</span>
                  <span class="film-meta">${e.stars > 0 && [...Array(e.stars)].map(() => icon('star', 'tiny filled'))}${e.rewatch && icon('rewatch', 'tiny')}${e.review && icon('note', 'tiny')}</span>
                </span>
              </button></li>`)}</ul>`
          : html`<p class="hint">Nothing here yet.</p>`}
      </section>`;

    // Bar widths are set here; the page's CSP doesn't allow inline style attributes
    this.els.tasteBody.querySelectorAll('.lean-fill').forEach(bar => {
      bar.style.width = `${bar.dataset.rate}%`;
    });
  },

  // ---- Settings -------------------------------------------------------------

  openSettings() {
    this.els.settingsSheet.querySelectorAll('[data-order]').forEach(button => {
      button.setAttribute('aria-checked', String(button.dataset.order === Feed.order));
    });
    this.els.tmdbKey.value = TMDB.key;
    this.els.omdbKey.value = OMDb.personalKey;
    this.els.omdbError.hidden = true;
    this.els.importError.hidden = true;
    this.els.settingsSheet.showModal();
  },

  // Checked with OMDb first, so a mistyped key isn't saved and then quietly
  // replaced by the demo key on every visit. Problems show in the sheet: a
  // toast would sit behind it
  async saveOmdbKey() {
    const key = this.els.omdbKey.value.trim();
    const button = this.els.omdbSave;
    const problem = message => {
      this.els.omdbError.textContent = message;
      this.els.omdbError.hidden = false;
    };
    this.els.omdbError.hidden = true;
    if (!key) {
      OMDb.setPersonalKey('');
      this.els.settingsSheet.close();
      this.toast('OMDb key removed: using the app’s key', 'check');
      return;
    }
    if (!OMDb.KEY_SHAPE.test(key)) {
      problem('An OMDb key is 8 characters, like 1a2b3c4d.');
      return;
    }
    button.disabled = true;
    try {
      const result = await OMDb.checkKey(key);
      if (result === 'rejected') {
        problem('OMDb didn’t accept that key. If it’s new, open the activation link in OMDb’s email first.');
        return;
      }
      OMDb.setPersonalKey(key);
      this.els.settingsSheet.close();
      this.toast(result === 'limit' ? 'OMDb key saved (its quota is used up for today)' : 'OMDb key saved on this device', 'check');
    } catch (error) {
      problem(`${error.message}, so the key wasn’t saved. Try again.`);
    } finally {
      button.disabled = false;
    }
  },

  bindSettings() {
    this.els.settingsSheet.querySelectorAll('[data-order]').forEach(button => {
      button.addEventListener('click', () => {
        Feed.order = button.dataset.order;
        this.openSettings();
        ReviewApp.savePrefs();
        if (!this.feedStarted()) return;
        Feed.start(Feed.categoryId);
        this.advance();
      });
    });

    this.els.tmdbSave.addEventListener('click', () => {
      TMDB.key = this.els.tmdbKey.value.trim();
      ReviewApp.savePrefs();
      TitleSearch.refreshRecent();
      this.els.settingsSheet.close();
      this.toast(TMDB.key ? 'TMDB key saved on this device' : 'TMDB key removed', 'check');
      if (this.feedStarted() && Catalog.isTv(Feed.categoryId)) this.switchCategory(Feed.categoryId, { announce: false });
    });

    this.els.omdbSave.addEventListener('click', () => this.saveOmdbKey());

    this.els.exportBackup.addEventListener('click', () => {
      const extra = AppSettings.included() ? { settings: AppSettings.collect() } : {};
      this.download(Library.fileName('titles'), Library.exportText('titles', extra));
    });
    this.els.exportAI.addEventListener('click', async () => {
      const text = Ratings.aiProfile(this.computeTaste());
      try {
        await navigator.clipboard.writeText(text);
        this.toast('Copied. Paste it into Claude.', 'check');
      } catch (error) {
        this.download(Library.fileName('taste-profile', 'md'), text, 'text/markdown');
      }
    });

    this.els.importButton.addEventListener('click', () => this.els.importFile.click());
    this.els.importFile.addEventListener('change', async () => {
      const file = this.els.importFile.files[0];
      this.els.importFile.value = '';
      if (!file) return;
      this.els.importError.hidden = true;
      try {
        if (file.size > CONFIG.LIMITS.MAX_FILE_SIZE) throw new Error('File is too large');
        const data = JSON.parse(await file.text());
        // A file of settings and no titles (an export from an empty app) still applies
        // Settings Include settings is off for are left alone
        const fileSettings = AppSettings.included() && data ? data.settings : undefined;
        const usable = AppSettings.clean(fileSettings).settings;
        const settingsOnly = data && data.app === 'titles' && Array.isArray(data.titles) && !data.titles.length &&
          Object.keys(usable).length > 0;
        const { added, updated } = settingsOnly ? { added: 0, updated: 0 } : Library.import(data);
        const { applied } = AppSettings.apply(fileSettings);
        const titles = added || updated ? `${added} new, ${updated} updated` : 'nothing new';
        this.toast(`Imported: ${titles}${applied.length ? `; ${applied.length} setting${applied.length === 1 ? '' : 's'} applied` : ''}`);
        this.els.settingsSheet.close();
        this.updateHeader();
      } catch (error) {
        // Shown in the sheet: a toast would sit behind the open dialog
        this.els.importError.textContent = `Import failed: ${error instanceof SyntaxError ? 'not a JSON file' : error.message}`;
        this.els.importError.hidden = false;
      }
    });

  },

  download(filename, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
