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

  updateUI() {
    UI.elements.undoBar.classList.toggle('visible', state.undoStack.length > 0);
  },

  undo() {
    if (state.undoStack.length === 0) return;

    const operation = state.undoStack.pop();
    const { type, data } = operation;

    if (type === 'toggle') {
      const item = state.items.find(i => i.id === data.id);
      if (item) {
        item.watched = data.previousWatched;
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
