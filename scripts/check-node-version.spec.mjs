// [15.6] Every case here drives the pure functions with injected version
// strings — never `process.versions.node`. This spec runs under
// `scripts:node` on whatever Node happens to be installed (locally that's
// 22, not the repo's pinned 24 — see .nvmrc); asserting against the real
// running version would make this suite red for anyone not already on the
// pinned major, which is exactly the false-confidence trap this ticket
// exists to close. Manual, real-Node verification of the CLI's actual pass/
// fail output belongs in the PR description, not here.
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  extractWorkflowNodeMajors,
  extractDockerNodeMajor,
  parseNvmrc,
} from './check-node-version.mjs';

describe('parseNvmrc', () => {
  it('reads a bare major', () => {
    expect(parseNvmrc('24\n')).toBe('24');
  });

  it('strips a leading v and a minor/patch tail', () => {
    expect(parseNvmrc('v24.19.0\n')).toBe('24');
  });

  it('throws on unparsable content', () => {
    expect(() => parseNvmrc('lts/iron\n')).toThrow(/does not start with a plain major version/);
  });
});

describe('extractWorkflowNodeMajors', () => {
  it('finds NODE_VERSION and node-version, quoted or bare', () => {
    expect(extractWorkflowNodeMajors('env:\n  NODE_VERSION: "24"\n')).toEqual(['24']);
    expect(extractWorkflowNodeMajors('        node-version: "24"\n')).toEqual(['24']);
    expect(extractWorkflowNodeMajors('        node-version: 24\n')).toEqual(['24']);
  });

  it('de-duplicates a workflow that pins the same major twice', () => {
    expect(extractWorkflowNodeMajors('NODE_VERSION: "24"\nnode-version: "24"\n')).toEqual(['24']);
  });

  it('reports both when a workflow disagrees with itself', () => {
    expect(extractWorkflowNodeMajors('NODE_VERSION: "24"\nnode-version: "22"\n')).toEqual([
      '24',
      '22',
    ]);
  });

  it('skips ${{ env.NODE_VERSION }} indirections — not a second source of truth', () => {
    expect(extractWorkflowNodeMajors('        node-version: ${{ env.NODE_VERSION }}\n')).toEqual(
      [],
    );
  });

  it('returns [] for a workflow that pins no Node at all', () => {
    expect(extractWorkflowNodeMajors('        cache: yarn\n')).toEqual([]);
  });
});

describe('evaluate', () => {
  const base = {
    requiredMajor: '24',
    workflows: [
      { file: 'ci.yml', majors: ['24'] },
      { file: 'nightly-e2e.yml', majors: ['24'] },
    ],
    dockerMajor: '26',
    runningMajor: '24',
    checkRuntime: true,
  };

  it('passes when everything agrees and the runtime matches', () => {
    const result = evaluate(base);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('notes, but does not fail on, a production Dockerfile major that differs', () => {
    const result = evaluate(base);
    expect(result.ok).toBe(true);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/production \(Dockerfile\) runs Node 26/);
  });

  it('is silent about Dockerfile when it matches the required major', () => {
    const result = evaluate({ ...base, dockerMajor: '24' });
    expect(result.notes).toEqual([]);
  });

  it('is silent about Dockerfile when there is no Dockerfile at all', () => {
    const result = evaluate({ ...base, dockerMajor: null });
    expect(result.notes).toEqual([]);
  });

  it('fails loudly, naming the fix command, when the running Node major does not match', () => {
    // This is the exact shape a Node-22 contributor sees on this branch —
    // the case the local-environment trap this ticket documents produces.
    const result = evaluate({ ...base, runningMajor: '22' });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/running Node 22/);
    expect(result.problems[0]).toMatch(/nvm install 24 && nvm use/);
  });

  it('skips the runtime check entirely when checkRuntime is false', () => {
    const result = evaluate({ ...base, runningMajor: '22', checkRuntime: false });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('fails when ci.yml has drifted from .nvmrc', () => {
    const result = evaluate({ ...base, workflows: [{ file: 'ci.yml', majors: ['23'] }] });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/ci\.yml pins Node "23"/);
  });

  // The regression that motivated enumerating the directory: workflows
  // added after this script was written (nightly-e2e.yml, ci-timings-trend.yml)
  // must be checked too, without anyone remembering to list them.
  it('fails for a workflow that did not exist when this script was written', () => {
    const result = evaluate({ ...base, workflows: [{ file: 'nightly-e2e.yml', majors: ['23'] }] });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/nightly-e2e\.yml pins Node "23"/);
  });

  it('flags every drifting workflow, not just the first', () => {
    const result = evaluate({
      ...base,
      workflows: [
        { file: 'ci.yml', majors: ['23'] },
        { file: 'nightly-e2e.yml', majors: ['22'] },
      ],
    });
    expect(result.problems).toHaveLength(2);
  });

  // Refusing to report OK on a check that examined nothing — otherwise a
  // moved directory or a broken extractor reads as a clean bill of health.
  it('fails rather than passing when no workflow pins a Node version', () => {
    const result = evaluate({ ...base, workflows: [] });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no workflow in \.github\/workflows\/ pins a Node version/);
  });

  it('can report multiple independent problems at once', () => {
    const result = evaluate({
      ...base,
      workflows: [{ file: 'ci.yml', majors: ['23'] }],
      runningMajor: '22',
    });
    expect(result.problems).toHaveLength(2);
  });
});
