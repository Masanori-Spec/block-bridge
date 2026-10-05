import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  extractTransferZip, validateExportEntries, writeBrowserExport, fixtureBytes, sha256,
} from './artifact-contract.mjs';

const fixtures = resolve('fixtures/owner-complete');
const geometry = '#drawing [data-geometry="true"]';
const names = ['LEAF', 'ASSEMBLY'];
const policy = (page, name) => page.locator(`button[data-policy="${name}"]`);

const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  pageErrors.set(page, []);
  page.on('pageerror', error => pageErrors.get(page).push(error.name));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No uncaught application exception is allowed').toEqual([]);
});

async function ready(page) {
  await expect(page.locator('[data-rename="LEAF"]')).toBeVisible();
  await expect(page.locator('[data-rename="ASSEMBLY"]')).toBeVisible();
  await expect(page.locator('#policy-summary')).toHaveAttribute('data-changed-incoming', /^\d+$/);
  await expect(page.locator(geometry)).toHaveCount(5);
}

async function uploadPair(page) {
  await page.locator('#target-file').setInputFiles(`${fixtures}/target.dxf`);
  await page.locator('#donor-file').setInputFiles(`${fixtures}/donor.dxf`);
  await ready(page);
}

async function demo(page) {
  await page.getByTestId('load-demo').click();
  await ready(page);
  await expect(page.locator('[data-rename="LEAF"]')).toHaveValue('TRANSFER_LEAF');
  await expect(page.locator('[data-rename="ASSEMBLY"]')).toHaveValue('TRANSFER_ASSEMBLY');
}

async function approve(page) {
  await policy(page, 'prepared').click();
  await page.locator('#approve-names').check();
  await page.locator('#approve-impact').check();
  await expect(page.locator('#export-button')).toBeEnabled();
}

async function clearedApproval(page) {
  await expect(page.locator('#approve-names')).not.toBeChecked();
  await expect(page.locator('#approve-impact')).not.toBeChecked();
  await expect(page.locator('#export-button')).toBeDisabled();
}

async function downloadBytes(page, keyboard = false) {
  const event = page.waitForEvent('download');
  if (keyboard) await page.keyboard.press('Enter');
  else await page.locator('#export-button').click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('blockbridge-transfer.zip');
  expect(await download.failure()).toBeNull();
  return readFile(await download.path());
}

async function screenshot(page, testInfo, suffix) {
  const directory = resolve('artifacts/browser/screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${testInfo.project.name}-${suffix}.png`, fullPage: true, animations: 'disabled' });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
}

async function tabTo(page, selector) {
  for (let i = 0; i < 45; i++) {
    if (await page.locator(selector).evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard traversal did not reach ${selector}`);
}

async function assertSandbox(browser) {
  const session = await browser.newBrowserCDPSession();
  const commandLine = await session.send('Browser.getBrowserCommandLine');
  await session.detach();
  expect(commandLine.arguments).not.toContain('--no-sandbox');
  expect(commandLine.arguments).not.toContain('--disable-setuid-sandbox');
  expect(commandLine.arguments).not.toContain('--disable-seccomp-filter-sandbox');
  expect(commandLine.arguments).not.toContain('--disable-namespace-sandbox');
}

async function pauseDelayedReads(page) {
  await page.addInitScript(() => {
    window.__bbReadWaiters = [];
    window.__bbReadsStarted = 0;
    window.__bbReadsFinished = 0;
    for (const method of ['text', 'arrayBuffer']) {
      const original = File.prototype[method];
      File.prototype[method] = async function (...args) {
        if (this.name.startsWith('delayed-')) {
          window.__bbReadsStarted += 1;
          await new Promise(resolveRead => window.__bbReadWaiters.push(resolveRead));
        }
        try { return await original.apply(this, args); }
        finally { if (this.name.startsWith('delayed-')) window.__bbReadsFinished += 1; }
      };
    }
    window.__bbReleaseReads = () => {
      for (const resolveRead of window.__bbReadWaiters.splice(0)) resolveRead();
    };
  });
}

async function delayedInput(page, side = 'donor') {
  const bytes = await readFile(`${fixtures}/${side}.dxf`);
  await page.locator(`#${side}-file`).setInputFiles({ name: `delayed-${side}.dxf`, mimeType: 'application/dxf', buffer: bytes });
  await expect.poll(() => page.evaluate(() => window.__bbReadsStarted)).toBeGreaterThan(0);
}

async function releaseReads(page) {
  await page.evaluate(() => window.__bbReleaseReads());
  await expect.poll(() => page.evaluate(() => window.__bbReadsFinished)).toBeGreaterThan(0);
  // The old promises must finish before the assertions below. This is a browser
  // event-loop barrier, not a timer used to make an assertion pass accidentally.
  await page.evaluate(() => new Promise(resolveTurn => requestAnimationFrame(() => requestAnimationFrame(resolveTurn))));
}

const unsupported = { name: 'unsupported.dxf', mimeType: 'application/dxf', buffer: Buffer.from('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n0\nENDSEC\n0\nEOF\n') };

test('sandboxed browser and accessible Japanese/English keyboard review', async ({ page, browser }, testInfo) => {
  await assertSandbox(browser);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#export-button')).toBeDisabled();
  await expect(page.locator('#target-file')).toHaveAccessibleName(/元の図面/);
  await expect(page.locator('#donor-file')).toHaveAccessibleName(/渡す図面/);
  await expect(page.locator('#status')).toHaveAttribute('aria-live', /polite|assertive/);
  await tabTo(page, "[data-testid='load-demo']");
  await page.keyboard.press('Enter');
  await ready(page);
  await tabTo(page, "[data-policy='keep']");
  await page.keyboard.press('Enter');
  await expect(page.locator('#policy-summary')).toHaveAttribute('data-changed-incoming', '2');
  await page.keyboard.press('End');
  await expect(policy(page, 'prepared')).toBeFocused();
  await expect(policy(page, 'prepared')).toHaveAttribute('aria-selected', 'true');
  await tabTo(page, '#approve-names');
  await page.keyboard.press('Space');
  await tabTo(page, '#approve-impact');
  await page.keyboard.press('Space');
  await expect(page.locator('#export-button')).toBeEnabled();
  await tabTo(page, '#export-button');
  const entries = extractTransferZip(await downloadBytes(page, true));
  validateExportEntries(entries, await fixtureBytes());
  await screenshot(page, testInfo, 'keyboard-approved-ja');
  const jaSummary = await page.locator('#policy-summary').innerText();
  await page.locator('#locale-button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#target-file')).toHaveAccessibleName(/Destination/i);
  await expect(page.locator('#donor-file')).toHaveAccessibleName(/Donor/i);
  await expect(page.locator('#policy-summary')).not.toHaveText(jaSummary);
  await expect(page.locator('#export-button')).toBeEnabled();
  await expect(page.locator('[data-rename="LEAF"]')).toHaveValue('TRANSFER_LEAF');
  await screenshot(page, testInfo, 'keyboard-approved-en');
  await page.locator('#locale-button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});

test('demo rehearses keep, overwrite, and prepared geometry impacts', async ({ page }, testInfo) => {
  await page.goto('/');
  await demo(page);
  for (const [name, incoming, target] of [
    ['original', '0', '0'], ['keep', '2', '0'], ['overwrite', '0', '1'], ['prepared', '0', '0'],
  ]) {
    await policy(page, name).click();
    await expect(page.locator('#policy-summary')).toHaveAttribute('data-changed-incoming', incoming);
    await expect(page.locator('#policy-summary')).toHaveAttribute('data-changed-target', target);
    await expect(page.locator(geometry)).toHaveCount(5);
    await expect(page.locator('#export-button')).toBeDisabled();
    await screenshot(page, testInfo, `policy-${name}`);
  }
});

test('real file inputs work offline and export deterministic hash-bound original bytes', async ({ page, context, browser }, testInfo) => {
  await assertSandbox(browser);
  await page.goto('/');
  await expect(page.locator('#target-file')).toBeVisible();
  const before = await fixtureBytes();
  const requests = [];
  const webSockets = [];
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  page.on('websocket', socket => webSockets.push(socket.url()));
  await context.setOffline(true);
  await uploadPair(page);
  await approve(page);
  const first = await downloadBytes(page);
  const second = await downloadBytes(page);
  expect(second.equals(first)).toBe(true);
  const entries = extractTransferZip(first);
  const details = validateExportEntries(entries, before);
  const after = await fixtureBytes();
  expect(sha256(after.target)).toBe(sha256(before.target));
  expect(sha256(after.donor)).toBe(sha256(before.donor));
  expect(requests).toEqual([]);
  expect(webSockets).toEqual([]);
  const stored = await page.evaluate(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage),
    indexedDB: (await indexedDB.databases()).map(database => database.name), caches: await caches.keys(),
  }));
  expect(stored.local.filter(key => key !== 'blockbridge-locale')).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(stored.indexedDB).toEqual([]);
  expect(stored.caches).toEqual([]);
  if (testInfo.project.name === 'desktop') await writeBrowserExport(entries, details);
  await screenshot(page, testInfo, 'real-files-prepared');
});

test('invalid and conflicting rename proposals cannot export', async ({ page }) => {
  await page.goto('/');
  await demo(page);
  await policy(page, 'prepared').click();
  for (const value of ['', 'SAME', 'LEAF', 'TRANSFER_ASSEMBLY', 'BAD/NAME', '*ANONYMOUS', 'NAME\u00e9']) {
    await page.locator('[data-rename="LEAF"]').fill(value);
    await clearedApproval(page);
    await expect(page.locator('#issue-banner')).toBeVisible();
    await expect(page.locator('#issue-banner')).toHaveAttribute('role', 'alert');
    await expect(page.locator(geometry)).toHaveCount(0);
    await page.locator('[data-rename="LEAF"]').fill('TRANSFER_LEAF');
    await ready(page);
  }
});

test('editing either approved rename clears both approvals and requires a fresh review', async ({ page }) => {
  await page.goto('/');
  await demo(page);
  for (const name of names) {
    await approve(page);
    await page.locator(`[data-rename="${name}"]`).fill(`REVIEWED_${name}`);
    await clearedApproval(page);
    await ready(page);
    await approve(page);
    const entries = extractTransferZip(await downloadBytes(page));
    expect(entries['donor-transfer.dxf'].toString('ascii')).toContain(`REVIEWED_${name}`);
    expect(entries['donor-transfer.dxf'].toString('ascii')).not.toContain(`TRANSFER_${name}`);
    await page.locator(`[data-rename="${name}"]`).fill(`TRANSFER_${name}`);
    await clearedApproval(page);
  }
});

for (const side of ['target', 'donor']) {
  test(`${side} replacement immediately clears stale approvals and preview during the read`, async ({ page }) => {
    await pauseDelayedReads(page);
    await page.goto('/');
    await uploadPair(page);
    await approve(page);
    await delayedInput(page, side);
    await clearedApproval(page);
    await expect(page.locator(geometry)).toHaveCount(0);
    await releaseReads(page);
    await ready(page);
    await clearedApproval(page);
  });
}

test('reset removes inputs, approvals, and preview and supports a fresh upload', async ({ page }) => {
  await page.goto('/');
  await uploadPair(page);
  await approve(page);
  await page.locator('#reset-button').click();
  await clearedApproval(page);
  await expect(page.locator(geometry)).toHaveCount(0);
  await expect(page.locator('#target-file')).toHaveValue('');
  await expect(page.locator('#donor-file')).toHaveValue('');
  await page.locator('#donor-file').setInputFiles(`${fixtures}/donor.dxf`);
  await expect(page.locator(geometry)).toHaveCount(0);
  await expect(page.locator('#export-button')).toBeDisabled();
  await page.locator('#target-file').setInputFiles(`${fixtures}/target.dxf`);
  await ready(page);
  await clearedApproval(page);
});

test('unsupported input clears an approved review and valid replacement recovers', async ({ page }) => {
  await page.goto('/');
  await uploadPair(page);
  await approve(page);
  await page.locator('#donor-file').setInputFiles(unsupported);
  await clearedApproval(page);
  await expect(page.locator('#issue-banner')).toBeVisible();
  await expect(page.locator(geometry)).toHaveCount(0);
  await page.locator('#donor-file').setInputFiles(`${fixtures}/donor.dxf`);
  await ready(page);
  await clearedApproval(page);
});

test('mismatched declared units block preview and export', async ({ page }) => {
  await page.goto('/');
  await uploadPair(page);
  await approve(page);
  const donor = await readFile(`${fixtures}/donor.dxf`, 'ascii');
  const changed = donor.replace(/(\$INSUNITS\r?\n\s*70\r?\n)4(?=\r?\n)/, (_, prefix) => `${prefix}6`);
  expect(changed).not.toBe(donor);
  await page.locator('#donor-file').setInputFiles({ name: 'unit-mismatch.dxf', mimeType: 'application/dxf', buffer: Buffer.from(changed) });
  await clearedApproval(page);
  await expect(page.locator('#issue-banner')).toBeVisible();
  await expect(page.locator(geometry)).toHaveCount(0);
});

test('a slow old donor cannot replace a newer unsupported file', async ({ page }) => {
  await pauseDelayedReads(page);
  await page.goto('/');
  await uploadPair(page);
  await approve(page);
  await delayedInput(page);
  await page.locator('#donor-file').setInputFiles(unsupported);
  await expect(page.locator('#issue-banner')).toBeVisible();
  await releaseReads(page);
  await clearedApproval(page);
  await expect(page.locator(geometry)).toHaveCount(0);
  await expect(page.locator('#issue-banner')).toBeVisible();
  expect(await page.locator('#donor-file').evaluate(input => input.files[0]?.name)).toBe('unsupported.dxf');
});

test('a slow old donor cannot resurrect a reset review', async ({ page }) => {
  await pauseDelayedReads(page);
  await page.goto('/');
  await uploadPair(page);
  await approve(page);
  await delayedInput(page);
  await page.locator('#reset-button').click();
  await releaseReads(page);
  await clearedApproval(page);
  await expect(page.locator(geometry)).toHaveCount(0);
  await expect(page.locator('#target-file')).toHaveValue('');
  await expect(page.locator('#donor-file')).toHaveValue('');
});
