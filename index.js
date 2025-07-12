const express = require('express');
const axios = require('axios');
const ytSearch = require('youtube-search-without-api-key');
const cheerio = require('cheerio');
const app = express();
const port = process.env.PORT || 3000;

require('dotenv').config();  

const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
if (!GENIUS_ACCESS_TOKEN) {
  console.error("Genius access token is not set. Please replace 'GENIUS_ACCESS_TOKEN' with your actual token.");
  process.exit(1);
}

app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Browser-like headers to avoid bot detection
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0'
};

// Helper function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced lyrics fetching with retry logic and proxy rotation
async function fetchLyricsWithRetry(url, maxRetries = 3) {
  // List of common User-Agent strings to rotate
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0'
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to fetch lyrics from ${url} (attempt ${attempt}/${maxRetries})`);
      
      // Rotate User-Agent for each attempt
      const currentUserAgent = userAgents[attempt % userAgents.length];
      const headers = {
        ...browserHeaders,
        'User-Agent': currentUserAgent
      };
      
      const response = await axios.get(url, {
        headers,
        timeout: 15000, // Increased timeout to 15 seconds
        validateStatus: function (status) {
          return status >= 200 && status < 300; // Accept only 2xx status codes
        },
        maxRedirects: 5, // Allow redirects
        decompress: true // Handle gzip compression
      });

      if (response.status === 200 && response.data) {
        console.log(`Successfully fetched lyrics on attempt ${attempt}`);
        return response.data;
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      // Check if it's a specific error that we should handle differently
      if (error.response) {
        const status = error.response.status;
        if (status === 403) {
          console.log('Access forbidden - likely bot detection');
        } else if (status === 429) {
          console.log('Rate limited - waiting longer before retry');
          await delay(10000); // Wait 10 seconds for rate limiting
        }
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await delay(waitTime);
    }
  }
  
  throw new Error('All retry attempts failed');
}

app.get('/', (req, res) => {
  res.render('index', { results: null, error: null });
});

// lyrics cleaner with fallback methods
function cleanLyrics($) {
  try {
    // Primary method: Look for the standard lyrics container
    let lyricsContainer = $('[data-lyrics-container="true"]');
    
    // Fallback method 1: Look for lyrics in common containers
    if (!lyricsContainer || lyricsContainer.length === 0) {
      lyricsContainer = $('.lyrics, .song-lyrics, [class*="lyrics"], [class*="Lyrics"]');
    }
    
    // Fallback method 2: Look for any div containing lyrics-like content
    if (!lyricsContainer || lyricsContainer.length === 0) {
      lyricsContainer = $('div').filter((i, el) => {
        const text = $(el).text();
        return text.length > 100 && text.includes('\n') && 
               (text.includes('[') || text.includes(']') || 
                text.match(/[A-Z][a-z]+/g)?.length > 5);
      });
    }

    if (!lyricsContainer || lyricsContainer.length === 0) {
      console.warn("Lyrics container not found with any method.");
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

    const hits = geniusRes.data.response.hits;

    if (!hits || hits.length === 0) {
      return res.render('index', { results: null, error: "No matching songs found." });
    }

    const results = await Promise.all(
      hits.map(async (hit, index) => {
        const song = hit.result;
        const query = `${song.title} ${song.primary_artist.name}`;

        let videoId = null;
        try {
          const videos = await ytSearch.search(query);
          videoId = videos?.[0]?.id?.videoId || null;
        } catch (err) {
          console.error("YouTube search failed:", err.message);
        }

        let lyricsText = 'Lyrics not found.';
        try {
          // Use the enhanced lyrics fetching with retry logic
          const pageData = await fetchLyricsWithRetry(song.url);
          const $ = cheerio.load(pageData);
          lyricsText = cleanLyrics($);
          
          // Add a small delay between requests to avoid rate limiting
          if (index < hits.length - 1) {
            await delay(500);
          }
        } catch (err) {
          console.error('Failed to fetch or clean lyrics:', err.message);
          lyricsText = 'Lyrics not available (blocked or unavailable).';
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
