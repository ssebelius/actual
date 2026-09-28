// Records bank file setup in the running app to bank-file-setup-demo.webm:
// a new budget made from a Chase QFX and a Chase Sapphire CSV.
// Start the app first (yarn start serves http://localhost:3001; set ACTUAL_URL
// to use another address), then run from the repository root:
// node proposals/bank-file-setup/ux/record-demo.mjs
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A one-off review tool outside any workspace. Playwright is a dependency of
// @actual-app/web and is hoisted to the root node_modules.
// oxlint-disable-next-line actual/no-extraneous-dependencies
import { chromium } from 'playwright';

const here = import.meta.dirname;
const app = process.env.ACTUAL_URL ?? 'http://localhost:3001';
const bankFiles = path.join(here, '../../../packages/sample-data/bank-files');
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

const videoDir = await mkdtemp(path.join(tmpdir(), 'setup-demo-'));
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
    await page.screenshot({ path: path.join(shotsDir, `setup-${shot}.png`) });
  }
  await pause(ms);
};
const moveTo = async locator => {
  // Bring anything off screen to the middle, where the viewer is looking
  const isVisible = await locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  if (!isVisible) {
    await locator.evaluate(el =>
      el.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
    await pause(700);
  }
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
const type = async (locator, text) => {
  await click(locator);
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 60 });
  await locator.press('Tab');
  await pause(400);
};
const choose = async (picker, option) => {
  await click(picker);
  await click(
    page.getByRole('menu').getByRole('button', { name: option, exact: true }),
  );
};
const addFile = async (card, name) => {
  const chooser = page.waitForEvent('filechooser');
  await click(card.getByRole('button', { name: /^Add files/ }));
  await (await chooser).setFiles(path.join(bankFiles, name));
  await pause(800);
};

// The first visit may ask about a sync server before the welcome screen
const start = page.getByRole('button', { name: 'Start budgeting' });
const noServer = page.getByRole('button', { name: "Don't use a server" });
await start.or(noServer).waitFor();
if (await noServer.isVisible()) {
  await click(noServer);
}
await start.waitFor();
await caption(
  'A new Actual user, starting with bank files they downloaded.',
  1600,
);
await click(start);

const setup = page.getByTestId('bank-file-setup-page');
// The first-run tour notice would sit over the transfer and Create buttons
const welcome = page
  .getByRole('alert')
  .filter({ hasText: 'Welcome to Actual!' });
await welcome.waitFor();
await click(welcome.getByRole('button', { name: 'Close' }));
await caption('Setup offers to build the budget from bank files.', 2000);
await click(page.getByRole('button', { name: /^Set up from bank files/ }));
await setup.getByRole('heading', { name: 'Your accounts' }).waitFor();

const cards = setup.getByTestId('setup-account-card');
const addAccount = setup.getByRole('button', {
  name: 'Add account',
  exact: true,
});
if ((await cards.count()) === 0) {
  await click(addAccount);
}

// Checking: the QFX names its bank and carries the balance
const checking = cards.nth(0);
await caption('Add the checking account QFX from Chase.', 1800);
await addFile(checking, 'chase-checking.qfx');
await caption(
  'The QFX names its bank, so JPMorgan Chase is filled in, and it carries the balance.',
  2800,
);
await type(
  checking.getByLabel('Account name', { exact: true }),
  'Chase Checking',
);

// Credit card: the CSV needs its columns mapped and the amount owed
await caption('Next, the credit card, downloaded as a CSV.', 1800);
await click(addAccount);
const card = cards.nth(1);
await card.waitFor();
await type(card.getByLabel('Account name', { exact: true }), 'Chase Sapphire');
await choose(card.getByLabel('Type', { exact: true }), 'Credit card');
await addFile(card, 'chase-sapphire.csv');
await caption('A CSV does not say which column is which.', 1800);

await click(card.getByRole('button', { name: /^Map columns/ }));
const modal = page.getByTestId('bank-file-setup-csv-mapping-modal');
await modal.waitFor();
await caption("Map its columns once, with the file's rows shown below.", 2000);
await choose(
  modal.getByRole('button', { name: 'Date', exact: true }),
  'Transaction Date',
);
await choose(
  modal.getByRole('button', { name: 'Payee', exact: true }),
  'Description',
);
await choose(
  modal.getByRole('button', { name: 'Amount', exact: true }),
  'Amount',
);
// The date format button is named by its current value, so it is found
// through the label beside it
await choose(
  modal
    .getByText('Date format', { exact: true })
    .locator('xpath=..')
    .getByRole('button'),
  'MM/DD/YYYY',
);
await pause(800);
await click(modal.getByRole('button', { name: 'Done', exact: true }));
await modal.waitFor({ state: 'detached' });

await caption(
  'A CSV carries no balance, so setup asks what was owed at the end of the file.',
  2600,
);
await type(card.getByLabel(/^How much did you owe on/), '412.60');

// Review: starting balances and the transfer between the two accounts
const review = setup.getByRole('table', { name: 'What will be created' });
await moveTo(review);
await caption(
  'The review works out each starting balance from the known balance and the imported transactions.',
  4000,
);
const confirm = setup.getByRole('button', { name: /^Confirm/ });
await moveTo(confirm);
await caption(
  'The card payment appears in both files, so setup offers to record it as one transfer.',
  3000,
);
await click(confirm);
const create = setup.getByRole('button', { name: 'Create', exact: true });
await moveTo(create);
await caption(
  'Confirmed. 2 accounts and 14 transactions, ready to create.',
  2500,
);

await click(create);
await page.waitForURL('**/categories/uncategorized');
await pause(1200);
await caption(
  'The new budget opens on the transactions left to categorize.',
  2800,
);
await moveTo(page.getByRole('link', { name: /^Chase Checking/ }));
await caption(
  "The sidebar shows the bank's balances: 6,210.48 in checking, 412.60 owed on the card.",
  4000,
);
await caption('', 800);

const video = page.video();
await context.close();
await browser.close();
const out = path.join(here, 'bank-file-setup-demo.webm');
await rename(await video.path(), out);
await rm(videoDir, { recursive: true, force: true });
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
