const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApiHandlers } = require('./api');

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const api = createApiHandlers({
  dataDir: path.join(__dirname, 'data'),
  dbPath: path.join(__dirname, 'data', 'database.json'),
  matchWaitTimeout: 8000,
});

function serveStaticFile(res, urlPath) {
  let filePath = path.join(__dirname, urlPath);
  if (urlPath === '/' || !path.extname(urlPath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  if (urlPath.startsWith('/dist/')) {
    filePath = path.join(DIST_DIR, urlPath.replace('/dist/', ''));
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function requestListener(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const handled = api.handleRequest(req, res, urlObj);
  if (!handled) {
    serveStaticFile(res, urlObj.pathname);
  }
}

const server = http.createServer(requestListener);
server.listen(PORT, () => {
  console.log(`MetaWorlds server running on http://localhost:${PORT}`);
});
