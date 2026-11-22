// Re-encode the textures of detailed models as WebP (quality 0.9, alpha kept, longest side at most
// 2048 px) in headless
// Chromium, no extra dependency. A WebP is kept only when it is smaller; the .ac files,
// textureMap and recolor settings are pointed at it and the original is deleted once no
// model file refers to it. Run debrand/whiten/recolor-setup before this: they read PNG.
// Usage: node scripts/compact-textures.js <model id> [...]   (or --all for every listed model)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, normalize, extname } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const QUALITY = 0.9;
const MAX = 2048; // longest side; larger simulator textures are scaled down
const args = process.argv.slice(2);
const index = JSON.parse(readFileSync('data/index.json', 'utf8'));
const files = [...index.models, ...index.workshop];
const models = files.map(p => ({ file: join('data', p), m: JSON.parse(readFileSync(join('data', p), 'utf8')) })).filter(x => x.m.asset);
const listed = new Set(index.models.map(p => join('data', p)));
const targets = models.filter(x => (args.includes('--all') ? listed.has(x.file) : args.includes(x.m.id)));
if (!targets.length) { console.error('usage: node scripts/compact-textures.js <model id> [...] | --all'); process.exit(1); }

const exe = join(homedir(), 'AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe');
const profile = mkdtempSync(join(tmpdir(), 'machina-webp-'));
const chrome = spawn(exe, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(100); const f = join(profile, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim(); }
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
if (ws.readyState !== WebSocket.OPEN) await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

async function toWebp(buf, mime) {
  const expr = `(async () => {
    const blob = await (await fetch('data:${mime};base64,${buf.toString('base64')}')).blob();
    const probe = await createImageBitmap(blob);
    const k = Math.min(1, ${MAX} / Math.max(probe.width, probe.height));
    const w = Math.round(probe.width * k), h = Math.round(probe.height * k);
    probe.close();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0);
    const out = await c.convertToBlob({ type: 'image/webp', quality: ${QUALITY} });
    const b = new Uint8Array(await out.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'encode failed');
  return Buffer.from(r.result.result.value, 'base64');
}

const acFiles = m => [...new Set((m.asset.files ?? [{ file: m.asset.file }]).map(f => join(m.asset.path, normalize(f.file))))].filter(existsSync);
const done = new Map(); // full texture path -> new file name (or null when kept)
const resized = new Set(); // WebP files already checked against MAX
let shrunk = 0;
/** Width and height from a WebP header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(b) {
  const t = b.toString('ascii', 12, 16);
  if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (t === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}
let before = 0, after = 0;
for (const { file, m } of targets) {
  const a = m.asset;
  const map = a.textureMap ?? {};
  for (const ac of acFiles(m)) {
    let text = readFileSync(ac, 'latin1');
    const names = new Set([...text.matchAll(/^texture "([^"]+)"/gm)].map(t => t[1]));
    for (const name of names) {
      for (const src of [name, map[name]].filter(Boolean)) {
        // A WebP already in place is only re-encoded when it is larger than MAX.
        if (/\.webp$/i.test(src)) {
          const full = normalize(join(dirname(ac), src));
          if (resized.has(full) || !existsSync(full)) continue;
          resized.add(full);
          const buf = readFileSync(full);
          if (Math.max(...webpSize(buf)) <= MAX) continue;
          const small = await toWebp(buf, 'image/webp');
          writeFileSync(full, small); before += buf.length; after += small.length; shrunk++;
          continue;
        }
        if (!/\.(png|jpe?g)$/i.test(src)) continue;
        const full = normalize(join(dirname(ac), src));
        if (!done.has(full)) {
          if (!existsSync(full)) { done.set(full, null); continue; }
          const buf = readFileSync(full);
          const webp = await toWebp(buf, /\.png$/i.test(src) ? 'image/png' : 'image/jpeg');
          before += buf.length;
          if (webp.length < buf.length * 0.9) { writeFileSync(full.replace(/\.(png|jpe?g)$/i, '.webp'), webp); after += webp.length; done.set(full, true); }
          else { after += buf.length; done.set(full, null); }
        }
      }
      const nameFull = normalize(join(dirname(ac), name));
      if (done.get(nameFull)) text = text.split(`texture "${name}"`).join(`texture "${name.replace(/\.(png|jpe?g)$/i, '.webp')}"`);
    }
    writeFileSync(ac, text, 'latin1');
  }
  // Model settings that name textures.
  const webpName = (base, n) => (done.get(normalize(join(base, n))) ? n.replace(/\.(png|jpe?g)$/i, '.webp') : n);
  const acDir = dirname(normalize(join(a.path, (a.files ?? [{ file: a.file }])[0].file)));
  if (a.textureMap) a.textureMap = Object.fromEntries(Object.entries(a.textureMap).map(([k, v]) => [webpName(acDir, k), webpName(acDir, v)]));
  if (a.recolor?.textures) a.recolor.textures = a.recolor.textures.map(t => webpName(a.path, t));
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
}

// Delete originals that no .ac file or model setting names any more.
const stillNamed = new Set();
for (const { m } of models) for (const ac of acFiles(m)) for (const t of readFileSync(ac, 'latin1').matchAll(/^texture "([^"]+)"/gm)) stillNamed.add(normalize(join(dirname(ac), t[1])));
for (const { m } of models) {
  const a = m.asset, acDir = dirname(normalize(join(a.path, (a.files ?? [{ file: a.file }])[0].file)));
  for (const v of Object.values(a.textureMap ?? {})) stillNamed.add(normalize(join(acDir, v)));
  for (const t of a.recolor?.textures ?? []) stillNamed.add(normalize(join(a.path, t)));
}
let removed = 0;
for (const [full, converted] of done) if (converted && !stillNamed.has(full) && existsSync(full)) { unlinkSync(full); removed++; }

ws.close(); chrome.kill(); await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`textures: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB, ${[...done.values()].filter(Boolean).length} converted, ${shrunk} scaled down, ${removed} originals removed`);
