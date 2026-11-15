import { SiteSectionKey } from '@biddaloy/shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import LangSwitch from '../components/LangSwitch.astro';
import AdmissionRibbon from './basic/AdmissionRibbon.astro';
import type { SiteManifest } from '../lib/types';
import basic from './basic';
import college from './college';
import highSchool from './high-school';
import international from './international';
import madrasa from './madrasa';
import premium from './premium';
import primary from './primary';

// Regression (#3714): in a theme preview nginx strips `/website/preview/<theme>`, and the links
// the site printed (`/bn/...`) dropped it, so one click left the preview.
const BASE = '/website/preview/primary';
const manifest = { schoolName: { bn: 'ক', en: 'A' }, contact: {} } as unknown as SiteManifest;
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('preview links keep the preview prefix', () => {
  it('language switch', async () => {
    const html = await container.renderToString(LangSwitch, {
      props: { lang: 'bn', rest: 'notices/' },
      locals: { base: BASE },
    });
    expect(hrefs(html)).toEqual([`${BASE}/bn/notices/`, `${BASE}/en/notices/`]);
  });

  for (const [name, theme] of Object.entries({
    basic,
    college,
    'high-school': highSchool,
    international,
    madrasa,
    premium,
    primary,
  })) {
    it(`${name}: section links are prefixed in a preview and plain on a school site`, async () => {
      for (const key of [SiteSectionKey.NOTICES, SiteSectionKey.HERO]) {
        const Comp = theme.sections[key]!;
        const props = {
          data: { ctaPrimary: { bn: 'ক', en: 'A' }, ctaSecondary: { bn: 'খ', en: 'B' } },
          feed: [],
          lang: 'bn',
          manifest,
        };
        const inPreview = hrefs(
          await container.renderToString(Comp, { props, locals: { base: BASE } }),
        );
        const onSchool = hrefs(await container.renderToString(Comp, { props }));
        const internal = inPreview.filter((x) => x.includes('/bn/'));
        expect(internal.length).toBeGreaterThan(0); // the section does link inside the site
        for (const h of internal) expect(h.startsWith(`${BASE}/bn/`)).toBe(true);
        expect(onSchool.every((h) => !h.includes('/website/preview/'))).toBe(true);
      }
    });
  }
});

describe('admission widgets never print a relative /admission link', () => {
  const feeds = {
    [SiteSectionKey.ADMISSIONS]: [
      { round_id: 'r1', title: 'T', deadline: '2026-12-01', open: true },
    ],
    [SiteSectionKey.ADMISSION_RESULT]: [{ round_id: 'r1', title: 'T' }],
    [SiteSectionKey.ADMISSION_LISTS]: [
      {
        list_id: 'l1',
        round_id: 'r1',
        round_title: 'T',
        kind: 'MERIT',
        sequence: 1,
        members: [{ roll: '101' }],
      },
    ],
  };
  for (const [name, theme] of Object.entries({ basic, 'high-school': highSchool, primary })) {
    it(`${name}: apply and result links carry the language and the preview prefix`, async () => {
      for (const [key, feed] of Object.entries(feeds)) {
        const Comp = theme.sections[key as SiteSectionKey]!;
        expect(Comp, key).toBeDefined();
        const props = { data: {}, feed, lang: 'bn', manifest };
        const inPreview = await container.renderToString(Comp, { props, locals: { base: BASE } });
        const onSchool = await container.renderToString(Comp, { props });
        const urls = (h: string) =>
          [...hrefs(h), ...[...h.matchAll(/action="([^"]*)"/g)].map((m) => m[1])].filter((u) =>
            u.includes('admission'),
          );
        if (key !== SiteSectionKey.ADMISSION_LISTS)
          expect(urls(inPreview).length).toBeGreaterThan(0);
        for (const u of urls(inPreview)) expect(u.startsWith(`${BASE}/bn/admission`), u).toBe(true);
        for (const u of urls(onSchool)) expect(u.startsWith('/bn/admission'), u).toBe(true);
      }
    });
  }
});

describe('admission ribbon', () => {
  const render = (link: string | undefined, base?: string) =>
    container.renderToString(AdmissionRibbon, {
      props: { lang: 'bn', link },
      locals: base ? { base } : {},
    });
  it('is hidden without a link', async () => {
    expect(hrefs(await render(undefined))).toEqual([]);
  });
  it('links with language, and the preview prefix in a preview', async () => {
    expect(hrefs(await render('/admission?round=r1'))).toEqual(['/bn/admission?round=r1']);
    expect(hrefs(await render('/admission?round=r1', BASE))).toEqual([
      `${BASE}/bn/admission?round=r1`,
    ]);
  });
});
