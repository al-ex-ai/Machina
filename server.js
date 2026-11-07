// Minimal static server for local development. Node built-ins only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 15420;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) && path !== ROOT) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Machina running at http://${HOST}:${PORT}`);
});
