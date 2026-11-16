/**
 * [59.2.06] Renders the legal Markdown subset as React elements, never as HTML:
 * `#`/`##` headings, paragraphs, `1.` lists, `-` lists, `**bold**`. Anything else
 * is shown as plain text, so a stray `<script>` is just words on the page.
 * ponytail: subset renderer; switch to a library if the texts ever need links or tables.
 */
import * as React from 'react';

export type LegalBlock =
  { kind: 'h1' | 'h2' | 'p'; text: string } | { kind: 'ol' | 'ul'; items: string[] };

const LIST: Record<'ol' | 'ul', RegExp> = { ol: /^\d+\.\s+(.*)$/, ul: /^-\s+(.*)$/ };

export function parseLegalMarkdown(src: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: heading[1] === '#' ? 'h1' : 'h2', text: heading[2] ?? '' });
      continue;
    }
    const kind = (['ol', 'ul'] as const).find((k) => LIST[k].test(line));
    if (kind) {
      const item = LIST[kind].exec(line)?.[1] ?? '';
      const last = blocks[blocks.length - 1];
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    blocks.push({ kind: 'p', text: line });
  }
  return blocks;
}

/** Text that looks like Markdown we do not support (deeper heading, quote, table, link, tag). */
export function isUnknownSyntax(text: string): boolean {
  return /^(#{3,}|[>|<])|\]\(|<\/?[a-z]/i.test(text);
}

function inline(text: string): React.ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export function LegalMarkdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-body text-text-primary">
      {parseLegalMarkdown(source).map((b, i) => {
        switch (b.kind) {
          case 'h1':
            return (
              <h2 key={i} className="text-h3 font-semibold">
                {b.text}
              </h2>
            );
          case 'h2':
            return (
              <h3 key={i} className="mt-2 text-body font-semibold">
                {b.text}
              </h3>
            );
          case 'ol':
          case 'ul': {
            const List = b.kind;
            return (
              <List
                key={i}
                className={`flex flex-col gap-2 ps-5 ${b.kind === 'ol' ? 'list-decimal' : 'list-disc'}`}
              >
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </List>
            );
          }
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
