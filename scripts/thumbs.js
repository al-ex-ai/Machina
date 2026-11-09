// Prerenders gallery thumbnails so visitors never download full models just to see the catalog.
// Renders each listed model with the app's own thumbnail renderer in a headless browser and writes
// assets/thumbs/<id>.webp plus data/thumbs.json ({ id: { hash, parts } }).
//
//   npm run thumbs              every listed model
//   npm run thumbs -- <id> ...  only these models
//
// Needs a Chromium-based browser: Chrome, Chromium, Edge or Playwright's build. Set MACHINA_BROWSER
// to its executable if it is not found. Node built-ins only.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/builders/index.js';
import { partCount } from '../src/registry.js';
import { loadCatalog, modelHash } from '../src/catalog-node.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'assets', 'thumbs');
const MANIFEST = join(ROOT, 'data', 'thumbs.json');
const SERVER_PORT = 15422;
const DEBUG_PORT = 15423;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  if (process.env.MACHINA_BROWSER) return process.env.MACHINA_BROWSER;
  const env = process.env;
  const fixed = [
    join(env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(env['PROGRAMFILES(X86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const playwright = [join(env.LOCALAPPDATA ?? '', 'ms-playwright'), join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright')]
    .filter(existsSync)
    .flatMap(d => readdirSync(d).filter(n => n.startsWith('chromium')).map(n => join(d, n)))
    .flatMap(d => readdirSync(d).map(n => [join(d, n, 'chrome-headless-shell.exe'), join(d, n, 'chrome-headless-shell'), join(d, n, 'chrome.exe'), join(d, n, 'chrome')]).flat());
  const found = [...fixed, ...playwright].find(p => p && existsSync(p));
  if (!found) throw new Error('No Chromium-based browser found. Set MACHINA_BROWSER to its executable.');
  return found;
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Minimal DevTools protocol client over Node's built-in WebSocket. */
async function connect(port) {
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'), 15000, 'the browser');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// Runs in the page: render with the app's renderer, re-encode as WebP (keeps transparency).
const renderInPage = file => `(async () => {
  const { thumbnail } = await import('/src/thumbs.js');
  const model = await fetch('/data/${file}').then(r => r.json());
  const img = new Image();
  img.src = await thumbnail(model);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.88);
})()`;

const { models } = loadCatalog();
const only = process.argv.slice(2);
const todo = only.length ? models.filter(m => only.includes(m.id)) : models;
const missing = only.filter(id => !models.some(m => m.id === id));
if (missing.length) throw new Error(`not listed: ${missing.join(', ')}`);

const manifest = existsSync(MANIFEST) && only.length ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(SERVER_PORT) }, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'machina-thumbs-'));
const browser = spawn(findBrowser(), ['--headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${SERVER_PORT}/`)).ok, 10000, 'the dev server');
  const page = await connect(DEBUG_PORT);
  // The History page renders no thumbnails, so the app does not compete with the renders below.
  await page.send('Page.navigate', { url: `http://127.0.0.1:${SERVER_PORT}/#/history` });
  await waitFor(() => page.evaluate(`document.querySelector('#page')?.children.length > 0`), 30000, 'the app');

  for (const m of todo) {
    const t0 = Date.now();
    const url = await page.evaluate(renderInPage(m._file));
    if (!url?.startsWith('data:image/webp')) throw new Error(`${m.id}: the browser did not return a WebP image`);
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(join(OUT, `${m.id}.webp`), bytes);
    manifest[m.id] = { hash: modelHash(m._file), parts: partCount(m) };
    console.log(`${m.id.padEnd(24)} ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  page.close();
} finally {
  const exited = new Promise(r => browser.once('exit', r));
  browser.kill();
  server.kill();
  await Promise.race([exited, sleep(5000)]);
  // Helper processes can hold the profile a little longer on Windows; a leftover temp folder is harmless.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
}

const sorted = Object.fromEntries(Object.keys(manifest).sort().map(k => [k, manifest[k]]));
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
console.log(`wrote ${todo.length} thumbnails and data/thumbs.json`);
