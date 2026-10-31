// ============================================================================
// Ratings UI
// The card, its gestures and buttons, and the sheets (lists, notes, taste,
// settings). Everything rendered goes through html`` so film data from OMDb or
// an imported file can't inject markup.
// ============================================================================

const VERDICT_LABELS = {
  up: ['thumb-up', 'Liked'], down: ['thumb-down', 'Disliked'], skip: ['skip', 'Skipped']
};

// An icon from the sprite at the top of ratings.html
function icon(name, className = '') {
  return html`<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const RatingsUI = {
  els: {},
  renderSeq: 0,
  busy: false,
  toastTimer: null,

  init() {
    const ids = ['card', 'stage', 'categoryButton', 'categoryName', 'categoryProgress', 'nextCategory',
      'tasteButton', 'settingsButton', 'toast', 'categorySheet', 'categoryList', 'noteSheet', 'noteFilm',
      'noteText', 'noteSave', 'tasteSheet', 'tasteBody', 'settingsSheet', 'exportBackup', 'importButton',
      'importFile', 'exportWant', 'exportAI', 'clearSkips', 'tmdbKey', 'tmdbSave',
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
      this.toast('You’ve been through every list. Try “Show skipped titles again” in settings.');
      return;
    }
    const category = Catalog.get(id);
    if (category.media === 'tv') {
      if (!TMDB.hasKey()) {
        Feed.start(id);
        App.savePrefs();
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
    }
    Feed.start(id);
    App.savePrefs();
    if (announce) this.toast(category.name);
    this.advance();
  },

  updateHeader() {
    const category = Catalog.get(Feed.categoryId);
    const total = category.keys.length;
    this.els.categoryName.textContent = category.name;
    this.els.categoryProgress.textContent = `${total - Catalog.remaining(category.id)} / ${total}`;
  },

  openCategories() {
    const groups = [...Catalog.groups()].map(([group, categories]) => html`
      <section class="category-group">
        <h3>${group}</h3>
        ${categories.map(category => {
          const total = category.keys.length;
          const done = total - Catalog.remaining(category.id);
          const note = category.media === 'tv' && !TMDB.hasKey() ? 'Needs a TMDB key (Settings)' : category.note;
          return html`
            <button type="button" class="category-option ${category.id === Feed.categoryId ? 'current' : ''}" data-category="${category.id}">
              <span class="option-name">${category.name}</span>
              <span class="option-progress">${category.loaded ? `${done} / ${total}` : ''}</span>
              ${note && html`<span class="option-note">${note}</span>`}
            </button>`;
        })}
      </section>`);
    this.els.categoryList.innerHTML = html`${groups}`;
    this.els.categorySheet.showModal();
  },

  // ---- Cards ----------------------------------------------------------------

  // Deal the next film, moving to the next list when this one runs out
  advance() {
    const key = Feed.next();
    if (!key) {
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
    for (const key of Feed.upcoming(RATINGS.PREFETCH)) {
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
    const [statusIcon, statusText] = !entry ? [] : entry.verdict ? VERDICT_LABELS[entry.verdict] : entry.want ? ['want', 'Want to watch'] : [];

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
        <p class="meta">You’ve been through every list. Skipped films can come back from settings.</p>
      </div>`;
  },

  // A film opened from the taste sheet goes next in the trail
  jumpTo(imdbID) {
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
      {
        const guess = this.firstVerdict(info) ? Guesses.forCard(key, info) : null;
        Ratings.update(info, { verdict: action, ...(guess !== null ? { guessPct: guess } : {}) });
        this.reveal(key, action, guess);
      }
        await this.fly(action);
        return this.advance();
      case 'skip':
        if (Ratings.hasOpinion(info.imdbID) && !(entry && entry.verdict && entry.verdict !== 'skip')) {
          this.nudge();
          return this.toast('You’ve rated this one. Swipe right or left to save it.');
        }
        // Moving past a film already dealt with leaves its rating alone
        if (!Ratings.isDone(info.imdbID)) {
          const guess = this.firstVerdict(info) ? Guesses.forCard(key, info) : null;
          Ratings.update(info, { verdict: 'skip', ...(guess !== null ? { guessPct: guess } : {}) });
        }
        await this.fly('skip');
        return this.advance();
      case 'want': {
        const want = !(entry && entry.want);
        // Wanting a film you skipped earlier un-skips it
        Ratings.update(info, want && entry && entry.verdict === 'skip' ? { want, verdict: '' } : { want });
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
      const strength = Math.min(1, Math.abs(amount) / RATINGS.SWIPE_DISTANCE);
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
      const swiped = Math.abs(amount) > RATINGS.SWIPE_DISTANCE || Math.abs(amount) / elapsed > RATINGS.SWIPE_VELOCITY;
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
      if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const keys = {
        ArrowRight: 'up', ArrowLeft: 'down', ArrowUp: 'skip', ArrowDown: 'back',
        w: 'want', r: 'rewatch', n: 'note'
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
    if (record.total < RATINGS.MIN_GUESSES) return '';
    const pct = x => `${Math.round(x * 100)}%`;
    const top = Math.round((1 - RATINGS.GUESS_TOP) * 100);
    return html`
      <section class="lean guesses">
        <h3>How our guesses do</h3>
        <p class="hint">From ${record.total} cards where we made a guess before you swiped.</p>
        <ul>
          <li class="lean-row"><span class="lean-name">Ranked in your top ${top}%</span><span class="lean-count">${record.top.count}</span></li>
          <li class="guess-detail">Seen ${pct(record.top.seen)} · liked ${pct(record.top.liked)} of those seen</li>
          <li class="lean-row"><span class="lean-name">Everything else</span><span class="lean-count">${record.rest.count}</span></li>
          <li class="guess-detail">Seen ${pct(record.rest.seen)} · liked ${pct(record.rest.liked)} of those seen</li>
        </ul>
        <p class="hint">Good guesses show up as a higher seen and liked share in the top group.</p>
      </section>`;
  },

  crowdSection(crowd) {
    if (crowd.compared < RATINGS.MIN_PROFILE_FILMS) return '';
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
      skip: e => e.verdict === 'skip'
    };
    const films = Ratings.all()
      .filter(filters[tab])
      .sort((a, b) => (b.updatedDate || '').localeCompare(a.updatedDate || ''))
      .slice(0, 300);
    const tabs = [['up', 'thumb-up', counts.up, 'Liked'], ['down', 'thumb-down', counts.down, 'Disliked'],
      ['want', 'want', counts.want, 'Want to watch'], ['skip', 'skip', counts.skip, 'Skipped']];

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
    this.els.clearSkips.textContent = `Show skipped titles again (${Ratings.counts().skip})`;
    this.els.tmdbKey.value = TMDB.key;
    this.els.settingsSheet.showModal();
  },

  bindSettings() {
    this.els.settingsSheet.querySelectorAll('[data-order]').forEach(button => {
      button.addEventListener('click', () => {
        Feed.order = button.dataset.order;
        this.openSettings();
        Feed.start(Feed.categoryId);
        App.savePrefs();
        this.advance();
      });
    });

    this.els.tmdbSave.addEventListener('click', () => {
      TMDB.key = this.els.tmdbKey.value.trim();
      App.savePrefs();
      this.els.settingsSheet.close();
      this.toast(TMDB.key ? 'TMDB key saved on this device' : 'TMDB key removed', 'check');
      if (Catalog.isTv(Feed.categoryId)) this.switchCategory(Feed.categoryId, { announce: false });
    });

    const today = () => new Date().toISOString().split('T')[0];
    this.els.exportBackup.addEventListener('click', () => {
      this.download(`ratings-${today()}.json`, JSON.stringify(Ratings.backup(), null, 2));
    });
    this.els.exportWant.addEventListener('click', () => {
      const items = Ratings.watchlistItems();
      if (!items.length) return this.toast('Nothing rated or wanted yet');
      this.download(`for-watchlist-${today()}.json`, JSON.stringify(items, null, 2));
    });
    this.els.exportAI.addEventListener('click', async () => {
      const text = Ratings.aiProfile(this.computeTaste());
      try {
        await navigator.clipboard.writeText(text);
        this.toast('Copied. Paste it into Claude.', 'check');
      } catch (error) {
        this.download(`taste-profile-${today()}.md`, text, 'text/markdown');
      }
    });

    this.els.importButton.addEventListener('click', () => this.els.importFile.click());
    this.els.importFile.addEventListener('change', async () => {
      const file = this.els.importFile.files[0];
      this.els.importFile.value = '';
      if (!file) return;
      try {
        if (file.size > CONFIG.LIMITS.MAX_FILE_SIZE) throw new Error('File is too large');
        const { added, updated } = Ratings.import(JSON.parse(await file.text()));
        this.toast(added || updated ? `Imported: ${added} new, ${updated} updated` : 'Nothing new to import');
        this.els.settingsSheet.close();
        this.updateHeader();
      } catch (error) {
        this.toast(`Import failed: ${error instanceof SyntaxError ? 'not a JSON file' : error.message}`);
      }
    });

    this.els.clearSkips.addEventListener('click', () => {
      const count = Ratings.clearSkips();
      this.toast(count ? `${count} skipped title${count > 1 ? 's' : ''} will come round again` : 'Nothing skipped');
      this.els.settingsSheet.close();
      Feed.start(Feed.categoryId);
      this.updateHeader();
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
