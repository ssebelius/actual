import path from 'path';

import type { Locator, Page } from '@playwright/test';

type CsvMapping = {
  date: string;
  payee: string;
  amount: string;
  dateFormat: string;
};

export class SetupPage {
  readonly page: Page;
  readonly choiceHeading: Locator;
  readonly root: Locator;
  readonly heading: Locator;
  readonly accountCards: Locator;
  readonly reviewTable: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.choiceHeading = page.getByRole('heading', {
      name: 'How do you want to start?',
    });
    this.root = page.getByTestId('bank-file-setup-page');
    this.heading = this.root.getByRole('heading', { name: 'Your accounts' });
    this.accountCards = this.root.getByTestId('setup-account-card');
    this.reviewTable = this.root.getByRole('table', {
      name: 'What will be created',
    });
    this.createButton = this.root.getByRole('button', {
      name: 'Create',
      exact: true,
    });
  }

  async chooseSetUpFromBankFiles() {
    await this.page
      .getByRole('button', { name: /^Set up from bank files/ })
      .click();
    await this.heading.waitFor();
  }

  /**
   * Returns the card at `index`, adding cards until it exists. The accounts
   * step may open with one empty card or none; this works with either.
   */
  async accountCard(index: number) {
    while ((await this.accountCards.count()) <= index) {
      await this.root
        .getByRole('button', { name: 'Add account', exact: true })
        .click();
    }
    const card = this.accountCards.nth(index);
    await card.waitFor();
    return card;
  }

  async addFiles(card: Locator, ...fileNames: string[]) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await card.getByRole('button', { name: /^Add files/ }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      fileNames.map(name => path.join(__dirname, '..', 'data', name)),
    );
  }

  async fillAccount(
    card: Locator,
    fields: { bank?: string; name?: string; type?: string },
  ) {
    if (fields.bank != null) {
      const bank = card.getByLabel('Bank', { exact: true });
      await bank.fill(fields.bank);
      await bank.press('Tab');
    }
    if (fields.name != null) {
      const name = card.getByLabel('Account name', { exact: true });
      await name.fill(fields.name);
      await name.press('Tab');
    }
    if (fields.type != null) {
      await card.getByLabel('Type', { exact: true }).click();
      await this.page
        .getByRole('menu')
        .getByRole('button', { name: fields.type, exact: true })
        .click();
    }
  }

  async mapCsvColumns(card: Locator, mapping: CsvMapping) {
    await card.getByRole('button', { name: /^Map columns/ }).click();
    const modal = this.page.getByTestId('bank-file-setup-csv-mapping-modal');
    await modal.waitFor();

    await this.chooseMappingOption(
      modal.getByRole('button', { name: 'Date', exact: true }),
      mapping.date,
    );
    await this.chooseMappingOption(
      modal.getByRole('button', { name: 'Payee', exact: true }),
      mapping.payee,
    );
    await this.chooseMappingOption(
      modal.getByRole('button', { name: 'Amount', exact: true }),
      mapping.amount,
    );
    // The date format button is named by its current value, so it is found
    // through the label beside it
    await this.chooseMappingOption(
      modal
        .getByText('Date format', { exact: true })
        .locator('xpath=..')
        .getByRole('button'),
      mapping.dateFormat,
    );

    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    await modal.waitFor({ state: 'detached' });
  }

  async enterBalance(card: Locator, question: RegExp, amount: string) {
    const input = card.getByLabel(question);
    await input.fill(amount);
    await input.press('Tab');
  }

  async confirmOnlyTransfer() {
    await this.root.getByRole('button', { name: /^Confirm/ }).click();
  }

  async create() {
    await this.createButton.click();
    await this.page.waitForURL('**/categories/uncategorized');
  }

  async close() {
    await this.root.getByRole('button', { name: 'Close setup' }).click();
    await this.page
      .getByRole('button', { name: 'Leave setup', exact: true })
      .click();
    await this.page.waitForURL('**/budget');
  }

  private async chooseMappingOption(picker: Locator, option: string) {
    await picker.click();
    await this.page
      .getByRole('menu')
      .getByRole('button', { name: option, exact: true })
      .click();
  }
}
