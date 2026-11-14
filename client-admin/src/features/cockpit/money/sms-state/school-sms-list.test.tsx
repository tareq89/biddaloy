import '@biddaloy/ui/test';

import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { smsReportFixture } from '../../../../../../ui/src/test/msw/handlers/platform-money';
import { loadRouteNamespaces } from '../../../../route-loaders';

import { SchoolSmsList, smsLeft, worstFirst } from './school-sms-list';

beforeAll(async () => {
  await i18n.changeLanguage('en');
  await loadRouteNamespaces('money');
});

afterEach(async () => {
  await cleanupTestState();
});

const [low, ok] = smsReportFixture.schools;

describe('SchoolSmsList', () => {
  it('works out what is left and puts the school with the least first', () => {
    expect(smsLeft(low!)).toBe(50);
    expect(worstFirst([ok!, low!]).map((s) => s.schoolName)).toEqual([
      'Rose Valley School',
      'Green Hill School',
    ]);
  });

  it('is a table on desktop', () => {
    renderWithProviders(<SchoolSmsList schools={[ok!, low!]} layout="table" onOpen={vi.fn()} />, {
      locale: 'en',
    });
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText(/[0০]\.[7৭]/)).toBeTruthy();
  });

  it('is cards on a phone, with a 44 px billing button that opens the school', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SchoolSmsList schools={[ok!, low!]} layout="cards" onOpen={onOpen} />, {
      locale: 'en',
    });
    expect(screen.queryByRole('table')).toBeNull();
    const button = screen.getByRole('button', { name: 'See billing for Rose Valley School' });
    expect(button.className).toContain('min-h-11');
    await user.click(button);
    expect(onOpen).toHaveBeenCalledWith(low);
    expect(within(document.body).getByText('Green Hill School')).toBeTruthy();
  });
});
