/*
 * Static file server for the demo. No dependencies — the demo is meant to be
 * openable without installing anything.
 *
 *   node docs/design/player/serve.mjs [port]
 *
 * Serves the repository root, because the demo reuses media/player/formatUtils.js
 * from outside its own directory. Binds to 127.0.0.1 only: on a remote host,
 * reach it through VS Code port forwarding or an SSH tunnel rather than by
 * exposing the port.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..', '..', '..'));
const ENTRY = '/docs/design/player/index.html';
const PORT = Number(process.argv[2] ?? 8777);
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST);
  const requested = url.pathname === '/' ? ENTRY : decodeURIComponent(url.pathname);
  const path = normalize(join(ROOT, requested));

  // Refuse anything that resolves outside the repository.
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      res.writeHead(302, { location: requested.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
      // The point of this server is iterating on the design; never serve stale CSS.
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + requested);
  }
});

server.listen(PORT, HOST, () => {
  console.log('Player demo: http://' + HOST + ':' + PORT + ENTRY);
  console.log('Serving ' + ROOT + ' — Ctrl+C to stop.');
});
