// [Epic 42] Reads a user-guide page: the `<!-- guide:meta … -->` comment (YAML
// subset, D44) and the body. No dependency; plain node like check-public-branding.mjs.
//
// Supported YAML: `key: scalar`, `key: [a, b]` (may span lines), block lists
// (`- item`), and `{ k: v, … }` flow maps as list items. `#` starts a comment
// when preceded by whitespace. That is all the page template uses.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const META = /<!--\s*guide:meta\r?\n([\s\S]*?)-->/;

function scalar(raw) {
  const s = raw.trim();
  if (s === 'null' || s === '~' || s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

// Split on top-level commas (not inside [] or {}).
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function value(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(value);
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const pair of splitTop(s.slice(1, -1))) {
      const i = pair.indexOf(':');
      obj[pair.slice(0, i).trim()] = scalar(pair.slice(i + 1));
    }
    return obj;
  }
  return scalar(s);
}

export function parseMeta(yaml) {
  const fm = {};
  const lines = yaml.split(/\r?\n/).map((l) => l.replace(/(^|\s)#(\s.*)?$/, '').trimEnd());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z]\w*):(.*)$/);
    if (!m) continue;
    let rest = m[2].trim();
    // Prettier writes long lists as `key:\n  [a,\n   b]`.
    if (rest === '' && lines[i + 1]?.trim().startsWith('[')) rest = lines[++i].trim();
    if (rest.startsWith('[') && !rest.includes(']')) {
      while (!rest.includes(']') && i + 1 < lines.length) rest += ' ' + lines[++i].trim();
    }
    if (rest === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
        items.push(value(lines[++i].replace(/^\s+-\s+/, '')));
      }
      fm[m[1]] = items;
    } else fm[m[1]] = value(rest);
  }
  return fm;
}

/** → { fm, body, legacyFrontmatter }. `fm` is null when the page has no guide:meta. */
export function readPage(file) {
  const text = readFileSync(file, 'utf8');
  const meta = text.match(META);
  return {
    fm: meta ? parseMeta(meta[1]) : null,
    body: meta ? text.replace(META, '') : text,
    legacyFrontmatter: /^---\r?\n/.test(text),
  };
}

/** Every `.md` page of one language, as paths relative to `<root>/docs/user-guide/<lang>`. */
export function listPages(lang, root = '.') {
  const base = path.join(root, 'docs/user-guide', lang);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md') && name !== 'SUMMARY.md' && name !== 'README.md')
        out.push(path.relative(base, full));
    }
  };
  if (existsSync(base)) walk(base);
  return out.sort();
}
