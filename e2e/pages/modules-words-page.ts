import { expect, type Locator, type Page } from '@playwright/test';

import { t } from '../i18n';

/** `key` is a module key (`fines`). */
const moduleName = (key: string) => t(`settings.modulesWords.moduleNames.${key}`);

/**
 * [Epic 77 / #3928] Settings › Modules & words (`/settings?section=modulesWords`): the kind
 * cards and their preview, the Modules tab and the Words tab. Locators go by role and by the
 * app's own i18n strings, so the spec reads the same in bn and en.
 */
export class ModulesWordsPage {
  constructor(readonly page: Page) {}

  async open(tab: 'modules' | 'words' = 'modules'): Promise<void> {
    await this.page.goto(`/settings?section=modulesWords&tab=${tab}`);
    await expect(
      this.page.getByRole('heading', { name: t('settings.modulesWords.kinds.title') }),
    ).toBeVisible();
  }

  // --- kind cards and preview (click 1: the card, click 2: Apply) ---

  kindCard(name: string): Locator {
    return this.page.getByRole('button', { name });
  }

  /** One of the preview's two module lists, by its heading. */
  previewList(which: 'willBeOn' | 'willBeOff'): Locator {
    const heading = this.page.getByRole('heading', {
      name: t(`settings.modulesWords.preview.${which}`),
    });
    return this.page.getByRole('dialog').locator('section').filter({ has: heading });
  }

  applyButton(): Locator {
    return this.page.getByRole('button', { name: t('settings.modulesWords.preview.apply') });
  }

  // --- Modules tab ---

  moduleSwitch(key: string): Locator {
    return this.page.getByRole('switch', { name: moduleName(key), exact: true });
  }

  moduleRow(key: string): Locator {
    return this.page.getByRole('listitem').filter({ has: this.moduleSwitch(key) });
  }

  savedToast(key: string, on: boolean): Locator {
    return this.page.getByText(
      t('settings.modulesWords.modules.saved', {
        module: moduleName(key),
        state: t(on ? 'settings.modulesWords.modules.on' : 'settings.modulesWords.modules.off'),
      }),
    );
  }

  undoButton(): Locator {
    return this.page.getByRole('button', { name: t('settings.modulesWords.modules.undo') });
  }

  /** "Who can't see it" for one module: open, tick the roles (UserRole values), Save. */
  async hideFromRoles(key: string, roles: string[]): Promise<void> {
    await this.moduleRow(key)
      .getByRole('button', { name: t('settings.modulesWords.modules.whoCantSee') })
      .click();
    const dialog = this.page.getByRole('dialog');
    for (const role of roles) {
      await dialog.getByRole('checkbox', { name: t(`auth.schoolPicker.roles.${role}`) }).check();
    }
    await dialog.getByRole('button', { name: t('settings.modulesWords.dialog.save') }).click();
    await expect(dialog).toHaveCount(0);
  }

  // --- Words tab ---

  async openWordsTab(): Promise<void> {
    await this.page.getByRole('tab', { name: t('settings.modulesWords.tabs.words') }).click();
  }

  /** The three fields of one word row: English singular, English plural, Bangla. */
  wordField(key: string, field: 'one' | 'other' | 'bn'): Locator {
    return this.page.locator(`#word-${key}-${field}`);
  }

  async setWord(key: string, word: { one: string; other: string; bn: string }): Promise<void> {
    await this.wordField(key, 'one').fill(word.one);
    await this.wordField(key, 'other').fill(word.other);
    await this.wordField(key, 'bn').fill(word.bn);
  }

  saveWordsButton(): Locator {
    return this.page.getByRole('button', { name: t('settings.modulesWords.words.save') });
  }
}
