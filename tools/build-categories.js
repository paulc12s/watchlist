// Builds data/categories.json, the movie lists the ratings page deals cards from.
//
//   node tools/build-categories.js path/to/ml-32m
//
// Download and unzip https://files.grouplens.org/datasets/movielens/ml-32m.zip
// first. Films are ranked by a damped average rating, so a 4.3 from 40,000
// ratings beats a 4.8 from 30. The Oscar lists come from tools/oscars.json.
//
// Each film also gets the share of MovieLens raters who liked it (4+ stars)
// and its most-agreed user tags ("twist ending", "atmospheric"), which the
// ratings page uses to describe your taste.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PER_CATEGORY = 80;
// Ratings a film needs before its own average outweighs the global average
const DAMPING = 500;

const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Fantasy', 'Horror', 'Musical', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'
];
const GENRE_NAMES = { 'Sci-Fi': 'Science fiction', Children: 'Family' };

const TAGS_PER_FILM = 8;
// A tag counts for a film once this many people gave it, and is kept only if
// it describes enough films to say something about taste
const TAG_MIN_USERS = 3;
const TAG_MIN_FILMS = 8;
// Films with fewer ratings than this aren't worth reading tags for
const TAG_MIN_RATINGS = 100;

// MovieLens includes some TV series and miniseries; its raters flag them, and
// this many flags marks one as not a film
const SERIES_TAG = /^(not a movie|made for tv|tv ?series|tv show|tv mini-?series|mini-?series|tv)$/;
const SERIES_MIN_USERS = 2;

// Opinions, awards, list memberships and personal bookkeeping describe the
// tagger or the film's reputation, not the film
const TAG_STOP = new RegExp('^(' + [
  'imdb', 'afi', 'oscar', 'academy award', 'best ', 'golden globe', 'cannes', 'bafta', 'national film registry',
  '1001', 'top ', 'bd-r', 'dvd', 'vhs', 'clv', 'netflix', 'tivo', 'library', 'seen', 'watched', 'to see',
  'want to', 'own', 'my ', 'favou?rite', 'must see', 'nudity', 'sexuality', 'r$', 'pg', 'overrated',
  'underrated', 'boring', 'bad', 'good', 'great', 'excellent', 'awesome', 'amazing', 'masterpiece',
  'classic$', 'stupid', 'predictable', 'funny$', 'entertaining', 'enjoyable', 'fun$', 'disappointing',
  'over the top$', 'slow$', 'long$', 'too long', 'worst', 'terrible', 'waste', 'beautiful$',
  'not a movie', 'made for tv', 'tv', 'mini-?series'
].join('|') + ')');

// Spellings of the same idea, folded together
const TAG_SYNONYMS = {
  'plot twist': 'twist ending', 'twists & turns': 'twist ending', 'twist': 'twist ending',
  'dark humor': 'dark comedy', 'black comedy': 'dark comedy', 'dark humour': 'dark comedy',
  'based on a true story': 'true story', 'based on true story': 'true story',
  'based on book': 'based on a book', 'based on a novel': 'based on a book', 'based on novel': 'based on a book',
  'mindfuck': 'mind-bending', 'mind bending': 'mind-bending', 'thought provoking': 'thought-provoking',
  'visually stunning': 'visually appealing', 'beautiful cinematography': 'cinematography',
  'beautifully filmed': 'visually appealing', 'nonlinear': 'non-linear', 'sci fi': 'sci-fi', 'scifi': 'sci-fi',
  'satirical': 'satire', 'historical': 'history', 'philosophical': 'philosophy'
};

// Tags that just repeat a genre add nothing
const GENRE_TAGS = new Set([
  'action', 'adventure', 'animation', 'animated', 'comedy', 'crime', 'documentary', 'drama', 'fantasy',
  'horror', 'musical', 'mystery', 'romance', 'sci-fi', 'science fiction', 'thriller', 'war', 'western',
  'family', 'children', 'film-noir', 'film noir'
]);

// "Twist Ending (sort of)" -> 'twist ending'; null for tags to drop
function cleanTag(raw) {
  let tag = String(raw || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  tag = TAG_SYNONYMS[tag] || tag;
  if (tag.length < 3 || tag.length > 30 || TAG_STOP.test(tag) || GENRE_TAGS.has(tag)) return null;
  return tag;
}

// Split one CSV line; only movie titles are quoted, and they may contain commas
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(field); field = ''; }
    else field += char;
  }
  fields.push(field);
  return fields;
}

async function* csvRows(file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = true;
  for await (const line of lines) {
    if (header) { header = false; continue; }
    if (line) yield parseCsvLine(line);
  }
}

// "Fabelmans, The (2022)" -> { title: 'The Fabelmans', year: 2022 }
// "Lives of Others, The (Das leben der Anderen) (2006)" -> 'The Lives of Others'
function splitTitle(raw) {
  const match = raw.trim().match(/^(.*?)\s*\((\d{4})\)\s*$/);
  let title = match ? match[1] : raw.trim();
  // Alternate and original-language titles follow in parentheses
  title = title.replace(/^(.+?)(\s+\([^()]*\))+$/, '$1');
  const article = title.match(/^(.*), (The|A|An|Les|La|Le|L'|Il|Das|Der|Die|El)$/);
  if (article) title = `${article[2]}${article[2].endsWith("'") ? '' : ' '}${article[1]}`;
  return { title, year: match ? Number(match[2]) : null };
}

function normalizeTitle(title) {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function loadMovies(dir) {
  const movies = new Map();
  for await (const [movieId, rawTitle, genres] of csvRows(path.join(dir, 'movies.csv'))) {
    const { title, year } = splitTitle(rawTitle);
    movies.set(movieId, {
      title, year,
      genres: genres === '(no genres listed)' ? [] : genres.split('|').filter(g => g !== 'IMAX'),
      count: 0, likes: 0, sum: 0, sumSq: 0, tags: []
    });
  }
  for await (const [movieId, imdbId] of csvRows(path.join(dir, 'links.csv'))) {
    const movie = movies.get(movieId);
    if (movie && imdbId) movie.imdbID = `tt${imdbId.padStart(7, '0')}`;
  }
  return movies;
}

async function addRatings(dir, movies) {
  let total = 0;
  let sum = 0;
  for await (const [, movieId, rating] of csvRows(path.join(dir, 'ratings.csv'))) {
    const movie = movies.get(movieId);
    if (!movie) continue;
    const value = Number(rating);
    movie.count++;
    movie.sum += value;
    movie.sumSq += value * value;
    if (value >= 4) movie.likes++;
    total++;
    sum += value;
    if (total % 5e6 === 0) console.error(`  ${total / 1e6}M ratings`);
  }
  const globalMean = sum / total;
  for (const movie of movies.values()) {
    movie.score = (movie.sum + DAMPING * globalMean) / (movie.count + DAMPING);
    const mean = movie.count ? movie.sum / movie.count : 0;
    movie.spread = movie.count ? Math.sqrt(movie.sumSq / movie.count - mean * mean) : 0;
  }
}

// Also marks films as series (movie.series) when enough raters say so
async function addTags(dir, movies) {
  // film -> tag -> people who gave it
  const taggers = new Map();
  const seriesFlags = new Map();
  for await (const [userId, movieId, rawTag] of csvRows(path.join(dir, 'tags.csv'))) {
    const movie = movies.get(movieId);
    if (movie && SERIES_TAG.test(String(rawTag).toLowerCase().trim())) {
      if (!seriesFlags.has(movie)) seriesFlags.set(movie, new Set());
      seriesFlags.get(movie).add(userId);
    }
    const tag = movie && movie.count >= TAG_MIN_RATINGS && cleanTag(rawTag);
    if (!tag) continue;
    if (!taggers.has(movie)) taggers.set(movie, new Map());
    const byTag = taggers.get(movie);
    if (!byTag.has(tag)) byTag.set(tag, new Set());
    byTag.get(tag).add(userId);
  }

  const agreed = new Map();
  const filmsPerTag = new Map();
  for (const [movie, byTag] of taggers) {
    const tags = [...byTag].filter(([, people]) => people.size >= TAG_MIN_USERS)
      .map(([tag, people]) => [tag, people.size]);
    agreed.set(movie, tags);
    for (const [tag] of tags) filmsPerTag.set(tag, (filmsPerTag.get(tag) || 0) + 1);
  }
  for (const [movie, tags] of agreed) {
    movie.tags = tags
      .filter(([tag]) => filmsPerTag.get(tag) >= TAG_MIN_FILMS)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TAGS_PER_FILM)
      .map(([tag]) => tag);
  }
  for (const [movie, people] of seriesFlags) movie.series = people.size >= SERIES_MIN_USERS;
}

function top(films, { minCount = 1000, where = () => true, by = 'score', limit = PER_CATEGORY } = {}) {
  return films
    .filter(m => m.imdbID && m.year && !m.series && m.count >= minCount && where(m))
    .sort((a, b) => b[by] - a[by])
    .slice(0, limit);
}

function oscarCategories(films, oscars) {
  const byTitle = new Map();
  for (const film of films) {
    if (film.year) byTitle.set(`${normalizeTitle(film.title)}|${film.year}`, film);
  }
  return oscars.ceremonies.map(({ ceremony, year, films: filmYear, nominees }) => ({
    id: `oscars-${year}`,
    group: 'Oscars',
    name: `Best Picture nominees ${year}`,
    note: `${ceremony}th Academy Awards · ${nominees[0]} won`,
    ordered: true,
    films: nominees.map(title => {
      // Release dates straddle years, so allow a year either side
      const match = [0, -1, 1].map(d => byTitle.get(`${normalizeTitle(title)}|${filmYear + d}`)).find(Boolean);
      return match || { title, year: filmYear };
    })
  }));
}

function buildCategories(movies, oscars) {
  const films = [...movies.values()];
  const decades = [];
  for (let decade = 2020; decade >= 1930; decade -= 10) {
    decades.push({
      id: `decade-${decade}`, group: 'Decades', name: `Top films of the ${decade}s`,
      films: top(films, {
        minCount: decade >= 2020 ? 150 : decade < 1960 ? 300 : 1000,
        where: m => m.year >= decade && m.year < decade + 10
      })
    });
  }

  return [
    {
      id: 'popular', group: 'Start here', name: 'Most watched',
      note: 'Films most people have seen: the quickest way to build a profile',
      films: top(films, { by: 'count', minCount: 0 })
    },
    {
      id: 'divisive', group: 'Start here', name: 'Love it or hate it',
      note: 'Widely seen films people disagree about, which say a lot about taste',
      films: top(films, { by: 'spread', minCount: 8000 })
    },
    { id: 'top-rated', group: 'Start here', name: 'All-time top rated', films: top(films, { minCount: 5000 }) },
    {
      id: 'recent', group: 'Start here', name: 'Recent favorites',
      note: 'MovieLens ratings run to October 2023',
      films: top(films, { minCount: 150, where: m => m.year >= 2019 })
    },
    ...oscarCategories(films, oscars),
    ...decades,
    ...GENRES.map(genre => ({
      id: `genre-${genre.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      group: 'Genres',
      name: `Top ${(GENRE_NAMES[genre] || genre).toLowerCase()}`,
      films: top(films, { minCount: genre === 'Documentary' || genre === 'Western' ? 300 : 1000, where: m => m.genres.includes(genre) })
    })),
    {
      id: 'hidden-gems', group: 'Discover', name: 'Hidden gems',
      note: 'Highly rated by the few who saw them',
      films: top(films, { minCount: 300, where: m => m.count < 3000 })
    }
  ];
}

// Films are stored once and referenced by key, keeping the file small:
// [title, year, 'Genre|Genre', 'tag|tag', % of raters who liked it, number of ratings]
function serialize(categories) {
  const movies = {};
  const out = categories.map(({ films, ...category }) => ({
    ...category,
    keys: films.map(film => {
      const key = film.imdbID || `title:${film.title} (${film.year})`;
      movies[key] = film.imdbID
        ? [film.title, film.year, film.genres.join('|'), film.tags.join('|'),
          film.count ? Math.round(100 * film.likes / film.count) : null, film.count]
        : [film.title, film.year, ''];
      return key;
    })
  }));
  return {
    generated: new Date().toISOString().split('T')[0],
    source: 'MovieLens 32M (GroupLens Research, University of Minnesota), used under its license: non-commercial, no endorsement implied.',
    movies,
    categories: out
  };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node tools/build-categories.js path/to/ml-32m');
    process.exit(1);
  }
  console.error('Reading movies and links');
  const movies = await loadMovies(dir);
  console.error('Reading ratings');
  await addRatings(dir, movies);
  console.error('Reading tags');
  await addTags(dir, movies);

  const oscars = JSON.parse(fs.readFileSync(path.join(__dirname, 'oscars.json'), 'utf8'));
  const data = serialize(buildCategories(movies, oscars));
  const outFile = path.join(__dirname, '..', 'data', 'categories.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.error(`Wrote ${data.categories.length} categories, ${Object.keys(data.movies).length} films to ${outFile}`);
}

if (require.main === module) main();

module.exports = { parseCsvLine, splitTitle, normalizeTitle, cleanTag, csvRows, loadMovies, addRatings, addTags };
