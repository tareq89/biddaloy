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
  // A decrypted copy (`sops -d ... > prod.env`, or its .bak/.txt/~ leftovers)
  // anywhere else; only examples are fine.
  if (/^\.envrc$|\.(env|dotenv)(\.(bak|old|orig|save|tmp|txt|swp|backup|\d+))?~?$/i.test(base)) {
    return !/\.example\.env$/i.test(base);
  }
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

// Content checks. An .enc file must really be sops output (every value and
// comment encrypted, only known sops metadata in the clear); an example holds no
// values; nothing may hold a private key or a decrypted secret line.
const AGE_KEY = /AGE-SECRET-KEY-1[A-Z0-9]{20,}/;
const PEM_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const ENC = /^ENC\[AES256_GCM,/;
const SOPS_VALUE = /^[A-Za-z_][A-Za-z0-9_]*=ENC\[AES256_GCM,/;
const SOPS_COMMENT = /^#ENC\[AES256_GCM,/;
// The clear-text metadata sops writes for an age-only dotenv file. Anything
// else named sops_* is a plaintext line in disguise.
const SOPS_META = [
  [/^sops_version$/, /^\d+\.\d+\.\d+$/],
  [/^sops_mac$/, ENC],
  [/^sops_lastmodified$/, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/],
  [/^sops_unencrypted_suffix$/, /^_unencrypted$/],
  [/^sops_age__list_\d+__map_recipient$/, /^age1[a-z0-9]+$/],
  [
    /^sops_age__list_\d+__map_enc$/,
    /^-----BEGIN AGE ENCRYPTED FILE-----[A-Za-z0-9+/=\\]*-----END AGE ENCRYPTED FILE-----(\\n)*$/,
  ],
];
// A decrypted secret line, whatever file it ended up in. Test fixtures use
// short values or a "do-not-use" / "change-me" marker.
const SECRET_LINE =
  /^(POSTGRES_PASSWORD|JWT_SECRET(_PREVIOUS)?|SETTINGS_ENCRYPTION_KEY(_PREVIOUS)?|S3_SECRET_ACCESS_KEY|BACKUP_S3_SECRET_ACCESS_KEY|BACKUP_RCLONE_CRYPT_(PASSWORD|SALT)|HEALTH_TOKEN)=([^\s$]{12,})$/;
const SECRET_PLACEHOLDER = /do-not-use|change-me/i;
// Public fixed test values (server/.env.test.example, scripts/test-env.sh).
const SECRET_VALUE_ALLOWED = new Set([
  'YmSqNpwxzusjAF12JSD+JNe+3LXrbNJiQza2yTnQyR0=',
  'ci-secret-key',
]);
// Cloudflare's public always-pass Turnstile test secret (staging only, D25).
const EXAMPLE_VALUE_ALLOWED = new Set([
  'infra/secrets/staging.example.env:TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
]);

// \r too: an old-Mac line end must not glue a plaintext line onto an ENC one.
function lines(text) {
  return text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
}

function isSopsMeta(l) {
  const i = l.indexOf('=');
  const [key, value] = [l.slice(0, i), l.slice(i + 1)];
  return i > 0 && SOPS_META.some(([k, v]) => k.test(key) && v.test(value));
}

function isSopsEnv(text) {
  const all = lines(text);
  return (
    all.some((l) => l.startsWith('sops_version=')) &&
    all.every((l) =>
      l.startsWith('#')
        ? SOPS_COMMENT.test(l)
        : l.startsWith('sops_')
          ? isSopsMeta(l)
          : SOPS_VALUE.test(l),
    )
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

// Comments are prose; a commented-out `# KEY=value` is a value.
function isEmptyExample(p, text) {
  return lines(text).every((l) =>
    l.startsWith('#')
      ? !/^#\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(l)
      : /^[A-Za-z_][A-Za-z0-9_]*=$/.test(l) || EXAMPLE_VALUE_ALLOWED.has(`${p}:${l}`),
  );
}

function hasSecretLine(text) {
  return lines(text).some((l) => {
    const m = SECRET_LINE.exec(l);
    return (
      !!m && !ENC.test(m[5]) && !SECRET_PLACEHOLDER.test(m[5]) && !SECRET_VALUE_ALLOWED.has(m[5])
    );
  });
}

export function findBadContent(paths, read) {
  return paths.filter((p) => {
    const text = read(p);
    if (text === null) return false;
    if (/^infra\/secrets\/[^/]+\.enc\.env$/.test(p) && !isSopsEnv(text)) return true;
    if (/^infra\/secrets\/[^/]+\.enc\.pem$/.test(p) && !isSopsBinary(text)) return true;
    if (/\.example\.env$/i.test(p) && !isEmptyExample(p, text)) return true;
    return AGE_KEY.test(text) || PEM_KEY.test(text) || hasSecretLine(text);
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
