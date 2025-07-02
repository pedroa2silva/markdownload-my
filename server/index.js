const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = global.fetch;
const {
  getArticleFromDom,
  convertArticleToMarkdown,
  getOptions
} = require('./markdownload');

const app = express();
app.use(express.json({ limit: '10mb' }));
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.get('/options', (req, res) => {
  res.json(getOptions());
});

app.post('/clip', async (req, res) => {
  const { url, options = {} } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await fetch(url);
    const html = await response.text();
    const article = await getArticleFromDom(html);
    const id = uuidv4();
    const { markdown } = await convertArticleToMarkdown(article, { ...options, id });
    const filePath = path.join(OUTPUT_DIR, `${id}.md`);
    fs.writeFileSync(filePath, markdown);
    res.json({ id, markdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/result/:id', (req, res) => {
  const file = path.join(OUTPUT_DIR, `${req.params.id}.md`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.type('text/markdown').send(fs.readFileSync(file));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
}

module.exports = app;
