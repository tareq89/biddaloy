import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECOVERY_CODES_FILENAME, RecoveryCodesCard } from './recovery-codes-card';

const labels = {
  title: 'Save codes',
  description: 'Keep safe.',
  copy: 'Copy codes',
  copied: 'Copied',
  download: 'Download',
  acknowledge: 'I saved them',
};
const codes = ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'];

afterEach(() => vi.restoreAllMocks());

describe('RecoveryCodesCard', () => {
  it('lists every code', () => {
    render(<RecoveryCodesCard codes={codes} labels={labels} onAcknowledged={vi.fn()} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(codes);
  });

  it('copies the codes, one per line', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<RecoveryCodesCard codes={codes} labels={labels} onAcknowledged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(writeText).toHaveBeenCalledWith(codes.join('\n'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('downloads biddaloy-recovery-codes.txt', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    render(<RecoveryCodesCard codes={codes} labels={labels} onAcknowledged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadName).toBe(RECOVERY_CODES_FILENAME);
    expect(RECOVERY_CODES_FILENAME).toBe('biddaloy-recovery-codes.txt');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reports the acknowledge checkbox', async () => {
    const user = userEvent.setup();
    const onAcknowledged = vi.fn();
    render(<RecoveryCodesCard codes={codes} labels={labels} onAcknowledged={onAcknowledged} />);
    await user.click(screen.getByRole('checkbox', { name: 'I saved them' }));
    expect(onAcknowledged).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('checkbox', { name: 'I saved them' }));
    expect(onAcknowledged).toHaveBeenLastCalledWith(false);
  });

  it('is axe clean', async () => {
    const { container } = render(
      <RecoveryCodesCard codes={codes} labels={labels} onAcknowledged={vi.fn()} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
