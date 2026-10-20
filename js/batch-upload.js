// ============================================================================
// Batch Upload Tool
// Looks up a list of titles and produces a JSON file for the watchlist's Import.
// Search, sanitizing and item creation come from the shared js/ modules.
// ============================================================================

'use strict';

const batch = {
  items: [],
  selectedResult: null
};

const BatchUI = {
  titlesInput: document.getElementById('titles-input'),
  defaultPriority: document.getElementById('default-priority'),
  defaultTag: document.getElementById('default-tag'),
  defaultPlatform: document.getElementById('default-platform'),
  platformList: document.getElementById('platform-list'),
  processBtn: document.getElementById('process-btn'),
  progressSection: document.getElementById('progress-section'),
  progressText: document.getElementById('progress-text'),
  progressBar: document.getElementById('progress-bar'),
  log: document.getElementById('log'),
  resultsSection: document.getElementById('results-section'),
  summaryText: document.getElementById('summary-text'),
  resultsGrid: document.getElementById('results-grid'),
  resetBtn: document.getElementById('reset-btn'),
  exportBtn: document.getElementById('export-btn'),
  copyBtn: document.getElementById('copy-btn'),
  disambiguationModal: document.getElementById('disambiguation-modal'),
  modalHeader: document.getElementById('modal-header'),
  modalOptions: document.getElementById('modal-options'),
  modalSkip: document.getElementById('modal-skip'),
  modalSelect: document.getElementById('modal-select')
};

// Options come from the shared config so they match the main app
BatchUI.defaultPriority.innerHTML = html`${CONFIG.PRIORITIES.map(p =>
  html`<option value="${p}" ${p === 'medium' && 'selected'}>${CONFIG.PRIORITY_LABELS[p]}</option>`)}`;
BatchUI.platformList.innerHTML = html`${CONFIG.PLATFORMS.map(p => html`<option value="${p}">`)}`;

BatchUI.processBtn.addEventListener('click', () => processTitles());
BatchUI.resetBtn.addEventListener('click', () => reset());
BatchUI.exportBtn.addEventListener('click', () => exportJSON());
BatchUI.copyBtn.addEventListener('click', () => copyToClipboard());

BatchUI.resultsGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-small.delete');
  if (btn) removeItem(parseInt(btn.dataset.index, 10));
});

// Main Processing
async function processTitles() {
  const titles = BatchUI.titlesInput.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (titles.length === 0) {
    alert('Please enter at least one title');
    return;
  }

  batch.items = [];
  BatchUI.log.innerHTML = '';
  BatchUI.progressSection.classList.add('visible');
  BatchUI.resultsSection.classList.remove('visible');

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];

    BatchUI.progressText.textContent = `Processing ${i + 1} of ${titles.length}: ${title}`;
    BatchUI.progressBar.style.width = ((i / titles.length) * 100).toFixed(0) + '%';

    try {
      await processTitle(title);

      // Rate limiting delay
      if (i < titles.length - 1) {
        await delay(CONFIG.BATCH_DELAY_MS);
      }
    } catch (error) {
      addLog(`Error processing "${title}": ${error.message}`, 'error');
    }
  }

  BatchUI.progressBar.style.width = '100%';
  BatchUI.progressText.textContent = `Complete! Processed ${titles.length} titles.`;
  showResults();
}

async function processTitle(line) {
  // Only treat lines that look like YouTube links as videos; a bare 11-character
  // title like "Ratatouille" would otherwise pass for a video ID
  const videoID = /youtube\.com|youtu\.be/i.test(line) ? YouTubeAPI.extractVideoID(line) : null;

  if (videoID) {
    addItem({
      title: `YouTube Video (${videoID})`,
      type: 'youtube',
      youtubeID: videoID,
      poster: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`
    });
    addLog('✓ Added YouTube video (edit title after import)', 'success');
    return;
  }

  addLog(`Searching for: ${line}`, 'info');
  const { results } = await MovieAPI.search(line);

  if (results.length === 0) {
    addLog(`No results found for "${line}"`, 'warning');
    return;
  }

  let selected = results[0];
  if (results.length > 1) {
    addLog(`Multiple results found for "${line}"`, 'warning');
    selected = await disambiguate(line, results.slice(0, 10));
    if (!selected) {
      addLog(`Skipped: ${line}`, 'warning');
      return;
    }
  }

  const details = await MovieAPI.getDetails(selected.imdbID);
  if (details) {
    addItem(details);
  }
}

function addItem(details) {
  const item = ItemModel.create({
    ...details,
    priority: BatchUI.defaultPriority.value,
    tag: BatchUI.defaultTag.value.trim(),
    platform: details.type === 'youtube' ? 'YouTube' : BatchUI.defaultPlatform.value.trim()
  });

  if (!item) return;

  if (ItemModel.isDuplicate(item, ItemModel.keySet(batch.items))) {
    addLog(`Skipped duplicate: ${item.title}`, 'warning');
    return;
  }

  batch.items.push(item);
  if (item.type !== 'youtube') {
    addLog(`✓ Added: ${item.title}`, 'success');
  }
}

function disambiguate(title, results) {
  return new Promise((resolve) => {
    batch.selectedResult = null;
    BatchUI.modalHeader.textContent = `Multiple results found for "${title}"`;

    BatchUI.modalOptions.innerHTML = html`${results.map((result, index) => html`
      <div class="modal-option" data-index="${index}">
        ${result.poster
          ? html`<img src="${result.poster}" class="modal-option-poster" alt="${result.title}">`
          : html`<div class="modal-option-poster"></div>`}
        <div class="modal-option-info">
          <div class="modal-option-title">${result.title}</div>
          <div class="modal-option-meta">${result.year} • ${result.type === 'series' ? 'TV Series' : 'Movie'}</div>
        </div>
      </div>
    `)}`;

    const optionHandler = (e) => {
      const option = e.target.closest('.modal-option');
      if (!option) return;
      BatchUI.modalOptions.querySelectorAll('.modal-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      batch.selectedResult = results[parseInt(option.dataset.index, 10)];
      BatchUI.modalSelect.disabled = false;
    };

    const finish = (selected) => {
      BatchUI.disambiguationModal.classList.remove('visible');
      BatchUI.modalOptions.removeEventListener('click', optionHandler);
      BatchUI.modalSkip.removeEventListener('click', skipHandler);
      BatchUI.modalSelect.removeEventListener('click', selectHandler);
      resolve(selected);
    };
    const skipHandler = () => finish(null);
    const selectHandler = () => finish(batch.selectedResult);

    BatchUI.modalOptions.addEventListener('click', optionHandler);
    BatchUI.modalSkip.addEventListener('click', skipHandler);
    BatchUI.modalSelect.addEventListener('click', selectHandler);

    BatchUI.modalSelect.disabled = true;
    BatchUI.disambiguationModal.classList.add('visible');
  });
}

function showResults() {
  if (batch.items.length === 0) {
    BatchUI.summaryText.textContent = 'No items were added. Try different titles.';
    BatchUI.resultsGrid.innerHTML = '<p class="results-empty">No items to display</p>';
  } else {
    BatchUI.summaryText.textContent = `Successfully added ${batch.items.length} item${batch.items.length === 1 ? '' : 's'} to your watchlist`;
    renderResults();
  }

  BatchUI.resultsSection.classList.add('visible');
}

function renderResults() {
  BatchUI.resultsGrid.innerHTML = html`${batch.items.map((item, index) => {
    const isYoutube = item.type === 'youtube';
    const typeDisplay = isYoutube ? '📺 YouTube' : item.type === 'series' ? 'TV Series' : 'Movie';

    return html`
      <div class="result-item" data-index="${index}">
        ${item.poster && Security.isSafeUrl(item.poster)
          ? html`<img src="${item.poster}" class="result-poster" alt="${item.title}">`
          : html`<div class="result-poster"></div>`}
        <div class="result-info">
          <div class="result-title">${item.title}</div>
          <div class="result-meta">
            ${typeDisplay}
            ${isYoutube && item.duration && ` • ⏱ ${item.duration}`}
            ${!isYoutube && item.rating && ` • ⭐ ${item.rating}`}
            ${item.genre && ` • ${isYoutube ? item.genre : item.genre.split(',')[0]}`}
          </div>
          <div class="result-meta">
            Priority: ${CONFIG.PRIORITY_LABELS[item.priority] || item.priority}
            ${item.tag && ` • Tag: ${item.tag}`}
            ${item.platform && ` • ${item.platform}`}
          </div>
        </div>
        <div class="result-actions">
          <button class="btn-small delete" data-index="${index}">Remove</button>
        </div>
      </div>
    `;
  })}`;
}

function removeItem(index) {
  batch.items.splice(index, 1);
  renderResults();

  BatchUI.summaryText.textContent = batch.items.length === 0
    ? 'All items removed. Start over to add more.'
    : `${batch.items.length} item${batch.items.length === 1 ? '' : 's'} in your watchlist`;
}

// Same shape as the main app's export, so Import accepts it
function exportPayload() {
  return JSON.stringify({
    unwatched: batch.items,
    watched: [],
    exportDate: new Date().toISOString()
  }, null, 2);
}

function exportJSON() {
  if (batch.items.length === 0) {
    alert('No items to export');
    return;
  }

  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchlist-batch-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);

  addLog('✓ JSON file downloaded', 'success');
}

async function copyToClipboard() {
  if (batch.items.length === 0) {
    alert('No items to copy');
    return;
  }

  try {
    await navigator.clipboard.writeText(exportPayload());
    BatchUI.copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      BatchUI.copyBtn.textContent = 'Copy to Clipboard';
    }, 2000);
  } catch (error) {
    alert('Failed to copy to clipboard. Use Export JSON instead.');
  }
}

function reset() {
  batch.items = [];
  BatchUI.titlesInput.value = '';
  BatchUI.log.innerHTML = '';
  BatchUI.resultsGrid.innerHTML = '';
  BatchUI.progressSection.classList.remove('visible');
  BatchUI.resultsSection.classList.remove('visible');
  BatchUI.progressBar.style.width = '0%';
}

function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  BatchUI.log.appendChild(entry);
  BatchUI.log.scrollTop = BatchUI.log.scrollHeight;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
