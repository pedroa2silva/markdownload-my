const fs = require('fs');
const path = require('path');
const request = require('supertest');
jest.mock('puppeteer');
const puppeteer = require('puppeteer');
const app = require('../index');
const { getArticleFromDom, convertArticleToMarkdown } = require('../markdownload');

describe('markdown conversion', () => {
  const html = fs.readFileSync(path.join(__dirname, 'sample.html'), 'utf8');
  let server;

  jest.setTimeout(20000);

  beforeAll(async () => {
    server = request(app);
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2020-01-01T00:00:00Z'));
    puppeteer.launch.mockResolvedValue({
      newPage: async () => ({
        goto: jest.fn(),
        content: async () => html,
        close: jest.fn()
      }),
      close: jest.fn()
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('matches direct conversion using fetch', async () => {
    const article = await getArticleFromDom(html);
    const direct = await convertArticleToMarkdown(article, { id: 'test' });
    const res = await server
      .post('/clip')
      .send({ url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.markdown).toBe(direct.markdown);
  });

  it('matches direct conversion using puppeteer', async () => {
    const article = await getArticleFromDom(html);
    const direct = await convertArticleToMarkdown(article, { id: 'test' });
    const res = await server.post('/clip').send({
      url: 'data:text/html;base64,' + Buffer.from(html).toString('base64'),
      options: { puppeteer: true }
    });
    expect(res.status).toBe(200);
    expect(res.body.markdown).toBe(direct.markdown);
  });
});
