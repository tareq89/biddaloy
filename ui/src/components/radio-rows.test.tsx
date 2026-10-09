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

  it('names the radiogroup by the legend too', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Templates' })).toBeTruthy();
  });

  it('names each radio by its title only; the caption is the description, read once', () => {
    setup();
    const radio = screen.getByRole('radio', { name: 'Template A' });
    const id = radio.getAttribute('aria-describedby');
    expect(document.getElementById(id as string)?.textContent).toBe('Ten lessons');
  });

  it('clicking the caption selects too', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioRows value="c" onValueChange={onValueChange} options={options} legend="Templates" />,
    );
    await userEvent.click(screen.getByText('Template A'));
    expect(onValueChange).toHaveBeenCalledWith('a');
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
