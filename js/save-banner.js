// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Save banner: a message that stays on screen while your changes can't be
// saved (see Store.onProblem), with a Reload button. Toasts vanish; this
// doesn't, until saving works again.
// ============================================================================

const SaveBanner = {
  el: null,

  show(message) {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'save-banner';
      this.el.setAttribute('role', 'alert');
      const text = document.createElement('span');
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload';
      reload.addEventListener('click', () => location.reload());
      this.el.append(text, reload);
      document.body.append(this.el);
    }
    this.el.firstChild.textContent = message;
    this.el.hidden = false;
  },

  hide() {
    if (this.el) this.el.hidden = true;
  }
};

Store.onProblem = message => (message ? SaveBanner.show(message) : SaveBanner.hide());
