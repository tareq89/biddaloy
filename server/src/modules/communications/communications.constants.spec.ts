import * as fs from 'fs';
import * as path from 'path';
import { COMMUNICATIONS_QUEUE_JOB_OPTIONS } from './communications.constants';

const MODULES_DIR = path.resolve(__dirname, '..');

function moduleFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return moduleFiles(p);
    return e.name.endsWith('.module.ts') ? [p] : [];
  });
}

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

describe('COMMUNICATIONS_QUEUE_JOB_OPTIONS', () => {
  it('retries 3 times with back-off and drops finished jobs', () => {
    expect(COMMUNICATIONS_QUEUE_JOB_OPTIONS.attempts).toBe(3);
    expect(COMMUNICATIONS_QUEUE_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(COMMUNICATIONS_QUEUE_JOB_OPTIONS.removeOnComplete).toBe(true);
    expect(typeof COMMUNICATIONS_QUEUE_JOB_OPTIONS.removeOnFail).toBe('number');
  });

  it('every registerQueue({ name: COMMUNICATIONS_QUEUE }) passes the shared options', () => {
    const offenders = moduleFiles(MODULES_DIR).filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      const registrations = count(src, /name:\s*COMMUNICATIONS_QUEUE\b/g);
      const shared = count(src, /defaultJobOptions:\s*COMMUNICATIONS_QUEUE_JOB_OPTIONS\b/g);
      return registrations > 0 && registrations !== shared;
    });
    expect(offenders).toEqual([]);
  });
});
