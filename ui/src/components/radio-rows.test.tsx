import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RadioRows } from './radio-rows';

const options = [
  { value: 'a', title: 'Template A', caption: 'Ten lessons' },
  { value: 'b', title: 'Template B', caption: 'Six lessons', disabled: true },
  { value: 'c', title: 'Template C' },
];

function setup() {
  const onValueChange = vi.fn();
  render(
    <RadioRows value="a" onValueChange={onValueChange} options={options} legend="Templates" />,
  );
  return onValueChange;
}

describe('RadioRows', () => {
  it('names the fieldset by its legend', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Templates' })).toBeTruthy();
  });

  it('links the caption as the radio description', () => {
    setup();
    const id = screen.getByRole('radio', { name: /Template A/ }).getAttribute('aria-describedby');
    expect(document.getElementById(id as string)?.textContent).toBe('Ten lessons');
  });

  it('clicking the label selects', async () => {
    const onValueChange = setup();
    await userEvent.click(screen.getByText('Template C'));
    expect(onValueChange).toHaveBeenCalledWith('c');
  });

  it('disabled option cannot be chosen', async () => {
    const onValueChange = setup();
    await userEvent.click(screen.getByText('Template B'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
