// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// The tag field in the add and title sheets: each tag a chip, with suggestions
// as you type, for tags already in use and new ones
//
//   Enter, Tab, ,  the highlighted suggestion (a tag that starts with what you
//                  typed, otherwise a new tag)
//   Pasting        "a, b, c" adds all three, exactly as written
//   Right arrow    finishes the word to the suggestion shown in grey
//   Backspace      in an empty field picks the last chip, then removes it
//
// Typing never touches the titles or the page behind the sheet: the tags in
// use are read once when the sheet opens, a key only searches that short list
// and redraws the menu, and a chip is added or removed on its own. Nothing is
// stored until the sheet saves, through values().
//
// On a phone the keyboard leaves too little room for a whole sheet, so while
// the field has focus the sheet fits the space above the keyboard and shows
// only the title, the field, its suggestions and the button to save
// (.tag-focus in app.css). Scrolling can't do this: the title and the button
// can't both stay on screen.
// ============================================================================

const TagInput = {
  MAX_SUGGESTIONS: 8,

  // catalog: tags in use, most used first, as [{ label, key, count }]. Returns
  // { options, active }: options for the menu, best first, then a new tag if
  // what's typed isn't one already; active: which one Enter takes, or -1
  suggest(typed, catalog, chosen) {
    const query = Title.cleanLabel(String(typed).replace(/,/g, ' ')).toLowerCase();
    const available = catalog.filter(tag => !chosen.has(tag.key));
    if (!query) return { options: available.slice(0, this.MAX_SUGGESTIONS), active: -1 };
    // In order: the tag itself, tags starting with it, a later word starting
    // with it, then anywhere in the tag
    const ranked = [[], [], [], []];
    for (const tag of available) {
      if (tag.key === query) ranked[0].push(tag);
      else if (tag.key.startsWith(query)) ranked[1].push(tag);
      else if (tag.key.includes(` ${query}`)) ranked[2].push(tag);
      else if (tag.key.includes(query)) ranked[3].push(tag);
    }
    const options = ranked.flat().slice(0, this.MAX_SUGGESTIONS);
    const startsWith = ranked[0].length + ranked[1].length > 0;
    const exists = chosen.has(query) || catalog.some(tag => tag.key === query);
    if (!exists) options.push({ label: Title.cleanLabel(String(typed).replace(/,/g, ' ')), key: query, isNew: true });
    // A tag elsewhere in a word is only offered: Enter on "art" must not turn into "Martial arts"
    return { options, active: startsWith ? 0 : exists ? -1 : options.length - 1 };
  },

  create(root) {
    const field = Object.assign(Object.create(TagInput), {
      root, tags: [], chosen: new Set(), known: new Map(), catalog: [], options: [], active: -1
    });
    field.build();
    return field;
  },

  build() {
    const menuId = `${this.root.id}-menu`;
    this.root.innerHTML = html`
      <div class="tag-box" role="group" aria-label="Tags">
        <span class="tag-entry">
          <span class="tag-ghost" aria-hidden="true"><span class="tag-ghost-typed"></span><span class="tag-ghost-rest"></span></span>
          <input type="text" placeholder="Add a tag" aria-label="Add a tag" role="combobox" aria-autocomplete="list"
            aria-expanded="false" aria-controls="${menuId}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        </span>
        <button type="button" class="tag-done">Done</button>
      </div>
      <ul class="tag-menu" id="${menuId}" role="listbox" aria-label="Tag suggestions" hidden></ul>`;
    this.sheet = this.root.closest('dialog');
    this.sheetBody = this.root.closest('.sheet-body');
    this.box = this.root.querySelector('.tag-box');
    this.entry = this.root.querySelector('.tag-entry');
    this.input = this.root.querySelector('input');
    this.menu = this.root.querySelector('.tag-menu');
    this.ghostTyped = this.root.querySelector('.tag-ghost-typed');
    this.ghostRest = this.root.querySelector('.tag-ghost-rest');

    this.input.addEventListener('focus', () => {
      this.enterFocus();
      this.refresh();
    });
    this.input.addEventListener('blur', () => {
      this.closeMenu();
      // After the tap that took the focus has landed, so the layout doesn't
      // change under it
      clearTimeout(this.leaveTimer);
      this.leaveTimer = setTimeout(() => this.leaveFocus(), 200);
    });
    // Android keyboards compose every word: suggest throughout, act on commas after
    this.input.addEventListener('input', event => {
      if (event.isComposing) this.refresh();
      else this.typed();
    });
    this.input.addEventListener('compositionend', () => this.typed());
    this.input.addEventListener('keydown', event => this.keydown(event));

    this.box.addEventListener('click', event => {
      const remove = event.target.closest('.tag-remove');
      if (event.target.closest('.tag-done')) {
        this.accept();
        this.input.blur();
      } else if (remove) this.remove(remove.closest('.tag-chip'));
      else if (!event.target.closest('.tag-chip')) this.input.focus();
    });
    // Tapping these keeps the focus and the keyboard where they are
    this.box.addEventListener('mousedown', event => {
      if (event.target !== this.input && document.activeElement === this.input) event.preventDefault();
    });
    this.menu.addEventListener('mousedown', event => event.preventDefault());
    this.menu.addEventListener('click', event => {
      const option = event.target.closest('[data-index]');
      if (option) this.pick(this.options[Number(option.dataset.index)]);
    });
  },

  // A sheet opening: these tags, and the tags in use right now to suggest
  set(tags) {
    this.known = Library.labels('tag');
    this.catalog = [...this.known]
      .map(([key, { label, count }]) => ({ key, label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    this.box.querySelectorAll('.tag-chip').forEach(chip => chip.remove());
    this.tags = [];
    this.chosen = new Set();
    this.input.value = '';
    this.leaveFocus();
    this.add(tags);
    this.closeMenu();
    this.updateGhost();
  },

  // What the sheet saves: the chips, plus anything still typed in the field
  values() {
    this.commitTyped();
    return [...this.tags];
  },

  // Adds any tags from a list or comma-separated text, in their usual spelling
  add(value) {
    for (const tag of Title.parseTags(value)) {
      if (this.tags.length >= CONFIG.LIMITS.MAX_TAGS) break;
      const label = Library.labelName('tag', tag, this.known);
      const key = label.toLowerCase();
      if (this.chosen.has(key)) continue;
      this.tags.push(label);
      this.chosen.add(key);
      this.entry.insertAdjacentHTML('beforebegin', this.chipHTML(label, key));
    }
    this.entry.hidden = this.tags.length >= CONFIG.LIMITS.MAX_TAGS;
  },

  chipHTML(label, key) {
    const isNew = !this.known.has(key);
    return html`<span class="tag-chip ${isNew ? 'is-new' : ''}" data-key="${key}" title="${isNew ? 'New tag' : label}">
      <span class="tag-chip-name">${label}</span>${isNew && html`<span class="visually-hidden"> (new)</span>`}
      <button type="button" class="tag-remove" aria-label="Remove tag ${label}">${icon('close')}</button>
    </span>`;
  },

  remove(chip) {
    const key = chip.dataset.key;
    this.tags = this.tags.filter(tag => tag.toLowerCase() !== key);
    this.chosen.delete(key);
    chip.remove();
    this.entry.hidden = false;
    if (document.activeElement === this.input) this.refresh();
  },

  pick(option) {
    if (!option) return;
    this.add(option.label);
    this.input.value = '';
    this.refresh();
  },

  commitTyped() {
    if (!this.input.value.trim()) return;
    this.add(this.input.value);
    this.input.value = '';
  },

  // Enter's job, and a typed comma's: the highlighted suggestion, or what's typed
  accept() {
    if (this.options[this.active] && !this.menu.hidden) return this.pick(this.options[this.active]);
    this.commitTyped();
    this.refresh();
  },

  // A comma just typed after a word takes the highlighted suggestion, which
  // was worked out from that word. Commas within text (a paste) separate
  // tags, exactly as written; what follows the last one stays in the field
  typed() {
    this.disarm();
    const { value } = this.input;
    if (value.indexOf(',') === value.length - 1 && value) {
      this.input.value = value.slice(0, -1);
      return this.accept();
    }
    if (value.includes(',')) {
      const end = value.lastIndexOf(',');
      this.add(value.slice(0, end));
      this.input.value = value.slice(end + 1).trimStart();
    }
    this.refresh();
  },

  keydown(event) {
    if (event.isComposing) return;
    const { key } = event;
    if (key !== 'Backspace') this.disarm();
    if (key === 'Enter' || (key === 'Tab' && this.input.value.trim())) {
      // Enter never leaves the field or submits the sheet
      event.preventDefault();
      this.accept();
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (this.menu.hidden) this.openMenu();
      else this.moveActive(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'ArrowRight') {
      const atEnd = this.input.selectionStart === this.input.value.length;
      if (atEnd && this.ghostRest.textContent) {
        event.preventDefault();
        this.input.value += this.ghostRest.textContent;
        this.refresh();
      }
    } else if (key === 'Escape' && !this.menu.hidden) {
      // Closes the menu, not the sheet
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu();
    } else if (key === 'Backspace' && !this.input.value && !event.repeat) {
      const chip = this.entry.previousElementSibling;
      if (!chip) return;
      if (chip.classList.contains('armed')) this.remove(chip);
      else chip.classList.add('armed');
    }
  },

  disarm() {
    const chip = this.entry.previousElementSibling;
    if (chip) chip.classList.remove('armed');
  },

  // ---- Fitting above a phone's keyboard ----------------------------------------

  enterFocus() {
    clearTimeout(this.leaveTimer);
    if (this.focused || !window.matchMedia('(pointer: coarse)').matches) return;
    this.focused = true;
    this.scrolled = this.sheetBody.scrollTop;
    this.sheet.classList.add('tag-focus');
    this.sheetBody.scrollTop = 0;
    this.fit();
    if (!window.visualViewport) return;
    this.fitter = () => this.fit();
    window.visualViewport.addEventListener('resize', this.fitter);
    window.visualViewport.addEventListener('scroll', this.fitter);
  },

  // The space the keyboard leaves
  fit() {
    const view = window.visualViewport;
    if (!view) return;
    this.sheet.style.setProperty('--visible-top', `${view.offsetTop}px`);
    this.sheet.style.setProperty('--visible-height', `${view.height}px`);
  },

  leaveFocus() {
    clearTimeout(this.leaveTimer);
    if (!this.focused) return;
    this.focused = false;
    if (this.fitter) {
      window.visualViewport.removeEventListener('resize', this.fitter);
      window.visualViewport.removeEventListener('scroll', this.fitter);
    }
    this.sheet.classList.remove('tag-focus');
    this.sheetBody.scrollTop = this.scrolled;
    // The app never scrolls the page itself; undo any shift iOS made for the keyboard
    window.scrollTo(0, 0);
  },

  // ---- The menu ---------------------------------------------------------------

  refresh() {
    const { options, active } = this.suggest(this.input.value, this.catalog, this.chosen);
    this.options = options;
    this.active = active;
    this.menu.innerHTML = html`${options.map((option, index) => html`
      <li class="tag-option ${option.isNew ? 'is-new' : ''}" role="option" id="${this.root.id}-option-${index}" data-index="${index}" aria-selected="false">
        ${option.isNew && icon('plus', 'tiny')}
        <span class="tag-option-name">${option.isNew ? `New tag “${option.label}”` : option.label}</span>
        ${!option.isNew && html`<span class="count">${option.count}</span>`}
      </li>`)}`;
    if (document.activeElement === this.input && options.length) this.openMenu();
    else this.closeMenu();
    this.showActive();
  },

  openMenu() {
    if (!this.options.length) return;
    const opening = this.menu.hidden;
    this.menu.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.showActive();
    if (!opening) return;
    if (!this.focused) this.menu.scrollIntoView({ block: 'nearest' });
  },

  closeMenu() {
    this.menu.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.updateGhost();
  },

  // Round the options, passing through "none" so Enter can keep what's typed
  moveActive(step) {
    const stops = this.options.length + 1;
    this.active = (this.active + 1 + step + stops) % stops - 1;
    this.showActive();
    if (this.active >= 0) this.menu.children[this.active].scrollIntoView({ block: 'nearest' });
  },

  showActive() {
    [...this.menu.children].forEach((row, index) => row.setAttribute('aria-selected', String(index === this.active)));
    if (this.active >= 0 && !this.menu.hidden) this.input.setAttribute('aria-activedescendant', `${this.root.id}-option-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
    this.updateGhost();
  },

  // The rest of the highlighted tag, in grey behind what's typed
  updateGhost() {
    const { value } = this.input;
    const option = this.menu.hidden ? null : this.options[this.active];
    const fits = value && option && !option.isNew && option.label.toLowerCase().startsWith(value.toLowerCase());
    this.ghostTyped.textContent = fits ? value : '';
    this.ghostRest.textContent = fits ? option.label.slice(value.length) : '';
  }
};
