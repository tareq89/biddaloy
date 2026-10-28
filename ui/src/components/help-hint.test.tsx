import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';
import finesEn from '../i18n/locales/en/fines.json';

import { HelpHint, HelpProvider, type HelpEntry, type HelpIndex } from './help-hint';

const BASE = 'https://guide.test';

const entry = (over: Partial<HelpEntry> = {}): HelpEntry => ({
  title: { bn: 'হাজিরা', en: 'Attendance' },
  summary: { bn: 'হাজিরা নিন', en: 'Take attendance' },
  path: 'attendance/register',
  anchor: 'task-main',
  knownIssues: 0,
  ...over,
});

function renderHint(
  index: HelpIndex,
  opts: { baseUrl?: string; lang?: 'bn' | 'en'; helpId?: string } = {},
) {
  const { baseUrl = BASE, lang = 'en', helpId = 'a' } = opts;
  const ui: ReactElement = (
    <HelpProvider index={index} lang={lang} baseUrl={baseUrl}>
      <HelpHint helpId={helpId} />
    </HelpProvider>
  );
  return rtlRender(ui, { wrapper: I18nProvider });
}

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

const button = () => screen.findByRole('button', { name: 'Help: Attendance' });

describe('HelpHint', () => {
  it('renders nothing without an entry', () => {
    const { container } = renderHint({}, {});
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing with an empty base URL', () => {
    const { container } = renderHint({ a: entry() }, { baseUrl: '' });
    expect(container.querySelector('button')).toBeNull();
  });

  it('has data-help-id and an accessible name with the title', async () => {
    renderHint({ a: entry() });
    expect((await button()).getAttribute('data-help-id')).toBe('a');
  });

  it('mouse hover opens after the delay and leaving closes', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    const btn = await button();
    await user.hover(btn);
    expect(screen.queryByText('Take attendance')).toBeNull();
    expect(await screen.findByText('Take attendance')).toBeTruthy();
    await user.unhover(btn);
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
  });

  it('Tab alone does not open; Enter opens and focuses the guide link', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    await button();
    await user.tab();
    expect(screen.queryByText('Take attendance')).toBeNull();
    await user.keyboard('{Enter}');
    const guide = await screen.findByRole('link', { name: 'Open the guide' });
    await waitFor(() => expect(document.activeElement).toBe(guide));
  });

  it('after a keyboard open, Tab past the last link or Shift+Tab before the first closes and refocuses the (?)', async () => {
    const user = userEvent.setup();
    rtlRender(
      <HelpProvider index={{ a: entry({ knownIssues: 1 }) }} lang="en" baseUrl={BASE}>
        <HelpHint helpId="a" />
        <button type="button">next</button>
      </HelpProvider>,
      { wrapper: I18nProvider },
    );
    const btn = await button();
    await user.tab();
    await user.keyboard('{Enter}');
    const guide = await screen.findByRole('link', { name: 'Open the guide' });
    await waitFor(() => expect(document.activeElement).toBe(guide));
    await user.tab();
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
    expect(document.activeElement).toBe(btn);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'next' }));

    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open the guide' })),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Known issues →' }));
    await user.tab({ shift: true });
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
    expect(document.activeElement).toBe(btn);
  });

  it('Esc closes, then Tab away and back works again', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    const btn = await button();
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByText('Take attendance');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
    expect(document.activeElement).toBe(btn);
    btn.blur();
    await user.tab();
    expect(document.activeElement).toBe(btn);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Take attendance')).toBeTruthy();
  });

  it('hover-open then close leaves focus in an input', async () => {
    const user = userEvent.setup();
    rtlRender(
      <HelpProvider index={{ a: entry() }} lang="en" baseUrl={BASE}>
        <input aria-label="name" />
        <HelpHint helpId="a" />
      </HelpProvider>,
      { wrapper: I18nProvider },
    );
    const btn = await button();
    const input = screen.getByRole('textbox', { name: 'name' });
    await user.click(input);
    await user.hover(btn);
    await screen.findByText('Take attendance');
    await user.unhover(btn);
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
    expect(document.activeElement).toBe(input);
  });

  it('hover then click pins the card open, even after the mouse leaves', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    const btn = await button();
    await user.hover(btn);
    await screen.findByText('Take attendance');
    await user.click(btn);
    await user.unhover(btn);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByText('Take attendance')).toBeTruthy();
  });

  it('a click-opened card does not close on mouse leave', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    const btn = await button();
    await user.click(btn);
    await screen.findByText('Take attendance');
    await user.unhover(btn);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByText('Take attendance')).toBeTruthy();
  });

  it('click opens the card', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    await user.click(await button());
    expect(await screen.findByText('Take attendance')).toBeTruthy();
  });

  it('Esc closes and returns focus to the button without re-opening', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry() });
    const btn = await button();
    await user.click(btn);
    await screen.findByText('Take attendance');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Take attendance')).toBeNull());
    expect(document.activeElement).toBe(btn);
  });

  it('guide link = base + lang + path + anchor, in a new tab', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('bn');
    renderHint({ a: entry() }, { lang: 'bn' });
    await user.click(await screen.findByRole('button', { name: 'সাহায্য: হাজিরা' }));
    const link = await screen.findByRole('link', { name: 'গাইড দেখুন' });
    expect(link.getAttribute('href')).toBe(`${BASE}/bn/attendance/register#task-main`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('a page entry (no anchor) links to the page with no bare #', async () => {
    const user = userEvent.setup();
    renderHint({ a: entry({ anchor: '' }) });
    await user.click(await button());
    const guide = await screen.findByRole('link', { name: 'Open the guide' });
    expect(guide.getAttribute('href')).toBe(`${BASE}/en/attendance/register`);
  });

  it('trims a trailing slash off the base URL and encodes the video id', async () => {
    const user = userEvent.setup();
    renderHint(
      {
        a: entry({
          video: { bn: { id: 'b', durationSec: 1 }, en: { id: 'a&b=c', durationSec: 1 } },
        }),
      },
      { baseUrl: `${BASE}//` },
    );
    await user.click(await button());
    const guide = await screen.findByRole('link', { name: 'Open the guide' });
    expect(guide.getAttribute('href')).toBe(`${BASE}/en/attendance/register#task-main`);
    expect(screen.getByRole('link', { name: /Watch the video/ }).getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=a%26b%3Dc',
    );
  });

  it('shows the known-issue line only when knownIssues > 0', async () => {
    const user = userEvent.setup();
    const none = renderHint({ a: entry() });
    await user.click(await button());
    await screen.findByText('Take attendance');
    expect(screen.queryByRole('link', { name: 'Known issues →' })).toBeNull();
    none.unmount();

    renderHint({ a: entry({ knownIssues: 2 }) });
    await user.click(await button());
    const link = await screen.findByRole('link', { name: 'Known issues →' });
    expect(link.getAttribute('href')).toBe(`${BASE}/en/attendance/register#known-issues`);
  });

  it('shows the video link only when the entry has a video (E21)', async () => {
    const user = userEvent.setup();
    const none = renderHint({ a: entry() });
    await user.click(await button());
    await screen.findByText('Take attendance');
    expect(screen.queryByRole('link', { name: /Watch the video/ })).toBeNull();
    none.unmount();

    renderHint({
      a: entry({
        video: { bn: { id: 'bnId', durationSec: 90 }, en: { id: 'enId', durationSec: 125 } },
      }),
    });
    await user.click(await button());
    const link = await screen.findByRole('link', { name: 'Watch the video · 2:05' });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=enId');
  });

  it('a field entry reads <ns>:help.<key> for its summary', async () => {
    const user = userEvent.setup();
    i18n.addResourceBundle('en', 'fieldNs', { help: { rollNo: 'Roll number help text' } }, true);
    renderHint({
      a: entry({ field: { ns: 'fieldNs', key: 'rollNo' }, summary: { bn: '', en: '' } }),
    });
    await user.click(await button());
    expect(await screen.findByText('Roll number help text')).toBeTruthy();
  });

  it('a field summary from a namespace not loaded yet shows the text, never help.<key>', async () => {
    const user = userEvent.setup();
    expect(i18n.hasLoadedNamespace('fines')).toBe(false);
    renderHint({
      a: entry({ field: { ns: 'fines', key: 'ruleTrigger' }, summary: { bn: '', en: '' } }),
    });
    await user.click(await button());
    expect(await screen.findByText(finesEn.help.ruleTrigger)).toBeTruthy();
    expect(screen.queryByText('help.ruleTrigger')).toBeNull();
  });

  it('is axe clean closed and open', async () => {
    const user = userEvent.setup();
    const { container } = renderHint({ a: entry({ knownIssues: 1 }) });
    await button();
    await expect(container).toHaveNoViolations();
    await user.click(await button());
    await screen.findByText('Take attendance');
    await expect(document.body).toHaveNoViolations();
  });
});
