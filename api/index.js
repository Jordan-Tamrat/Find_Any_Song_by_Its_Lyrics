const express = require('express');
const serverless = require('serverless-http');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
require('dotenv').config();

const app = express();

const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
if (!GENIUS_ACCESS_TOKEN) {
  console.error("Genius access token is not set. Please set GENIUS_ACCESS_TOKEN as an environment variable in Vercel.");
}

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index', { results: null, error: null });
});

function cleanLyrics($) {
  try {
    const lyricsContainer = $('[data-lyrics-container="true"]');
    if (!lyricsContainer || lyricsContainer.length === 0) {
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
    const queryLower = lyrics.toLowerCase();
    hits = hits.sort((a, b) => {
      const sa = a.result;
      const sb = b.result;
      const aArtistMatch = queryLower.includes(sa.primary_artist.name.toLowerCase()) ? 1 : 0;
      const bArtistMatch = queryLower.includes(sb.primary_artist.name.toLowerCase()) ? 1 : 0;
      if (aArtistMatch !== bArtistMatch) return bArtistMatch - aArtistMatch;
      const aTitleMatch = queryLower.includes(sa.title.toLowerCase()) || queryLower.includes(sa.full_title.toLowerCase()) ? 1 : 0;
      const bTitleMatch = queryLower.includes(sb.title.toLowerCase()) || queryLower.includes(sb.full_title.toLowerCase()) ? 1 : 0;
      if (aTitleMatch !== bTitleMatch) return bTitleMatch - aTitleMatch;
      const aYear = sa.release_date_components?.year || 9999;
      const bYear = sb.release_date_components?.year || 9999;
      if (aYear !== bYear) return aYear - bYear;
      const aMonth = sa.release_date_components?.month || 99;
      const bMonth = sb.release_date_components?.month || 99;
      if (aMonth !== bMonth) return aMonth - bMonth;
      const aDay = sa.release_date_components?.day || 99;
      const bDay = sb.release_date_components?.day || 99;
      if (aDay !== bDay) return aDay - bDay;
      const aAnn = sa.annotation_count || 0;
      const bAnn = sb.annotation_count || 0;
      if (aAnn !== bAnn) return bAnn - aAnn;
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
          // YouTube search failed
        }
        let lyricsText = 'Lyrics not found.';
        try {
          const pageRes = await axios.get(song.url);
          const $ = cheerio.load(pageRes.data);
          lyricsText = cleanLyrics($);
        } catch (err) {
          // Failed to fetch or clean lyrics
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
    res.render('index', { results: null, error: "Error fetching data from Genius or YouTube. Possible causes: Invalid API tokens, no internet connection, or service unavailable." });
  }
});

module.exports = serverless(app); 