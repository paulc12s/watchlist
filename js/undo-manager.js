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

    if (type === 'toggle') {
      const item = state.items.find(i => i.id === data.id);
      if (item) {
        item.watched = data.previousWatched;
        item.reviewDate = data.previousReviewDate || '';
      }
    } else if (type === 'edit') {
      const item = state.items.find(i => i.id === data.id);
      if (item) {
        Object.assign(item, data.previousItem);
      }
    } else if (type === 'delete') {
      const insertIndex = Math.min(data.index, state.items.length);
      state.items.splice(insertIndex, 0, data.item);
    }

    ItemManager.scheduleSave();
    UI.render();
    this.updateUI();
  }
};
