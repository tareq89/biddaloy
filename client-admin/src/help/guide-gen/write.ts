/**
 * [Epic 42 / #2520] `yarn guide:gen`. Computes every generated guide file from
 * app code; the golden test either compares them with disk or, with
 * `UPDATE_GUIDE=1`, rewrites them.
 *
 *   e2e/route-manifest.json + nav-tree + portal + i18n
 *        |  generate()
 *        v
 *   docs/user-guide/_generated/features.json   (consumed by scripts/user-guide/check.mjs)
 *   docs/user-guide/_generated/blocks.json     { "<lang>": { "<kind>:<id>": content }, "roleAnchors": ... }
 *   every <!-- guide:generated:<kind>:<id> --> block inside docs/user-guide/<lang>/**.md
 *   client-admin/src/help/help-index.gen.ts      HELP_INDEX + HELP_ROUTES (Epic 44, E14)
 *   the `appVersion:` line of every page's <!-- guide:meta --> comment
 *
 * Block kinds: `fields:<i18n namespace>[:<key>,<key>]`, `roles:<role-kebab>` (`roles:exam-controller`),
 * `widgets:roles` (each role's default widgets) and `widgets:sections` (one section per widget).
 * Any other kind throws: the generator for it does not exist yet (video is out, D48).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { UserRole } from '@biddaloy/shared';
import { format, resolveConfig } from 'prettier';

import { buildRoleDashboards, buildWidgetSections } from './dashboard';
import { buildFeatures, type Feature } from './features';
import { buildFieldTable, type GuideLang } from './field-table';
import { buildHelpIndex, renderHelpIndexModule } from './help-index';
import { buildRoleIndex } from './role-index';

export const LANGS: readonly GuideLang[] = ['bn', 'en'];
const MARKER = /(<!-- guide:generated:(\w+):(\S+) -->)([\s\S]*?)(<!-- \/guide:generated -->)/g;

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

/** Heading anchor: lower-case, punctuation dropped, spaces to "-". This is
 * GitHub's rule; GitBook's is checked against the live site in 42.1.07. */
export const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

const roleOf = (kebabId: string): UserRole => {
  const role = kebabId.toUpperCase().replace(/-/g, '_') as UserRole;
  if (!Object.values(UserRole).includes(role) || role === UserRole.SUPER_ADMIN)
    throw new Error(`roles:${kebabId} is not a guide role`);
  return role;
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : e.name.endsWith('.md')
        ? [path.join(dir, e.name)]
        : [],
  );
}

export interface Generated {
  /** absolute path -> full expected text */
  files: Map<string, string>;
  features: Feature[];
}

export async function generate(root: string, env: { GUIDE_SHA?: string } = {}): Promise<Generated> {
  const guide = path.join(root, 'docs/user-guide');
  const locale = (lang: string, ns: string) =>
    readJson(path.join(root, `ui/src/i18n/locales/${lang}/${ns}.json`));
  const manifest = readJson(path.join(root, 'e2e/route-manifest.json')) as {
    routes: { path: string }[];
  };
  const features = buildFeatures(manifest.routes.map((r) => r.path));
  const version = String(readJson(path.join(root, 'package.json')).version);
  const config = (await resolveConfig(path.join(root, 'x.md'))) ?? {};
  const md = async (s: string) => (await format(s, { ...config, parser: 'markdown' })).trim();
  const json = (v: unknown) => format(JSON.stringify(v), { ...config, parser: 'json' });

  const files = new Map<string, string>();
  const blocks: Record<string, Record<string, string>> = { bn: {}, en: {} };
  const roleAnchors: Record<string, Record<string, string>> = { bn: {}, en: {} };

  for (const lang of LANGS) {
    const dir = path.join(guide, lang);
    const summaries: Record<string, string> = {};
    for (const f of features) {
      const file = path.join(dir, `${f.path}.md`);
      const summary = existsSync(file) && readFileSync(file, 'utf8').match(/^summary: (.+)$/m)?.[1];
      if (summary) summaries[f.path] = summary;
    }
    const roleNames = (locale(lang, 'staff').roles ?? {}) as Record<string, string>;
    for (const role of Object.values(UserRole))
      if (role !== UserRole.SUPER_ADMIN) roleAnchors[lang]![role] = slug(roleNames[role] ?? role);

    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      let out = text;
      for (const m of [...text.matchAll(MARKER)]) {
        const [whole, open, kind, id, current, close] = m as unknown as string[];
        let want: string | null;
        if (kind === 'fields') {
          const [nsName, keys] = id!.split(':');
          want = buildFieldTable(locale(lang, nsName!), lang, nsName, keys?.split(','));
        } else if (kind === 'roles')
          want = buildRoleIndex(roleOf(id!), lang, {
            features,
            nav: locale(lang, 'nav'),
            common: locale(lang, 'common'),
            summaries,
          });
        else if (kind === 'widgets' && (id === 'roles' || id === 'sections')) {
          const deps = {
            dashboard: locale(lang, 'dashboard'),
            staff: locale(lang, 'staff'),
            sectionsPage: 'widgets.md',
          };
          want = id === 'roles' ? buildRoleDashboards(lang, deps) : buildWidgetSections(lang, deps);
        } else
          throw new Error(
            `${path.relative(root, file)}: no generator for guide:generated:${kind}:${id}`,
          );
        // ponytail: a namespace with no `help.*` yet keeps its hand-written table; recorded as-is.
        const content = want === null ? current!.trim() : await md(want);
        blocks[lang]![`${kind}:${id}`] = content;
        out = out.replace(whole!, () => `${open}\n\n${content}\n\n${close}`);
      }
      out = out.replace(/^(<!-- guide:meta[\s\S]*?)^appVersion: .*$/m, (_, head: string) => {
        const sha = env.GUIDE_SHA ?? text.match(/^appVersion: \S+ \((\w+)\)$/m)?.[1];
        return `${head}appVersion: ${version}${sha ? ` (${sha})` : ''}`;
      });
      files.set(file, out);
    }
  }

  const gen = path.join(guide, '_generated');
  files.set(path.join(gen, 'features.json'), await json(features));
  files.set(path.join(gen, 'blocks.json'), await json({ ...blocks, roleAnchors }));
  // The index reads the pages as they are on disk, before this run's rewrites. helpIds, title
  // and summary are never rewritten, but anchors inside generated blocks are (widgets:sections
  // writes the `id="widget.<key>"` headings). ponytail: a helpIds `#suffix` pointing at an anchor
  // that a generated block adds in this same run is a gap on the first run and settles on the
  // second; read the rewritten text from `files` if that ever bites.
  files.set(
    path.join(root, 'client-admin/src/help/help-index.gen.ts'),
    await format(renderHelpIndexModule(buildHelpIndex(root, features, { strict: false })), {
      ...config,
      parser: 'typescript',
    }),
  );
  return { files, features };
}

/** Writes the files that differ; returns their paths. */
export function writeGenerated({ files }: Generated): string[] {
  const changed: string[] = [];
  for (const [file, text] of files) {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    changed.push(file);
  }
  return changed;
}
