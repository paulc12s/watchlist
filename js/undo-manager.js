// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Undo Manager
// ============================================================================

const UndoManager = {
  push(message, undoData) {
    state.undoStack.push({
      message: message,
      ...undoData
    });

    if (state.undoStack.length > 10) {
      state.undoStack.shift();
    }

    this.updateUI();
  },

  // Shows the latest undoable action for a few seconds; the stack itself is kept
  updateUI() {
    clearTimeout(this.hideTimer);

    const latest = state.undoStack[state.undoStack.length - 1];
    UI.elements.undoBar.classList.toggle('visible', Boolean(latest));
    if (!latest) return;

    UI.elements.undoMessage.textContent = latest.message;
    this.hideTimer = setTimeout(() => {
      UI.elements.undoBar.classList.remove('visible');
    }, CONFIG.UNDO_TIMEOUT);
  },

  undo() {
    if (state.undoStack.length === 0) return;

    const operation = state.undoStack.pop();
    const { type, data } = operation;

    if (type === 'edit') {
      const item = Library.get(data.id);
      if (item) {
        Object.assign(item, data.previous);
        Library.changed();
      }
    } else if (type === 'delete') {
      Library.restore(data.item, data.index);
    }

    UI.render();
    this.updateUI();
  }
};
