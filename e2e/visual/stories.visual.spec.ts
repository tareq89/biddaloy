import { expect, test } from '@playwright/test';

import { applyDeterminism, assertLinux, readyForCapture } from './determinism';

/**
 * [8.5.4] Component-level visual suite: every Storybook story, rendered
 * from the static build served by visual-stories.config.ts. Stories opt
 * out with a `no-visual` tag. One Playwright test walks the index
 * (Playwright requires tests to be declared synchronously, and the
 * index only exists after the webServer builds Storybook) — each story
 * is a `test.step` with a soft screenshot assertion so one diff doesn't
 * hide the rest.
 */

assertLinux();

interface IndexEntry {
  id: string;
  type: string;
  tags?: string[];
}

test('every story matches its baseline', async ({ page, baseURL }) => {
  test.setTimeout(15 * 60 * 1000);
  const index = (await (await fetch(`${baseURL}/index.json`)).json()) as {
    entries: Record<string, IndexEntry>;
  };
  const stories = Object.values(index.entries).filter(
    (entry) => entry.type === 'story' && !(entry.tags ?? []).includes('no-visual'),
  );
  expect(stories.length).toBeGreaterThan(0);

  for (const story of stories) {
    await test.step(story.id, async () => {
      await applyDeterminism(page);
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      await page.waitForLoadState('networkidle');
      await readyForCapture(page);
      await expect.soft(page).toHaveScreenshot(`story-${story.id}.png`, { animations: 'disabled' });
    });
  }
});
