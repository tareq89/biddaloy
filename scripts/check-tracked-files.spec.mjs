// [75.28] Pure-function cases plus one check against the real tracked tree.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findBadContent, findForbidden } from './check-tracked-files.mjs';

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
  });
});

describe('findBadContent', () => {
  const run = (p, text) => findBadContent([p], () => text);
  const AGE = 'AGE-SECRET-' + 'KEY-1' + 'Q'.repeat(30);
  const PEM = '-----BEGIN ' + 'PRIVATE KEY-----';

  it('fails a plaintext .enc.env, passes real sops output', () => {
    expect(run('infra/secrets/prod.enc.env', 'JWT_SECRET=x\n')).toHaveLength(1);
    expect(run('infra/secrets/prod.enc.env', 'A=ENC[x]\nsops_version=3.9.0\n')).toEqual([]);
  });

  it('fails a plaintext .enc.pem, passes sops output', () => {
    expect(run('infra/secrets/origin-ca.enc.pem', PEM + '\nabc')).toHaveLength(1);
    expect(run('infra/secrets/origin-ca.enc.pem', '{"data":"ENC[x]","sops":{"age":[]}}')).toEqual(
      [],
    );
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
