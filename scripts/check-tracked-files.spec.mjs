// [75.28] Pure-function cases plus one check against the real tracked tree.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  findBadContent,
  findComposeDrift,
  findForbidden,
  readText,
} from './check-tracked-files.mjs';

describe('findForbidden', () => {
  it.each([['.env'], ['server/.env'], ['.env.production']])('flags %s', (p) => {
    expect(findForbidden([p])).toEqual([p]);
  });

  it('allows the example env files', () => {
    expect(findForbidden(['.env.example', 'server/.env.test.example'])).toEqual([]);
  });

  it('flags drafts and audit evidence', () => {
    const p = ['drafts/a.html', 'audit-evidence/x.png'];
    expect(findForbidden(p)).toEqual(p);
  });

  it('flags planning/state files', () => {
    const p = [
      '.implement-epic-state-36.md',
      '.plan-epic-epic75-security.md',
      '.epic-8.5-state.md',
    ];
    expect(findForbidden(p)).toEqual(p);
  });

  it('flags graphify output except the two root files', () => {
    expect(
      findForbidden(['server/graphify-out/graph.json', 'graphify-out/graph.json']),
    ).toHaveLength(2);
    expect(findForbidden(['graphify-out/README.md', 'graphify-out/cost.json'])).toEqual([]);
  });

  it.each([
    ['infra/secrets/prod.env'],
    ['infra/secrets/age.key'],
    ['infra/secrets/notes.txt'],
    ['certs/origin.pem'],
    ['infra/secrets/origin-ca.pem'],
    ['certs/KEY.PEM'],
    ['Infra/secrets/prod.env'],
  ])('flags plaintext secret %s', (p) => {
    expect(findForbidden([p])).toEqual([p]);
  });

  it('allows encrypted and example secret files', () => {
    const p = [
      'infra/secrets/README.md',
      'infra/secrets/prod.enc.env',
      'infra/secrets/prod.example.env',
      'infra/secrets/origin-ca.enc.pem',
      'infra/secrets/origin-ca-key.enc.pem',
    ];
    expect(findForbidden(p)).toEqual([]);
  });

  it.each([['x/server.key'], ['x/cert.p12'], ['certs/origin.enc.pem']])('flags %s', (p) => {
    expect(findForbidden([p])).toEqual([p]);
  });

  it.each([
    ['prod.env'],
    ['infra/ansible/prod.env'],
    ['server/decrypted.env'],
    ['infra/ansible/.vault_pass'],
    ['infra/ansible/.vault-password.txt'],
    ['infra/ansible/prod.env.bak'],
    ['prod.env.txt'],
    ['prod.env~'],
    ['server/.envrc'],
    ['decrypted/prod.dotenv'],
  ])('flags a stray env or vault file %s', (p) => {
    expect(findForbidden([p])).toEqual([p]);
  });

  it('allows example env files anywhere', () => {
    expect(findForbidden(['docs/sample.example.env'])).toEqual([]);
  });

  it('ignores ordinary paths', () => {
    const p = [
      'server/src/main.ts',
      'docs/architecture/08-security.md',
      '.github/workflows/ci.yml',
    ];
    expect(findForbidden(p)).toEqual([]);
  });

  it('passes on the real repo', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
      .split('\0')
      .filter(Boolean);
    expect(findForbidden(tracked)).toEqual([]);
    expect(findBadContent(tracked, readText)).toEqual([]);
  });
});

describe('findBadContent', () => {
  const run = (p, text) => findBadContent([p], () => text);
  const AGE = 'AGE-SECRET-' + 'KEY-1' + 'Q'.repeat(30);
  const PEM = '-----BEGIN ' + 'PRIVATE KEY-----';

  const SOPS_ENV =
    '#ENC[AES256_GCM,data:abc,iv:x,tag:y,type:comment]\n' +
    'JWT_SECRET=ENC[AES256_GCM,data:abc,iv:x,tag:y,type:str]\n\n' +
    'sops_mac=ENC[AES256_GCM,data:m,iv:x,tag:y,type:str]\nsops_version=3.9.0\n';

  it('fails a plaintext .enc.env, passes real sops output', () => {
    expect(run('infra/secrets/prod.enc.env', 'JWT_SECRET=x\n')).toHaveLength(1);
    expect(run('infra/secrets/prod.enc.env', SOPS_ENV)).toEqual([]);
  });

  it('fails a sops .enc.env with a line added outside sops', () => {
    expect(run('infra/secrets/prod.enc.env', SOPS_ENV + 'NEW_KEY=plaintext\n')).toHaveLength(1);
    expect(run('infra/secrets/prod.enc.env', SOPS_ENV + 'NEW_KEY=ENC[x]\n')).toHaveLength(1);
  });

  it('passes the age metadata sops writes', () => {
    const meta =
      'sops_age__list_0__map_enc=-----BEGIN AGE ENCRYPTED FILE-----\\nYWdl+/=\\n-----END AGE ENCRYPTED FILE-----\\n\n' +
      'sops_age__list_0__map_recipient=age17x5j60tf4punpm35\n' +
      'sops_lastmodified=2026-10-20T08:52:05Z\nsops_unencrypted_suffix=_unencrypted\n';
    expect(run('infra/secrets/prod.enc.env', SOPS_ENV + meta)).toEqual([]);
  });

  it.each([
    ['a plaintext comment', SOPS_ENV + '# JWT_SECRET_OLD=hunter2-real-secret\n'],
    ['only comments and a version', '# POSTGRES_PASSWORD=hunter2\n# sops_version=3\n'],
    ['an unknown sops_ key', SOPS_ENV + 'sops_backup_pw=hunter2\n'],
    ['a plaintext sops_mac', SOPS_ENV.replace(/sops_mac=[^\n]*/, 'sops_mac=hunter2')],
    [
      'a line glued on by a lone \\r',
      SOPS_ENV + 'A=ENC[AES256_GCM,x]\rPOSTGRES_PASSWORD=hunter2\n',
    ],
  ])('fails a .enc.env with %s', (_, text) => {
    expect(run('infra/secrets/prod.enc.env', text)).toHaveLength(1);
  });

  it('fails a plaintext .enc.pem, passes sops output', () => {
    expect(run('infra/secrets/origin-ca.enc.pem', PEM + '\nabc')).toHaveLength(1);
    const ok = '{"data":"ENC[AES256_GCM,data:x]","sops":{"age":[]}}';
    expect(run('infra/secrets/origin-ca.enc.pem', ok)).toEqual([]);
  });

  it('fails a .enc.pem that only mentions "sops": or holds plaintext data', () => {
    expect(run('infra/secrets/origin-ca.enc.pem', 'abc\n"sops": {}')).toHaveLength(1);
    const plain = '{"data":"-----BEGIN CERTIFICATE","sops":{"age":[]}}';
    expect(run('infra/secrets/origin-ca.enc.pem', plain)).toHaveLength(1);
  });

  it('fails a filled-in example env; allows empty values and the staging Turnstile test key', () => {
    const TEST_KEY = 'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\n';
    expect(
      run('infra/secrets/prod.example.env', '# c\nA=\nPOSTGRES_PASSWORD=hunter2\n'),
    ).toHaveLength(1);
    expect(run('infra/secrets/prod.example.env', '# Never put a value here.\nA=\n')).toEqual([]);
    expect(run('infra/secrets/staging.example.env', TEST_KEY)).toEqual([]);
    expect(run('infra/secrets/prod.example.env', TEST_KEY)).toHaveLength(1);
    expect(run('infra/secrets/prod.example.env', '#POSTGRES_PASSWORD=hunter2\n')).toHaveLength(1);
    expect(run('infra/secrets/prod.example.env', '# KEY=value pairs, empty here.\n')).toHaveLength(
      1,
    );
    expect(run('infra/secrets/prod.example.env', '# Format: one key per line.\nA=\n')).toEqual([]);
  });

  it('checks every *.example.env, not only infra/secrets', () => {
    expect(run('server/prod.example.env', 'A=filled\n')).toHaveLength(1);
    expect(run('server/prod.example.env', 'A=\n')).toEqual([]);
  });

  it('fails a decrypted secret line in any file; allows fixtures', () => {
    expect(run('notes/x.md', 'JWT_SECRET=0123456789abcdef0123\n')).toHaveLength(1);
    expect(run('a/b.txt', 'x\r\nPOSTGRES_PASSWORD=hunter2hunter2\r\n')).toHaveLength(1);
    expect(run('a/b.sh', 'JWT_SECRET=x\nHEALTH_TOKEN=$(cat t)-padding\n')).toEqual([]);
    expect(run('a/b.sh', 'JWT_SECRET=ci-jwt-do-not-use-in-production-1\n')).toEqual([]);
    expect(run('a/b.sh', 'JWT_SECRET=ENC[AES256_GCM,data:abc,iv:x]\n')).toEqual([]);
  });

  it('fails an age private key or PEM private key anywhere', () => {
    expect(run('notes/a.txt', 'key ' + AGE)).toHaveLength(1);
    expect(run('notes/b.txt', PEM)).toHaveLength(1);
  });

  it('allows the doc placeholder and unreadable files', () => {
    expect(
      run('scripts/backup/README.md', '# Private key: AGE-SECRET-KEY-1... stored offline'),
    ).toEqual([]);
    expect(run('img.png', null)).toEqual([]);
  });
});

describe('findComposeDrift', () => {
  const files = {
    'deploy/ops.yml': 'memory: ${KUMA_MEM:-384m}\nx: ${OPS_DIR:?set}/y\n',
    'infra/secrets/ops.example.env': 'KUMA_MEM=\n',
  };
  const read = (f) => files[f] ?? null;

  it('passes when the example lists the var (OPS_DIR is set by the deploy)', () => {
    expect(findComposeDrift(read)).toEqual([]);
  });

  it('names a compose var its example does not list', () => {
    const drift = findComposeDrift((f) =>
      f === 'infra/secrets/ops.example.env' ? '# none\n' : read(f),
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('KUMA_MEM');
  });

  it('also catches a bare $VAR and a lowercase name, but not an escaped $$VAR', () => {
    const drift = findComposeDrift((f) =>
      f === 'deploy/ops.yml' ? 'a: $PLAIN_VAR\nb: ${lower_var}\nc: $$ESCAPED\n' : read(f),
    );
    expect(drift.join('\n')).toMatch(/PLAIN_VAR[\s\S]*lower_var|lower_var[\s\S]*PLAIN_VAR/);
    expect(drift.join('\n')).not.toContain('ESCAPED');
  });

  it('holds for the real deploy files', () => {
    expect(findComposeDrift(readText)).toEqual([]);
  });
});
