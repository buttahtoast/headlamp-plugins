import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(pluginRoot, 'demo');
const baseUrl = (process.env.HEADLAMP_URL || 'http://127.0.0.1:4466').replace(/\/$/, '');
const cluster = process.env.HEADLAMP_CLUSTER || 'kind-bookmarks';
const namespace = process.env.HEADLAMP_NAMESPACE || 'shop';
const playwrightDir = '/tmp/buttah-bookmarks-playwright';

function ensurePlaywright() {
  if (!fs.existsSync(path.join(playwrightDir, 'node_modules/playwright/index.js'))) {
    fs.mkdirSync(playwrightDir, { recursive: true });
    fs.writeFileSync(
      path.join(playwrightDir, 'package.json'),
      JSON.stringify({ private: true, dependencies: { playwright: '1.58.2' } })
    );
    const install = spawnSync('npm', ['install'], { cwd: playwrightDir, stdio: 'inherit' });
    if (install.status !== 0) {
      throw new Error('Could not install Playwright.');
    }
  }
  const browsers = spawnSync(
    process.execPath,
    [path.join(playwrightDir, 'node_modules/playwright/cli.js'), 'install', 'chromium'],
    { cwd: playwrightDir, stdio: 'inherit' }
  );
  if (browsers.status !== 0) {
    throw new Error('Could not install Chromium.');
  }
}

ensurePlaywright();
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(playwrightDir, 'node_modules/playwright'));

const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
fs.mkdirSync(demoDir, { recursive: true });

async function open(pathname) {
  await page.goto(baseUrl + pathname, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator("nav[aria-label='Navigation']").waitFor();
  await page.waitForTimeout(600);
}

async function bookmark(label) {
  const link = page
    .locator("nav[aria-label='Navigation'] a")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  const button = page.getByRole('button', { name: `Bookmark ${label}`, exact: true });
  if ((await button.count()) === 0) {
    return;
  }
  await button.click();
  await page.waitForTimeout(300);
}

await open(`/c/${cluster}/pods`);
await bookmark('Pods');
await bookmark('Deployments');
await page.locator("nav[aria-label='Navigation'] a").filter({ hasText: /^Jobs$/ }).first().hover();
await page.screenshot({ path: path.join(demoDir, 'sidebar-light.png') });

const podLink = page.locator(`a[href*="/pods/${namespace}/"]`).first();
await podLink.click();
await page.getByRole('button', { name: 'Bookmark', exact: true }).waitFor();
await page.screenshot({ path: path.join(demoDir, 'pod-details.png') });

await page.goto(baseUrl + '/settings/general', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Dark', exact: true }).click();
await open(`/c/${cluster}/pods`);
await page.locator("nav[aria-label='Navigation'] a").filter({ hasText: /^Jobs$/ }).first().hover();
await page.screenshot({ path: path.join(demoDir, 'sidebar-dark.png') });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const menu = page.getByRole('button', { name: /menu|drawer|navigation|sidebar|open/i });
if ((await menu.count()) > 0) {
  await menu.first().click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: path.join(demoDir, 'phone-drawer.png') });

await browser.close();
console.log(`Wrote screenshots of ${baseUrl} cluster ${cluster} to ${demoDir}`);
