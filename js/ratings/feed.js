// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Feed
// Which film is on screen. Films are dealt from the current list's queue; the
// trail remembers what's been shown this visit so swiping down can go back,
// and forward again, across list changes.
// ============================================================================

const Feed = {
  categoryId: null,
  order: 'ranked',
  queue: [],
  trail: [],
  index: -1,
  // Where in the trail this pass through the list began: a title shown in
  // this pass (and skipped) isn't dealt again until the next pass
  round: 0,

  // Start dealing from a list; anything ahead in the trail is dropped
  start(categoryId) {
    this.categoryId = Catalog.get(categoryId).id;
    this.queue = Catalog.queue(this.categoryId, this.order);
    this.trail = this.trail.slice(0, this.index + 1);
    this.round = this.trail.length;
  },

  current() {
    return this.trail[this.index] || null;
  },

  // Next film: forward through the trail if we went back, else a new one.
  // Returns null when the list has nothing left.
  next() {
    if (this.index < this.trail.length - 1) {
      this.index++;
      return this.current();
    }
    while (this.queue.length) {
      const key = this.queue.shift();
      if (Catalog.isDone(key) || this.trail.indexOf(key, this.round) !== -1) continue;
      this.trail.push(key);
      this.index = this.trail.length - 1;
      return key;
    }
    return null;
  },

  back() {
    if (this.index <= 0) return null;
    this.index--;
    return this.current();
  },

  // Take a film out of the trail (OMDb says it's a series or can't find it)
  drop(key) {
    const at = this.trail.indexOf(key);
    if (at === -1) return;
    this.trail.splice(at, 1);
    if (this.index >= at) this.index--;
    if (this.round > at) this.round--;
  },

  // The next few films to be dealt, to fetch their details ahead of time
  upcoming(count) {
    const ahead = this.trail.slice(this.index + 1);
    for (const key of this.queue) {
      if (ahead.length >= count) break;
      if (!Catalog.isDone(key) && !ahead.includes(key)) ahead.push(key);
    }
    return ahead.slice(0, count);
  }
};
