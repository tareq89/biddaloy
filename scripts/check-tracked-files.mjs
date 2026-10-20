// [75.28] Guard: fail when a file that must stay local is tracked in git
// (env files, planning/state notes, audit evidence, derived graph output).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_ALLOWED = new Set(['.env.example', '.env.test.example']);
const GRAPHIFY_ALLOWED = new Set(['graphify-out/README.md', 'graphify-out/cost.json']);

// [61.x] infra/secrets holds only sops-encrypted files, examples and the README.
const SECRETS_ALLOWED = /^infra\/secrets\/(README\.md|[^/]+\.enc\.(env|pem)|[^/]+\.example\.env)$/;

function isForbidden(path) {
  const base = basename(path);
  if (/^infra\/secrets\//i.test(path)) return !SECRETS_ALLOWED.test(path);
  if (/\.(pem|key|p12)$/i.test(base)) return true;
  if (base === '.env' || base.startsWith('.env.')) return !ENV_ALLOWED.has(base);
  // A decrypted copy (`sops -d ... > prod.env`) anywhere else; only examples are fine.
  if (/\.env$/i.test(base)) return !/\.example\.env$/i.test(base);
  if (/^infra\/ansible\/\.vault/.test(path)) return true;
  if (/^(drafts|audit-evidence)\//.test(path)) return true;
  if (/^(\.implement-epic|\.plan-epic-)/.test(base) || /^\.epic-.*-state\.md$/.test(base)) {
    return true;
  }
  return /(^|\/)graphify-out\//.test(path) && !GRAPHIFY_ALLOWED.has(path);
}

export function findForbidden(paths) {
  return paths.filter(isForbidden);
}

// Content checks. An .enc file must really be sops output (every value
// encrypted, not just a sops footer); an example holds no values; nothing may
// hold a private key.
const AGE_KEY = /AGE-SECRET-KEY-1[A-Z0-9]{20,}/;
const PEM_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SOPS_VALUE = /^[A-Za-z_][A-Za-z0-9_]*=ENC\[AES256_GCM,/;
// Cloudflare's public always-pass Turnstile test secret (staging only, D25).
const EXAMPLE_VALUE_ALLOWED = new Set([
  'infra/secrets/staging.example.env:TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
]);

function lines(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#'));
}

function isSopsEnv(text) {
  return (
    text.includes('sops_version=') &&
    lines(text).every((l) => l.startsWith('sops_') || SOPS_VALUE.test(l))
  );
}

function isSopsBinary(text) {
  try {
    const doc = JSON.parse(text);
    return typeof doc.data === 'string' && doc.data.startsWith('ENC[') && !!doc.sops;
  } catch {
    return false;
  }
}

function isEmptyExample(p, text) {
  return lines(text).every(
    (l) => /^[A-Za-z_][A-Za-z0-9_]*=$/.test(l) || EXAMPLE_VALUE_ALLOWED.has(`${p}:${l}`),
  );
}

export function findBadContent(paths, read) {
  return paths.filter((p) => {
    const text = read(p);
    if (text === null) return false;
    if (/^infra\/secrets\/[^/]+\.enc\.env$/.test(p) && !isSopsEnv(text)) return true;
    if (/^infra\/secrets\/[^/]+\.enc\.pem$/.test(p) && !isSopsBinary(text)) return true;
    if (/^infra\/secrets\/[^/]+\.example\.env$/.test(p) && !isEmptyExample(p, text)) return true;
    return AGE_KEY.test(text) || PEM_KEY.test(text);
  });
}

export function readText(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean);
  const bad = [...new Set([...findForbidden(tracked), ...findBadContent(tracked, readText)])];
  if (bad.length === 0) {
    console.log('OK');
    return;
  }
  for (const p of bad) console.error(`tracked but must stay local: ${p}  (git rm --cached ${p})`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
