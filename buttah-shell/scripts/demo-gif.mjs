/**
 * Records demo/shell.gif from a Headlamp that already serves this plugin.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(pluginRoot, 'demo');
const baseUrl = (process.env.HEADLAMP_URL || 'https://headlamp.local:8443').replace(/\/$/, '');
const cluster = process.env.HEADLAMP_CLUSTER || 'shell';
const password = process.env.ALICE_PASSWORD || 'alice-password';
const playwrightDir = '/tmp/buttah-bookmarks-playwright';

if (!fs.existsSync(path.join(playwrightDir, 'node_modules/playwright/index.js'))) {
  throw new Error('Playwright is not installed in /tmp/buttah-bookmarks-playwright.');
}
const { chromium } = createRequire(import.meta.url)(
  path.join(playwrightDir, 'node_modules/playwright')
);

async function signIn(popup) {
  await popup.locator('input[name="login"]').waitFor({ timeout: 30000 });
  await popup.locator('input[name="login"]').fill('alice@alpina.test');
  await popup.locator('input[name="password"]').fill(password);
  await popup.locator('button[type="submit"]').click();
}

function writeGif(webm, gif) {
  const palette = `${webm}.png`;
  const scale = 'fps=8,scale=880:-1:flags=lanczos';
  if (
    spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', `${scale},palettegen=stats_mode=diff`, '-update', '1', palette], {
      stdio: 'inherit',
    }).status !== 0
  ) {
    throw new Error('ffmpeg palette failed');
  }
  if (
    spawnSync(
      'ffmpeg',
      ['-y', '-i', webm, '-i', palette, '-lavfi', `${scale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`, gif],
      { stdio: 'inherit' }
    ).status !== 0
  ) {
    throw new Error('ffmpeg gif failed');
  }
}

fs.mkdirSync(demoDir, { recursive: true });
const videoDir = fs.mkdtempSync('/tmp/buttah-shell-video-');
const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

await page.goto(`${baseUrl}/c/${cluster}/pods`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await Promise.race([
  page.locator('input[name="login"]').waitFor({ timeout: 20000 }),
  page.getByRole('button', { name: 'Account of current user' }).waitFor({ timeout: 20000 }),
]);
if (await page.locator('input[name="login"]').count()) {
  await signIn(page);
  await page.waitForURL(/\/c\//, { timeout: 60000 });
}
await page.getByRole('button', { name: 'Account of current user' }).click();
await page.locator('#buttah-open-shell').waitFor();
await page.waitForTimeout(700);
await page.locator('#buttah-open-shell').click();
await page.locator('#primary-user-menu').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
const start = page.getByRole('button', { name: 'Start', exact: true });
await start.waitFor();
await page.waitForTimeout(800);
const popupPromise = page.waitForEvent('popup', { timeout: 30000 });
await start.click();
const popup = await popupPromise;
await signIn(popup);
const term = page.locator('.xterm-rows');
await term.waitFor({ timeout: 90000 });
const deadline = Date.now() + 60000;
let text = '';
while (Date.now() < deadline) {
  text = await term.innerText();
  if (/\$|# /.test(text)) {
    break;
  }
  await page.waitForTimeout(400);
}
if (!/\$|# /.test(text)) {
  throw new Error(`Shell prompt did not appear:\n${text}`);
}
await page.locator('.buttah-shell-term').click();
await page.waitForTimeout(800);
let shown = false;
for (let attempt = 0; attempt < 2 && !shown; attempt += 1) {
  await page.keyboard.press('Control+u');
  await page.keyboard.type('kubectl version --client', { delay: 40 });
  await page.keyboard.press('Enter');
  try {
    await term.getByText('Client Version').waitFor({ timeout: 15000 });
    shown = true;
  } catch (error) {
    if (attempt === 1) {
      throw new Error(`${error}\n${await term.innerText()}`);
    }
  }
}
await page.waitForTimeout(1200);

const video = page.video();
await context.close();
await browser.close();
const gif = path.join(demoDir, 'shell.gif');
writeGif(await video.path(), gif);
console.log(`Wrote ${gif}`);
