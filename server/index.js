/**
 * Minimal Express server exposing endpoints used by the browser extension.
 *
 * The `/clip` route accepts a URL and returns the page converted to Markdown.
 * The `/options` route exposes server-side defaults for the web UI.
 * Generated Markdown files are stored on disk so they can be retrieved via
 * `/result/:id`.
 */
// Core dependencies used to expose the clipping API
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// Use the global fetch implementation provided by the runtime
const fetch = global.fetch;
const puppeteer = require('puppeteer');
const {
  getArticleFromDom,
  convertArticleToMarkdown,
  getOptions
} = require('./markdownload');

// Set up the express application with JSON body parsing
const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve static test files from the public directory
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Ensure an output directory exists for storing clipped markdown files
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * GET /options
 *
 * Return the server-side default conversion settings so the web UI can display
 * them to the user. These defaults may be affected by environment variables.
 */
app.get('/options', (req, res) => {
  res.json(getOptions());
});

/**
 * POST /clip
 *
 * Accepts a JSON body containing a `url` and optional conversion `options`.
 * The page is fetched (or rendered with Puppeteer) and converted to Markdown.
 * The resulting document is saved on disk and returned in the response.
 */
app.post('/clip', async (req, res) => {
  const { url, options = {} } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  // Determine if Puppeteer should be used from either request or env vars.
  // When USE_PUPPETEER is true the server falls back to Puppeteer by default,
  // but the client can override this per-request via the `options` payload.
  const envUsePuppeteer = process.env.USE_PUPPETEER === 'true';
  const usePuppeteer =
    typeof options.puppeteer === 'boolean' ? options.puppeteer : envUsePuppeteer;
  try {
    let html;
    if (usePuppeteer) {
      try {
        const browser = await puppeteer.launch({
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });
        html = await page.content();
        await browser.close();
      } catch (puppeteerErr) {
        console.error('Puppeteer failed, falling back to fetch', puppeteerErr);
        if (/libatk|browser process/i.test(puppeteerErr.message || '')) {
          console.error('Missing system libraries detected. See README for Puppeteer setup.');
        }
        // Fall back to a simple HTTP fetch if Puppeteer fails
        const response = await fetch(url);
        html = await response.text();
      }
    } else {
      const response = await fetch(url);
      html = await response.text();
    }
    // Convert the raw HTML into a Readability article and then markdown
    const article = await getArticleFromDom(html);
    const id = uuidv4();
    const { markdown } = await convertArticleToMarkdown(article, { ...options, id });
    const filePath = path.join(OUTPUT_DIR, `${id}.md`);
    fs.writeFileSync(filePath, markdown);
    // Send the generated markdown back to the client
    res.json({ id, markdown });
  } catch (err) {
    // Catch-all for unexpected errors during conversion
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /result/:id
 *
 * Look up a previously generated Markdown file by identifier and return the
 * raw Markdown. Responds with `404` if the file does not exist.
 */
app.get('/result/:id', (req, res) => {
  const file = path.join(OUTPUT_DIR, `${req.params.id}.md`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.type('text/markdown').send(fs.readFileSync(file));
});

// Start the server when executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
}

module.exports = app;
