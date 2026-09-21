import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const publicRoots = [
  'client-admin/index.html',
  'client-admin/public/',
  'client-admin/src/pwa/',
  'client-admin/src/use-breadcrumbs.ts',
  'docs/user-guide/',
  'docs/design/',
  'server/src/swagger.ts',
  'server/src/modules/account-access/',
  'server/src/modules/workbook/codec/',
  'ui/src/i18n/locales/',
  'README.md',
  'scripts/start.sh',
];
const compatibilityOnly = new Set(['docs/documentation/gitbook-setup.md']);

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && !compatibilityOnly.has(file))
  .filter((file) => publicRoots.some((root) => file === root || file.startsWith(root)));

const failures = [];
const oldBrand = /\bBiddaloy\b|\bbiddaloy\b/;
const compatibilityReference =
  /@biddaloy|biddaloy(?:[._:/-]|['"`;]|\.test|\.com)|tareq89\/biddaloy|\/opt\/biddaloy|postgres:\/\/[^\s]*biddaloy/;

for (const file of trackedFiles) {
  const content = await readFile(file, 'utf8');
  const hasOldPublicBrand = content
    .split('\n')
    .some((line) => oldBrand.test(line) && !compatibilityReference.test(line));
  if (hasOldPublicBrand) failures.push(file);
}

if (failures.length > 0) {
  console.error(`Old public branding found in: ${failures.join(', ')}`);
  process.exitCode = 1;
}
