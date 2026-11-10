// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Save banner: a message that stays on screen. Toasts vanish; this doesn't.
//   - While your changes can't be saved (see Store.onProblem), with a Reload
//     button, until saving works again.
//   - For something you need to know that no save will put right, such as
//     titles the browser has cleared (hold): it stays until you dismiss it
//     or it's released, and a saving problem shows in its place meanwhile.
// ============================================================================

const SaveBanner = {
  el: null,
  problem: '',
  held: '',

  show(message) {
    this.problem = message;
    this.draw();
  },

  hide() {
    this.problem = '';
    this.draw();
  },

  hold(message) {
    this.held = message;
    this.draw();
  },

  release() {
    this.held = '';
    this.draw();
  },

  draw() {
    const message = this.problem || this.held;
    if (!this.el) {
      if (!message) return;
      this.el = document.createElement('div');
      this.el.className = 'save-banner';
      this.el.setAttribute('role', 'alert');
      const button = document.createElement('button');
      button.type = 'button';
      // Reload retries a save that's stuck; a held message is only dismissed
      button.addEventListener('click', () => (this.problem ? location.reload() : this.release()));
      this.el.append(document.createElement('span'), button);
      document.body.append(this.el);
    }
    this.el.firstChild.textContent = message;
    this.el.lastChild.textContent = this.problem ? 'Reload' : 'OK';
    this.el.hidden = !message;
  }
};

Store.onProblem = message => (message ? SaveBanner.show(message) : SaveBanner.hide());
