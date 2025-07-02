const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../index');
const { getArticleFromDom, convertArticleToMarkdown } = require('../markdownload');

describe('markdown conversion', () => {
  it('matches direct conversion', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'sample.html'), 'utf8');
    const article = await getArticleFromDom(html);
    const direct = await convertArticleToMarkdown(article, { id: 'test' });

    const server = request(app);
    const res = await server.post('/clip').send({ url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.markdown).toBe(direct.markdown);
  });
});
