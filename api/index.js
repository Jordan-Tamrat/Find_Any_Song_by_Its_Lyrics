const express = require('express');
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
    console.log('[search] query="' + lyrics + '"');
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
        console.log(`[song] #${index + 1} ${song.full_title || song.title} → ${song.url}`);
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
          const pageRes = await axios.get(song.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          console.log(`[lyrics] primary OK size=${(pageRes.data||'').length}`);
          const $ = cheerio.load(pageRes.data);
          lyricsText = cleanLyrics($);
        } catch (err) {
          const status = err?.response?.status;
          console.log(`[lyrics] primary FAIL status=${status} msg=${err?.message}`);
          // ignore; will try mirror fallback below
        }

        // Fallback: text-render mirror (helps when Genius blocks serverless IPs)
        if (!lyricsText || lyricsText === 'Lyrics not found.' || lyricsText.length < 40) {
          try {
            const mirrorUrl = `https://r.jina.ai/http://${song.url.replace(/^https?:\/\//, '')}`;
            const mirrorRes = await axios.get(mirrorUrl, { responseType: 'text' });
            const fullText = (mirrorRes.data || '').replace(/\r/g, '').trim();
            console.log(`[lyrics] mirror OK len=${fullText.length}`);

            // 1) If "Embed" exists, trim anything after it
            let uptoEmbed = fullText.split(/\n?\s*Embed\s*$/i)[0] || fullText;

            // 2) Remove leading header lines until we hit a likely lyric section
            const lines = uptoEmbed.split('\n');
            const startIndex = lines.findIndex(l => /\[(Verse|Chorus|Bridge|Intro|Outro)\b/i.test(l) || l.trim().length > 20);
            let cleaned = (startIndex >= 0 ? lines.slice(startIndex) : lines).join('\n').trim();

            // 3) If still too short, keep the original mirror text
            if (cleaned.length < 40) cleaned = fullText;

            lyricsText = cleaned || lyricsText;
          } catch (e) {
            console.log('[lyrics] mirror FAIL', e?.message);
            // keep previous lyricsText
          }
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
    console.log('[search] done results=' + results.length);
    res.render('index', { results, error: null });
  } catch (error) {
    console.log('[search] error', error?.message);
    res.render('index', { results: null, error: "Error fetching data from Genius or YouTube. Possible causes: Invalid API tokens, no internet connection, or service unavailable." });
  }
});

module.exports = (req, res) => {
  return app(req, res);
};
