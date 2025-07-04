// Core dependencies for the express server and utilities
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

// Expose the server's default conversion options for the web UI
app.get('/options', (req, res) => {
  res.json(getOptions());
});

// Convert the provided URL into markdown using Readability and Turndown
app.post('/clip', async (req, res) => {
  const { url, options = {} } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  // Determine if Puppeteer should be used from either request or env vars
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

// Retrieve a previously generated markdown file by id
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
