/**
 * [Epic 44 / #2562] Builds the app's help index from the guide (E14).
 *
 *   docs/user-guide/{bn,en}/<feature path>.md   <!-- guide:meta --> helpIds, title, summary, knownIssues
 *   docs/user-guide/_generated/features.json    path + routes[]
 *   docs/user-guide/media-manifest.json         optional, per-feature video (E21)
 *        |  buildHelpIndex()
 *        v
 *   HELP_INDEX  id -> entry        HELP_ROUTES  route path -> feature id (E15)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { HelpEntry } from '@biddaloy/ui/components';

import type { Feature } from './features';
import type { GuideLang } from './field-table';

const LANGS: readonly GuideLang[] = ['bn', 'en'];

export type HelpIndexEntry = HelpEntry;
export interface BuiltHelpIndex {
  index: Record<string, HelpIndexEntry>;
  routes: Record<string, string>;
  /** Declared ids that could not be indexed (non-strict mode), each with the reason. */
  gaps: string[];
}

const META = /<!--\s*guide:meta\r?\n([\s\S]*?)-->/;

interface PageMeta {
  title: string;
  summary: string;
  helpIds: string[];
  knownIssues: number;
  anchors: Set<string>;
  fieldNs: string[];
}

const scalar = (yaml: string, key: string): string =>
  (yaml.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');

/** `helpIds: [a, b]`, possibly wrapped over lines by prettier. */
function listOf(yaml: string, key: string): string[] {
  const m = yaml.match(new RegExp(`^${key}:[ \\t]*\\n?[ \\t]*\\[([^\\]]*)\\]`, 'm'));
  return (m?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readMeta(file: string): PageMeta {
  const text = readFileSync(file, 'utf8');
  const yaml = text.match(META)?.[1];
  if (yaml === undefined) throw new Error(`${file}: no <!-- guide:meta --> comment`);
  const issues = yaml.match(/^knownIssues:[ \t]*\n((?:[ \t]+-.*\n?)*)/m)?.[1] ?? '';
  return {
    title: scalar(yaml, 'title'),
    summary: scalar(yaml, 'summary'),
    helpIds: listOf(yaml, 'helpIds'),
    knownIssues: issues.split('\n').filter((l) => /^\s+-\s/.test(l)).length,
    // Not `data-id="…"`: the char before `id` must not be a word char or `-`.
    anchors: new Set([...text.matchAll(/(?<![\w-])id="([^"]+)"/g)].map((m) => m[1]!)),
    fieldNs: [...text.matchAll(/<!-- guide:generated:fields:([^\s:]+)(?::\S+)? -->/g)].map(
      (m) => m[1]!,
    ),
  };
}

/** E10: where an id without a `#anchor` suffix points. */
const defaultAnchor = (id: string): string => {
  if (id.includes('.field.')) return 'more';
  if (id.includes('.action.') || id.includes('.section.')) return 'task-main';
  const w = id.match(/(?:^|\.)widget\.(.+)$/);
  return w ? `widget.${w[1]}` : '';
};

export function buildHelpIndex(
  root: string,
  features: Pick<Feature, 'id' | 'path' | 'routes'>[],
  { strict = true }: { strict?: boolean } = {},
): BuiltHelpIndex {
  const guide = path.join(root, 'docs/user-guide');
  const cache = new Map<string, { help?: Record<string, unknown> }>();
  const locale = (lang: string, ns: string): { help?: Record<string, unknown> } => {
    const file = path.join(root, `ui/src/i18n/locales/${lang}/${ns}.json`);
    if (!cache.has(file))
      cache.set(
        file,
        existsSync(file)
          ? (JSON.parse(readFileSync(file, 'utf8')) as { help?: Record<string, unknown> })
          : {},
      );
    return cache.get(file)!;
  };
  const manifestFile = path.join(guide, 'media-manifest.json');
  const manifest: Record<string, { youtube: Record<GuideLang, string>; durationSec: number }> =
    existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as never) : {};

  const index: Record<string, HelpIndexEntry> = {};
  const routes: Record<string, string> = {};
  const problems: string[] = [];
  const seen = new Set<string>(); // ids that were indexed (a rejected declaration does not block a later page)

  for (const f of features) {
    for (const r of f.routes ?? []) {
      // Deliberate throw even when non-strict: routes come from code (D41), not from guide data,
      // so a clash is a code bug, not a guide gap.
      if (routes[r] && routes[r] !== f.id)
        throw new Error(`HELP_ROUTES: route "${r}" is claimed by ${routes[r]} and ${f.id}`);
      routes[r] = f.id;
    }
    const pagePath = f.path.replace(/\.md$/, '');
    const bnFile = path.join(guide, 'bn', `${pagePath}.md`);
    if (!existsSync(bnFile)) continue; // no page yet: guide:check owns that
    const enFile = path.join(guide, 'en', `${pagePath}.md`);
    if (!existsSync(enFile)) throw new Error(`${path.relative(root, bnFile)}: no en twin`);
    const meta = { bn: readMeta(bnFile), en: readMeta(enFile) };
    // One count serves both languages, so a list on one page only would link the other to nothing.
    if (meta.bn.knownIssues !== meta.en.knownIssues)
      problems.push(
        `${pagePath}: "${f.id}" knownIssues differ (bn ${meta.bn.knownIssues}, en ${meta.en.knownIssues})`,
      );
    const m = manifest[f.id];
    const video = m && {
      bn: { id: m.youtube.bn, durationSec: m.durationSec },
      en: { id: m.youtube.en, durationSec: m.durationSec },
    };

    for (const raw of meta.bn.helpIds) {
      if (raw.split('#').length > 2) {
        problems.push(`${pagePath}: helpId "${raw}" has more than one #`);
        continue;
      }
      const [id, suffix] = raw.split('#') as [string, string | undefined];
      if (seen.has(id)) {
        problems.push(`helpId "${id}" is declared twice (${pagePath})`);
        continue;
      }
      const badAnchor =
        suffix !== undefined && LANGS.find((lang) => !meta[lang].anchors.has(suffix));
      if (badAnchor) {
        problems.push(
          `${badAnchor}/${pagePath}: helpId "${raw}" has no id="${suffix}" on the page`,
        );
        continue; // not `seen`: a valid declaration on a later page still indexes it
      }
      const entry: HelpIndexEntry = {
        title: { bn: meta.bn.title, en: meta.en.title },
        summary: { bn: meta.bn.summary, en: meta.en.summary },
        path: pagePath,
        anchor: suffix ?? defaultAnchor(id),
        knownIssues: meta.bn.knownIssues,
      };
      const fieldKey = id.match(/\.field\.(.+)$/)?.[1];
      if (fieldKey) {
        const ns = meta.bn.fieldNs.find((n) =>
          LANGS.every((l) => {
            const text = locale(l, n).help?.[fieldKey];
            return typeof text === 'string' && text.trim() !== '';
          }),
        );
        if (!ns) {
          problems.push(`${pagePath}: "${id}" has no help.${fieldKey} in any fields:<ns> marker`);
          continue;
        }
        entry.summary = { bn: '', en: '' };
        entry.field = { ns, key: fieldKey };
      }
      if (video) entry.video = video;
      seen.add(id); // only an id that really indexes blocks a later declaration
      index[id] = entry;
    }
  }
  // ponytail: real guide pages still hold unindexable ids (field help missing, ids declared
  // twice). `generate` runs non-strict and lists them in HELP_GAPS (feeds #3017); strict = throw.
  if (strict && problems.length) throw new Error(`help index:\n${problems.join('\n')}`);
  return { index, routes, gaps: problems };
}

export const renderHelpIndexModule = ({ index, routes, gaps }: BuiltHelpIndex): string =>
  `// GENERATED by \`yarn guide:gen\` from docs/user-guide. Do not edit.\n` +
  `import type { HelpIndex } from '@biddaloy/ui/components';\n\n` +
  `export const HELP_INDEX: HelpIndex = ${JSON.stringify(index)} as const;\n\n` +
  `export const HELP_ROUTES = ${JSON.stringify(routes)} as const;\n\n` +
  `/** Declared in the guide but not indexable yet (guide gaps, #3017). */\n` +
  `export const HELP_GAPS: readonly string[] = ${JSON.stringify(gaps)};\n`;
