import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const publicRoots = [
  'landing/',
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
// `by Biddaloy` is allowed: the company name appears on the landing tagline
// ("SchoolManager ERP by Biddaloy") only.
const compatibilityReference =
  /\bby Biddaloy\b|@biddaloy|biddaloy(?:[._:/-]|['"`;]|\.test|\.com)|tareq89\/biddaloy|\/opt\/biddaloy|postgres:\/\/[^\s]*biddaloy/;

// The company name (not the old product name) may appear in landing copy: footer
// tagline, about link and copyright line. Only those i18n keys are exempt; the
// rest of the landing translations are still scanned.
const companyNameAllowed = (file, line) =>
  file.startsWith('landing/src/i18n/') && /^\s*"footer\.(tagline|about|copy)"/.test(line);

for (const file of trackedFiles) {
  const content = await readFile(file, 'utf8');
  const hasOldPublicBrand = content
    .split('\n')
    .some(
      (line) =>
        oldBrand.test(line) && !compatibilityReference.test(line) && !companyNameAllowed(file, line),
    );
  if (hasOldPublicBrand) failures.push(file);
}

if (failures.length > 0) {
  console.error(`Old public branding found in: ${failures.join(', ')}`);
  process.exitCode = 1;
}
