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

// Enhanced browser-like headers with more realistic patterns
const getBrowserHeaders = (attempt = 0) => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
  ];

  const acceptLanguages = [
    'en-US,en;q=0.9',
    'en-GB,en;q=0.9',
    'en-CA,en;q=0.9',
    'en-AU,en;q=0.9'
  ];

  return {
    'User-Agent': userAgents[attempt % userAgents.length],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': acceptLanguages[attempt % acceptLanguages.length],
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
  };
};

// Helper function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Session management for cookies
let sessionCookies = '';

// Enhanced lyrics fetching with multiple strategies
async function fetchLyricsWithRetry(url, maxRetries = 3) {
  console.log(`Starting lyrics fetch for: ${url}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} for ${url}`);
      
      const headers = getBrowserHeaders(attempt - 1);
      
      // Add cookies if we have them
      if (sessionCookies) {
        headers['Cookie'] = sessionCookies;
      }

      const response = await axios.get(url, {
        headers,
        timeout: 20000, // 20 second timeout
        maxRedirects: 5,
        decompress: true,
        validateStatus: function (status) {
          return status >= 200 && status < 300;
        }
      });

      // Store cookies for future requests
      if (response.headers['set-cookie']) {
        sessionCookies = response.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join('; ');
      }

      if (response.status === 200 && response.data) {
        console.log(`Successfully fetched lyrics on attempt ${attempt}`);
        return response.data;
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (error.response) {
        const status = error.response.status;
        console.log(`HTTP Status: ${status}`);
        
        if (status === 403) {
          console.log('Access forbidden - trying different approach');
          // Clear cookies and try again
          sessionCookies = '';
        } else if (status === 429) {
          console.log('Rate limited - waiting longer');
          await delay(15000); // Wait 15 seconds
        } else if (status === 503) {
          console.log('Service unavailable - waiting');
          await delay(10000);
        }
      }
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const baseDelay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
      const jitter = Math.random() * 1000;
      const waitTime = baseDelay + jitter;
      console.log(`Waiting ${Math.round(waitTime)}ms before retry...`);
      await delay(waitTime);
    }
  }
  
  throw new Error('All retry attempts failed');
}

// Alternative lyrics fetching method using different approach
async function fetchLyricsAlternative(url) {
  try {
    console.log('Trying alternative lyrics fetching method...');
    
    // First, try to get the page with a different approach
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000,
      maxRedirects: 3
    });

    return response.data;
  } catch (error) {
    console.error('Alternative method failed:', error.message);
    throw error;
  }
}

// Third fallback method - simulate a more realistic browser session
async function fetchLyricsWithSession(url) {
  try {
    console.log('Trying session-based lyrics fetching...');
    
    // First, visit the main page to establish a session
    const mainPageResponse = await axios.get('https://genius.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    });

    // Extract cookies from the main page
    let cookies = '';
    if (mainPageResponse.headers['set-cookie']) {
      cookies = mainPageResponse.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join('; ');
    }

    // Wait a bit to simulate human behavior
    await delay(2000 + Math.random() * 3000);

    // Now fetch the actual lyrics page with the session cookies
    const lyricsResponse = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://genius.com',
        'Cookie': cookies
      },
      timeout: 15000
    });

    return lyricsResponse.data;
  } catch (error) {
    console.error('Session-based method failed:', error.message);
    throw error;
  }
}

// Debug function to log response details
function logResponseDetails(response, url) {
  console.log(`Response for ${url}:`);
  console.log(`- Status: ${response.status}`);
  console.log(`- Content-Type: ${response.headers['content-type']}`);
  console.log(`- Content-Length: ${response.headers['content-length']}`);
  console.log(`- Server: ${response.headers['server']}`);
  console.log(`- X-Powered-By: ${response.headers['x-powered-by']}`);
  
  // Check if we got a valid HTML response
  const html = response.data;
  if (html && typeof html === 'string') {
    console.log(`- HTML length: ${html.length}`);
    console.log(`- Contains 'lyrics': ${html.includes('lyrics')}`);
    console.log(`- Contains 'data-lyrics-container': ${html.includes('data-lyrics-container')}`);
    console.log(`- Contains 'genius': ${html.includes('genius')}`);
  }
}

app.get('/', (req, res) => {
  res.render('index', { results: null, error: null });
});

// Enhanced lyrics cleaner with multiple extraction methods
function cleanLyrics($) {
  try {
    console.log('Starting lyrics extraction...');
    
    // Method 1: Standard Genius lyrics container
    let lyricsContainer = $('[data-lyrics-container="true"]');
    console.log(`Method 1 found ${lyricsContainer.length} containers`);
    
    // Method 2: Common lyrics selectors
    if (!lyricsContainer || lyricsContainer.length === 0) {
      lyricsContainer = $('.lyrics, .song-lyrics, [class*="lyrics"], [class*="Lyrics"], .Lyrics__Container-sc-1ynbvzw-1');
      console.log(`Method 2 found ${lyricsContainer.length} containers`);
    }
    
    // Method 3: Look for lyrics in any div with substantial text
    if (!lyricsContainer || lyricsContainer.length === 0) {
      lyricsContainer = $('div').filter((i, el) => {
        const text = $(el).text();
        return text.length > 200 && text.includes('\n') && 
               (text.includes('[') || text.includes(']') || 
                text.match(/[A-Z][a-z]+/g)?.length > 10);
      });
      console.log(`Method 3 found ${lyricsContainer.length} containers`);
    }
    
    // Method 4: Look for any element with lyrics-like content
    if (!lyricsContainer || lyricsContainer.length === 0) {
      lyricsContainer = $('*').filter((i, el) => {
        const text = $(el).text();
        const hasBrackets = text.includes('[') && text.includes(']');
        const hasMultipleLines = (text.match(/\n/g) || []).length > 5;
        const hasSongStructure = text.length > 300 && hasMultipleLines;
        return hasSongStructure && (hasBrackets || text.match(/[A-Z][a-z]+/g)?.length > 15);
      });
      console.log(`Method 4 found ${lyricsContainer.length} containers`);
    }

    if (!lyricsContainer || lyricsContainer.length === 0) {
      console.warn("No lyrics containers found with any method");
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
      console.warn("No lyric lines extracted from containers");
      return 'Lyrics not found.';
    }

    const cleanedLyrics = cleanChunks
      .join('\n')
      .replace(/\n{2,}/g, '\n\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    console.log(`Successfully extracted ${cleanedLyrics.split('\n').length} lines of lyrics`);
    return cleanedLyrics;
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
          // Try all three methods in sequence
          let pageData;
          let methodUsed = 'none';
          
          // Method 1: Primary method with enhanced headers
          try {
            console.log(`\n=== Trying Method 1 for ${song.title} ===`);
            pageData = await fetchLyricsWithRetry(song.url);
            methodUsed = 'primary';
            console.log(`✓ Method 1 succeeded for ${song.title}`);
          } catch (primaryError) {
            console.log(`✗ Method 1 failed for ${song.title}: ${primaryError.message}`);
            
            // Method 2: Alternative method with different headers
            try {
              console.log(`\n=== Trying Method 2 for ${song.title} ===`);
              pageData = await fetchLyricsAlternative(song.url);
              methodUsed = 'alternative';
              console.log(`✓ Method 2 succeeded for ${song.title}`);
            } catch (alternativeError) {
              console.log(`✗ Method 2 failed for ${song.title}: ${alternativeError.message}`);
              
              // Method 3: Session-based method
              try {
                console.log(`\n=== Trying Method 3 for ${song.title} ===`);
                pageData = await fetchLyricsWithSession(song.url);
                methodUsed = 'session';
                console.log(`✓ Method 3 succeeded for ${song.title}`);
              } catch (sessionError) {
                console.log(`✗ Method 3 failed for ${song.title}: ${sessionError.message}`);
                throw new Error(`All methods failed: ${primaryError.message}, ${alternativeError.message}, ${sessionError.message}`);
              }
            }
          }
          
          // Log the response details for debugging
          if (pageData) {
            console.log(`\n=== Response Analysis for ${song.title} (Method: ${methodUsed}) ===`);
            console.log(`- Data type: ${typeof pageData}`);
            console.log(`- Data length: ${pageData.length}`);
            console.log(`- Contains 'lyrics': ${pageData.includes('lyrics')}`);
            console.log(`- Contains 'data-lyrics-container': ${pageData.includes('data-lyrics-container')}`);
            console.log(`- Contains 'genius': ${pageData.includes('genius')}`);
            console.log(`- Contains 'blocked': ${pageData.includes('blocked')}`);
            console.log(`- Contains 'captcha': ${pageData.includes('captcha')}`);
            console.log(`- Contains 'cloudflare': ${pageData.includes('cloudflare')}`);
          }
          
          const $ = cheerio.load(pageData);
          lyricsText = cleanLyrics($);
          
          // Add delay between requests
          if (index < hits.length - 1) {
            const delayTime = 2000 + Math.random() * 3000; // Random delay between 2-5 seconds
            console.log(`Waiting ${Math.round(delayTime)}ms before next request...`);
            await delay(delayTime);
          }
        } catch (err) {
          console.error(`\n❌ All methods failed for ${song.title}:`, err.message);
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

// Debug endpoint to test scraping
app.get('/debug/:songId', async (req, res) => {
  const songId = req.params.songId;
  const testUrl = `https://genius.com/songs/${songId}`;
  
  console.log(`\n=== DEBUG: Testing scraping for ${testUrl} ===`);
  
  try {
    const results = {
      method1: { success: false, error: null, data: null },
      method2: { success: false, error: null, data: null },
      method3: { success: false, error: null, data: null }
    };
    
    // Test Method 1
    try {
      console.log('Testing Method 1...');
      const data1 = await fetchLyricsWithRetry(testUrl);
      results.method1 = { success: true, error: null, data: data1.substring(0, 500) + '...' };
      console.log('✓ Method 1 succeeded');
    } catch (error) {
      results.method1 = { success: false, error: error.message, data: null };
      console.log('✗ Method 1 failed:', error.message);
    }
    
    // Test Method 2
    try {
      console.log('Testing Method 2...');
      const data2 = await fetchLyricsAlternative(testUrl);
      results.method2 = { success: true, error: null, data: data2.substring(0, 500) + '...' };
      console.log('✓ Method 2 succeeded');
    } catch (error) {
      results.method2 = { success: false, error: error.message, data: null };
      console.log('✗ Method 2 failed:', error.message);
    }
    
    // Test Method 3
    try {
      console.log('Testing Method 3...');
      const data3 = await fetchLyricsWithSession(testUrl);
      results.method3 = { success: true, error: null, data: data3.substring(0, 500) + '...' };
      console.log('✓ Method 3 succeeded');
    } catch (error) {
      results.method3 = { success: false, error: error.message, data: null };
      console.log('✗ Method 3 failed:', error.message);
    }
    
    res.json({
      url: testUrl,
      timestamp: new Date().toISOString(),
      results
    });
    
  } catch (error) {
    res.json({
      url: testUrl,
      timestamp: new Date().toISOString(),
      error: error.message,
      results: null
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Debug endpoint available at http://localhost:${port}/debug/[song-id]`);
});
