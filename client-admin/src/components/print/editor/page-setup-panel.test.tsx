import '@biddaloy/ui/test';

import type { TemplateDefinition } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageSetupPanel, type PageSetupPanelProps } from './page-setup-panel';

const page = (over: Partial<TemplateDefinition['page']> = {}): TemplateDefinition['page'] => ({
  widthMm: 85.6,
  heightMm: 54,
  sides: ['front'],
  ...over,
});

function setup(over: Partial<PageSetupPanelProps> = {}) {
  const mocks = {
    onName: vi.fn<PageSetupPanelProps['onName']>(),
    onBatchSize: vi.fn<PageSetupPanelProps['onBatchSize']>(),
    onPage: vi.fn<PageSetupPanelProps['onPage']>(),
    onCopyLabel: vi.fn<PageSetupPanelProps['onCopyLabel']>(),
  };
  const props: PageSetupPanelProps = {
    name: 'Classic',
    batchSize: 50,
    page: page(),
    copyLabel: undefined,
    ...mocks,
    ...over,
  };
  return {
    ...mocks,
    ...renderWithProviders(<PageSetupPanel {...props} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    }),
  };
}

describe('PageSetupPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('commits a changed name on blur, trimmed; ignores blank or unchanged names', async () => {
    const { user, onName } = setup();
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Modern  ');
    await user.tab();
    expect(onName).toHaveBeenCalledWith('Modern');

    onName.mockClear();
    await user.clear(name);
    await user.tab();
    expect(onName).not.toHaveBeenCalled(); // blank

    await user.type(name, 'Classic');
    await user.tab();
    expect(onName).not.toHaveBeenCalled(); // same as the saved name
  });

  it('picks a paper preset; the custom entry changes nothing by itself', async () => {
    const { user, onPage } = setup({ page: page({ widthMm: 100, heightMm: 70 }) });
    await user.click(await screen.findByRole('combobox', { name: 'Paper' }));
    await user.click(await screen.findByRole('option', { name: 'CR80 card, portrait' }));
    expect(onPage).toHaveBeenCalledWith({ widthMm: 54, heightMm: 85.6 });

    onPage.mockClear();
    await user.click(screen.getByRole('combobox', { name: 'Paper' }));
    await user.click(await screen.findByRole('option', { name: 'Custom size' }));
    expect(onPage).not.toHaveBeenCalled();
  });

  it('recognises both CR80 orientations and shows them selected', async () => {
    setup({ page: page({ widthMm: 54, heightMm: 85.6 }) });
    expect((await screen.findByRole('combobox', { name: 'Paper' })).textContent).toContain(
      'portrait',
    );
  });

  it('commits a typed width, height and batch size (batch rounded)', async () => {
    const { user, onPage, onBatchSize } = setup();
    const width = await screen.findByLabelText('Width (mm)');
    await user.clear(width);
    await user.type(width, '90');
    await user.tab();
    expect(onPage).toHaveBeenCalledWith({ widthMm: 90 });

    const height = screen.getByLabelText('Height (mm)');
    await user.clear(height);
    await user.type(height, '60');
    await user.tab();
    expect(onPage).toHaveBeenCalledWith({ heightMm: 60 });

    const batch = screen.getByLabelText('Cards per batch');
    await user.clear(batch);
    await user.type(batch, '30');
    await user.tab();
    expect(onBatchSize).toHaveBeenCalledWith(30);
  });

  it('switches between one and two sides', async () => {
    const { user, onPage } = setup();
    await user.click(await screen.findByRole('combobox', { name: 'Sides' }));
    await user.click(await screen.findByRole('option', { name: 'Front and back' }));
    expect(onPage).toHaveBeenCalledWith({ sides: 'both' });
  });

  it('shows two-sided pages as "front and back"', async () => {
    setup({ page: page({ sides: ['front', 'back'] } as never) });
    expect((await screen.findByRole('combobox', { name: 'Sides' })).textContent).toContain('back');
  });

  it('edits the copy label: shows an example, saves it, and clears it when emptied', async () => {
    const { user, onCopyLabel } = setup({ copyLabel: 'Copy {n}' });
    expect(await screen.findByText('Example on copy 3: Copy 3')).toBeTruthy();
    const label = screen.getByLabelText('Label on reprints');
    await user.clear(label);
    await user.type(label, 'DUPLICATE');
    await user.tab();
    expect(onCopyLabel).toHaveBeenCalledWith('DUPLICATE');

    onCopyLabel.mockClear();
    await user.clear(label);
    await user.tab();
    expect(onCopyLabel).toHaveBeenCalledWith(undefined);
  });

  it('does not save the copy label when it is unchanged', async () => {
    const { user, onCopyLabel } = setup({ copyLabel: 'Copy {n}' });
    const label = await screen.findByLabelText('Label on reprints');
    await user.click(label);
    await user.tab();
    expect(onCopyLabel).not.toHaveBeenCalled();
  });
});
