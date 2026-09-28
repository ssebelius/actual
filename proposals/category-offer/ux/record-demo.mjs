// Records the category offer in the running app to category-offer-demo.webm:
// in the family sample budget, categorizing one Chick-fil-A purchase offers to
// categorize the other uncategorized one and save a rule.
// First generate the budget (yarn seed --profile family --yes --end-date
// 2026-09-27) and start the app (yarn start serves http://localhost:3001; set
// ACTUAL_URL to use another address), then run from the repository root:
// node proposals/category-offer/ux/record-demo.mjs
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A one-off review tool outside any workspace. Playwright is a dependency of
// @actual-app/web and is hoisted to the root node_modules.
// oxlint-disable-next-line actual/no-extraneous-dependencies
import { chromium } from 'playwright';

const here = import.meta.dirname;
const app = process.env.ACTUAL_URL ?? 'http://localhost:3001';
const budgetZip = path.join(
  here,
  '../../../packages/sample-data/output/family-with-kids-sample-seed2026.zip',
);
const size = { width: 1280, height: 800 };
// Set DEMO_SHOTS to a directory to also save a screenshot at each caption.
const shotsDir = process.env.DEMO_SHOTS;

// Headless recordings have no cursor, so draw one that follows the mouse,
// and add a caption bar the script can write to.
const overlayScript = `
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(135,25,224,.35);border:2px solid #8719e0;pointer-events:none;transition:transform .1s;left:-50px;top:-50px';
    document.body.appendChild(dot);
    addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'));
    addEventListener('mouseup', () => (dot.style.transform = ''));
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;z-index:99998;left:50%;top:8px;transform:translateX(-50%);max-width:760px;padding:8px 16px;border-radius:6px;background:rgba(20,20,30,.85);color:#fff;font:15px/1.4 system-ui,sans-serif;text-align:center;pointer-events:none;display:none';
    document.body.appendChild(bar);
    window.setCaption = t => { bar.textContent = t; bar.style.display = t ? 'block' : 'none'; };
  });`;

const videoDir = await mkdtemp(path.join(tmpdir(), 'offer-demo-'));
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to reuse an installed Chromium build.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: videoDir, size },
});
const page = await context.newPage();
await page.addInitScript(overlayScript);
await page.goto(app);

let shot = 0;
const pause = ms => page.waitForTimeout(ms);
const caption = async (text, ms = 2200) => {
  await page.evaluate(t => window.setCaption(t), text);
  if (shotsDir) {
    shot += 1;
    await page.screenshot({ path: path.join(shotsDir, `offer-${shot}.png`) });
  }
  await pause(ms);
};
const moveTo = async locator => {
  const box = await locator.boundingBox();
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 20 });
  await pause(300);
  return { x, y };
};
const click = async locator => {
  const { x, y } = await moveTo(locator);
  await page.mouse.click(x, y);
  await pause(500);
};

// Import the generated family budget from the welcome screen
const importButton = page.getByRole('button', { name: 'Import my budget' });
const noServer = page.getByRole('button', { name: "Don't use a server" });
await importButton.or(noServer).waitFor();
if (await noServer.isVisible()) {
  await click(noServer);
}
await importButton.waitFor();
await caption('Import the family sample budget, exported from Actual.', 1800);
await click(importButton);
await click(
  page.getByRole('button', {
    name: 'Actual Import a file exported from Actual',
  }),
);
const chooser = page.waitForEvent('filechooser');
await click(page.getByRole('button', { name: 'Select file...' }));
await (await chooser).setFiles(budgetZip);
await page.getByTestId('budget-table').waitFor({ timeout: 60_000 });
// The first-run tour notice would sit over the table
const welcome = page
  .getByRole('alert')
  .filter({ hasText: 'Welcome to Actual!' });
await welcome.waitFor();
await pause(600);
await click(welcome.getByRole('button', { name: 'Close' }));

// Find the Chick-fil-A purchases on the card they were bought with
await click(page.getByRole('link', { name: /^Family Rewards Card/ }));
const table = page.getByTestId('transaction-table');
await table.waitFor();
const search = page.getByPlaceholder('Search');
await click(search);
await search.pressSequentially('Chick-fil-A', { delay: 60 });
await pause(1200);
await caption(
  'Chick-fil-A: 10 purchases marked Dining Out, and 2 in April left uncategorized.',
  4000,
);

const rows = table.getByTestId('row');
const april17 = rows.filter({ hasText: '04/17/2026' });
const april4 = rows.filter({ hasText: '04/04/2026' });
await moveTo(april4.getByTestId('category'));
await pause(600);

// Categorize April 17 the ordinary way: pick a category and press Enter
await caption('Set the April 17 purchase to Dining Out.', 1800);
const category = april17.getByTestId('category');
await click(category);
const categoryInput = category.getByRole('textbox');
await categoryInput.pressSequentially('Dining Out', { delay: 80 });
await pause(700);
await categoryInput.press('Enter');

const offer = page.getByRole('region', { name: 'Category offer' });
await offer.waitFor();
await pause(600);
await moveTo(offer);
await caption(
  'An offer opens under the edited row: set the other uncategorized purchase too, and save a rule.',
  5000,
);

await click(offer.getByRole('button', { name: 'Apply', exact: true }));
await caption(
  'April 4 is now Dining Out as well, and the strip confirms the saved rule.',
  4500,
);
await moveTo(april4.getByTestId('category'));
await caption('Undo reverses both rows; View rule opens the saved rule.', 3000);

// The rule is an ordinary rule on the Rules page
await click(page.getByRole('button', { name: 'More', exact: true }));
await click(page.getByRole('link', { name: 'Rules' }));
const filter = page.getByPlaceholder('Filter rules...');
await filter.waitFor();
await click(filter);
await filter.pressSequentially('Chick-fil-A', { delay: 60 });
await pause(1000);
await caption(
  'The saved rule: payee is Chick-fil-A, set category to Dining Out.',
  4500,
);
await caption('', 800);

const video = page.video();
await context.close();
await browser.close();
const out = path.join(here, 'category-offer-demo.webm');
await rename(await video.path(), out);
await rm(videoDir, { recursive: true, force: true });
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
