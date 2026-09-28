// Records a walkthrough of category-offer-prototype.html to category-offer-prototype-demo.webm.
// Run from the repository root: node proposals/category-offer/ux/record-prototype-demo.mjs
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// A one-off review tool outside any workspace. Playwright is a dependency of
// @actual-app/web and is hoisted to the root node_modules.
// oxlint-disable-next-line actual/no-extraneous-dependencies
import { chromium } from 'playwright';

const here = import.meta.dirname;
const prototype = pathToFileURL(
  path.join(here, 'category-offer-prototype.html'),
).href;
const size = { width: 1280, height: 800 };

// Headless recordings have no cursor, so draw one that follows the mouse.
const cursorScript = `
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(135,25,224,.35);border:2px solid #8719e0;pointer-events:none;transition:transform .1s;left:-50px;top:-50px';
    document.body.appendChild(dot);
    addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'));
    addEventListener('mouseup', () => (dot.style.transform = ''));
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
await page.addInitScript(cursorScript);
await page.goto(prototype + '?d=A');

const pause = ms => page.waitForTimeout(ms);
const caption = async (text, ms = 2200) => {
  await page.evaluate(t => window.setCaption(t), text);
  await pause(ms);
};
const moveTo = async selector => {
  const box = await page.locator(selector).first().boundingBox();
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 20 });
  await pause(300);
  return { x, y };
};
const click = async selector => {
  const { x, y } = await moveTo(selector);
  await page.mouse.click(x, y);
  await pause(500);
};
const categorizeApr17 = async () => {
  await click('[data-cat="11"]');
  await moveTo('[data-opt="Fast food"]');
};
const tab = async d => {
  await click(`.tabs button[data-d="${d}"]`);
  await pause(400);
};

await caption(
  'Family sample: Chick-fil-A has 12 purchases. 10 are Dining Out, 2 are uncategorized (Apr 17, Apr 4).',
  3500,
);

// A: notification
await caption('A · Notification. Set Apr 17 to Fast food.', 1500);
await categorizeApr17();
await click('[data-opt="Fast food"]');
await caption(
  'The offer appears bottom right, where Actual shows notifications today, and says a rule will be saved.',
  3400,
);
await click('#apply');
await caption(
  'Apply updates Apr 4 and saves a rule. The confirmation offers Undo and View rule.',
  3000,
);
await click('.notice .link');
await caption(
  'The rule is an ordinary rule: visible and editable on the Rules page.',
  2600,
);
await click('.modal .btn');
await click('.notice .btn');
await caption(
  'Undo puts everything back as it was before the edit, Apr 17 included.',
  2800,
);

// B: inline strip (recommended)
await tab('B');
await caption('B · Inline strip, the recommended direction. Same edit.', 1800);
await categorizeApr17();
await click('[data-opt="Fast food"]');
await caption(
  "The offer opens directly under the row you edited, in Actual's notice colors.",
  3400,
);
await click('#apply');
await caption(
  'Changed rows take the table highlight briefly; the confirmation stays in the strip.',
  3400,
);
await click('.strip .btn');
await caption(
  'Undo restores everything. Then the riskier case: also changing Dining Out rows.',
  2600,
);
await categorizeApr17();
await click('[data-opt="Fast food"]');
await click('#include');
await caption(
  'Including categorized rows turns Apply into a review, because it overwrites earlier choices.',
  3200,
);
await click('#apply');
await caption(
  'The review panel lists exactly which rows will change. Any can be unticked.',
  3400,
);
await click('.pop input[data-r="0"]');
await click('#pop-apply');
await caption(
  'Apply changes Apr 4 and the 9 Dining Out rows still ticked, and saves the rule.',
  3200,
);

// C: in the picker
await tab('C');
await caption(
  'C · In the picker. Rejected in review: Shift+Enter already means "save and move up".',
  3000,
);
await categorizeApr17();
await caption(
  'Enter sets this row only. The footer action also sets the uncategorized rows and saves a rule.',
  3600,
);
await click('#apply-all');
await caption(
  'No offer interrupts afterward; the confirmation is a notification.',
  3000,
);

// D: review popover
await tab('D');
await caption('D · Review popover as the default. Same edit.', 1500);
await categorizeApr17();
await click('[data-opt="Fast food"]');
await caption(
  'A panel lists the rows that would change. Uncategorized rows are selected.',
  3400,
);
await click('.pop input[data-r="0"]');
await caption(
  'Dining Out rows can be added one by one; the button count follows.',
  2600,
);
await click('.pop input[data-r="0"]');
await click('#pop-apply');
await caption(
  'Review found this too heavy as the default for a usually one-click decision.',
  3200,
);

await caption(
  "Recommended: B, with D's panel only when already-categorized rows would change.",
  4000,
);

const video = page.video();
await context.close();
await browser.close();
const out = path.join(here, 'category-offer-prototype-demo.webm');
await rename(await video.path(), out);
await rm(videoDir, { recursive: true, force: true });
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
