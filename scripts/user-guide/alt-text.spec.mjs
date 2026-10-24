// yarn vitest run scripts/user-guide/alt-text.spec.mjs
// Fixtures are written to a temp tree; one bad image per case.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { altProblem, checkAltText, imagesIn } from './alt-text.mjs';

function run(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'guide-alt-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const f = path.join(root, 'docs/user-guide', rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    return checkAltText(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('meaningful alt text passes, in markdown and html', () => {
  const problems = run({
    'en/a.md': '![The fee path from structure to receipt](diagrams/x.svg)\n\n<figure>\n  <img src="img/a.png" alt="Dashboard with the Attendance card">\n</figure>\n',
    'bn/a.md': '![ফির পথ: কাঠামো থেকে রসিদ](diagrams/x.svg)\n',
  });
  assert.deepEqual(problems, []);
});

test('empty, missing, generic and file-name alt text are reported', () => {
  const problems = run({
    'en/a.md': [
      '![](a.png)',
      '![Image](b.png)',
      '![screenshot 2](c.png)',
      '![d.png](d.png)',
      '<img src="e.png">',
      '<img src="f.png" alt="">',
      '<img src="g.png" alt="Screenshot">',
    ].join('\n'),
    'bn/a.md': '![ছবি](h.png)\n![স্ক্রিনশট](i.png)\n',
  });
  assert.equal(problems.length, 9);
  assert.ok(problems.every((p) => p.problem.startsWith('(l) image ')));
  assert.ok(problems.some((p) => p.file.endsWith('bn/a.md') && p.problem.includes('h.png')));
});

test('image-pending comments, code and _generated are ignored', () => {
  const problems = run({
    'en/a.md': '<!-- image pending -->\n\n```\n![](x.png)\n```\n\nUse `![](y.png)` syntax.\n',
    '_generated/b.md': '![](z.png)\n',
  });
  assert.deepEqual(problems, []);
});

test('helpers', () => {
  assert.equal(altProblem('Class 6 section B list'), null);
  assert.equal(altProblem('  '), 'empty');
  assert.deepEqual(imagesIn('<img alt="x y" src="p.png">'), [{ alt: 'x y', src: 'p.png' }]);
});
