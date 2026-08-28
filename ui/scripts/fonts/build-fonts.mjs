#!/usr/bin/env node
/**
 * Build the two self-hosted webfont subsets that `globals.css` serves as the
 * single CSS family `Biddaloy Sans` (design contract:
 * `docs/architecture/09-design-direction.md` §2).
 *
 * ## This script is DEV-ONLY. CI never runs it.
 *
 * Its outputs — `ui/src/styles/fonts/*.woff2` and the two OFL licence files —
 * are **committed**. Re-run this only when the upstream fonts, the subset
 * ranges or the weight ranges change, then commit the regenerated `.woff2`
 * files and paste the printed sizes into the PR.
 *
 * ## Prerequisite: a local Python venv with fontTools (NOT installed by npm)
 *
 * `fontTools` is a Python package, so it cannot live in `package.json`. Nobody
 * has it by default and there is no npm equivalent that can pin a variable
 * axis. Create one once, from the repo root:
 *
 * ```sh
 * python3 -m venv .venv-fonts
 * ./.venv-fonts/bin/pip install "fonttools[woff]" brotli
 * echo '.venv-fonts/' >> .git/info/exclude   # keep it out of git
 * node ui/scripts/fonts/build-fonts.mjs
 * ```
 *
 * `brotli` is what actually writes woff2; without it fontTools fails at the
 * `--flavor=woff2` step. Point `BIDDALOY_FONT_PYTHON` at a different
 * interpreter if you keep your venv elsewhere.
 *
 * ## What it does, per face
 *
 * ```text
 * google/fonts AnekX[wdth,wght].ttf   (upstream variable font, all axes)
 *   -> varLib.instancer  wdth=100, wght=<range>   (drop the width axis)
 *   -> rename name table to "Biddaloy Sans"       (CSS family == internal name)
 *   -> pyftsubset --unicodes=<script range> --layout-features='*' --flavor=woff2
 *   -> ui/src/styles/fonts/anek-<script>.woff2    (committed)
 * ```
 *
 * Dropping `wdth` is a large byte win and Biddaloy never uses width variation.
 * `--layout-features='*'` is kept deliberately: Bengali conjuncts (ক্ষ, জ্ঞ)
 * are produced by GSUB, and pruning to the default feature set would break
 * shaping. `--no-hinting` drops TrueType instructions no browser uses here.
 *
 * ## Licence
 *
 * Both families are SIL OFL 1.1 with **no** Reserved Font Name clause (the
 * upstream copyright line names no reserved name), so renaming the internal
 * name table is permitted. The OFL requires the licence to travel with the
 * font software, so this script also copies both upstream `OFL.txt` files
 * next to the `.woff2` outputs.
 *
 * ## Flags
 *
 * - `--metrics`  also print the `size-adjust` / `*-override` percentages for
 *                the metric-matched fallback faces in `globals.css`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..'); // ui/
const repoRoot = resolve(pkgRoot, '..');
const outDir = join(pkgRoot, 'src', 'styles', 'fonts');

const GF_RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl';

/**
 * `wght` ranges are not symmetric, and that asymmetry is a recorded decision,
 * not an oversight: at 400–800 the Bangla subset measured 141,116 B, over the
 * contract's 135 KB budget, so #343 used §2's one sanctioned relief valve and
 * narrowed Bangla to 400–700. The type ramp's heaviest step is 620, so nothing
 * in the design is lost. Latin stays 400–800.
 */
const FACES = [
  {
    id: 'latin',
    upstreamDir: 'aneklatin',
    ttf: 'AnekLatin[wdth,wght].ttf',
    wght: '400:800',
    out: 'anek-latin.woff2',
    licence: 'OFL-anek-latin.txt',
    budgetBytes: 45 * 1024,
    unicodes:
      'U+0000-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2212',
    // Metric-match target: Arial. It is the Latin face every desktop fallback
    // stack lands on, and its metrics are identical across platforms.
    fallback: { name: 'Arial', upm: 2048, ascent: 1854, descent: 434, lineGap: 67, xAvg: 904 },
  },
  {
    id: 'bangla',
    upstreamDir: 'anekbangla',
    ttf: 'AnekBangla[wdth,wght].ttf',
    wght: '400:700',
    out: 'anek-bangla.woff2',
    licence: 'OFL-anek-bangla.txt',
    budgetBytes: 135 * 1024,
    unicodes: 'U+0980-09FF,U+0964-0965,U+200C-200D,U+25CC',
    // Metric-match target: Noto Sans Bengali. `Nirmala UI` (Windows) and
    // `Bangla Sangam MN` (macOS) come first in the CSS `src` list, but Noto is
    // the Bengali face on Android and on the Linux headless Chrome that
    // Lighthouse CI measures the 0.1 CLS budget with — so it is the one worth
    // matching numerically.
    fallback: {
      name: 'Noto Sans Bengali',
      upm: 1000,
      ascent: 917,
      descent: 408,
      lineGap: 0,
      xAvg: 568,
    },
  },
];

function python() {
  const fromEnv = process.env.BIDDALOY_FONT_PYTHON;
  if (fromEnv) return fromEnv;
  const venv = join(repoRoot, '.venv-fonts', 'bin', 'python');
  if (existsSync(venv)) return venv;
  throw new Error(
    'No fontTools interpreter found. Create one (see the header of this file):\n' +
      '  python3 -m venv .venv-fonts && ./.venv-fonts/bin/pip install "fonttools[woff]" brotli',
  );
}

const py = python();
const run = (args, opts = {}) => execFileSync(py, args, { stdio: 'pipe', ...opts }).toString();

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** web.dev "Improved font fallbacks" formula, applied to one face. */
function overridesFor(web, fallback) {
  const pct = (n) => `${(n * 100).toFixed(3)}%`;
  const sizeAdjust = web.xAvg / web.upm / (fallback.xAvg / fallback.upm);
  return {
    'size-adjust': pct(sizeAdjust),
    'ascent-override': pct(web.ascent / web.upm / sizeAdjust),
    'descent-override': pct(web.descent / web.upm / sizeAdjust),
    'line-gap-override': pct(web.lineGap / web.upm / sizeAdjust),
  };
}

const work = mkdtempSync(join(tmpdir(), 'biddaloy-fonts-'));
mkdirSync(outDir, { recursive: true });

let overBudget = false;

for (const face of FACES) {
  const src = join(work, face.ttf);
  const licenceDest = join(outDir, face.licence);
  process.stdout.write(`\n[${face.id}] downloading ${face.ttf}\n`);
  await download(`${GF_RAW}/${face.upstreamDir}/${encodeURIComponent(face.ttf)}`, src);
  await download(`${GF_RAW}/${face.upstreamDir}/OFL.txt`, licenceDest);

  const instanced = join(work, `${face.id}-instanced.ttf`);
  process.stdout.write(`[${face.id}] instancing wdth=100 wght=${face.wght}\n`);
  run(['-m', 'fontTools.varLib.instancer', '-o', instanced, src, 'wdth=100', `wght=${face.wght}`]);

  process.stdout.write(`[${face.id}] renaming name table to "Biddaloy Sans"\n`);
  run([
    '-c',
    [
      'import sys',
      'from fontTools.ttLib import TTFont',
      'f = TTFont(sys.argv[1])',
      'n = f["name"]',
      // OFL 1.1 §3: no Reserved Font Name on either family, so a rename is
      // allowed — and it keeps the internal name equal to the CSS family.
      'n.setName("Biddaloy Sans", 1, 3, 1, 0x409)',
      'n.setName("Regular", 2, 3, 1, 0x409)',
      'n.setName("Biddaloy Sans", 4, 3, 1, 0x409)',
      'n.setName("BiddaloySans-Regular", 6, 3, 1, 0x409)',
      'n.setName("Biddaloy Sans", 16, 3, 1, 0x409)',
      'f.save(sys.argv[1])',
    ].join('\n'),
    instanced,
  ]);

  const outFile = join(outDir, face.out);
  process.stdout.write(`[${face.id}] subsetting -> ${face.out}\n`);
  run([
    '-m',
    'fontTools.subset',
    instanced,
    `--output-file=${outFile}`,
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
    '--name-IDs=0,1,2,3,4,5,6,16',
    `--unicodes=${face.unicodes}`,
  ]);

  const bytes = statSync(outFile).size;
  const kb = (bytes / 1024).toFixed(1);
  const budgetKb = (face.budgetBytes / 1024).toFixed(0);
  const ok = bytes <= face.budgetBytes;
  if (!ok) overBudget = true;
  process.stdout.write(
    `[${face.id}] ${bytes} B (${kb} KB) — budget ${budgetKb} KB — ${ok ? 'OK' : 'OVER BUDGET'}\n`,
  );

  if (process.argv.includes('--metrics')) {
    const web = JSON.parse(
      run([
        '-c',
        [
          'import json, sys',
          'from fontTools.ttLib import TTFont',
          'f = TTFont(sys.argv[1])',
          'print(json.dumps({',
          '  "upm": f["head"].unitsPerEm,',
          '  "ascent": f["hhea"].ascent,',
          '  "descent": abs(f["hhea"].descent),',
          '  "lineGap": f["hhea"].lineGap,',
          '  "xAvg": f["OS/2"].xAvgCharWidth,',
          '}))',
        ].join('\n'),
        outFile,
      ]),
    );
    process.stdout.write(
      `[${face.id}] measured: ${JSON.stringify(web)}\n` +
        `[${face.id}] fallback ${face.fallback.name}: ${JSON.stringify(face.fallback)}\n` +
        `[${face.id}] globals.css overrides: ${JSON.stringify(overridesFor(web, face.fallback), null, 2)}\n`,
    );
  }
}

process.stdout.write(
  `\nWrote ${FACES.map((f) => f.out).join(', ')} to ui/src/styles/fonts/.\n` +
    'Commit the .woff2 files and record the byte sizes in the PR description.\n',
);

if (overBudget) {
  process.stderr.write(
    '\nAt least one face is over its contract budget. Do not silently accept it:\n' +
      'narrow the Bangla wght range (§2 relief valve) and record the number.\n',
  );
  process.exit(1);
}
