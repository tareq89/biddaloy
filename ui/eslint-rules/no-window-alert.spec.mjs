import { RuleTester } from 'eslint';

import noWindowAlertPlugin from './no-window-alert.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const rule = noWindowAlertPlugin.rules['no-window-alert'];

ruleTester.run('no-window-alert', rule, {
  valid: [
    `toast.error('Something went wrong');`,
    `notifyOutcome({ variant: 'error', message: 'Import failed' });`,
    // A same-named variable that's never called isn't a call expression at all.
    `const alert = 'not a function';`,
    // A near-miss name must not false-positive.
    `window.alertSomething();`,
    // Only `window.<name>(...)` is flagged — a same-named method on some
    // other object isn't the global dialog.
    `myObj.alert('x');`,
    `dialog.confirm();`,
    // A locally shadowed `alert` (a param, a function) is a different
    // binding entirely — not the browser global.
    `function alert(message) { return message; } alert('not the global one');`,
    `function run(alert) { alert('not the global one'); }`,
    // A locally shadowed `window` — `window.alert(...)` inside it isn't
    // the real browser API either.
    `function run(window) { window.alert('not global'); }`,
    // A dynamic computed key can't be resolved statically — left
    // unflagged rather than risking a false positive.
    `const method = 'alert'; window[method]('Saved!');`,
  ],
  invalid: [
    {
      code: `window.alert('Saved!');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'window.alert' } }],
    },
    {
      code: `alert('Saved!');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'alert' } }],
    },
    {
      code: `window.confirm('Are you sure?');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'window.confirm' } }],
    },
    {
      code: `confirm('Are you sure?');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'confirm' } }],
    },
    {
      code: `window.prompt('Name?');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'window.prompt' } }],
    },
    {
      code: `prompt('Name?');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'prompt' } }],
    },
    {
      code: `window['alert']('Saved!');`,
      errors: [{ messageId: 'noWindowAlert', data: { callee: 'window.alert' } }],
    },
  ],
});
