const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;

require('dotenv').config();  

const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
if (!GENIUS_ACCESS_TOKEN) {
  console.error("Genius access token is not set. Please replace 'GENIUS_ACCESS_TOKEN' with your actual token.");
  process.exit(1);
}

app.use(express.static('public'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'api', 'views'));
app.use(express.urlencoded({ extended: true }));


app.get('/', (req, res) => {
  res.render('index', { results: null, error: null });
});

// lyrics cleaner
function cleanLyrics($) {
  try {
    const lyricsContainer = $('[data-lyrics-container="true"]');
    if (!lyricsContainer || lyricsContainer.length === 0) {
      console.warn("Lyrics container not found.");
      return 'Lyrics not found.';
    }

    const cleanChunks = [];

    lyricsContainer.each((i, el) => {
      const children = $(el).contents();

      children.each((j, child) => {
        const isMetadata = $(child).attr && $(child).attr('data-exclude-from-selection');
        if (!isMetadata) {
          const text = $(child).text ? $(child).text().trim() : $(child).toString().trim();
          if (text.length > 0) cleanChunks.push(text);
        }
      });
    });

    if (cleanChunks.length === 0) {
      console.warn("No lyric lines extracted.");
      return 'Lyrics not found.';
    }

    return cleanChunks
      .join('\n')
      .replace(/\n{2,}/g, '\n\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  } catch (err) {
    console.error("cleanLyrics failed:", err.message);
    return 'Lyrics not found due to error.';
  }
}


app.post('/search', async (req, res) => {
  const lyrics = req.body.lyrics;

  try {
    const geniusRes = await axios.get('https://api.genius.com/search', {
      params: { q: lyrics },
      headers: { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` },
    });

    let hits = geniusRes.data.response.hits;

    if (!hits || hits.length === 0) {
      return res.render('index', { results: null, error: "No matching songs found." });
    }

    // Improved ranking logic
    const queryLower = lyrics.toLowerCase();
    hits = hits.sort((a, b) => {
      const sa = a.result;
      const sb = b.result;

      // 1. Artist match boost (if artist name is in query)
      const aArtistMatch = queryLower.includes(sa.primary_artist.name.toLowerCase()) ? 1 : 0;
      const bArtistMatch = queryLower.includes(sb.primary_artist.name.toLowerCase()) ? 1 : 0;
      if (aArtistMatch !== bArtistMatch) return bArtistMatch - aArtistMatch;

      // 2. Title/full_title match boost (if title or full_title is in query)
      const aTitleMatch = queryLower.includes(sa.title.toLowerCase()) || queryLower.includes(sa.full_title.toLowerCase()) ? 1 : 0;
      const bTitleMatch = queryLower.includes(sb.title.toLowerCase()) || queryLower.includes(sb.full_title.toLowerCase()) ? 1 : 0;
      if (aTitleMatch !== bTitleMatch) return bTitleMatch - aTitleMatch;

      // 3. Older first (lower year, month, day)
      const aYear = sa.release_date_components?.year || 9999;
      const bYear = sb.release_date_components?.year || 9999;
      if (aYear !== bYear) return aYear - bYear;
      const aMonth = sa.release_date_components?.month || 99;
      const bMonth = sb.release_date_components?.month || 99;
      if (aMonth !== bMonth) return aMonth - bMonth;
      const aDay = sa.release_date_components?.day || 99;
      const bDay = sb.release_date_components?.day || 99;
      if (aDay !== bDay) return aDay - bDay;

      // 4. Annotation count (more = better)
      const aAnn = sa.annotation_count || 0;
      const bAnn = sb.annotation_count || 0;
      if (aAnn !== bAnn) return bAnn - aAnn;

      // Default: keep original order
      return 0;
    });

    const results = await Promise.all(
      hits.map(async (hit, index) => {
        const song = hit.result;
        const query = `${song.title} ${song.primary_artist.name}`;

        let videoId = null;
        try {
          const ytSearchModule = await import('youtube-search-without-api-key');
          const ytSearch = ytSearchModule.search || ytSearchModule.default?.search;
          if (!ytSearch) throw new Error('ytSearch function not found in module');
          const videos = await ytSearch(query);
          videoId = videos?.[0]?.id?.videoId || null;
        } catch (err) {
          console.error("YouTube search failed:", err.message);
        }

        let lyricsText = 'Lyrics not found.';
        try {
          const pageRes = await axios.get(song.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          const $ = cheerio.load(pageRes.data);
          lyricsText = cleanLyrics($);
        } catch (err) {
          console.error('Failed to fetch or clean lyrics:', err.message);
        }

        return {
          rank: index + 1,
          title: song.title,
          artist: song.primary_artist.name,
          videoId,
          lyricsText,
        };
      })
    );

    res.render('index', { results, error: null });

  } catch (error) {
    console.error(error);
    res.render('index', { results: null, error: "Error fetching data from Genius or YouTube. Possible causes: Invalid API tokens, no internet connection, or service unavailable." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
