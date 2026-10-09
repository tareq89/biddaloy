import { RuleTester } from 'eslint';

import plugin from './ux-guards.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
const bad = (code) => ({ code, errors: 1 });

ruleTester.run('no-native-picker', plugin.rules['no-native-picker'], {
  valid: ['const x = <input type="text" />;', 'const x = <Select />;', 'const x = <input />;'],
  invalid: [
    bad('const x = <select />;'),
    bad('const x = <input type="date" />;'),
    bad("const x = <input type={'month'} />;"),
    bad('const x = <input type="datetime-local" />;'),
  ],
});

ruleTester.run('no-raw-date-display', plugin.rules['no-raw-date-display'], {
  valid: ['n.toLocaleString();', 'formatDate(d);', 'd.toISOString();', 'new Date().getTime();'],
  invalid: [
    bad('d.toLocaleDateString();'),
    bad('d.toLocaleTimeString();'),
    bad('new Date(x).toLocaleString();'),
    bad('new Date().toISOString().slice(0, 10);'),
    bad("d.toISOString().split('T')[0];"),
  ],
});

ruleTester.run('no-page-max-width', plugin.rules['no-page-max-width'], {
  valid: [
    'const x = <p className="max-w-xs truncate" />;',
    'const x = <p className="max-w-[12rem]" />;',
    'const x = <p className="max-w-full max-w-sm max-w-none" />;',
    'const x = <p data-x="max-w-3xl" />;',
  ],
  invalid: [
    bad('const x = <div className="mx-auto max-w-3xl" />;'),
    bad("const x = <div className={cn('md:max-w-screen-xl', x)} />;"),
    bad('const x = <div className="max-w-prose" />;'),
  ],
});

ruleTester.run('row-actions-column', plugin.rules['row-actions-column'], {
  valid: [
    "const c = { id: 'actions', cell: () => <RowActions actions={a} /> };",
    "const c = { id: 'name' };",
  ],
  invalid: [bad("const c = { id: 'actions', cell: () => <button /> };")],
});
