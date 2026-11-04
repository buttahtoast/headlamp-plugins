/**
 * Records demo/bookmarks.gif from a Headlamp that already serves this plugin.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(pluginRoot, 'demo');
const baseUrl = (process.env.HEADLAMP_URL || 'http://127.0.0.1:4466').replace(/\/$/, '');
const cluster = process.env.HEADLAMP_CLUSTER || 'shell';
const playwrightDir = '/tmp/buttah-bookmarks-playwright';

if (!fs.existsSync(path.join(playwrightDir, 'node_modules/playwright/index.js'))) {
  throw new Error('Playwright is not installed in /tmp/buttah-bookmarks-playwright.');
}
const { chromium } = createRequire(import.meta.url)(
  path.join(playwrightDir, 'node_modules/playwright')
);
fs.mkdirSync(demoDir, { recursive: true });
const videoDir = fs.mkdtempSync('/tmp/buttah-bookmarks-video-');
const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);

async function star(label) {
  const link = page
    .locator("nav[aria-label='Navigation'] a")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: `Bookmark ${label}`, exact: true }).click();
  await page.waitForTimeout(700);
}

await page.goto(`${baseUrl}/c/${cluster}/pods`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.removeItem('buttah-bookmarks'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator("nav[aria-label='Navigation']").waitFor();
await page.waitForTimeout(900);
await star('Pods');
await star('Deployments');
const pinned = page.locator("nav[aria-label='Navigation'] a[data-buttah-bookmark]").first();
await pinned.waitFor();
await page.waitForTimeout(700);
await pinned.click();
await page.waitForTimeout(1400);

const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();
const gif = path.join(demoDir, 'bookmarks.gif');
const palette = path.join(videoDir, 'palette.png');
const scale = 'fps=10,scale=960:-1:flags=lanczos';
if (spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', `${scale},palettegen=stats_mode=diff`, palette], { stdio: 'inherit' }).status !== 0) {
  throw new Error('ffmpeg palette failed');
}
if (
  spawnSync(
    'ffmpeg',
    ['-y', '-i', webm, '-i', palette, '-lavfi', `${scale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`, gif],
    { stdio: 'inherit' }
  ).status !== 0
) {
  throw new Error('ffmpeg gif failed');
}
console.log(`Wrote ${gif}`);
