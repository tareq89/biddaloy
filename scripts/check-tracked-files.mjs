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
// The only values an example may hold: public defaults, never a secret. Cloudflare's always-pass
// Turnstile test pair (staging, demo), the stack name, and the starting memory limits (D23).
const TURNSTILE_TEST = [
  'TURNSTILE_SITE_KEY=1x00000000000000000000AA',
  'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
];
const MEM_SMALL = ['APP_MEM=768m', 'PG_MEM=1g', 'REDIS_MEM=128m', 'S3_MEM=256m'];
// Test inbox values (Epic 87): the compose profile and a placeholder public URL, no secrets.
const sinkLines = (stack) => [
  'COMPOSE_PROFILES=sink',
  'MESSAGE_SINK=mailpit',
  `MESSAGE_SINK_PUBLIC_URL=https://inbox-${stack}.school.example`,
];
const EXAMPLE_VALUES_ALLOWED = {
  prod: [
    'ENV_NAME=prod',
    'COMPOSE_PROFILES=replica,backup',
    'APP_MEM=1200m',
    'PG_MEM=2g',
    'REDIS_MEM=256m',
    'S3_MEM=512m',
  ],
  staging: [
    'ENV_NAME=staging',
    'DEMO_MODE=false',
    ...MEM_SMALL,
    ...TURNSTILE_TEST,
    ...sinkLines('staging'),
    'SMOKE_INBOX_API_URL=http://staging-mailpit:8025',
  ],
  demo: ['ENV_NAME=demo', 'DEMO_MODE=true', ...MEM_SMALL, ...TURNSTILE_TEST, ...sinkLines('demo')],
  edge: ['EDGE_MODE=tunnel'],
};
const EXAMPLE_VALUE_ALLOWED = new Set(
  Object.entries(EXAMPLE_VALUES_ALLOWED).flatMap(([stack, ls]) =>
    ls.map((l) => `infra/secrets/${stack}.example.env:${l}`),
  ),
);

// Variables a deploy/*.yml file reads that the deploy sets itself (on the compose command line
// or from a path it computes), so no example lists them.
const DEPLOY_SET = new Set([
  'EDGE_DIR',
  'REPO_DIR',
  'OPS_DIR',
  'PG_TLS_DIR',
  'EDGE_TRUSTED_CIDR',
  'BACKUP_AGE_KEY_DIR',
  'ENV_BADGE', // write-env.yml derives both from the staging active db
  'ENV_BADGE_DATE',
]);
// Which examples must list the variables each compose file reads.
const COMPOSE_EXAMPLES = {
  'deploy/stack.yml': ['prod', 'staging', 'demo'],
  'deploy/edge.yml': ['edge'],
  'deploy/edge.direct.yml': ['edge'],
  'deploy/ops.yml': ['ops'],
};

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

// Drift guard: every ${VAR} a compose file reads is a key of one of its stack's example files
// (any one of prod / staging / demo for stack.yml), unless the deploy sets it. Returns messages.
export function findComposeDrift(read) {
  const keysOf = (stack) => {
    const text = read(`infra/secrets/${stack}.example.env`);
    return new Set(
      text === null
        ? []
        : lines(text).flatMap((l) => (/^[A-Za-z_][A-Za-z0-9_]*=/.test(l) ? [l.split('=')[0]] : [])),
    );
  };
  return Object.entries(COMPOSE_EXAMPLES).flatMap(([file, stacks]) => {
    const raw = read(file);
    // A renamed or unreadable mapped file must fail the guard, not pass it as "no drift".
    if (raw === null) return [`${file} is mapped in COMPOSE_EXAMPLES but could not be read`];
    // Compose does not interpolate YAML comments. ponytail: regex, not a YAML parse; a
    // " #" inside a quoted value hides the rest of that line. Use a parser if that bites.
    const text = raw.replace(/(^|\s)#.*$/gm, '$1');
    const listed = stacks.map(keysOf);
    const refs = (re) => new Set([...text.matchAll(re)].map((m) => m[1]));
    const vars = refs(/(?<!\$)\$\{?([A-Za-z_][A-Za-z0-9_]*)/g);
    // `${VAR:?}` breaks `compose up` for any stack missing it, so every example must list it;
    // an optional var only needs one stack that uses it.
    const required = refs(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g);
    return [...vars]
      .filter(
        (v) =>
          !DEPLOY_SET.has(v) &&
          !(required.has(v) ? listed.every((k) => k.has(v)) : listed.some((k) => k.has(v))),
      )
      .sort()
      .map(
        (v) =>
          `${file} reads \${${v}} but infra/secrets/{${stacks.join(',')}}.example.env does not list it`,
      );
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
  const drift = findComposeDrift(readText);
  for (const d of drift) console.error(d);
  if (bad.length === 0 && drift.length === 0) {
    console.log('OK');
    return;
  }
  for (const p of bad) console.error(`tracked but must stay local: ${p}  (git rm --cached ${p})`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
