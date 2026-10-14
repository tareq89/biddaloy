// [75.28] Guard: fail when a file that must stay local is tracked in git
// (env files, planning/state notes, audit evidence, derived graph output).
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_ALLOWED = new Set(['.env.example', '.env.test.example']);
const GRAPHIFY_ALLOWED = new Set(['graphify-out/README.md', 'graphify-out/cost.json']);

function isForbidden(path) {
  const base = basename(path);
  if (base === '.env' || base.startsWith('.env.')) return !ENV_ALLOWED.has(base);
  if (/^(drafts|audit-evidence)\//.test(path)) return true;
  if (/^(\.implement-epic|\.plan-epic-)/.test(base) || /^\.epic-.*-state\.md$/.test(base)) {
    return true;
  }
  return /(^|\/)graphify-out\//.test(path) && !GRAPHIFY_ALLOWED.has(path);
}

export function findForbidden(paths) {
  return paths.filter(isForbidden);
}

function main() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean);
  const bad = findForbidden(tracked);
  if (bad.length === 0) {
    console.log('OK');
    return;
  }
  for (const p of bad) console.error(`tracked but must stay local: ${p}  (git rm --cached ${p})`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
