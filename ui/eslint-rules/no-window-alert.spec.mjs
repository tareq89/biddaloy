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
  ],
});
