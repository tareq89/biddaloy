import { RuleTester } from 'eslint';

import noWaitForTextContentPlugin from './no-wait-for-text-content.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const rule = noWaitForTextContentPlugin.rules['no-wait-for-text-content'];

ruleTester.run('no-wait-for-text-content', rule, {
  valid: [
    // The recommended replacements are untouched by this rule.
    `await screen.findByText('dark');`,
    `expect(el).toHaveTextContent('dark');`,
    // .textContent read outside any waitFor is a different, allowed shape.
    `expect(el.textContent).toBe('dark');`,
    // A waitFor callback that never touches .textContent is fine.
    `await waitFor(() => expect(screen.getByText('dark')).toBeTruthy());`,
    // A near-miss property name must not false-positive.
    `await waitFor(() => expect(el.innerText).toBe('dark'));`,
    // A dynamic computed key can't be resolved statically — left
    // unflagged rather than risking a false positive.
    `const key = 'textContent'; await waitFor(() => expect(el[key]).toBe('dark'));`,
    // .textContent inside the *options* argument's onTimeout — runs once,
    // after polling has already given up, not the eventual-consistency
    // footgun this rule targets. Must not be scoped in with the poll
    // callback (the whole point of #437's review fix).
    `await waitFor(() => expect(screen.getByText('dark')).toBeTruthy(), { onTimeout: () => el.textContent });`,
  ],
  invalid: [
    {
      code: `await waitFor(() => expect(el.textContent).toBe('dark'));`,
      errors: [{ messageId: 'noWaitForTextContent' }],
    },
    {
      code: `await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));`,
      errors: [{ messageId: 'noWaitForTextContent' }],
    },
    {
      code: `await waitFor(() => expect(el['textContent']).toBe('dark'));`,
      errors: [{ messageId: 'noWaitForTextContent' }],
    },
    {
      // A multi-line callback body — the shape most of the real sites use.
      code: `await waitFor(() =>\n  expect(el.textContent).toBe('142 payments recorded.'),\n);`,
      errors: [{ messageId: 'noWaitForTextContent' }],
    },
    {
      // Multiple .textContent reads inside one callback each get their own error.
      code: `await waitFor(() => { expect(a.textContent).toBe('x'); expect(b.textContent).toBe('y'); });`,
      errors: [{ messageId: 'noWaitForTextContent' }, { messageId: 'noWaitForTextContent' }],
    },
  ],
});
