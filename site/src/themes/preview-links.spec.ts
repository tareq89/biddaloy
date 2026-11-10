import { SiteSectionKey } from '@biddaloy/shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import LangSwitch from '../components/LangSwitch.astro';
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
