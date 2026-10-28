#!/usr/bin/env node
/**
 * [Epic 42] Turns a recording into a guide GIF: <= 960 px wide, 12 fps, with the
 * same 3 px grey frame as every guide screenshot (D48: no address-bar frame).
 * Fails when the result is over 20 s or 2 MB, so a bloated GIF never reaches a page.
 *
 *   node scripts/user-guide/gif.mjs <in.mp4|webm> <out.gif> [--start <sec>] [--duration <sec>] [--width <px>]
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_SECONDS = 20;
export const MAX_BYTES = 2 * 1024 * 1024;

export function makeGif({ input, out, start = 0, duration, width = 960 }) {
  if (duration !== undefined && duration > MAX_SECONDS) {
    throw new Error(`GIF would be ${duration}s long; the limit is ${MAX_SECONDS}s`);
  }
  const total = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input],
      { encoding: 'utf8' },
    ),
  );
  const length = duration ?? total - start;
  if (!(length > 0)) throw new Error(`nothing to encode: ${input} is ${total}s, start ${start}s`);
  if (length > MAX_SECONDS) {
    throw new Error(`GIF would be ${length.toFixed(1)}s long; the limit is ${MAX_SECONDS}s`);
  }
  const filters =
    `fps=12,scale='min(${width},iw)':-1:flags=lanczos,pad=iw+6:ih+6:3:3:color=#ced4da,` +
    'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';
  const args = ['-y', '-loglevel', 'error', '-ss', String(start)];
  if (duration !== undefined) args.push('-t', String(duration));
  execFileSync('ffmpeg', [...args, '-i', input, '-vf', filters, '-loop', '0', out]);
  const bytes = statSync(out).size;
  if (bytes > MAX_BYTES) {
    throw new Error(`${out} is ${(bytes / 1048576).toFixed(2)} MB; the limit is 2 MB`);
  }
  return { bytes, seconds: length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, out, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? undefined : Number(rest[i + 1]);
  };
  if (!input || !out) {
    console.error('usage: gif.mjs <in> <out.gif> [--start s] [--duration s] [--width px]');
    process.exit(2);
  }
  try {
    const r = makeGif({
      input,
      out,
      start: flag('start'),
      duration: flag('duration'),
      width: flag('width'),
    });
    console.log(`${out}: ${r.seconds.toFixed(1)}s, ${(r.bytes / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
