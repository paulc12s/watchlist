// ============================================================================
// Movie Search API
// ============================================================================

const MovieAPI = {
  async search(query) {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const url = `${CONFIG.API.OMDB_URL}?apikey=${CONFIG.API.OMDB_KEY}&s=${encodeURIComponent(query)}`;

      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'default'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.Response === 'True' && Array.isArray(data.Search)) {
        return data.Search.map(item => ({
          imdbID: item.imdbID || '',
          title: item.Title || 'Unknown',
          year: item.Year || '',
          type: this.normalizeType(item.Type),
          poster: item.Poster !== 'N/A' ? item.Poster : ''
        })).filter(item => item.imdbID); // Filter out items without ID
      }

      if (data.Response === 'False' && data.Error) {
        console.warn('API error:', data.Error);
      }

      return [];
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('Search timeout:', error);
        throw new Error('Search timed out. Please try again.');
      }
      console.error('Search error:', error);
      throw new Error('Search failed. Check your internet connection.');
    }
  },

  normalizeType(omdbType) {
    // OMDb returns: "movie", "series", "episode", "game"
    const type = (omdbType || '').toLowerCase();

    if (type === 'series' || type === 'episode') {
      return 'series';
    }

    // Default to movie for "movie", "game", or unknown types
    return 'movie';
  },

  async getDetails(imdbID) {
    if (!imdbID) {
      throw new Error('Invalid IMDB ID');
    }

    try {
      const url = `${CONFIG.API.OMDB_URL}?apikey=${CONFIG.API.OMDB_KEY}&i=${encodeURIComponent(imdbID)}&plot=short`;

      // Add timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'default'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.Response === 'True') {
        return {
          imdbID: data.imdbID || imdbID,
          title: data.Title || 'Unknown',
          type: this.normalizeType(data.Type),
          year: data.Year || '',
          genre: data.Genre !== 'N/A' ? data.Genre : '',
          rating: data.imdbRating !== 'N/A' ? data.imdbRating : '',
          plot: data.Plot !== 'N/A' ? data.Plot : '',
          poster: data.Poster !== 'N/A' ? data.Poster : ''
        };
      }

      if (data.Response === 'False' && data.Error) {
        console.warn('API error:', data.Error);
      }

      return null;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('Details timeout:', error);
        throw new Error('Request timed out. Please try again.');
      }
      console.error('Details error:', error);
      throw new Error('Failed to load details. Check your internet connection.');
    }
  }
};
