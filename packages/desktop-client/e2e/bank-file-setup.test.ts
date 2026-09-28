import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';
import { SetupPage } from './page-models/setup-page';

test.describe('Bank file setup', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('sets up a budget from a QFX and a CSV file', async () => {
    await page.getByRole('button', { name: 'Start budgeting' }).click();
    const setupPage = new SetupPage(page);
    await expect(setupPage.choiceHeading).toBeVisible();
    await expect(page).toMatchThemeScreenshots();

    await setupPage.chooseSetUpFromBankFiles();

    // The QFX names its bank and carries a ledger balance dated on its end
    const checking = await setupPage.accountCard(0);
    await setupPage.addFiles(checking, 'setup-checking.qfx');
    await expect(checking.getByLabel('Bank', { exact: true })).toHaveValue(
      'JPMorgan Chase',
    );
    await setupPage.fillAccount(checking, { name: 'Chase Checking' });

    // The CSV needs its columns mapped, then the amount owed
    const card = await setupPage.accountCard(1);
    await setupPage.fillAccount(card, {
      bank: 'Chase',
      name: 'Chase Sapphire',
      type: 'Credit card',
    });
    await setupPage.addFiles(card, 'setup-card.csv');
    await expect(card).toContainText('Needs columns');
    await expect(setupPage.createButton).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await setupPage.mapCsvColumns(card, {
      date: 'Transaction Date',
      payee: 'Description',
      amount: 'Amount',
      dateFormat: 'MM/DD/YYYY',
    });
    await expect(card).toContainText('Needs a balance');
    await setupPage.enterBalance(card, /^How much did you owe on/, '412.60');

    // Starting balances are known balance minus the imported net
    await expect(setupPage.reviewTable).toContainText('1,250.00');
    await expect(setupPage.reviewTable).toContainText('6,210.48');
    await expect(setupPage.reviewTable).toContainText('721.95 owed');
    await expect(setupPage.reviewTable).toContainText('412.60 owed');

    await setupPage.confirmOnlyTransfer();
    await expect(setupPage.root).toContainText(
      '2 accounts and 14 transactions will be created.',
    );
    await expect(page).toMatchThemeScreenshots();

    await setupPage.create();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Created 2 accounts and 14 transactions.' }),
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: /^Chase Checking/ }),
    ).toContainText('6,210.48');
    await expect(
      page.getByRole('link', { name: /^Chase Sapphire/ }),
    ).toContainText('-412.60');
    await expect(page.getByTestId('sidebar-all-accounts-balance')).toHaveText(
      '5,797.88',
    );

    const checkingPage = await navigation.goToAccountPage('Chase Checking');
    await expect(checkingPage.accountBalance).toHaveText('6,210.48');
    await expect(checkingPage.transactionTableRow).toHaveCount(9);
    const checkingStart = checkingPage.transactionTableRow.filter({
      hasText: 'Starting Balance',
    });
    await expect(checkingStart.getByTestId('credit')).toHaveText('1,250.00');
    const paymentOut = checkingPage.transactionTableRow.filter({
      hasText: 'Chase Sapphire',
    });
    await expect(paymentOut).toHaveCount(1);
    await expect(paymentOut.getByTestId('debit')).toHaveText('523.10');
    await expect(paymentOut.getByTestId('transfer-icon')).toBeVisible();

    const cardPage = await navigation.goToAccountPage('Chase Sapphire');
    await expect(cardPage.accountBalance).toHaveText('-412.60');
    await expect(cardPage.transactionTableRow).toHaveCount(7);
    const cardStart = cardPage.transactionTableRow.filter({
      hasText: 'Starting Balance',
    });
    await expect(cardStart.getByTestId('debit')).toHaveText('721.95');
    const paymentIn = cardPage.transactionTableRow.filter({
      hasText: 'Chase Checking',
    });
    await expect(paymentIn).toHaveCount(1);
    await expect(paymentIn.getByTestId('credit')).toHaveText('523.10');
    await expect(paymentIn.getByTestId('transfer-icon')).toBeVisible();
  });

  test('closing setup before Create leaves no accounts', async () => {
    const setupPage = await configurationPage.startWithBankFiles();

    const checking = await setupPage.accountCard(0);
    await setupPage.addFiles(checking, 'setup-checking.qfx');
    await expect(setupPage.reviewTable).toContainText('6,210.48');

    await setupPage.close();

    await expect(page.getByText('No accounts yet')).toBeVisible();
    await expect(page.getByTestId('sidebar-all-accounts-balance')).toHaveText(
      '0.00',
    );
    await expect(page.getByTestId('sidebar-on-budget-balance')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-off-budget-balance')).toHaveCount(0);
  });
});
