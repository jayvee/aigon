// Minimal static server for dashboard Playwright tests.
// Serves the dashboard HTML with substituted template vars, no aigon instance required.
// Tests use page.route() to intercept all API calls.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.TEST_DASHBOARD_PORT || 4109;
const templatePath = path.join(__dirname, '../../templates/dashboard/index.html');
const assetsBase = path.join(__dirname, '../../templates/dashboard');

const INITIAL_DATA = JSON.stringify({
  repos: [],
  generatedAt: new Date().toISOString(),
  summary: { implementing: 0, waiting: 0, submitted: 0, error: 0 }
});
const INSTANCE_NAME = JSON.stringify('test');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    try {
      let html = fs.readFileSync(templatePath, 'utf8');
      html = html
        .replace('${INITIAL_DATA}', () => INITIAL_DATA)
        .replace('${INSTANCE_NAME}', () => INSTANCE_NAME);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error reading template: ' + e.message);
    }
    return;
  }

  // Serve static assets under /assets/
  if (pathname.startsWith('/assets/')) {
    const filePath = path.join(assetsBase, pathname);
    const ext = path.extname(filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // Serve dashboard JS modules under /js/ and /styles.css
  if (pathname.startsWith('/js/') || pathname === '/styles.css') {
    const filePath = path.join(assetsBase, pathname);
    const ext = path.extname(filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(filePath, 'utf8'));
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // All API endpoints return 404 by default — tests intercept them via page.route()
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Dashboard test server running at http://127.0.0.1:${PORT}\n`);
});
