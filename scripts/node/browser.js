// A Chromium-based browser for scripts that render pages or drawings: Chrome, Chromium, Edge or
// Playwright's build. Set MACHINA_BROWSER to its executable if it is not found.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function findBrowser({ shellFirst = false } = {}) {
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
  const found = (shellFirst ? [...playwright.filter(p => /headless-shell/.test(p)), ...fixed, ...playwright] : [...fixed, ...playwright]).find(p => p && existsSync(p));
  if (!found) throw new Error('No Chromium-based browser found. Set MACHINA_BROWSER to its executable.');
  return found;
}

/** Rasterize an SVG (with a headless shell when there is one: a full Chrome may not write --screenshot) to a PNG at the given pixel width, keeping its aspect ratio. Returns the PNG bytes. */
export function svgToPng(svg, width) {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);
  const height = Math.round(width * vb[3] / vb[2]);
  const dir = mkdtempSync(join(tmpdir(), 'machina-svg-'));
  try {
    const src = join(dir, 'sheet.svg'), out = join(dir, 'sheet.png');
    writeFileSync(src, svg.replace(/<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${width}" height="${height}"`));
    execFileSync(findBrowser({ shellFirst: true }), ['--headless', '--no-proxy-server', '--disable-gpu', '--hide-scrollbars',
      `--window-size=${width},${height}`, `--screenshot=${out}`, pathToFileURL(src).href], { stdio: 'ignore', timeout: 120000 });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
