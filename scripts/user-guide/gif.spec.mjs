import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BYTES, makeGif } from './gif.mjs';

// CI runners have no ffmpeg; the clip-based cases need it to make input video.
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let dir;
const video = () => path.join(dir, 'in.mp4');

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gif-spec-'));
  if (!hasFfmpeg) return;
  const make = (name, seconds) =>
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=1440x900:rate=25:duration=${seconds}`,
      '-pix_fmt',
      'yuv420p',
      path.join(dir, name),
    ]);
  make('in.mp4', 3);
  make('long.mp4', 21);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('gif.mjs', () => {
  it.skipIf(!hasFfmpeg)('makes a GIF under budget from a 3 s clip', () => {
    const out = path.join(dir, 'out.gif');
    const { bytes } = makeGif({ input: video(), out });
    expect(existsSync(out)).toBe(true);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
  });

  it.skipIf(!hasFfmpeg)('rejects input longer than 20 s', () => {
    expect(() =>
      makeGif({ input: path.join(dir, 'long.mp4'), out: path.join(dir, 'x.gif') }),
    ).toThrow(/limit is 20s/);
  });

  it('rejects an explicit duration over 20 s without running ffmpeg', () => {
    expect(() => makeGif({ input: video(), out: path.join(dir, 'y.gif'), duration: 25 })).toThrow(
      /limit is 20s/,
    );
  });
});
