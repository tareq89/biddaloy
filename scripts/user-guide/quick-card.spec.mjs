import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardHtml, launch, makeCard, MAX_BYTES, parseTasks, parseTitle } from './quick-card.mjs';

const tasks = [1, 2, 3, 4, 5].map((n) => `${n}. **[Task ${n}](../x/y.md#task-main)** — Step ${n} <b>.`).join('\n');
const page = (list) => `# Teacher\n\nintro\n\n## Your tasks <a href="#tasks" id="tasks"></a>\n\n${list}\n\n## Next <a href="#features" id="features"></a>\n\n9. **[Not me](a.md)** — no\n`;

let dir;
let browser;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'card-spec-'));
});
afterAll(async () => {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('quick-card parsing', () => {
  it('reads the title and exactly the 5 tasks of #tasks', () => {
    expect(parseTitle(page(tasks))).toBe('Teacher');
    const t = parseTasks(page(tasks));
    expect(t).toHaveLength(5);
    expect(t[0]).toEqual({ name: 'Task 1', step: 'Step 1 <b>.' });
  });
  it('rejects a wrong count or a missing section', () => {
    expect(() => parseTasks(page(tasks.split('\n').slice(0, 4).join('\n')))).toThrow(/want 5/);
    expect(() => parseTasks('# x')).toThrow(/no #tasks/);
  });
  it('escapes html and prints the path when no base address is set', () => {
    const html = cardHtml({ lang: 'en', role: 'teacher', title: 'Teacher', tasks: parseTasks(page(tasks)), base: undefined });
    expect(html).toContain('Step 1 &lt;b&gt;.');
    expect(html).toContain('Help Center');
    expect(cardHtml({ lang: 'bn', role: 'teacher', title: 'T', tasks: parseTasks(page(tasks)), base: 'https://h.example/' })).toContain(
      'https://h.example/bn/roles/teacher',
    );
  });
});

describe('quick-card pdf', () => {
  it('prints one A4 page under budget', async () => {
    mkdirSync(path.join(dir, 'docs/user-guide/en/roles'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/user-guide/en/roles/teacher.md'), page(tasks));
    try {
      browser = await launch();
    } catch (e) {
      console.warn(`skipping pdf test, no browser: ${e.message.split('\n')[0]}`);
      return;
    }
    const file = await makeCard({ root: dir, role: 'teacher', lang: 'en', browser });
    expect(file.endsWith('roles/cards/teacher.en.pdf')).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
    expect(statSync(file).size).toBeLessThanOrEqual(MAX_BYTES);
  }, 60_000);
});
