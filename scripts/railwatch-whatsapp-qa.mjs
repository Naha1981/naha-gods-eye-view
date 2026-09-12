import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import puppeteer from 'puppeteer';

const port = 4176;
const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', `--port`, String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
let output = '';
vite.stdout.on('data', chunk => { output += chunk.toString(); });
vite.stderr.on('data', chunk => { output += chunk.toString(); });

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}\n${output}`);
}

const overlaps = (a, b, gap = 0) => !(
  a.right + gap <= b.left || a.left - gap >= b.right || a.bottom + gap <= b.top || a.top - gap >= b.bottom
);

try {
  await waitFor(`http://127.0.0.1:${port}/railwatch/`);
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(), args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', error => errors.push(`page: ${error.message}`));

    for (const viewport of [
      { width: 1600, height: 1000 },
      { width: 1200, height: 900 },
      { width: 900, height: 900 },
      { width: 700, height: 900 },
    ]) {
      await page.setViewport(viewport);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(100);
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          header: rect('.topbar'),
          panel: rect('.panel'),
          feed: rect('.feed'),
        };
      });
      assert(geometry.header && geometry.panel && geometry.feed, `missing layout surface at ${viewport.width}x${viewport.height}`);
      assert(geometry.panel.top >= geometry.header.bottom + 2, `left control panel overlaps topbar at ${viewport.width}x${viewport.height}`);
      assert(geometry.feed.top >= geometry.header.bottom + 2, `alert feed overlaps topbar at ${viewport.width}x${viewport.height}`);
    }

    await page.setViewport({ width: 1600, height: 1000 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.click('#whatsapp-open');
    await page.waitForSelector('.whatsapp-panel.visible', { timeout: 5000 });
    const whatsapp = await page.evaluate(() => {
      const rect = selector => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      };
      return {
        whatsapp: rect('.whatsapp-panel'),
        header: rect('.topbar'),
        panel: rect('.panel'),
        feed: rect('.feed'),
      };
    });
    assert(whatsapp.whatsapp.left >= 0 && whatsapp.whatsapp.right <= 1600, 'WhatsApp workspace escapes viewport horizontally');
    assert(whatsapp.whatsapp.top >= 0 && whatsapp.whatsapp.bottom <= 1000, 'WhatsApp workspace escapes viewport vertically');
    assert(!overlaps(whatsapp.whatsapp, whatsapp.header, 8), 'WhatsApp workspace overlaps topbar');
    assert(!overlaps(whatsapp.whatsapp, whatsapp.panel, 8), 'WhatsApp workspace overlaps left control panel');
    assert(!overlaps(whatsapp.whatsapp, whatsapp.feed, 8), 'WhatsApp workspace overlaps alert feed');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal(await page.$eval('.whatsapp-panel', element => element.classList.contains('visible')), false, 'WhatsApp workspace did not close with Escape');
    assert.deepEqual(errors, [], `browser errors detected: ${errors.join(' | ')}`);
    console.log('RailWatch WhatsApp browser QA PASS');
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(`RAILWATCH WHATSAPP QA FAIL: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  vite.kill('SIGTERM');
}
