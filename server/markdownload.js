// Tools for parsing, converting and saving articles as markdown
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const gfm = require('turndown-plugin-gfm');
// Use the runtime's global fetch API for HTTP requests
const fetch = global.fetch;
const moment = require('moment');
const mime = require('mime-types');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Base configuration used when converting articles to markdown
const defaultOptions = {
  headingStyle: "atx",
  hr: "___",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
  imageStyle: "markdown",
  imageRefStyle: "inlined",
  frontmatter: "---\ncreated: {date:YYYY-MM-DDTHH:mm:ss} (UTC {date:Z})\ntags: [{keywords}]\nsource: {baseURI}\nauthor: {byline}\n---\n\n# {pageTitle}\n\n> ## Excerpt\n> {excerpt}\n\n---",
  backmatter: "",
  title: "{pageTitle}",
  includeTemplate: true,
  saveAs: false,
  downloadImages: false,
  imagePrefix: "{pageTitle}/",
  mdClipsFolder: null,
  disallowedChars: "[]#^",
  downloadMode: "downloadsApi",
  turndownEscape: true,
  contextMenus: true,
  obsidianIntegration: false,
  obsidianVault: "",
  obsidianFolder: "",
  puppeteer: false
};
// Retrieve the effective options, merging env overrides and function args
function getOptions(overrides = {}) {
  const envOptions = {};
  // Allow environment variables to override default values
  if (process.env.DOWNLOAD_IMAGES) envOptions.downloadImages = process.env.DOWNLOAD_IMAGES === 'true';
  if (process.env.IMAGE_STYLE) envOptions.imageStyle = process.env.IMAGE_STYLE;
  if (process.env.USE_PUPPETEER) envOptions.puppeteer = process.env.USE_PUPPETEER === 'true';
  return { ...defaultOptions, ...envOptions, ...overrides };
}

// Remove characters that are invalid on most file systems
function generateValidFileName(title, disallowedChars = null) {
  if (!title) return title;
  title = String(title);
  const illegalRe = /[\/\?<>\\:\*\|":]/g;
  let name = title.replace(illegalRe, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  if (disallowedChars) {
    for (let c of disallowedChars) {
      if ('[\\^$.|?*+()'.includes(c)) c = `\\${c}`;
      name = name.replace(new RegExp(c, 'g'), '');
    }
  }
  return name;
}

// Replace template placeholders with data from the article
function textReplace(string, article, disallowedChars = null) {
  for (const key in article) {
    if (Object.hasOwn(article, key) && key !== 'content') {
      let s = String(article[key] || '');
      if (s && disallowedChars) s = generateValidFileName(s, disallowedChars);
      string = string
        .replace(new RegExp('{' + key + '}', 'g'), s)
        .replace(new RegExp('{' + key + ':lower}', 'g'), s.toLowerCase())
        .replace(new RegExp('{' + key + ':upper}', 'g'), s.toUpperCase())
        .replace(new RegExp('{' + key + ':kebab}', 'g'), s.replace(/ /g, '-').toLowerCase())
        .replace(new RegExp('{' + key + ':mixed-kebab}', 'g'), s.replace(/ /g, '-'))
        .replace(new RegExp('{' + key + ':snake}', 'g'), s.replace(/ /g, '_').toLowerCase())
        .replace(new RegExp('{' + key + ':mixed_snake}', 'g'), s.replace(/ /g, '_'))
        .replace(new RegExp('{' + key + ':obsidian-cal}', 'g'), s.replace(/ /g, '-').replace(/-{2,}/g, '-'))
        .replace(new RegExp('{' + key + ':camel}', 'g'), s.replace(/ ./g, str => str.trim().toUpperCase()).replace(/^./, str => str.toLowerCase()))
        .replace(new RegExp('{' + key + ':pascal}', 'g'), s.replace(/ ./g, str => str.trim().toUpperCase()).replace(/^./, str => str.toUpperCase()));
    }
  }
  const now = new Date();
  const dateRegex = /{date:(.+?)}/g;
  const matches = string.match(dateRegex);
  if (matches && matches.forEach) {
    matches.forEach(match => {
      const format = match.substring(6, match.length - 1);
      const dateString = moment(now).format(format);
      string = string.replaceAll(match, dateString);
    });
  }
  const keywordRegex = /{keywords:?(.*)?}/g;
  const keywordMatches = string.match(keywordRegex);
  if (keywordMatches && keywordMatches.forEach) {
    keywordMatches.forEach(match => {
      let separator = match.substring(10, match.length - 1);
      try {
        separator = JSON.parse(JSON.stringify(separator).replace(/\\\\/g, '\\'));
      } catch {
        // ignore
      }
      const keywordsString = (article.keywords || []).join(separator);
      string = string.replace(new RegExp(match.replace(/\\/g, '\\\\'), 'g'), keywordsString);
    });
  }
  const defaultRegex = /{(.*?)}/g;
  return string.replace(defaultRegex, '');
}

// Parse an HTML document into a Readability article
async function getArticleFromDom(domString) {
  const dom = new JSDOM(domString, { url: 'https://example.com' });
  const document = dom.window.document;
  const math = {};
  const storeMathInfo = (el, mathInfo) => {
    const randomId = uuidv4();
    el.id = randomId;
    math[randomId] = mathInfo;
  };

  // Extract math formulas rendered by MathJax
  document.body
    .querySelectorAll('script[id^=MathJax-Element-]')
    ?.forEach(mathSource => {
    const type = mathSource.attributes.type.value;
    storeMathInfo(mathSource, {
      tex: mathSource.textContent,
      inline: type ? !type.includes('mode=display') : false
    });
  });

  // Handle MathJax v3 nodes added by the browser extension
  document.body.querySelectorAll('[markdownload-latex]')?.forEach(mathJax3Node => {
    const tex = mathJax3Node.getAttribute('markdownload-latex');
    const display = mathJax3Node.getAttribute('display');
    const inline = !(display && display === 'true');
    const mathNode = document.createElement(inline ? 'i' : 'p');
    mathNode.textContent = tex;
    mathJax3Node.parentNode.insertBefore(mathNode, mathJax3Node.nextSibling);
    mathJax3Node.parentNode.removeChild(mathJax3Node);
    storeMathInfo(mathNode, { tex, inline });
  });

  // Handle KaTeX rendered nodes
  document.body.querySelectorAll('.katex-mathml')?.forEach(kaTeXNode => {
    storeMathInfo(kaTeXNode, {
      tex: kaTeXNode.querySelector('annotation').textContent,
      inline: true
    });
  });

  // Annotate code blocks with detected languages from highlight.js
  document.body.querySelectorAll('[class*=highlight-text],[class*=highlight-source]')?.forEach(codeSource => {
    const language = codeSource.className.match(/highlight-(?:text|source)-([a-z0-9]+)/)?.[1];
    if (codeSource.firstChild.nodeName === 'PRE') {
      codeSource.firstChild.id = `code-lang-${language}`;
    }
  });

  // Annotate PrismJS style code blocks with their language
  document.body.querySelectorAll('[class*=language-]')?.forEach(codeSource => {
    const language = codeSource.className.match(/language-([a-z0-9]+)/)?.[1];
    codeSource.id = `code-lang-${language}`;
  });

  // Preserve line breaks inside PRE tags
  document.body.querySelectorAll('pre br')?.forEach(br => {
    br.outerHTML = '<br-keep></br-keep>';
  });

  // Some highlight styles wrap PRE inside a div; mark them as plain text
  document.body.querySelectorAll('.codehilite > pre')?.forEach(codeSource => {
    if (codeSource.firstChild.nodeName !== 'CODE' && !codeSource.className.includes('language')) {
      codeSource.id = 'code-lang-text';
    }
  });

  // Remove any classes from headings to avoid unintended styling
  document.body.querySelectorAll('h1, h2, h3, h4, h5, h6')?.forEach(header => {
    header.className = '';
    header.outerHTML = header.outerHTML;
  });

  // Sanitize the root element to avoid CSS inheritance issues
  document.documentElement.removeAttribute('class');
  const article = new Readability(document).parse();
  article.baseURI = document.baseURI;
  article.pageTitle = document.title;
  const url = new URL(document.baseURI);
  article.hash = url.hash;
  article.host = url.host;
  article.origin = url.origin;
  article.hostname = url.hostname;
  article.pathname = url.pathname;
  article.port = url.port;
  article.protocol = url.protocol;
  article.search = url.search;
  // Collect additional metadata from the document head
  if (document.head) {
    article.keywords = document.head
      .querySelector('meta[name="keywords"]')
      ?.content?.split(',')?.map(s => s.trim());
    document.head
      .querySelectorAll('meta[name][content], meta[property][content]')
      ?.forEach(meta => {
        const key = meta.getAttribute('name') || meta.getAttribute('property');
        const val = meta.getAttribute('content');
        if (key && val && !article[key]) {
          article[key] = val;
        }
      });
  }
  // Preserve extracted math data for use during conversion
  article.math = math;
  return article;
}

// Download external images before writing markdown to disk
async function preDownloadImages(imageList, markdown, options, id) {
  const newImageList = {};
  // Fetch images in parallel and either embed or save them
  await Promise.all(
    Object.entries(imageList).map(async ([src, filename]) => {
      const res = await fetch(src);
      const buffer = await res.buffer();
      if (options.imageStyle === 'base64') {
        const dataUrl = `data:${res.headers.get('content-type')};base64,${buffer.toString('base64')}`;
        markdown = markdown.replaceAll(src, dataUrl);
      } else {
        let newFilename = filename;
        if (newFilename.endsWith('.idunno')) {
          const type = res.headers.get('content-type');
          const ext = mime.extension(type) || 'bin';
          newFilename = filename.replace('.idunno', '.' + ext);
          markdown = markdown.replaceAll(filename, newFilename);
        }
        const dir = path.join('output', id);
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, newFilename);
        fs.writeFileSync(dest, buffer);
        newImageList[dest] = newFilename;
      }
    })
  );
  return { imageList: newImageList, markdown };
}

// Convert a Readability article object into markdown
async function convertArticleToMarkdown(article, overrides = {}) {
  const options = getOptions(overrides);
  // Optionally wrap the markdown with custom front/back matter
  if (options.includeTemplate) {
    options.frontmatter = textReplace(options.frontmatter, article) + '\n';
    options.backmatter = '\n' + textReplace(options.backmatter, article);
  } else {
    options.frontmatter = options.backmatter = '';
  }
  // Apply template variables to the image path and sanitize it
  options.imagePrefix = textReplace(options.imagePrefix, article, options.disallowedChars)
    .split('/')
    .map(s => generateValidFileName(s, options.disallowedChars))
    .join('/');
  const turndownService = new TurndownService(options);
  turndownService.use(gfm.gfm);
  // Preserve elements that Turndown would normally discard
  turndownService.keep(['iframe', 'sub', 'sup', 'u', 'ins', 'del', 'small', 'big']);
  const result = turndownService.turndown(article.content);
  let markdown = options.frontmatter + result + options.backmatter;
  let imageList = {};
  if (options.downloadImages && options.imageStyle !== 'base64') {
    // Save images to disk before returning the markdown
    const preRes = await preDownloadImages(imageList, markdown, options, overrides.id || uuidv4());
    markdown = preRes.markdown;
    imageList = preRes.imageList;
  }
  return { markdown, imageList };
}

// Expose utility functions for use in the express server and tests
module.exports = {
  getArticleFromDom,
  convertArticleToMarkdown,
  preDownloadImages,
  generateValidFileName,
  textReplace,
  getOptions
};
