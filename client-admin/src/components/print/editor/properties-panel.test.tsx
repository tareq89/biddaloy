import '@biddaloy/ui/test';

import type { PrintElement } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from './properties-panel';

const element = {
  id: 'e1',
  type: 'TEXT',
  x: 1,
  y: 1,
  w: 60,
  h: 20,
  text: '',
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'WRAP',
} as unknown as PrintElement;

async function setup(text = '') {
  const onChange = vi.fn();
  const view = renderWithProviders(
    <PropertiesPanel
      element={{ ...element, text } as PrintElement}
      kind="STUDENT_ID_CARD"
      onChange={onChange}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
  const area = () => document.getElementById('e1-text') as HTMLTextAreaElement;
  const picker = () => document.getElementById('e1-text-insert') as HTMLElement;
  await screen.findByRole('textbox');
  return { onChange, view, area, picker };
}

describe('PropertiesPanel fixed text', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('names the insert picker for what it does, with a hint inside it', async () => {
    const { picker } = await setup();
    // Not "Field": that is the label of the field-binding select.
    expect(screen.getByRole('combobox', { name: 'Insert field' })).toBe(picker());
    expect(picker().textContent).toContain('Pick a field to add at the cursor');
  });

  it('inserts the picked field once, resets the picker and refocuses the textarea', async () => {
    const user = userEvent.setup();
    const { onChange, area, picker } = await setup();
    await user.click(area());
    await user.paste('এই মর্মে ');
    await user.click(picker());
    await user.click(await screen.findByRole('option', { name: /^Name\s—/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ text: 'এই মর্মে {{student.name}}' });
    expect(picker().textContent).not.toMatch(/Name/);
    await waitFor(() => expect(document.activeElement).toBe(area()));
  });

  it('inserts at the cursor, not at the end', async () => {
    const user = userEvent.setup();
    const { onChange, area, picker } = await setup();
    await user.type(area(), 'abcd');
    area().setSelectionRange(2, 2);
    await user.click(picker());
    await user.click(await screen.findByRole('option', { name: /^Name\s—/ }));
    expect(onChange).toHaveBeenCalledWith({ text: 'ab{{student.name}}cd' });
  });

  it('Enter makes a newline and does not commit', async () => {
    const user = userEvent.setup();
    const { onChange, area } = await setup();
    await user.type(area(), 'a{Enter}b');
    expect(area().value).toBe('a\nb');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is axe clean', async () => {
    const { view } = await setup('hello');
    await expect(view.container).toHaveNoViolations();
  });
});
