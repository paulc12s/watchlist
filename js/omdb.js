// ============================================================================
// OMDb requests, shared by every page
// Uses the app's own key, and falls back to the shared demo key if OMDb
// rejects it or its daily quota is used up. Once a key fails, the rest of the
// visit uses the next one, so each failure costs one extra request at most.
// ============================================================================

const OMDb = {
  keys: [CONFIG.API.OMDB_KEY, CONFIG.API.OMDB_FALLBACK_KEY].filter(Boolean),
  keyIndex: 0,

  // Resolves to OMDb's JSON (which may be { Response: 'False', Error }), or
  // throws on network errors, aborts and unexpected HTTP errors
  async fetch(params, { signal } = {}) {
    for (;;) {
      const index = this.keyIndex;
      const url = new URL(CONFIG.API.OMDB_URL);
      url.searchParams.set('apikey', this.keys[index]);
      for (const [name, value] of Object.entries(params)) {
        if (value) url.searchParams.set(name, value);
      }

      const response = await fetch(url, { signal });
      const data = await response.json().catch(() => null);
      if (this.isKeyProblem(response, data) && index < this.keys.length - 1) {
        // Other requests may already have moved on; never move back
        this.keyIndex = Math.max(this.keyIndex, index + 1);
        continue;
      }
      if (data && data.Response) return data;
      throw new Error(`HTTP ${response.status}`);
    }
  },

  isKeyProblem(response, data) {
    return response.status === 401 ||
      Boolean(data && data.Response === 'False' && /limit|api key/i.test(data.Error || ''));
  }
};
